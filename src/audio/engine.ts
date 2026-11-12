/**
 * 오디오 엔진. UI와 분리된 순수 TypeScript 모듈.
 *
 * 그래프: Voice(source → env → ctl) → master → output.input → (출력 경로)
 *
 * 규칙
 * - AudioContext는 앱 전체에 하나. 사용자 탭에서 생성/재개한다.
 * - 재생은 key(보통 큐 id)별로 관리한다. 같은 key를 다시 재생하면 그 재생만 새로 시작한다.
 *   - 기본: 새로 재생하면 다른 재생은 짧게(또는 fadePreviousSeconds 동안) 줄인 뒤 정지 (재생은 하나)
 *   - layer: 다른 재생을 그대로 두고 겹쳐 재생 (QLab 방식)
 * - 정지/페이드/일시정지/이어 재생/위치 이동은 key를 주면 그 재생에만, 안 주면 전체(위치 이동은 주 재생)에 적용한다.
 * - 볼륨 변화는 모두 AudioParam 예약으로 처리한다. 타이머로 볼륨을 바꾸지 않는다.
 * - 위치는 AudioContext.currentTime 기준으로 계산한다.
 */
import { cueRange } from './envelope.ts'
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

  /** key별 재생 (재생 중/페이드 중/일시정지). Map 순서 = 시작한 순서 */
  private readonly playbacks = new Map<string, Playback>()
  /** 정지 페이드 중인 것까지 포함한 살아 있는 모든 Voice */
  private readonly voices = new Set<Voice>()

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

  /** 디코딩 중이면 그 작업 (같은 원본을 다시 읽지 않도록) */
  loadingPromise(audioId: string): Promise<AudioBuffer> | undefined {
    return this.loading.get(audioId)
  }

  /**
   * 디코딩 오디오가 차지하는 메모리(바이트).
   * cached: 캐시에 있는 것, voicesOnly: 캐시에서 내렸지만 아직 소리(페이드 중 등)가 붙잡고 있는 것
   */
  memoryInUse(): { cached: number; voicesOnly: number; byId: Record<string, number> } {
    const byId: Record<string, number> = {}
    let cached = 0
    for (const [id, b] of this.buffers) {
      byId[id] = b.length * b.numberOfChannels * 4
      cached += byId[id]
    }
    let voicesOnly = 0
    for (const v of this.voices) if (!this.buffers.has(v.audioId)) voicesOnly += v.bufferBytes
    return { cached, voicesOnly, byId }
  }

  /** 디코딩된 오디오가 될 샘플레이트 (AudioContext가 없으면 48kHz로 본다) */
  get decodeSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000
  }

  /** 디코딩해서 캐시에 올라가 있는 음원 id 목록 */
  loadedIds(): string[] {
    return [...this.buffers.keys()]
  }

  /** 디코딩된 길이(초). 로드 안 됐으면 null */
  getDuration(audioId: string): number | null {
    return this.buffers.get(audioId)?.duration ?? null
  }

  /** 캐시 해제. 이 음원을 재생/일시정지 중인 재생은 정지한다. */
  unload(audioId: string): void {
    for (const pb of [...this.playbacks.values()]) if (pb.cue.audioId === audioId) this.stop(pb.key)
    this.loading.delete(audioId)
    this.buffers.delete(audioId)
  }

  // ───────────────────────── 재생 ─────────────────────────

  /**
   * 재생. 인 포인트(또는 startAt)에서 시작해 아웃 포인트에서 자동 종료.
   * @param startAt 파일 위치(초). 주면 그 지점부터 재생 (마커 점프용). 인/아웃 범위로 맞춘다.
   * @param options.key 재생 이름 (기본: 음원 id). 같은 key가 재생 중이면 그 재생만 새로 시작한다
   * @param options.layer true면 다른 재생을 그대로 두고 겹쳐 재생 (QLab 방식)
   * @param options.fadePreviousSeconds 겹치지 않을 때 다른 재생을 이 시간 동안 페이드 아웃 (기본 10ms)
   * @param options.ignoreFadeIn 큐의 페이드 인 설정을 쓰지 않는다 (마커 재생). 페이드 아웃과 아웃 포인트는 그대로.
   * @param options.startFade 시작할 때 0에서 올라오는 시간(초). 기본 10ms
   */
  play(cue: CueSettings, startAt?: number, options?: PlayOptions): void {
    const buffer = this.buffers.get(cue.audioId)
    if (!buffer) throw new Error(`로드되지 않은 음원입니다: ${cue.audioId}`)

    this.unlock()
    const ctx = this.ensureContext()
    const ignoreFadeIn = options?.ignoreFadeIn ?? false
    const range = cueRange(cue, buffer.duration, ignoreFadeIn)
    if (range.outPoint - range.inPoint < MIN_LENGTH) throw new Error('인/아웃 포인트 사이가 너무 짧습니다')
    const from = clamp(startAt ?? range.inPoint, range.inPoint, range.outPoint - MIN_LENGTH)
    const key = options?.key ?? cue.audioId

    // 같은 key는 그 재생만 새로 시작 (같은 곡이 두 겹으로 나오지 않게)
    const same = this.playbacks.get(key)
    if (same) {
      same.voice?.release(DECLICK)
      this.playbacks.delete(key)
    }
    if (!options?.layer) {
      const fade = Math.max(DECLICK, options?.fadePreviousSeconds ?? DECLICK)
      if (fade > DECLICK) {
        // 길게 페이드되는 이전 소리는 하나만 둔다 (GO 연타로 여러 소리가 겹쳐 커지는 것 방지)
        for (const v of this.voices) if (v.isReleasing) v.release(DECLICK)
      }
      for (const pb of this.playbacks.values()) pb.voice?.release(fade)
      this.playbacks.clear()
    }

    const voice = new Voice(ctx, this.master!, buffer, cue.audioId, range, from, options?.startFade)
    voice.onEnded = (v) => this.handleVoiceEnded(v)
    this.voices.add(voice)
    this.playbacks.set(key, { key, cue, voice, state: 'playing', ignoreFadeIn, pausedAt: 0 })
    this.changed()
  }

  /** 클릭 소리가 나지 않게 10ms 페이드 후 정지. key가 없으면 전체 */
  stop(key?: string): void {
    for (const pb of this.targets(key)) {
      pb.voice?.release(DECLICK)
      this.playbacks.delete(pb.key)
    }
    this.changed()
  }

  /** seconds 동안 페이드 아웃 후 정지. key가 없으면 전체. 일시정지 중인 재생은 바로 정지 */
  fadeOutAndStop(seconds: number, key?: string): void {
    if (!(seconds > DECLICK)) {
      this.stop(key)
      return
    }
    for (const pb of this.targets(key)) {
      if (pb.voice) {
        pb.voice.release(seconds)
        pb.state = 'fading'
      } else this.playbacks.delete(pb.key)
    }
    this.changed()
  }

  /** 재생 중인 것의 위치를 기억하고 멈춘다. 페이드 아웃 중인 것은 정지. key가 없으면 전체 */
  pause(key?: string): void {
    if (!this.ctx) return
    for (const pb of this.targets(key)) {
      if (pb.state === 'fading') {
        pb.voice?.release(DECLICK)
        this.playbacks.delete(pb.key)
      } else if (pb.state === 'playing' && pb.voice) {
        pb.pausedAt = pb.voice.position(this.ctx.currentTime)
        pb.voice.release(DECLICK)
        pb.voice = null
        pb.state = 'paused'
      }
    }
    this.changed()
  }

  /** 일시정지한 위치부터 이어서 재생. key가 없으면 일시정지한 것 전체 */
  resume(key?: string): void {
    for (const pb of this.targets(key)) {
      if (pb.state !== 'paused') continue
      const duration = this.getDuration(pb.cue.audioId)
      const out = duration === null ? 0 : cueRange(pb.cue, duration).outPoint
      if (duration === null || pb.pausedAt >= out - MIN_LENGTH) {
        this.playbacks.delete(pb.key)
        continue
      }
      this.restart(pb, pb.pausedAt)
    }
    this.changed()
  }

  /**
   * 재생/일시정지 중인 큐의 설정이 바뀌었을 때 호출. 지금 나는 소리에 바로 반영한다.
   * - 페이드/볼륨만 바뀌면: 재생을 끊지 않고 볼륨 곡선만 다시 예약
   * - 인/아웃 포인트가 바뀌면: 지금 위치(새 범위 안으로 맞춤)에서 다시 재생
   * - 지금 위치가 새 아웃 포인트를 지났으면: 정지
   * @param key 이 재생에만 (없으면 같은 음원을 쓰는 재생 전체)
   */
  applyCueSettings(cue: CueSettings, key?: string): void {
    const buffer = this.buffers.get(cue.audioId)
    if (!buffer || !this.ctx) return
    const list = key ? this.targets(key) : [...this.playbacks.values()].filter((pb) => pb.cue.audioId === cue.audioId)
    for (const pb of list) {
      if (pb.cue.audioId !== cue.audioId) continue
      const next = cueRange(cue, buffer.duration, pb.ignoreFadeIn)
      if (next.outPoint - next.inPoint < MIN_LENGTH) continue
      const prev = cueRange(pb.cue, buffer.duration, pb.ignoreFadeIn)
      pb.cue = cue
      if (pb.state === 'paused') {
        pb.pausedAt = clamp(pb.pausedAt, next.inPoint, next.outPoint - MIN_LENGTH)
        continue
      }
      if (pb.state === 'fading' || !pb.voice) continue // 정지하려고 줄어드는 중이면 그대로 둔다
      if (prev.inPoint === next.inPoint && prev.outPoint === next.outPoint) {
        pb.voice.reschedule(next)
        continue
      }
      const pos = pb.voice.position(this.ctx.currentTime)
      if (pos >= next.outPoint - 0.05) {
        pb.voice.release(DECLICK)
        this.playbacks.delete(pb.key)
        continue
      }
      this.restart(pb, Math.max(pos, next.inPoint))
    }
    this.changed()
  }

  /**
   * 위치 이동(초, 파일 기준). 재생 중이면 그 지점부터 다시 재생하고,
   * 일시정지 중이면 이어 재생할 위치만 바꾼다. 페이드 아웃 중이면 무시
   * (옮기면 원래 볼륨으로 다시 나와 페이드가 풀리므로).
   * @param key 이 재생 (없으면 주 재생 = 가장 최근에 시작한 것)
   */
  seek(position: number, key?: string): void {
    const pb = key ? this.playbacks.get(key) : this.primary()
    if (!pb) return
    const duration = this.getDuration(pb.cue.audioId)
    if (duration === null) return
    const r = cueRange(pb.cue, duration)
    if (pb.state === 'paused') pb.pausedAt = clamp(position, r.inPoint, r.outPoint - MIN_LENGTH)
    else if (pb.state === 'playing') this.restart(pb, position)
    this.changed()
  }

  /** 모든 소리를 즉시 정지 (페이드 없음) */
  panic(): void {
    const all = [...this.voices]
    this.playbacks.clear()
    for (const v of all) v.kill()
    this.voices.clear()
    this.changed()
  }

  /** 지금 재생/페이드/일시정지 중인 재생이 있는지 */
  get isActive(): boolean {
    return this.playbacks.size > 0
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

  /** 지금 이 순간의 위치(초). key가 없으면 주 재생. 구독 없이 바로 읽을 때 사용 */
  getPosition(key?: string): number {
    const pb = key ? this.playbacks.get(key) : this.primary()
    if (!pb) return 0
    return pb.voice && this.ctx ? pb.voice.position(this.ctx.currentTime) : pb.pausedAt
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

  /** key가 있으면 그 재생, 없으면 전체 */
  private targets(key?: string): Playback[] {
    if (key === undefined) return [...this.playbacks.values()]
    const pb = this.playbacks.get(key)
    return pb ? [pb] : []
  }

  /** 주 재생 = 가장 최근에 시작한 것 */
  private primary(): Playback | undefined {
    let last: Playback | undefined
    for (const pb of this.playbacks.values()) last = pb
    return last
  }

  /** 같은 재생을 다른 위치에서 다시 시작 (마커 재생이면 그 방식 유지). 다른 재생은 건드리지 않는다 */
  private restart(pb: Playback, position: number): void {
    const buffer = this.buffers.get(pb.cue.audioId)
    if (!buffer || !this.ctx || !this.master) return
    const range = cueRange(pb.cue, buffer.duration, pb.ignoreFadeIn)
    const from = clamp(position, range.inPoint, range.outPoint - MIN_LENGTH)
    pb.voice?.release(DECLICK)
    const voice = new Voice(this.ctx, this.master, buffer, pb.cue.audioId, range, from)
    voice.onEnded = (v) => this.handleVoiceEnded(v)
    this.voices.add(voice)
    pb.voice = voice
    pb.state = 'playing'
  }

  private handleVoiceEnded(v: Voice): void {
    this.voices.delete(v)
    // 아웃 포인트 도달 또는 페이드 아웃 완료: 그 Voice를 쓰던 재생을 끝낸다
    for (const pb of this.playbacks.values()) {
      if (pb.voice === v) {
        this.playbacks.delete(pb.key)
        this.changed()
        break
      }
    }
  }

  /** 전체 상태 */
  private get state(): PlaybackState {
    let fading = false
    let paused = false
    for (const pb of this.playbacks.values()) {
      if (pb.state === 'playing') return 'playing'
      if (pb.state === 'fading') fading = true
      if (pb.state === 'paused') paused = true
    }
    return fading ? 'fading' : paused ? 'paused' : 'stopped'
  }

  private changed(): void {
    this.emit()
    this.updateTicker()
  }

  private buildSnapshot(): EngineSnapshot {
    const healthy = !!this.ctx && this.ctx.state === 'running' && !(this.output?.isPaused() ?? false)
    if (healthy) this.everRunning = true
    const now = this.ctx?.currentTime ?? 0
    const active = [...this.playbacks.values()].map((pb) => ({
      key: pb.key,
      audioId: pb.cue.audioId,
      state: pb.state,
      position: pb.voice ? pb.voice.position(now) : pb.pausedAt,
    }))
    const primary = active[active.length - 1]
    return {
      state: this.state,
      position: primary?.position ?? 0,
      audioId: primary?.audioId ?? null,
      primaryKey: primary?.key ?? null,
      active,
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
    const st = this.state
    const active = (st === 'playing' || st === 'fading') && this.listeners.size > 0
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

/** key별 재생 하나 */
interface Playback {
  key: string
  cue: CueSettings
  /** 재생/페이드 중인 소리. 일시정지면 null */
  voice: Voice | null
  state: 'playing' | 'fading' | 'paused'
  /** 마커 재생처럼 큐 페이드 인을 무시하는 재생인지 (이어 재생/위치 이동/설정 변경 때도 유지) */
  ignoreFadeIn: boolean
  /** 일시정지한 위치(초) */
  pausedAt: number
}

export interface PlayOptions {
  key?: string
  layer?: boolean
  fadePreviousSeconds?: number
  ignoreFadeIn?: boolean
  startFade?: number
}
