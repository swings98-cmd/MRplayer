/**
 * 프로젝트 / 큐 / 음원 상태 (zustand) + IndexedDB 저장.
 * 화면은 이 스토어만 쓰고, db.ts를 직접 부르지 않는다.
 */
import { create } from 'zustand'
import { analyzeAudio, audioEngine } from '../audio/index.ts'
import * as db from './db.ts'
import type { AudioMeta, Cue, CuePatch, Project } from './types.ts'

const CURRENT_PROJECT_KEY = 'currentProjectId'
const AUTOSAVE_DELAY_MS = 500
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
  /** 미뤄 둔 저장을 지금 한다 */
  flushSaves(): Promise<void>
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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
let flushing: Promise<void> = Promise.resolve()

function scheduleSave(projectId: string, cue: Cue): void {
  pending.set(cue.id, { projectId, cue })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushPending(), AUTOSAVE_DELAY_MS)
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
        console.error('큐 저장 실패', err)
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

      set({ importing: { done: 0, total: files.length, current: '' } })
      try {
        for (const [i, file] of files.entries()) {
          set({ importing: { done: i, total: files.length, current: file.name } })
          if (!isSupportedFile(file)) {
            result.failed.push({ fileName: file.name, reason: '지원하지 않는 형식' })
            continue
          }
          try {
            // 한 파일씩 순서대로 처리해서 메모리를 아낀다
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
            result.failed.push({ fileName: file.name, reason: `디코딩 실패 (${message(err)})` })
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

    flushSaves: flushPending,
  }
})

/** 큐의 원본 파일을 읽어 오디오 엔진에 올린다 (이미 올라가 있으면 바로 끝) */
export async function loadCueAudio(cue: Cue): Promise<AudioBuffer> {
  if (audioEngine.isLoaded(cue.audioId)) return audioEngine.load(cue.audioId, new ArrayBuffer(0))
  const blob = await db.getAudioBlob(cue.audioId)
  if (!blob) throw new Error('저장된 음원 파일을 찾을 수 없습니다')
  return audioEngine.load(cue.audioId, await blob.arrayBuffer())
}
