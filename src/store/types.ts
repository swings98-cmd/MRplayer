/** 시간 단위는 모두 초(파일 처음 기준), 시각은 Date.now() 밀리초 */

export interface Project {
  id: string
  name: string
  /** 큐 순서 */
  cueIds: string[]
  updatedAt: number
  /** 마지막 전체 내보내기(음원 포함 백업) 시각 */
  lastBackupAt?: number
  /** 마지막 설정만 내보내기 시각 */
  lastSettingsExportAt?: number
}

export type MarkerColor = 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'

export interface Marker {
  id: string
  name: string
  time: number
  /** 없으면 orange */
  color?: MarkerColor
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
  /**
   * 설정만 가져왔는데 기기에 맞는 음원이 없을 때: audioId는 ''이고 원래 음원 정보를 여기에 둔다.
   * 사용자가 파일을 다시 지정하면 지워진다.
   */
  missingAudio?: AudioRef
}

/** 음원을 맞춰 보기 위한 정보 (설정 파일에 기록) */
export interface AudioRef {
  fileName: string
  /** 초 */
  duration: number
  /** 바이트 */
  size: number
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
