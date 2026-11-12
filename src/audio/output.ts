/**
 * 출력 경로 선택. 경로를 고르는 곳은 이 파일 하나뿐이다.
 * 엔진의 나머지 부분은 output.input에 연결만 하고 어떤 경로인지 알 필요가 없다.
 *
 * - stream: input(GainNode) → MediaStreamAudioDestinationNode → <audio>.srcObject
 *   아이패드/아이폰에서 화면이 꺼져도 재생이 이어지게 하기 위한 경로.
 *   <audio>는 첫 사용자 탭에서 play()한 뒤 계속 재생 상태로 둔다.
 *   (큐마다 멈췄다 켜면 오디오 세션이 풀려 백그라운드 재생이 끊긴다)
 * - direct: input(GainNode) → AudioContext.destination (윈도우/맥)
 */
import type { OutputKind, OutputMode } from './types.ts'

export interface Output {
  readonly kind: OutputKind
  /** 엔진이 연결할 입력 노드 */
  readonly input: AudioNode
  /** 사용자 탭 안에서 호출. stream이면 멈춰 있는 <audio>를 다시 재생 상태로 만든다 */
  unlock(): void
  /** 출력이 바깥 사정(전화, 알람, 잠금 화면의 일시정지 등)으로 멈춰 있는지. stream일 때만 의미가 있다 */
  isPaused(): boolean
  /** isPaused가 바뀔 때 호출할 함수 */
  onChange: (() => void) | null
  /** 경로를 바꿀 때만 사용 */
  dispose(): void
}

/**
 * 아이패드/아이폰인지 판별.
 * 아이패드 사파리는 기본으로 Mac 사파리처럼 표시되므로 터치 포인트 수를 함께 본다.
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}

export function resolveOutputKind(mode: OutputMode): OutputKind {
  if (mode === 'stream' || mode === 'direct') return mode
  return isAppleMobile() ? 'stream' : 'direct'
}

export function createOutput(ctx: AudioContext, mode: OutputMode): Output {
  const kind = resolveOutputKind(mode)
  const input = ctx.createGain()

  if (kind === 'direct') {
    input.connect(ctx.destination)
    return {
      kind,
      input,
      onChange: null,
      isPaused: () => false,
      unlock() {},
      dispose() {
        input.disconnect()
      },
    }
  }

  const streamDest = ctx.createMediaStreamDestination()
  input.connect(streamDest)

  // 무음 유지 소스: 재생 중인 소리가 하나도 없으면 사파리가 오디오 처리를 쉬어서,
  // 계속 재생 중인 <audio>가 마지막 조각을 반복해 "두두두" 소리를 낸다.
  // 값 0을 끝없이 내보내는 소스를 켜 두어 스트림에 항상 무음 데이터가 흐르게 한다.
  const keepAlive = createSilentSource(ctx)
  keepAlive.connect(streamDest)
  keepAlive.start()

  const el = document.createElement('audio')
  el.setAttribute('playsinline', '')
  el.setAttribute('aria-hidden', 'true')
  el.style.display = 'none'
  el.srcObject = streamDest.stream
  document.body.appendChild(el)

  const out: Output = {
    kind,
    input,
    onChange: null,
    isPaused: () => el.paused,
    unlock() {
      // 이미 재생 중이면 아무것도 하지 않는다. 절대 pause()하지 않는다.
      if (el.paused) {
        el.play().catch(() => {
          /* 사용자 탭 밖에서 불리면 실패할 수 있음. 다음 탭에서 다시 시도된다 */
        })
      }
    },
    dispose() {
      input.disconnect()
      try {
        keepAlive.stop()
      } catch {
        /* 무시 */
      }
      keepAlive.disconnect()
      el.pause()
      el.srcObject = null
      el.remove()
    },
  }
  for (const type of ['play', 'playing', 'pause'] as const) el.addEventListener(type, () => out.onChange?.())
  return out
}

/** 무음(0)을 끝없이 내보내는 소스. ConstantSourceNode가 없으면 무음 버퍼 반복으로 대신한다 */
function createSilentSource(ctx: AudioContext): AudioScheduledSourceNode {
  if (typeof ctx.createConstantSource === 'function') {
    const src = ctx.createConstantSource()
    src.offset.value = 0
    return src
  }
  const src = ctx.createBufferSource()
  src.buffer = ctx.createBuffer(1, 128, ctx.sampleRate)
  src.loop = true
  return src
}
