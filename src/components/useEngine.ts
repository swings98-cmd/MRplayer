import { useSyncExternalStore } from 'react'
import { audioEngine, type EngineSnapshot, type PlaybackState } from '../audio/index.ts'

/** 엔진 상태 전체. 재생 중에는 프레임마다 다시 그려지므로 위치를 보여주는 곳에서만 쓴다. */
export function useEngineSnapshot(): EngineSnapshot {
  return useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot)
}

/** 재생 상태만. 상태가 바뀔 때만 다시 그려진다. */
export function useEngineState(): PlaybackState {
  return useSyncExternalStore(audioEngine.subscribe, () => audioEngine.getSnapshot().state)
}
