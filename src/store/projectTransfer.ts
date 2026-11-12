/**
 * 프로젝트 내보내기 / 가져오기.
 *
 * 전체 내보내기(.mrcue): zip(압축 없이 저장만) 안에 project.json + audio/(원본 음원 그대로)
 * 설정만 내보내기(.json): project.json만. 큐마다 음원 파일 이름·길이·크기를 적어 가져올 때 맞춰 본다.
 *
 * 가져오기는 항상 새 프로젝트로 추가한다 (기존 프로젝트를 덮어쓰지 않음).
 * 먼저 모든 검사(형식, 버전, 손상)를 끝낸 뒤에만 저장하고, 저장 중 실패하면 넣은 것을 되돌린다.
 * 큰 프로젝트에서도 메모리가 넘치지 않게 음원은 하나씩, 조금씩 나눠 읽는다.
 */
import { Zip, ZipPassThrough, strToU8 } from 'fflate'
import { analyzeAudio, PEAKS_PER_SECOND } from '../audio/index.ts'
import * as db from './db.ts'
import type { AudioMeta, AudioRef, Cue, Marker, MarkerColor, Project } from './types.ts'
import { entryBlob, entryBytes, readZipEntries, verifyCrc, ZipError, type ZipEntry } from './zipReader.ts'

export const FORMAT_ID = 'mr-cue-player-project'
export const FORMAT_VERSION = 1
const PROJECT_JSON = 'project.json'
/** 음원을 읽는 조각 크기 */
const CHUNK = 4 * 1024 * 1024

// ───────────────────────── 파일 형식 ─────────────────────────

interface FileAudioRef extends AudioRef {
  /** 전체 내보내기에서 audioFiles의 key. 음원이 없던 큐면 없음 */
  key?: string
  mimeType?: string
}

interface FileCue {
  name: string
  inPoint: number
  outPoint: number | null
  fadeIn: number
  fadeOut: number
  volumeDb: number
  memo: string
  markers: { name: string; time: number; color?: MarkerColor }[]
  /** 이 큐가 쓰는 음원 (맞춰 보기용 정보) */
  audio: FileAudioRef
}

interface FileAudio {
  key: string
  /** zip 안 경로 */
  path: string
  fileName: string
  mimeType: string
  size: number
  duration: number
  peaksPerSecond: number
  /** 파형 피크 (base64) */
  peaks: string
}

export interface ProjectFile {
  format: typeof FORMAT_ID
  version: number
  kind: 'full' | 'settings'
  exportedAt: string
  project: { name: string }
  cues: FileCue[]
  /** 전체 내보내기에만 */
  audioFiles?: FileAudio[]
}

export class ImportError extends Error {}

