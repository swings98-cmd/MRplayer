/**
 * 큰 zip을 메모리에 다 올리지 않고 읽는다.
 * 끝부분의 목록(중앙 디렉터리)만 읽고, 각 항목은 원래 파일에서 그 부분만 잘라(Blob.slice) 꺼낸다.
 * 압축하지 않은 항목(저장만 한 것)은 그대로, 압축된 항목은 작은 파일(project.json)만 푼다.
 */
import { inflateSync } from 'fflate'
import { crc32 } from './crc32.ts'

export interface ZipEntry {
  name: string
  /** 0: 저장만, 8: deflate */
  method: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
}

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}

export async function readZipEntries(file: Blob): Promise<ZipEntry[]> {
  if (file.size < 22) throw new ZipError('파일이 너무 작습니다 (zip이 아님)')
  // 끝에서 목록 위치(EOCD)를 찾는다 (뒤에 주석이 있을 수 있어 최대 64KB)
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = await bytes(file, tailStart, file.size)
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('zip 목록을 찾을 수 없습니다 (파일이 잘렸거나 손상됨)')
  const count = tail.getUint16(eocd + 10, true)
  const cdSize = tail.getUint32(eocd + 12, true)
  const cdOffset = tail.getUint32(eocd + 16, true)
  if (cdOffset === 0xffffffff || count === 0xffff) throw new ZipError('4GB가 넘는 zip(ZIP64)은 지원하지 않습니다')
  if (cdOffset + cdSize > file.size) throw new ZipError('zip 목록 위치가 잘못됐습니다 (파일이 잘렸거나 손상됨)')

  const cd = await bytes(file, cdOffset, cdOffset + cdSize)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('zip 목록이 손상됐습니다')
    const nameLen = cd.getUint16(p + 28, true)
    const extraLen = cd.getUint16(p + 30, true)
    const commentLen = cd.getUint16(p + 32, true)
    const name = decoder.decode(new Uint8Array(cd.buffer, p + 46, nameLen))
    entries.push({
      name,
      method: cd.getUint16(p + 10, true),
      crc: cd.getUint32(p + 16, true),
      compressedSize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      localOffset: cd.getUint32(p + 42, true),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 항목의 (압축된) 데이터 부분 */
async function rawData(file: Blob, e: ZipEntry): Promise<Blob> {
  const local = await bytes(file, e.localOffset, e.localOffset + 30)
  if (local.byteLength < 30 || local.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`"${e.name}" 항목이 손상됐습니다`)
  const start = e.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
  if (start + e.compressedSize > file.size) throw new ZipError(`"${e.name}" 항목이 잘렸습니다`)
  return file.slice(start, start + e.compressedSize)
}

/** 압축하지 않은 항목을 원래 파일에서 잘라낸 Blob으로 (메모리에 올리지 않음) */
export async function entryBlob(file: Blob, e: ZipEntry, type = ''): Promise<Blob> {
  if (e.method !== 0) throw new ZipError(`"${e.name}"은(는) 압축되어 있어 읽을 수 없습니다`)
  const raw = await rawData(file, e)
  return type ? raw.slice(0, raw.size, type) : raw
}

/** 작은 항목(설정 파일)을 바이트로 */
export async function entryBytes(file: Blob, e: ZipEntry): Promise<Uint8Array> {
  const raw = new Uint8Array(await (await rawData(file, e)).arrayBuffer())
  if (e.method === 0) return raw
  if (e.method === 8) return inflateSync(raw)
  throw new ZipError(`"${e.name}"의 압축 방식(${e.method})은 지원하지 않습니다`)
}

/** 손상 검사: CRC를 조금씩 읽으며 계산 (메모리를 크게 쓰지 않음) */
export async function verifyCrc(blob: Blob, expected: number, onProgress?: (bytes: number) => void): Promise<boolean> {
  const CHUNK = 4 * 1024 * 1024
  let c = 0
  for (let pos = 0; pos < blob.size; pos += CHUNK) {
    const part = new Uint8Array(await blob.slice(pos, pos + CHUNK).arrayBuffer())
    c = crc32(part, c)
    onProgress?.(part.length)
  }
  return c === expected >>> 0
}
