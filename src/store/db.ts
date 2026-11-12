/**
 * IndexedDB 저장 (idb).
 *
 * 저장소
 * - projects   : Project
 * - cues       : Cue (audioId 인덱스: 음원을 쓰는 큐가 남아 있는지 확인용)
 * - audioMeta  : AudioMeta (파일 이름, 길이, 파형 피크)
 * - audioBlobs : 원본 파일 Blob — 불러올 때 한 번만 쓰고, 큐 설정 저장 때는 건드리지 않는다
 * - settings   : 마지막으로 연 프로젝트 등
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb'
import type { AudioMeta, Cue, Project } from './types.ts'

interface MrDB extends DBSchema {
  projects: { key: string; value: Project }
  cues: { key: string; value: Cue; indexes: { byAudio: string } }
  audioMeta: { key: string; value: AudioMeta }
  audioBlobs: { key: string; value: { id: string; blob: Blob } }
  settings: { key: string; value: string }
}

type WriteTx = IDBPTransaction<MrDB, StoreNames<MrDB>[], 'readwrite'>

const DB_NAME = 'mr-cue-player'
const ALL_STORES: StoreNames<MrDB>[] = ['projects', 'cues', 'audioMeta', 'audioBlobs']

let dbPromise: Promise<IDBPDatabase<MrDB>> | null = null

function db(): Promise<IDBPDatabase<MrDB>> {
  dbPromise ??= openDB<MrDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' })
      const cues = d.createObjectStore('cues', { keyPath: 'id' })
      cues.createIndex('byAudio', 'audioId')
      d.createObjectStore('audioMeta', { keyPath: 'id' })
      d.createObjectStore('audioBlobs', { keyPath: 'id' })
      d.createObjectStore('settings')
    },
  })
  return dbPromise
}

// ───────────────────────── 읽기 ─────────────────────────

export async function listProjects(): Promise<Project[]> {
  return (await db()).getAll('projects')
}

/** 프로젝트의 큐(순서대로)와 그 큐들이 쓰는 음원 정보 */
export async function loadProjectData(project: Project): Promise<{ cues: Cue[]; audio: AudioMeta[] }> {
  const tx = (await db()).transaction(['cues', 'audioMeta'])
  const found = await Promise.all(project.cueIds.map((id) => tx.objectStore('cues').get(id)))
  const cues = found.filter((c): c is Cue => !!c)
  const audioIds = [...new Set(cues.map((c) => c.audioId))]
  const metas = await Promise.all(audioIds.map((id) => tx.objectStore('audioMeta').get(id)))
  await tx.done
  return { cues, audio: metas.filter((m): m is AudioMeta => !!m) }
}

export async function getAudioBlob(audioId: string): Promise<Blob | undefined> {
  return (await (await db()).get('audioBlobs', audioId))?.blob
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await db()).get('settings', key)
}

export async function setSetting(key: string, value: string): Promise<void> {
  await (await db()).put('settings', value, key)
}

// ───────────────────────── 쓰기 ─────────────────────────

export async function putProject(project: Project): Promise<void> {
  await (await db()).put('projects', project)
}

/** 불러온 음원 하나 = 음원 정보 + Blob + 큐 + 프로젝트의 큐 목록 갱신을 한 번에 저장 */
export async function addImportedCue(projectId: string, meta: AudioMeta, blob: Blob, cue: Cue): Promise<Project> {
  const tx = (await db()).transaction(ALL_STORES, 'readwrite')
  const project = await tx.objectStore('projects').get(projectId)
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다')
  const updated: Project = { ...project, cueIds: [...project.cueIds, cue.id], updatedAt: Date.now() }
  await Promise.all([
    tx.objectStore('audioMeta').put(meta),
    tx.objectStore('audioBlobs').put({ id: meta.id, blob }),
    tx.objectStore('cues').put(cue),
    tx.objectStore('projects').put(updated),
  ])
  await tx.done
  return updated
}

/** 이미 저장된 음원을 쓰는 새 큐를 index 위치에 추가 (복제용). 음원은 다시 쓰지 않는다. */
export async function insertCue(projectId: string, cue: Cue, index: number): Promise<Project> {
  const tx = (await db()).transaction(['cues', 'projects'], 'readwrite')
  const project = await tx.objectStore('projects').get(projectId)
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다')
  const cueIds = [...project.cueIds]
  cueIds.splice(index, 0, cue.id)
  const updated: Project = { ...project, cueIds, updatedAt: Date.now() }
  await tx.objectStore('cues').put(cue)
  await tx.objectStore('projects').put(updated)
  await tx.done
  return updated
}

/** 큐 설정 저장. 음원 저장소는 건드리지 않는다. */
export async function saveCues(projectId: string, cues: Cue[]): Promise<void> {
  const tx = (await db()).transaction(['cues', 'projects'], 'readwrite')
  const project = await tx.objectStore('projects').get(projectId)
  await Promise.all(cues.map((c) => tx.objectStore('cues').put(c)))
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() })
  await tx.done
}

/** 남은 큐가 하나도 쓰지 않는 음원만 지운다. 지운 음원 id 목록을 돌려준다. */
async function deleteUnusedAudio(tx: WriteTx, audioIds: Iterable<string>): Promise<string[]> {
  const deleted: string[] = []
  for (const id of new Set(audioIds)) {
    const users = await tx.objectStore('cues').index('byAudio').count(id)
    if (users === 0) {
      await tx.objectStore('audioMeta').delete(id)
      await tx.objectStore('audioBlobs').delete(id)
      deleted.push(id)
    }
  }
  return deleted
}

/** 큐 삭제 + 프로젝트 큐 목록에서 제거 + 쓰이지 않게 된 음원 삭제 */
export async function deleteCue(
  projectId: string,
  cueId: string,
): Promise<{ project: Project; deletedAudioIds: string[] }> {
  const tx = (await db()).transaction(ALL_STORES, 'readwrite')
  const project = await tx.objectStore('projects').get(projectId)
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다')
  const cue = await tx.objectStore('cues').get(cueId)
  await tx.objectStore('cues').delete(cueId)
  const updated: Project = { ...project, cueIds: project.cueIds.filter((id) => id !== cueId), updatedAt: Date.now() }
  await tx.objectStore('projects').put(updated)
  const deletedAudioIds = cue ? await deleteUnusedAudio(tx, [cue.audioId]) : []
  await tx.done
  return { project: updated, deletedAudioIds }
}

/** 프로젝트와 그 큐 삭제 + 쓰이지 않게 된 음원 삭제 */
export async function deleteProject(projectId: string): Promise<{ deletedAudioIds: string[] }> {
  const tx = (await db()).transaction(ALL_STORES, 'readwrite')
  const project = await tx.objectStore('projects').get(projectId)
  if (!project) {
    await tx.done
    return { deletedAudioIds: [] }
  }
  const audioIds: string[] = []
  for (const id of project.cueIds) {
    const cue = await tx.objectStore('cues').get(id)
    if (cue) audioIds.push(cue.audioId)
    await tx.objectStore('cues').delete(id)
  }
  await tx.objectStore('projects').delete(projectId)
  const deletedAudioIds = await deleteUnusedAudio(tx, audioIds)
  await tx.done
  return { deletedAudioIds }
}