// ───────────────────────── 작은 도구 ─────────────────────────

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toBase64(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

function safeName(name: string): string {
  return [...name].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('').trim() || '프로젝트'
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

// ───────────────────────── 내보내기 ─────────────────────────

export type ExportKind = 'full' | 'settings'

interface Source {
  project: Project
  cues: Cue[]
  audio: Record<string, AudioMeta>
}

/** 큐가 쓰는 음원 목록 (같은 음원은 한 번만) */
function usedAudio(src: Source): AudioMeta[] {
  const seen = new Set<string>()
  const out: AudioMeta[] = []
  for (const c of src.cues) {
    const m = src.audio[c.audioId]
    if (m && !seen.has(m.id)) {
      seen.add(m.id)
      out.push(m)
    }
  }
  return out
}

function buildProjectFile(src: Source, kind: ExportKind): ProjectFile {
  const metas = usedAudio(src)
  const keyOf = new Map(metas.map((m, i) => [m.id, `a${i + 1}`]))
  const cues: FileCue[] = src.cues.map((c) => {
    const m = src.audio[c.audioId]
    const audio: FileAudioRef = m
      ? { key: kind === 'full' ? keyOf.get(m.id) : undefined, fileName: m.fileName, duration: m.duration, size: m.size, mimeType: m.mimeType }
      : { fileName: c.missingAudio?.fileName ?? '', duration: c.missingAudio?.duration ?? 0, size: c.missingAudio?.size ?? 0 }
    return {
      name: c.name,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      volumeDb: c.volumeDb,
      memo: c.memo,
      markers: c.markers.map((mk) => ({ name: mk.name, time: mk.time, color: mk.color })),
      audio,
    }
  })
  const file: ProjectFile = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    kind,
    exportedAt: new Date().toISOString(),
    project: { name: src.project.name },
    cues,
  }
  if (kind === 'full') {
    file.audioFiles = metas.map((m) => ({
      key: keyOf.get(m.id)!,
      path: `audio/${keyOf.get(m.id)}-${safeName(m.fileName)}`,
      fileName: m.fileName,
      mimeType: m.mimeType,
      size: m.size,
      duration: m.duration,
      peaksPerSecond: m.peaksPerSecond,
      peaks: toBase64(m.peaks),
    }))
  }
  return file
}

/** 예상 파일 크기 (바이트) */
export function estimateExport(src: Source): { full: number; settings: number; audioCount: number; missing: number } {
  const metas = usedAudio(src)
  const fullJson = strToU8(JSON.stringify(buildProjectFile(src, 'full'))).length
  const settingsJson = strToU8(JSON.stringify(buildProjectFile(src, 'settings'), null, 2)).length
  // zip 머리 정보: 항목마다 지역 헤더 + 데이터 설명 + 중앙 목록
  const overhead = (n: string) => 30 + 16 + 46 + 2 * strToU8(n).length
  const zipOverhead =
    overhead(PROJECT_JSON) + metas.reduce((s, m) => s + overhead(`audio/a00-${safeName(m.fileName)}`), 0) + 22
  return {
    full: fullJson + metas.reduce((s, m) => s + m.size, 0) + zipOverhead,
    settings: settingsJson,
    audioCount: metas.length,
    missing: src.cues.filter((c) => !src.audio[c.audioId]).length,
  }
}

export interface ExportProgress {
  /** 처리한 바이트 / 전체 */
  done: number
  total: number
  label: string
}

/** 전체 내보내기 (.mrcue). 음원은 하나씩 조금씩 읽어 압축 없이 담는다 */
export async function exportFull(src: Source, onProgress: (p: ExportProgress) => void): Promise<File> {
  const projectFile = buildProjectFile(src, 'full')
  const json = strToU8(JSON.stringify(projectFile))
  const metas = usedAudio(src)
  const total = json.length + metas.reduce((s, m) => s + m.size, 0)
  let done = 0

  const parts: BlobPart[] = []
  let pending: Uint8Array[] = []
  let zipError: Error | null = null
  let finish!: () => void
  const finished = new Promise<void>((r) => (finish = r))
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err
      finish()
      return
    }
    pending.push(chunk)
    if (final) finish()
  })
  // 쌓인 조각을 Blob으로 넘겨 메모리를 비운다 (브라우저가 디스크로 보낼 수 있게)
  const collapse = () => {
    if (pending.length) parts.push(new Blob(pending as BlobPart[]))
    pending = []
  }

  onProgress({ done, total, label: PROJECT_JSON })
  const jsonEntry = new ZipPassThrough(PROJECT_JSON)
  zip.add(jsonEntry)
  jsonEntry.push(json, true)
  done += json.length

  for (const [i, meta] of metas.entries()) {
    const fa = projectFile.audioFiles![i]
    const blob = await db.getAudioBlob(meta.id)
    if (!blob) throw new Error(`"${meta.fileName}" 음원을 기기에서 찾을 수 없습니다`)
    const entry = new ZipPassThrough(fa.path)
    zip.add(entry)
    if (blob.size === 0) entry.push(new Uint8Array(0), true)
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const part = new Uint8Array(await blob.slice(pos, pos + CHUNK).arrayBuffer())
      entry.push(part, pos + CHUNK >= blob.size)
      done += part.length
      onProgress({ done, total, label: `${i + 1}/${metas.length} ${meta.fileName}` })
    }
    collapse()
    if (zipError) throw zipError
  }
  zip.end()
  await finished
  if (zipError) throw zipError
  collapse()
  return new File(parts, `${safeName(src.project.name)}_${stamp()}.mrcue`, { type: 'application/zip' })
}

