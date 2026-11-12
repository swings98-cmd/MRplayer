/** 시간 단위는 모두 초(파일 처음 기준), 시각은 Date.now() 밀리초 */

export interface Project {
  id: string
  name: string
  /** 큐 순서 */
  cueIds: string[]
  updatedAt: number
}

export interface Marker {
  id: string
  name: string
  time: number
}

export interface Cue {
  id: string
  name: string
  audioId: string
  inPoint: number
  /** null이면 파일 끝 */
  outPoint: number | null
  fadeIn: number
  fadeOut: number
  volumeDb: number
  markers: Marker[]
  memo: string
}

/** 큐 설정 중 사용자가 바꿀 수 있는 부분 */
export type CuePatch = Partial<Omit<Cue, 'id' | 'audioId'>>

/** 음원 정보 (Blob 제외). 파형 피크까지 여기에 둔다. */
export interface AudioMeta {
  id: string
  fileName: string
  /** 길이(초) */
  duration: number
  /** 구간별 최대 진폭 0~255 */
  peaks: Uint8Array
  peaksPerSecond: number
  /** 원본 파일 크기(바이트) */
  size: number
  mimeType: string
  createdAt: number
}

/** 음원 전체 = 정보 + 원본 파일. IndexedDB에는 둘을 다른 저장소에 나눠 저장한다. */
export interface AudioAsset extends AudioMeta {
  blob: Blob
}
