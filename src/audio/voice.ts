/**
 * Voice = 한 번의 재생. 재생할 때마다 새로 만들고, 끝나면 버린다.
 * (AudioBufferSourceNode는 한 번만 start할 수 있으므로 재사용하지 않는다)
 *
 * source → env(큐 볼륨 곡선) → ctl(시작/정지 디클릭, 수동 페이드 아웃) → 출력
 *
 * env와 ctl을 나눠서, 정지·페이드 아웃이 큐 볼륨 곡선 예약을 건드리지 않게 한다.
 * ctl의 현재 값은 직접 계산해서 알고 있으므로 연속 조작에도 값이 튀지 않는다.
 */
import { scheduleEnvelope, type CueRange } from './envelope.ts'

/** 시작/정지 때 딸깍 소리를 없애는 짧은 페이드 길이(초) */
export const DECLICK = 0.01

interface Ramp {
  t0: number
  v0: number
  t1: number
  v1: number
}

export class Voice {
  readonly audioId: string
  /** 재생을 시작한 파일 위치(초) */
  readonly offset: number
  /** 자동 종료되는 파일 위치(초) = 아웃 포인트 */
  readonly end: number
  /** offset 위치가 소리 나기 시작하는 AudioContext 시각 */
  readonly startTime: number
  onEnded: ((v: Voice) => void) | null = null

  private readonly ctx: AudioContext
  private readonly source: AudioBufferSourceNode
  private readonly env: GainNode
  private readonly ctl: GainNode
  private ctlRamp: Ramp
  private stopAt: number | null = null
  private ended = false

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    audioId: string,
    range: CueRange,
    offset: number,
  ) {
    this.ctx = ctx
    this.audioId = audioId
    this.offset = offset
    this.end = range.outPoint

    const when = ctx.currentTime
    this.startTime = when

    this.source = ctx.createBufferSource()
    this.source.buffer = buffer
    this.env = ctx.createGain()
    this.ctl = ctx.createGain()
    this.source.connect(this.env)
    this.env.connect(this.ctl)
    this.ctl.connect(destination)

    scheduleEnvelope(this.env.gain, range, offset, when)

    this.ctl.gain.setValueAtTime(0, when)
    this.ctl.gain.linearRampToValueAtTime(1, when + DECLICK)
    this.ctlRamp = { t0: when, v0: 0, t1: when + DECLICK, v1: 1 }

    this.source.onended = () => this.finish()
    // duration을 주면 아웃 포인트에서 오디오 스레드가 알아서 멈춘다
    this.source.start(when, offset, Math.max(0, this.end - offset))
  }

  get isEnded(): boolean {
    return this.ended
  }

  /**
   * 볼륨 곡선(페이드, 큐 볼륨)만 바꾼다. 재생은 끊지 않는다.
   * 인/아웃 포인트는 바꿀 수 없으므로(이미 시작한 source의 길이는 고정) 같은 값이어야 한다.
   */
  reschedule(range: CueRange): void {
    if (this.ended) return
    const now = this.ctx.currentTime
    scheduleEnvelope(this.env.gain, range, this.position(now), now)
  }

  /** 현재 파일 위치(초) */
  position(now: number): number {
    return Math.min(this.end, this.offset + Math.max(0, now - this.startTime))
  }

  private ctlAt(t: number): number {
    const r = this.ctlRamp
    if (t <= r.t0) return r.v0
    if (t >= r.t1) return r.v1
    return r.v0 + ((r.v1 - r.v0) * (t - r.t0)) / (r.t1 - r.t0)
  }

  /**
   * seconds 동안 줄인 뒤 정지. 이미 더 빨리 끝나도록 예약돼 있으면 무시한다.
   * (페이드 아웃 중 stop()을 누르면 더 짧은 쪽으로 바뀐다)
   */
  release(seconds: number): void {
    if (this.ended) return
    const now = this.ctx.currentTime
    const endT = now + Math.max(DECLICK, seconds)
    if (this.stopAt !== null && this.stopAt <= endT) return

    const g = this.ctl.gain
    const v = this.ctlAt(now)
    g.cancelScheduledValues(now)
    g.setValueAtTime(v, now)
    g.linearRampToValueAtTime(0, endT)
    this.ctlRamp = { t0: now, v0: v, t1: endT, v1: 0 }
    this.stopAt = endT
    try {
      this.source.stop(endT + 0.005)
    } catch {
      /* 오래된 사파리는 stop() 두 번째 호출에서 예외. 이미 볼륨 0으로 가므로 무시 */
    }
  }

  /** 즉시 정지 (패닉용) */
  kill(): void {
    if (this.ended) return
    const now = this.ctx.currentTime
    this.ctl.gain.cancelScheduledValues(0)
    this.ctl.gain.setValueAtTime(0, now)
    try {
      this.source.stop()
    } catch {
      /* 무시: 바로 아래에서 연결을 끊으므로 소리는 나지 않는다 */
    }
    this.finish()
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    this.source.onended = null
    this.source.disconnect()
    this.env.disconnect()
    this.ctl.disconnect()
    this.onEnded?.(this)
  }
}