/** 설정만 내보내기 (.json) */
export function exportSettings(src: Source): File {
  const text = JSON.stringify(buildProjectFile(src, 'settings'), null, 2)
  return new File([text], `${safeName(src.project.name)}_설정_${stamp()}.json`, { type: 'application/json' })
}

// ───────────────────────── 가져오기: 검사 ─────────────────────────

export interface PreparedImport {
  kind: 'full' | 'settings'
  file: File
  data: ProjectFile
  /** 전체: key → zip 항목 */
  entries?: Map<string, ZipEntry>
  /** 설정만: 큐 순서대로 연결할 기기 음원 id (없으면 null) */
  links?: (string | null)[]
  summary: {
    projectName: string
    cueCount: number
    markerCount: number
    audioCount: number
    /** 설정만: 기기 음원과 연결된 큐 수 */
    linked: number
    /** 설정만: 기기에 없는 음원 파일 이름 */
    missing: string[]
    exportedAt: string
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/** 내용 구조 검사. 문제가 있으면 무엇이 문제인지 알려준다 */
function validate(raw: unknown): ProjectFile {
  if (!raw || typeof raw !== 'object') throw new ImportError('설정 내용이 비어 있거나 형식이 잘못됐습니다')
  const d = raw as Record<string, unknown>
  if (d.format !== FORMAT_ID) throw new ImportError('MR 큐 플레이어에서 내보낸 프로젝트 파일이 아닙니다')
  if (!isNum(d.version)) throw new ImportError('파일에 버전 번호가 없습니다')
  if (d.version > FORMAT_VERSION) {
    throw new ImportError(
      `이 파일은 더 새로운 버전(v${d.version})의 앱에서 만들어졌습니다. 이 앱은 v${FORMAT_VERSION}까지 읽을 수 있습니다. 앱을 업데이트한 뒤 다시 시도하세요.`,
    )
  }
  if (d.version !== FORMAT_VERSION) throw new ImportError(`지원하지 않는 파일 버전입니다 (v${d.version})`)
  if (d.kind !== 'full' && d.kind !== 'settings') throw new ImportError('파일 종류(kind)가 잘못됐습니다')
  const project = d.project as Record<string, unknown> | undefined
  if (!project || !isStr(project.name)) throw new ImportError('프로젝트 이름이 없습니다')
  if (!Array.isArray(d.cues)) throw new ImportError('큐 목록이 없습니다')
  d.cues.forEach((c: Record<string, unknown>, i: number) => {
    const where = `${i + 1}번 큐`
    if (!c || typeof c !== 'object') throw new ImportError(`${where}의 내용이 잘못됐습니다`)
    if (!isStr(c.name)) throw new ImportError(`${where}의 이름이 없습니다`)
    for (const k of ['inPoint', 'fadeIn', 'fadeOut', 'volumeDb']) {
      if (!isNum(c[k])) throw new ImportError(`${where}의 ${k} 값이 잘못됐습니다`)
    }
    if (c.outPoint !== null && !isNum(c.outPoint)) throw new ImportError(`${where}의 outPoint 값이 잘못됐습니다`)
    if (!Array.isArray(c.markers)) throw new ImportError(`${where}의 마커 목록이 잘못됐습니다`)
    for (const m of c.markers as Record<string, unknown>[]) {
      if (!m || !isStr(m.name) || !isNum(m.time)) throw new ImportError(`${where}의 마커 내용이 잘못됐습니다`)
    }
    const a = c.audio as Record<string, unknown> | undefined
    if (!a || !isStr(a.fileName) || !isNum(a.duration) || !isNum(a.size)) {
      throw new ImportError(`${where}의 음원 정보(파일 이름, 길이, 크기)가 잘못됐습니다`)
    }
  })
  if (d.kind === 'full') {
    if (!Array.isArray(d.audioFiles)) throw new ImportError('음원 목록이 없습니다')
    for (const a of d.audioFiles as Record<string, unknown>[]) {
      if (!a || !isStr(a.key) || !isStr(a.path) || !isStr(a.fileName) || !isNum(a.size) || !isNum(a.duration)) {
        throw new ImportError('음원 목록의 내용이 잘못됐습니다')
      }
    }
  }
  return d as unknown as ProjectFile
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ImportError('설정 내용(project.json)이 손상됐습니다 (JSON을 읽을 수 없음)')
  }
}

/**
 * 가져올 파일을 검사한다. 아무것도 저장하지 않는다.
 * @param onProgress 손상 검사 진행 (전체 내보내기 파일)
 */
export async function inspectImport(file: File, onProgress?: (p: ExportProgress) => void): Promise<PreparedImport> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04

