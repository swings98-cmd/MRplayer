/**
 * 프로젝트 / 큐 / 음원 상태 (zustand) + IndexedDB 저장.
 * 화면은 이 스토어만 쓰고, db.ts를 직접 부르지 않는다.
 */
import { create } from 'zustand'
import { analyzeAudio, audioEngine } from '../audio/index.ts'
import { describeSaveError, isQuotaError, QUOTA_MESSAGE, reportError } from './appErrors.ts'
import * as db from './db.ts'
import type { AudioMeta, Cue, CuePatch, Marker, Project } from './types.ts'

const CURRENT_PROJECT_KEY = 'currentProjectId'
/** 마지막 변경 후 이만큼 조용하면 저장 */
const AUTOSAVE_DELAY_MS = 300
/** 계속 바꾸는 중이어도 이 시간 안에는 한 번 저장 */
const AUTOSAVE_MAX_WAIT_MS = 1000
const DEFAULT_PROJECT_NAME = '새 프로젝트'

/** 불러올 수 있는 확장자 */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac'] as const
export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTENSIONS.map((e) => `.${e}`)].join(',')

export interface ImportResult {
  imported: number
  failed: { fileName: string; reason: string }[]
}

export interface ImportProgress {
  done: number
  total: number
  current: string
}

interface ProjectState {
  ready: boolean
  /** 초기화 실패 등 */
  error: string | null
  projects: Project[]
  currentProjectId: string | null
  /** 현재 프로젝트의 큐 (순서대로) */
  cues: Cue[]
  /** 현재 프로젝트 큐들이 쓰는 음원 정보 */
  audio: Record<string, AudioMeta>
  importing: ImportProgress | null

  init(): Promise<void>
  createProject(name?: string): Promise<void>
  renameProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  switchProject(id: string): Promise<void>
  importFiles(files: File[]): Promise<ImportResult>
  /** 큐 설정 변경. 화면에는 바로 반영하고 저장은 잠시 뒤에 모아서 한다. */
  updateCue(id: string, patch: CuePatch): void
  deleteCue(id: string): Promise<void>
  /** 큐를 바로 아래에 복제 (같은 음원을 함께 씀). 새 큐 id를 돌려준다. */
  duplicateCue(id: string): Promise<string | null>
  /** 순서 변경 */
  moveCue(fromIndex: number, toIndex: number): Promise<void>
  /** DB에서 프로젝트 목록을 다시 읽는다 (가져오기 후) */
  refreshProjects(): Promise<void>
  /** 내보내기 시각 기록 (설정 화면의 "마지막 백업 시각") */
  markExported(projectId: string, kind: 'full' | 'settings'): Promise<void>
  /**
   * 큐의 음원 파일을 다시 지정한다 (설정만 가져와서 "음원 없음"인 큐).
   * 같은 음원이 없던 다른 큐들도 함께 연결한다. 이름이나 길이가 다르면 warning을 돌려준다.
   */
  relinkAudio(cueId: string, file: File): Promise<{ linked: number; warning: string | null }>
  /** 마커 추가 ("마커 N" 자동 이름). 마커는 항상 시간순으로 저장한다. */
  addMarker(cueId: string, time: number): Marker | null
  updateMarker(cueId: string, markerId: string, patch: Partial<Omit<Marker, 'id'>>): void
  deleteMarker(cueId: string, markerId: string): void
  /** 미뤄 둔 저장을 지금 한다 */
  flushSaves(): Promise<void>
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sortMarkers(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.time - b.time)
}

function stripExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(0, i) : fileName
}

function isSupportedFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext) || file.type.startsWith('audio/')
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  return String(err)
}

// ───────────────────────── 자동 저장 ─────────────────────────

/** 저장 대기 중인 큐: cueId → { projectId, cue } */
const pending = new Map<string, { projectId: string; cue: Cue }>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 저장되지 않은 첫 변경 시각 */
let firstPendingAt = 0
let flushing: Promise<void> = Promise.resolve()

function scheduleSave(projectId: string, cue: Cue): void {
  const now = Date.now()
  if (pending.size === 0) firstPendingAt = now
  pending.set(cue.id, { projectId, cue })
  if (saveTimer) clearTimeout(saveTimer)
  const wait = Math.max(0, Math.min(AUTOSAVE_DELAY_MS, firstPendingAt + AUTOSAVE_MAX_WAIT_MS - now))
  saveTimer = setTimeout(() => void flushPending(), wait)
}

