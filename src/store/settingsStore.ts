/**
 * 앱 설정 (IndexedDB settings 저장소에 JSON으로 저장).
 * 오디오 엔진에 적용해야 하는 값(마스터 볼륨, 출력 경로)은 바뀔 때 바로 엔진에 넘긴다.
 */
import { create } from 'zustand'
import { audioEngine, type OutputMode } from '../audio/index.ts'
import * as db from './db.ts'

/** GO를 눌렀을 때 이미 재생 중인 큐 처리 */
export type GoMode = 'cut' | 'fade'

export interface AppSettings {
  goMode: GoMode
  /** 페이드 아웃 정지, "페이드 아웃하며 재생"에 쓰는 시간(초) */
  fadeOutSeconds: number
  masterVolumeDb: number
  /** 숨은 옵션: 출력 경로 강제 */
  outputMode: OutputMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  goMode: 'cut',
  fadeOutSeconds: 3,
  masterVolumeDb: 0,
  outputMode: 'auto',
}

const KEY = 'appSettings'
const SAVE_DELAY_MS = 400

interface SettingsState extends AppSettings {
  loaded: boolean
  init(): Promise<void>
  update(patch: Partial<AppSettings>): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let initPromise: Promise<void> | null = null

function applyToEngine(s: Partial<AppSettings>): void {
  if (s.masterVolumeDb !== undefined) audioEngine.setMasterVolumeDb(s.masterVolumeDb)
  if (s.outputMode !== undefined) audioEngine.setOutputMode(s.outputMode)
}

function pick(s: SettingsState): AppSettings {
  return { goMode: s.goMode, fadeOutSeconds: s.fadeOutSeconds, masterVolumeDb: s.masterVolumeDb, outputMode: s.outputMode }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  init() {
    initPromise ??= (async () => {
      let saved: Partial<AppSettings> = {}
      try {
        const raw = await db.getSetting(KEY)
        if (raw) saved = JSON.parse(raw) as Partial<AppSettings>
      } catch {
        /* 저장된 설정을 못 읽으면 기본값 */
      }
      const merged = { ...DEFAULT_SETTINGS, ...saved }
      set({ ...merged, loaded: true })
      applyToEngine(merged)
    })()
    return initPromise
  },

  update(patch) {
    set(patch)
    applyToEngine(patch)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void db.setSetting(KEY, JSON.stringify(pick(get()))).catch(() => {})
    }, SAVE_DELAY_MS)
  },
}))