  if (!isZip) {
    // 설정만 (.json)
    const firstChar = new TextDecoder().decode(head).trimStart()[0]
    if (firstChar !== '{') throw new ImportError('.mrcue 또는 .json 프로젝트 파일이 아닙니다')
    if (file.size > 50 * 1024 * 1024) throw new ImportError('설정 파일이 너무 큽니다')
    const data = validate(parseJson(new Uint8Array(await file.arrayBuffer())))
    // 같은 파일 이름 + 길이의 음원이 기기에 있으면 연결
    const metas = await db.listAudioMeta()
    const links = data.cues.map((c) => {
      const same = metas.filter((m) => m.fileName === c.audio.fileName && Math.abs(m.duration - c.audio.duration) < 0.05)
      return (same.find((m) => m.size === c.audio.size) ?? same[0])?.id ?? null
    })
    const missing = [...new Set(data.cues.filter((_, i) => !links[i]).map((c) => c.audio.fileName || '(이름 없음)'))]
    return {
      kind: 'settings',
      file,
      data,
      links,
      summary: {
        projectName: data.project.name,
        cueCount: data.cues.length,
        markerCount: data.cues.reduce((s, c) => s + c.markers.length, 0),
        audioCount: new Set(data.cues.map((c) => c.audio.fileName)).size,
        linked: links.filter(Boolean).length,
        missing,
        exportedAt: data.exportedAt,
      },
    }
  }

  // 전체 (.mrcue)
  let entries: ZipEntry[]
  try {
    entries = await readZipEntries(file)
  } catch (err) {
    throw new ImportError(err instanceof ZipError ? err.message : '파일이 손상됐습니다 (zip을 읽을 수 없음)')
  }
  const jsonEntry = entries.find((e) => e.name === PROJECT_JSON)
  if (!jsonEntry) throw new ImportError('파일 안에 project.json이 없습니다')
  let jsonBytes: Uint8Array
  try {
    jsonBytes = await entryBytes(file, jsonEntry)
  } catch (err) {
    throw new ImportError(err instanceof Error ? err.message : 'project.json을 읽을 수 없습니다')
  }
  const data = validate(parseJson(jsonBytes))
  if (data.kind !== 'full' || !data.audioFiles) throw new ImportError('음원이 들어 있는 전체 내보내기 파일이 아닙니다')

  const byPath = new Map(entries.map((e) => [e.name, e]))
  const byKey = new Map<string, ZipEntry>()
  for (const a of data.audioFiles) {
    const e = byPath.get(a.path)
    if (!e) throw new ImportError(`음원 "${a.fileName}"이(가) 파일 안에 없습니다`)
    if (e.method !== 0) throw new ImportError(`음원 "${a.fileName}"이(가) 지원하지 않는 방식으로 압축돼 있습니다`)
    if (e.size !== a.size) throw new ImportError(`음원 "${a.fileName}"의 크기가 맞지 않습니다 (파일이 손상됨)`)
    byKey.set(a.key, e)
  }
  for (const [i, c] of data.cues.entries()) {
    if (c.audio.key && !byKey.has(c.audio.key)) throw new ImportError(`${i + 1}번 큐 "${c.name}"의 음원이 파일 안에 없습니다`)
  }