function flushPending(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (pending.size === 0) return flushing
  const byProject = new Map<string, Cue[]>()
  for (const { projectId, cue } of pending.values()) {
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), cue])
  }
  pending.clear()
  // 이전 저장이 끝난 뒤 순서대로 저장
  flushing = flushing.then(async () => {
    for (const [projectId, cues] of byProject) {
      try {
        await db.saveCues(projectId, cues)
      } catch (err) {
        // 저장하지 못한 변경은 버리지 않고 다시 대기열에 넣어 잠시 뒤 다시 시도한다
        for (const cue of cues) if (!pending.has(cue.id)) pending.set(cue.id, { projectId, cue })
        reportError(`큐 설정을 저장하지 못했습니다: ${describeSaveError(err)} (5초 뒤 다시 시도합니다)`)
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void flushPending(), 5000)
      }
    }
  })
  return flushing
}

if (typeof window !== 'undefined') {
  // 앱이 닫히거나 백그라운드로 갈 때 미뤄 둔 저장을 바로 한다
  window.addEventListener('pagehide', () => void flushPending())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPending()
  })
}

// ───────────────────────── 스토어 ─────────────────────────

export const useProjectStore = create<ProjectState>((set, get) => {
  /** 프로젝트 하나를 열어 큐와 음원 정보를 읽는다 */
  async function open(project: Project): Promise<void> {
    const { cues, audio } = await db.loadProjectData(project)
    set({
      currentProjectId: project.id,
      cues,
      audio: Object.fromEntries(audio.map((a) => [a.id, a])),
    })
    await db.setSetting(CURRENT_PROJECT_KEY, project.id)
  }

  function replaceProject(p: Project): void {
    set({ projects: get().projects.map((x) => (x.id === p.id ? p : x)) })
  }

  async function makeProject(name: string): Promise<Project> {
    const p: Project = { id: newId(), name, cueIds: [], updatedAt: Date.now() }
    await db.putProject(p)
    set({ projects: [...get().projects, p] })
    return p
  }

  function unloadFromEngine(audioIds: string[]): void {
    for (const id of audioIds) audioEngine.unload(id)
  }

  let initPromise: Promise<void> | null = null

  async function initOnce(): Promise<void> {
    try {
      let projects = await db.listProjects()
      set({ projects })
      if (projects.length === 0) {
        await makeProject(DEFAULT_PROJECT_NAME)
        projects = get().projects
      }
      const lastId = await db.getSetting(CURRENT_PROJECT_KEY)
      const latest = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      await open(projects.find((p) => p.id === lastId) ?? latest)
      set({ ready: true })
    } catch (err) {
      set({ error: `저장소를 열 수 없습니다: ${message(err)}` })
    }
  }

  return {
    ready: false,
    error: null,
    projects: [],
    currentProjectId: null,
    cues: [],
    audio: {},
    importing: null,

    init() {
      // 여러 번 불려도(개발 모드의 effect 두 번 실행 등) 초기화는 한 번만
      initPromise ??= initOnce()
      return initPromise
    },

    async createProject(name = DEFAULT_PROJECT_NAME) {
      await flushPending()
      const p = await makeProject(name.trim() || DEFAULT_PROJECT_NAME)
      await open(p)
    },

    async renameProject(id, name) {
      const p = get().projects.find((x) => x.id === id)
      const trimmed = name.trim()
      if (!p || !trimmed) return
      const updated = { ...p, name: trimmed, updatedAt: Date.now() }
      replaceProject(updated)
      await db.putProject(updated)
    },

    async deleteProject(id) {
      await flushPending()
      const { deletedAudioIds } = await db.deleteProject(id)
      unloadFromEngine(deletedAudioIds)
      const rest = get().projects.filter((p) => p.id !== id)
      set({ projects: rest })
      if (get().currentProjectId === id) {
        const next = [...rest].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? (await makeProject(DEFAULT_PROJECT_NAME))
        await open(next)
      }
    },

    async switchProject(id) {
      if (id === get().currentProjectId) return
      const p = get().projects.find((x) => x.id === id)
      if (!p) return
      await flushPending()
      await open(p)
    },

    async importFiles(files) {
      const projectId = get().currentProjectId
      const result: ImportResult = { imported: 0, failed: [] }
      if (!projectId || files.length === 0 || get().importing) return result

      // 재생 안정성: 재생 중에는 큰 파일 디코딩을 하지 않는다
      if (audioEngine.getSnapshot().state !== 'stopped') {
        result.failed.push(...files.map((f) => ({ fileName: f.name, reason: '재생 중에는 불러올 수 없습니다 (정지 후 다시)' })))
        return result
      }
      set({ importing: { done: 0, total: files.length, current: '' } })
      let outOfSpace = false
      try {
        for (const [i, file] of files.entries()) {
          if (outOfSpace) {
            result.failed.push({ fileName: file.name, reason: '저장 공간 부족으로 건너뜀' })
            continue
          }
          set({ importing: { done: i, total: files.length, current: file.name } })
          if (!isSupportedFile(file)) {
            result.failed.push({ fileName: file.name, reason: '지원하지 않는 형식' })
            continue
          }
          try {
            // 한 파일씩 순서대로 처리해서 메모리를 아낀다
            let analysis
            try {
              analysis = await analyzeAudio(await file.arrayBuffer())
            } catch (err) {
              result.failed.push({ fileName: file.name, reason: `디코딩 실패 — 파일이 손상되었거나 지원하지 않는 형식입니다 (${message(err)})` })
              continue
            }
            const meta: AudioMeta = {
              id: newId(),
              fileName: file.name,
              duration: analysis.duration,
              peaks: analysis.peaks,
              peaksPerSecond: analysis.peaksPerSecond,
              size: file.size,
              mimeType: file.type,
              createdAt: Date.now(),
            }
            const cue: Cue = {
              id: newId(),
              name: stripExtension(file.name),
              audioId: meta.id,
              inPoint: 0,
              outPoint: null,
              fadeIn: 0,
              fadeOut: 0,
              volumeDb: 0,
              markers: [],
              memo: '',
            }
            const blob = file.slice(0, file.size, file.type)
            const project = await db.addImportedCue(projectId, meta, blob, cue)
            replaceProject(project)
            if (get().currentProjectId === projectId) {
              set({ cues: [...get().cues, cue], audio: { ...get().audio, [meta.id]: meta } })
            }
            result.imported++
          } catch (err) {
            if (isQuotaError(err)) {
              outOfSpace = true
              result.failed.push({ fileName: file.name, reason: QUOTA_MESSAGE })
            } else {
              result.failed.push({ fileName: file.name, reason: `저장 실패 (${message(err)})` })
            }
          }
        }
      } finally {
        set({ importing: null })
      }
      return result
    },

    updateCue(id, patch) {
      const projectId = get().currentProjectId
      const cue = get().cues.find((c) => c.id === id)
      if (!projectId || !cue) return
      const updated: Cue = { ...cue, ...patch }
      set({ cues: get().cues.map((c) => (c.id === id ? updated : c)) })
      scheduleSave(projectId, updated)
    },

    async deleteCue(id) {
      const projectId = get().currentProjectId
      if (!projectId) return
      pending.delete(id)
      await flushPending()
      const { project, deletedAudioIds } = await db.deleteCue(projectId, id)
      unloadFromEngine(deletedAudioIds)
      replaceProject(project)
      const audio = { ...get().audio }
      for (const a of deletedAudioIds) delete audio[a]
      set({ cues: get().cues.filter((c) => c.id !== id), audio })
    },

    async duplicateCue(id) {
      const projectId = get().currentProjectId
      const index = get().cues.findIndex((c) => c.id === id)
      if (!projectId || index < 0) return null
      const src = get().cues[index]
      const copy: Cue = {
        ...src,
        id: newId(),
        name: `${src.name} 복사`,
        markers: src.markers.map((m) => ({ ...m, id: newId() })),
      }
      const project = await db.insertCue(projectId, copy, index + 1)
      replaceProject(project)
      const cues = [...get().cues]
      cues.splice(index + 1, 0, copy)
      set({ cues })
      return copy.id
    },

    async moveCue(fromIndex, toIndex) {
      const projectId = get().currentProjectId
      const project = get().projects.find((p) => p.id === projectId)
      const cues = [...get().cues]
      if (!project || fromIndex === toIndex || !cues[fromIndex] || toIndex < 0 || toIndex >= cues.length) return
      const [moved] = cues.splice(fromIndex, 1)
      cues.splice(toIndex, 0, moved)
      const updated: Project = { ...project, cueIds: cues.map((c) => c.id), updatedAt: Date.now() }
      set({ cues })
      replaceProject(updated)
      await db.putProject(updated)
    },

    addMarker(cueId, time) {
      const cue = get().cues.find((c) => c.id === cueId)
      if (!cue) return null
      // 남아 있는 "마커 N" 중 가장 큰 번호 다음 (중간 번호를 지워도 겹치지 않게)
      const used = cue.markers.map((m) => Number(/^마커 (\d+)$/.exec(m.name)?.[1] ?? 0))
      const n = Math.max(cue.markers.length, ...used) + 1
      const marker: Marker = { id: newId(), name: `마커 ${n}`, time: Math.round(time * 1000) / 1000, color: 'orange' }
      get().updateCue(cueId, { markers: sortMarkers([...cue.markers, marker]) })
      return marker
    },

    updateMarker(cueId, markerId, patch) {
      const cue = get().cues.find((c) => c.id === cueId)
      if (!cue) return
      const markers = cue.markers.map((m) =>
        m.id === markerId
          ? { ...m, ...patch, ...(patch.time !== undefined ? { time: Math.round(patch.time * 1000) / 1000 } : {}) }
          : m,
      )
      get().updateCue(cueId, { markers: sortMarkers(markers) })
    },

    deleteMarker(cueId, markerId) {
      const cue = get().cues.find((c) => c.id === cueId)
      if (!cue) return
      get().updateCue(cueId, { markers: cue.markers.filter((m) => m.id !== markerId) })
    },

    async refreshProjects() {
      set({ projects: await db.listProjects() })
    },

    async markExported(projectId, kind) {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return
      const updated: Project = kind === 'full' ? { ...p, lastBackupAt: Date.now() } : { ...p, lastSettingsExportAt: Date.now() }
      replaceProject(updated)
      await db.putProject(updated)
    },

    async relinkAudio(cueId, file) {
      const projectId = get().currentProjectId
      const cue = get().cues.find((c) => c.id === cueId)
      if (!projectId || !cue) return { linked: 0, warning: null }
      const analysis = await analyzeAudio(await file.arrayBuffer())
      const meta: AudioMeta = {
        id: newId(),
        fileName: file.name,
        duration: analysis.duration,
        peaks: analysis.peaks,
        peaksPerSecond: analysis.peaksPerSecond,
        size: file.size,
        mimeType: file.type,
        createdAt: Date.now(),
      }
      await db.putAudio(meta, file.slice(0, file.size, file.type))

      const expected = cue.missingAudio
      // 같은 음원이 없던 큐들을 함께 연결
      const targets = get().cues.filter(
        (c) => c.id === cueId || (expected && !c.audioId && c.missingAudio?.fileName === expected.fileName),
      )
      const ids = new Set(targets.map((c) => c.id))
      const updatedCues = get().cues.map((c) => {
        if (!ids.has(c.id)) return c
        const { missingAudio: _drop, ...rest } = c
        void _drop
        return { ...rest, audioId: meta.id }
      })
      set({ cues: updatedCues, audio: { ...get().audio, [meta.id]: meta } })
      await db.saveCues(projectId, updatedCues.filter((c) => ids.has(c.id)))

      let warning: string | null = null
      if (expected) {
        const diffs: string[] = []
        if (expected.fileName !== file.name) diffs.push(`파일 이름(원래 "${expected.fileName}")`)
        if (Math.abs(expected.duration - meta.duration) > 0.05) {
          diffs.push(`길이(원래 ${expected.duration.toFixed(1)}초, 지정한 파일 ${meta.duration.toFixed(1)}초)`)
        }
        if (diffs.length) warning = `원래 음원과 ${diffs.join(', ')}이(가) 다릅니다. 트림과 마커 위치를 확인하세요.`
      }
      return { linked: ids.size, warning }
    },

    flushSaves: flushPending,
  }
})

/** 큐의 원본 파일을 읽어 오디오 엔진에 올린다 (이미 올라가 있으면 바로 끝) */
export async function loadCueAudio(cue: Cue): Promise<AudioBuffer> {
  if (audioEngine.isLoaded(cue.audioId)) return audioEngine.load(cue.audioId, new ArrayBuffer(0))
  // 이미 디코딩 중이면 원본 파일을 다시 읽지 않고 그 작업을 기다린다 (메모리 절약)
  const pending = audioEngine.loadingPromise(cue.audioId)
  if (pending) return pending
  const blob = await db.getAudioBlob(cue.audioId)
  if (!blob) throw new Error('저장된 음원 파일을 찾을 수 없습니다')
  return audioEngine.load(cue.audioId, await blob.arrayBuffer())
}
