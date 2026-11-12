import { AudioEngine } from './engine.ts'

/** 앱 전체에서 하나만 쓰는 오디오 엔진 */
export const audioEngine = new AudioEngine()

export type { AudioEngine, PlayOptions } from './engine.ts'
export type {
  ContextState,
  CueSettings,
  EngineListener,
  EngineSnapshot,
  OutputKind,
  OutputMode,
  PlaybackState,
} from './types.ts'
export { dbToGain, gainToDb, SILENCE_DB } from './volume.ts'
export { analyzeAudio, PEAKS_PER_SECOND, type AudioAnalysis } from './analyze.ts'