  // 손상 검사: 음원을 하나씩 조금씩 읽어 CRC 확인
  const total = data.audioFiles.reduce((s, a) => s + a.size, 0)
  let done = 0
  for (const [i, a] of data.audioFiles.entries()) {
    const e = byKey.get(a.key)!
    const blob = await entryBlob(file, e).catch((err: unknown) => {
      throw new ImportError(err instanceof Error ? err.message : '음원을 읽을 수 없습니다')
    })
    const ok = await verifyCrc(blob, e.crc, (n) => {
      done += n
      onProgress?.({ done, total, label: `손상 검사 ${i + 1}/${data.audioFiles!.length} ${a.fileName}` })
    })
    if (!ok) throw new ImportError(`음원 "${a.fileName}"이(가) 손상됐습니다 (검사 값이 맞지 않음)`)
  }

  return {
    kind: 'full',
    file,
    data,
    entries: byKey,
    summary: {
      projectName: data.project.name,
      cueCount: data.cues.length,
      markerCount: data.cues.reduce((s, c) => s + c.markers.length, 0),
      audioCount: data.audioFiles.length,
      linked: data.cues.length,
      missing: [],
      exportedAt: data.exportedAt,
    },
  }
}

// ───────────────────────── 가져오기: 저장 ─────────────────────────

/** 기존 프로젝트 이름과 겹치지 않게 */
function uniqueName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (가져옴)` : `${name} (가져옴 ${n})`
    if (!existing.includes(candidate)) return candidate
  }
}

function toCue(c: FileCue, audioId: string, missing: boolean): Cue {
  const markers: Marker[] = c.markers.map((m) => ({ id: newId(), name: m.name, time: m.time, color: m.color ?? 'orange' }))
  return {
    id: newId(),
    name: c.name,
    audioId,
    inPoint: c.inPoint,
    outPoint: c.outPoint,
    fadeIn: c.fadeIn,
    fadeOut: c.fadeOut,
    volumeDb: c.volumeDb,
    memo: c.memo ?? '',
    markers: markers.sort((a, b) => a.time - b.time),
    ...(missing ? { missingAudio: { fileName: c.audio.fileName, duration: c.audio.duration, size: c.audio.size } } : {}),
  }
}

/**
 * 검사를 마친 파일을 새 프로젝트로 저장한다. 중간에 실패하면 넣은 음원을 지우고 오류를 낸다.
 * @returns 새 프로젝트
 */
export async function applyImport(
  prep: PreparedImport,
  existingNames: string[],
  onProgress?: (p: ExportProgress) => void,
): Promise<Project> {
  const created: string[] = []
  try {
    const audioIdByKey = new Map<string, string>()
    if (prep.kind === 'full') {
      const files = prep.data.audioFiles!
      for (const [i, a] of files.entries()) {
        onProgress?.({ done: i, total: files.length, label: `음원 저장 ${i + 1}/${files.length} ${a.fileName}` })
        const blob = await entryBlob(prep.file, prep.entries!.get(a.key)!, a.mimeType)
        let peaks: Uint8Array
        let peaksPerSecond = a.peaksPerSecond
        try {
          peaks = fromBase64(a.peaks)
          if (peaks.length === 0) throw new Error('empty')
        } catch {
          // 파형 정보가 없으면 다시 계산 (디코딩)
          const analysis = await analyzeAudio(await blob.arrayBuffer())
          peaks = analysis.peaks
          peaksPerSecond = PEAKS_PER_SECOND
        }
        const id = newId()
        await db.putAudio(
          { id, fileName: a.fileName, duration: a.duration, peaks, peaksPerSecond, size: a.size, mimeType: a.mimeType, createdAt: Date.now() },
          blob,
        )
        created.push(id)
        audioIdByKey.set(a.key, id)
      }
    }

    const cues = prep.data.cues.map((c, i) => {
      const audioId = prep.kind === 'full' ? (c.audio.key ? audioIdByKey.get(c.audio.key) : undefined) : prep.links![i]
      return toCue(c, audioId ?? '', !audioId)
    })
    const project: Project = {
      id: newId(),
      name: uniqueName(prep.data.project.name, existingNames),
      cueIds: cues.map((c) => c.id),
      updatedAt: Date.now(),
    }
    await db.putProjectWithCues(project, cues)
    onProgress?.({ done: 1, total: 1, label: '완료' })
    return project
  } catch (err) {
    // 아무것도 남기지 않는다
    if (created.length) await db.deleteAudio(created).catch(() => {})
    throw err
  }
}
