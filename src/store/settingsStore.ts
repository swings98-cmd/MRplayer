/**
 * 앱 설정 (IndexedDB settings 저장소에 JSON으로 저장).
 * 오디오 엔진에 적용해야 하는 값(마스터 볼륨, 출력 경로)은 바뀔 때 바로 엔진에 넘긴다.
 */
import { create } from 'zustand'
import { audioEngine, type OutputMode } from '../audio/index.ts'
import { describeSaveError, reportError } from './appErrors.ts'
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
  /** 마커 재생 시 마커보다 몇 초 앞에서 시작할지 */
  prerollSeconds: number
  /** 재생 중 화면 꺼짐 방지 (Screen Wake Lock) */
  keepScreenOn: boolean
  /** 공연 모드: 편집 조작 잠금. 새로고침해도 유지한다 */
  performanceMode: boolean
}

export const PREROLL_CHOICES = [0, 2, 4, 8] as const

export const DEFAULT_SETTINGS: AppSettings = {
  goMode: 'cut',
  fadeOutSeconds: 3,
  masterVolumeDb: 0,
  outputMode: 'auto',
  prerollSeconds: 0,
  keepScreenOn: true,
  performanceMode: false,
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
  return {
    goMode: s.goMode,
    fadeOutSeconds: s.fadeOutSeconds,
    masterVolumeDb: s.masterVolumeDb,
    outputMode: s.outputMode,
    prerollSeconds: s.prerollSeconds,
    keepScreenOn: s.keepScreenOn,
    performanceMode: s.performanceMode,
  }
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
      void db
        .setSetting(KEY, JSON.stringify(pick(get())))
        .catch((err: unknown) => reportError(`설정을 저장하지 못했습니다: ${describeSaveError(err)}`))
    }, SAVE_DELAY_MS)
  },
}))
