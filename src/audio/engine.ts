/**
 * 오디오 엔진. UI와 분리된 순수 TypeScript 모듈.
 *
 * 그래프: Voice(source → env → ctl) → master → output.input → (출력 경로)
 *
 * 규칙
 * - AudioContext는 앱 전체에 하나. 사용자 탭에서 생성/재개한다.
 * - 동시에 "현재 재생"은 하나. 새로 재생하면 이전 재생은 짧게 줄인 뒤 정지한다.
 * - 볼륨 변화는 모두 AudioParam 예약으로 처리한다. 타이머로 볼륨을 바꾸지 않는다.
 * - 위치는 AudioContext.currentTime 기준으로 계산한다.
 */
import type { CueRange } from './envelope.ts'
import { decodeAudio } from './decode.ts'
import { createOutput, resolveOutputKind, type Output } from './output.ts'
import type {
  ContextState,
  CueSettings,
  EngineListener,
  EngineSnapshot,
  OutputMode,
  PlaybackState,
} from './types.ts'
import { DECLICK, Voice } from './voice.ts'
import { dbToGain } from './volume.ts'

/** 재생 가능한 최소 길이(초) */
const MIN_LENGTH = 0.005

const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'] as const

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private output: Output | null = null
  private analyser: AnalyserNode | null = null
  private outputMode: OutputMode = 'auto'
  /** AudioContext와 출력이 한 번이라도 함께 정상이었는지 (그 전에는 재연결 안내를 띄우지 않는다) */
  private everRunning = false
  private masterDb = 0

  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly loading = new Map<string, Promise<AudioBuffer>>()

  /** 지금 재생/페이드 중인 Voice */
  private current: Voice | null = null
  /** 정지 페이드 중인 것까지 포함한 살아 있는 모든 Voice */
  private readonly voices = new Set<Voice>()
  private state: PlaybackState = 'stopped'
  private currentCue: CueSettings | null = null
  /** 지금 재생이 큐 페이드 인을 무시하는 재생(마커 재생)인지. 이어 재생/위치 이동/설정 변경 때도 유지한다 */
  private ignoreFadeIn = false
  private paused: { cue: CueSettings; position: number; ignoreFadeIn: boolean } | null = null

  private readonly listeners = new Set<EngineListener>()
  private snapshot: EngineSnapshot
  private tickHandle: number | null = null

  constructor() {
    this.snapshot = this.buildSnapshot()
    if (typeof window !== 'undefined') {
      const onGesture = () => this.unlock()
      for (const type of GESTURE_EVENTS) {
        window.addEventListener(type, onGesture, { capture: true, passive: true })
      }
      // 화면이 다시 보이면 상태와 위치 표시를 실제 값으로 다시 맞춘다
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.emit()
      })
    }
  }

  // ───────────────────────── AudioContext ─────────────────────────

  /**
   * 사용자 탭 안에서 호출. AudioContext를 만들거나 재개하고, 출력(<audio>)을 재생 상태로 만든다.
   * 엔진이 window의 탭/키 입력마다 자동으로 호출하므로 보통 직접 부를 필요는 없다.
   * (suspended / interrupted가 되면 다음 사용자 조작 때 자동으로 resume을 시도)
   */
  unlock(): void {
    const ctx = this.ensureContext()
    const st = ctx.state as string
    if (st !== 'running' && st !== 'closed') {
      ctx.resume().catch(() => {
        /* 탭 밖이면 실패할 수 있음. 다음 탭에서 다시 시도 */
      })
    }
    this.output?.unlock()
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = dbToGain(this.masterDb)
    this.attachOutput(createOutput(ctx, this.outputMode))

    ctx.addEventListener('statechange', () => this.emit())
    this.emit()
    return ctx
  }

  // ───────────────────────── 출력 경로 ─────────────────────────

  private attachOutput(output: Output): void {
    this.output = output
    this.master!.connect(output.input)
    output.onChange = () => this.emit()
  }

  /**
   * 출력 경로 강제 변경 (숨은 옵션: 문제 비교용). 사용자 탭 안에서 호출할 것.
   * AudioContext가 아직 없으면 값만 기억했다가 만들 때 적용한다.
   */
  setOutputMode(mode: OutputMode): void {
    this.outputMode = mode
    if (this.ctx && this.master && this.output) {
      const kind = resolveOutputKind(mode)
      if (kind !== this.output.kind) {
        this.master.disconnect(this.output.input)
        this.output.dispose()
        this.attachOutput(createOutput(this.ctx, mode))
        this.output!.unlock()
      }
    }
    this.emit()
  }

  // ───────────────────────── 음원 로드 ─────────────────────────

  /**
   * ArrayBuffer를 디코딩해서 id로 캐시한다. 이미 있으면 캐시를 돌려준다.
   * 주의: 넘긴 ArrayBuffer는 디코딩 후 비워질 수 있다(detached). 다시 쓸 거면 복사본을 넘길 것.
   */
  load(audioId: string, data: ArrayBuffer): Promise<AudioBuffer> {
    const cached = this.buffers.get(audioId)
    if (cached) return Promise.resolve(cached)
    const inFlight = this.loading.get(audioId)
    if (inFlight) return inFlight

    const ctx = this.ensureContext()
    const p: Promise<AudioBuffer> = decodeAudio(ctx, data).then(
      (buffer) => {
        // 디코딩 중에 unload되었다면 캐시하지 않는다
        if (this.loading.get(audioId) === p) {
          this.loading.delete(audioId)
          this.buffers.set(audioId, buffer)
        }
        return buffer
      },
      (err: unknown) => {
        if (this.loading.get(audioId) === p) this.loading.delete(audioId)
        throw err
      },
    )
    this.loading.set(audioId, p)
    return p
  }

  isLoaded(audioId: string): boolean {
    return this.buffers.has(audioId)
  }

  /** 디코딩해서 캐시에 올라가 있는 음원 id 목록 */
  loadedIds(): string[] {
    return [...this.buffers.keys()]
  }

  /** 디코딩된 길이(초). 로드 안 됐으면 null */
  getDuration(audioId: string): number | null {
    return this.buffers.get(audioId)?.duration ?? null
  }

  /** 캐시 해제. 이 음원을 재생/일시정지 중이면 정지한다. */
  unload(audioId: string): void {
    if (this.current?.audioId === audioId) this.stop()
    if (this.paused?.cue.audioId === audioId) {
      this.paused = null
      this.setState('stopped')
    }
    this.loading.delete(audioId)
    this.buffers.delete(audioId)
  }

  // ───────────────────────── 재생 ─────────────────────────

  /**
   * 재생. 인 포인트(또는 startAt)에서 시작해 아웃 포인트에서 자동 종료.
   * 재생 중이면 이전 재생은 짧은 페이드(10ms) 후 정지하고 새로 시작한다.
   * @param startAt 파일 위치(초). 주면 그 지점부터 재생 (마커 점프용). 인/아웃 범위로 맞춘다.
   * @param options.fadePreviousSeconds 이전 재생을 이 시간 동안 페이드 아웃하며 새로 재생 (기본 10ms)
   * @param options.ignoreFadeIn 큐의 페이드 인 설정을 쓰지 않는다 (마커 재생). 페이드 아웃과 아웃 포인트는 그대로.
   * @param options.startFade 시작할 때 0에서 올라오는 시간(초). 기본 10ms
   */
  play(cue: CueSettings, startAt?: number, options?: PlayOptions): void {
    const buffer = this.buffers.get(cue.audioId)
    if (!buffer) throw new Error(`로드되지 않은 음원입니다: ${cue.audioId}`)

    this.unlock()
    const ctx = this.ensureContext()
    const ignoreFadeIn = options?.ignoreFadeIn ?? false
    const range = toRange(cue, buffer.duration, ignoreFadeIn)
    if (range.outPoint - range.inPoint < MIN_LENGTH) throw new Error('인/아웃 포인트 사이가 너무 짧습니다')

    const from = clamp(startAt ?? range.inPoint, range.inPoint, range.outPoint - MIN_LENGTH)

    this.releaseCurrent(Math.max(DECLICK, options?.fadePreviousSeconds ?? DECLICK))
    this.paused = null

    const voice = new Voice(ctx, this.master!, buffer, cue.audioId, range, from, options?.startFade)
    voice.onEnded = (v) => this.handleVoiceEnded(v)
    this.voices.add(voice)
    this.current = voice
    this.currentCue = cue
    this.ignoreFadeIn = ignoreFadeIn
    this.setState('playing')
  }

  /** 클릭 소리가 나지 않게 10ms 페이드 후 정지 */
  stop(): void {
    this.releaseCurrent(DECLICK)
    this.paused = null
    this.currentCue = null
    this.setState('stopped')
  }

  /** seconds 동안 페이드 아웃 후 정지. 끝나면 state가 stopped가 된다. */
  fadeOutAndStop(seconds: number): void {
    if (!this.current) return
    if (!(seconds > DECLICK)) {
      this.stop()
      return
    }
    this.current.release(seconds)
    this.setState('fading')
  }

  /** 위치를 기억하고 정지. 페이드 아웃 중이면 stop()과 같다. */
  pause(): void {
    if (this.state === 'fading') {
      this.stop()
      return
    }
    if (this.state !== 'playing' || !this.current || !this.currentCue || !this.ctx) return
    const position = this.current.position(this.ctx.currentTime)
    const cue = this.currentCue
    this.releaseCurrent(DECLICK)
    this.paused = { cue, position, ignoreFadeIn: this.ignoreFadeIn }
    this.setState('paused')
  }

  /** 일시정지한 위치부터 이어서 재생 */
  resume(): void {
    if (this.state !== 'paused' || !this.paused) return
    const { cue, position, ignoreFadeIn } = this.paused
    const duration = this.getDuration(cue.audioId)
    const out = duration === null ? 0 : toRange(cue, duration).outPoint
    if (position >= out - MIN_LENGTH) {
      this.stop()
      return
    }
    this.play(cue, position, { ignoreFadeIn })
  }

  /**
   * 재생/일시정지 중인 큐의 설정이 바뀌었을 때 호출. 지금 나는 소리에 바로 반영한다.
   * - 페이드/볼륨만 바뀌면: 재생을 끊지 않고 볼륨 곡선만 다시 예약
   * - 인/아웃 포인트가 바뀌면: 지금 위치(새 범위 안으로 맞춤)에서 다시 재생
   * - 지금 위치가 새 아웃 포인트를 지났으면: 정지
   * 다른 음원을 재생 중이면 무시한다.
   */
  applyCueSettings(cue: CueSettings): void {
    const buffer = this.buffers.get(cue.audioId)
    if (!buffer) return
    if (this.state === 'paused' && this.paused?.cue.audioId === cue.audioId) {
      const next = toRange(cue, buffer.duration)
      if (next.outPoint - next.inPoint < MIN_LENGTH) return
      const position = clamp(this.paused.position, next.inPoint, next.outPoint - MIN_LENGTH)
      this.paused = { ...this.paused, cue, position }
      this.emit()
      return
    }
    if (!this.current || !this.currentCue || !this.ctx || this.currentCue.audioId !== cue.audioId) return

    const next = toRange(cue, buffer.duration, this.ignoreFadeIn)
    if (next.outPoint - next.inPoint < MIN_LENGTH) return
    const prev = toRange(this.currentCue, buffer.duration, this.ignoreFadeIn)
    this.currentCue = cue
    if (this.state === 'fading') return // 정지하려고 줄어드는 중이면 그대로 둔다

    if (prev.inPoint === next.inPoint && prev.outPoint === next.outPoint) {
      this.current.reschedule(next)
      return
    }
    const pos = this.current.position(this.ctx.currentTime)
    if (pos >= next.outPoint - 0.05) {
      this.stop()
      return
    }
    this.play(cue, Math.max(pos, next.inPoint), { ignoreFadeIn: this.ignoreFadeIn })
  }

  /**
   * 위치 이동(초, 파일 기준). 재생 중이면 그 지점부터 다시 재생하고,
   * 일시정지 중이면 이어 재생할 위치만 바꾼다. 정지 상태면 무시.
   */
  seek(position: number): void {
    if (this.state === 'paused' && this.paused) {
      const duration = this.getDuration(this.paused.cue.audioId)
      if (duration === null) return
      const r = toRange(this.paused.cue, duration)
      this.paused = { ...this.paused, position: clamp(position, r.inPoint, r.outPoint - MIN_LENGTH) }
      this.emit()
      return
    }
    if ((this.state === 'playing' || this.state === 'fading') && this.currentCue) {
      this.play(this.currentCue, position, { ignoreFadeIn: this.ignoreFadeIn })
    }
  }

  /** 모든 소리를 즉시 정지 (페이드 없음) */
  panic(): void {
    const all = [...this.voices]
    this.current = null
    this.paused = null
    this.currentCue = null
    for (const v of all) v.kill()
    this.voices.clear()
    this.setState('stopped')
  }

  // ───────────────────────── 마스터 볼륨 ─────────────────────────

  setMasterVolumeDb(db: number): void {
    this.masterDb = db
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      // 값이 툭 바뀌며 생기는 잡음을 막기 위해 약 15ms에 걸쳐 따라가게 한다
      this.master.gain.setTargetAtTime(dbToGain(db), now, 0.015)
    }
  }

  getMasterVolumeDb(): number {
    return this.masterDb
  }

  // ───────────────────────── 상태 구독 ─────────────────────────

  /** 마지막으로 알린 상태 (React useSyncExternalStore용, 구독 중일 때 프레임마다 갱신) */
  getSnapshot = (): EngineSnapshot => this.snapshot

  /** 지금 이 순간의 위치(초). 구독 없이 바로 읽을 때 사용 */
  getPosition(): number {
    if (this.current && this.ctx) return this.current.position(this.ctx.currentTime)
    return this.paused?.position ?? 0
  }

  /** 상태가 바뀔 때, 그리고 재생/페이드 중에는 화면 프레임마다 호출된다 */
  subscribe = (listener: EngineListener): (() => void) => {
    this.listeners.add(listener)
    this.updateTicker()
    return () => {
      this.listeners.delete(listener)
      this.updateTicker()
    }
  }

  // ───────────────────────── 측정/진단용 ─────────────────────────

  /** 마스터 출력 신호를 보는 AnalyserNode (레벨 미터, 지연 측정용) */
  getAnalyser(): AnalyserNode {
    const ctx = this.ensureContext()
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.master!.connect(this.analyser)
    }
    return this.analyser
  }

  getContextInfo(): { sampleRate: number; baseLatency: number | null; outputLatency: number | null } | null {
    if (!this.ctx) return null
    const c = this.ctx as AudioContext & { outputLatency?: number }
    return {
      sampleRate: c.sampleRate,
      baseLatency: typeof c.baseLatency === 'number' ? c.baseLatency : null,
      outputLatency: typeof c.outputLatency === 'number' ? c.outputLatency : null,
    }
  }

  // ───────────────────────── 내부 ─────────────────────────

  private releaseCurrent(seconds: number): void {
    const v = this.current
    this.current = null
    v?.release(seconds)
  }

  private handleVoiceEnded(v: Voice): void {
    this.voices.delete(v)
    if (v === this.current) {
      // 아웃 포인트 도달 또는 페이드 아웃 완료
      this.current = null
      this.currentCue = null
      this.setState('stopped')
    }
  }

  private setState(s: PlaybackState): void {
    this.state = s
    this.emit()
    this.updateTicker()
  }

  private buildSnapshot(): EngineSnapshot {
    const healthy = !!this.ctx && this.ctx.state === 'running' && !(this.output?.isPaused() ?? false)
    if (healthy) this.everRunning = true
    const now = this.ctx?.currentTime ?? 0
    let position = 0
    let audioId: string | null = null
    if (this.current) {
      position = this.current.position(now)
      audioId = this.current.audioId
    } else if (this.paused) {
      position = this.paused.position
      audioId = this.paused.cue.audioId
    }
    return {
      state: this.state,
      position,
      audioId,
      contextState: (this.ctx?.state ?? 'none') as ContextState,
      outputMode: this.outputMode,
      outputKind: this.output?.kind ?? null,
      needsReconnect: this.everRunning && !healthy,
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const l of this.listeners) l(this.snapshot)
  }

  /** 재생/페이드 중이고 구독자가 있을 때만 프레임마다 위치를 알린다 (화면 표시용, 소리와 무관) */
  private updateTicker(): void {
    const active = (this.state === 'playing' || this.state === 'fading') && this.listeners.size > 0
    if (active && this.tickHandle === null) {
      const tick = () => {
        this.emit()
        this.tickHandle = requestAnimationFrame(tick)
      }
      this.tickHandle = requestAnimationFrame(tick)
    } else if (!active && this.tickHandle !== null) {
      cancelAnimationFrame(this.tickHandle)
      this.tickHandle = null
    }
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** 큐 설정을 파일 길이에 맞게 정리 */
export interface PlayOptions {
  fadePreviousSeconds?: number
  ignoreFadeIn?: boolean
  startFade?: number
}

function toRange(cue: CueSettings, duration: number, ignoreFadeIn = false): CueRange {
  const inPoint = clamp(Number.isFinite(cue.inPoint) ? cue.inPoint : 0, 0, duration)
  const rawOut = cue.outPoint === null || !Number.isFinite(cue.outPoint) ? duration : cue.outPoint
  const outPoint = clamp(rawOut, inPoint, duration)
  const len = outPoint - inPoint
  return {
    inPoint,
    outPoint,
    fadeIn: ignoreFadeIn ? 0 : clamp(cue.fadeIn || 0, 0, len),
    fadeOut: clamp(cue.fadeOut || 0, 0, len),
    gain: dbToGain(cue.volumeDb),
  }
}
