/** 출력 경로 설정. 'auto'는 기기를 보고 고른다. */
export type OutputMode = 'auto' | 'stream' | 'direct'

/** 실제로 쓰는 출력 경로. stream = MediaStreamDestination → <audio>, direct = destination 직결 */
export type OutputKind = 'stream' | 'direct'

/** 재생 상태. fading = fadeOutAndStop으로 줄어드는 중 */
export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'fading'

/** AudioContext 상태. iOS에는 'interrupted'가 있고, 아직 만들지 않았으면 'none' */
export type ContextState = 'none' | 'suspended' | 'running' | 'interrupted' | 'closed'

/** 큐 하나를 재생할 때 필요한 값. 시간 단위는 모두 초(파일 처음 기준). */
export interface CueSettings {
  /** load()에 넘긴 음원 id */
  audioId: string
  /** 인 포인트. 기본 0 */
  inPoint: number
  /** 아웃 포인트. null이면 파일 끝 */
  outPoint: number | null
  /** 페이드 인 길이 */
  fadeIn: number
  /** 아웃 포인트 직전 페이드 아웃 길이 */
  fadeOut: number
  /** 큐 볼륨 (dB). 0 = 원래 크기 */
  volumeDb: number
}

export interface EngineSnapshot {
  state: PlaybackState
  /** 현재 위치(초, 파일 처음 기준). 정지 상태면 0 */
  position: number
  /** 재생/일시정지 중인 음원 id */
  audioId: string | null
  contextState: ContextState
  outputMode: OutputMode
  /** AudioContext를 아직 만들지 않았으면 null */
  outputKind: OutputKind | null
  /**
   * 소리가 한 번 나온 뒤에 오디오가 멈춘 상태 (화면 복귀, 전화·알람·다른 앱 소리 등).
   * 사용자가 탭하면(unlock) 다시 연결된다.
   */
  needsReconnect: boolean
}

export type EngineListener = (snapshot: EngineSnapshot) => void
