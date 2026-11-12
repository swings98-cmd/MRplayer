/**
 * 음원 추출: 큐 하나를 현재 설정대로 렌더링해서 WAV 또는 MP3 파일로 만든다.
 * 원본과 큐 설정은 바꾸지 않는다(비파괴). 추출한 파일을 큐로 다시 추가하지 않는다.
 */
import {
  encodeMp3,
  encodeWav16,
  estimatePeak,
  lowerToAvoidClipping,
  MP3_MAX_SAMPLE_RATE,
  mp3Size,
  renderCue,
  sniffSampleRate,
  wavSize,
} from '../audio/index.ts'
import { getAudioBlob } from './db.ts'
import type { AudioMeta, Cue } from './types.ts'

export type ExportFormat = 'wav' | 'mp3-192' | 'mp3-320'

export const FORMATS: { id: ExportFormat; label: string; desc: string }[] = [
  { id: 'wav', label: 'WAV', desc: '16비트 · 무손실 · 파일이 큼' },
  { id: 'mp3-192', label: 'MP3 192kbps', desc: '작은 파일' },
  { id: 'mp3-320', label: 'MP3 320kbps', desc: 'MP3 최고 음질' },
]

/** 클리핑이 있을 때: 그대로 / 자동으로 낮춤 */
export type ClipPolicy = 'keep' | 'lower'

export type ExportStage = 'reading' | 'rendering' | 'encoding'

export interface ExportedFile {
  file: File
  /** 자동으로 낮춘 dB (0이면 그대로) */
  loweredDb: number
  /** 렌더링 결과 가장 큰 진폭 (낮추기 전) */
  peak: number
  sampleRate: number
  channels: number
}

const extension = (f: ExportFormat) => (f === 'wav' ? 'wav' : 'mp3')
const kbpsOf = (f: ExportFormat) => (f === 'mp3-320' ? 320 : 192)

/** 파일 이름에 쓸 수 없는 글자를 바꾸고 확장자를 붙인다 */
export function safeFileName(name: string, format: ExportFormat): string {
  const cleaned = [...name].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('')
  const base = cleaned.trim().replace(/\.(wav|mp3)$/i, '') || '음원'
  return `${base}.${extension(format)}`
}

/** 트림 반영 길이(초) */
export function trimmedSeconds(cue: Cue, meta: AudioMeta): number {
  const out = cue.outPoint === null ? meta.duration : Math.min(cue.outPoint, meta.duration)
  return Math.max(0, out - cue.inPoint)
}

/**
 * 원본 샘플레이트·채널 수 어림 (예상 크기 표시용).
 * 파일 앞부분만 읽는다. 모르면 44.1kHz 스테레오로 본다.
 */
export async function probeOriginal(audioId: string): Promise<{ sampleRate: number; channels: number }> {
  const blob = await getAudioBlob(audioId)
  if (!blob) return { sampleRate: 44100, channels: 2 }
  const head = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer())
  let sampleRate = sniffSampleRate(head)
  // M4A는 정보가 파일 끝에 있을 수 있다
  if (sampleRate === null && blob.size > head.length && blob.size < 64 * 1024 * 1024) {
    sampleRate = sniffSampleRate(new Uint8Array(await blob.arrayBuffer()))
  }
  // WAV는 채널 수도 머리에 있다
  let channels = 2
  if (head.length > 24 && String.fromCharCode(...head.subarray(0, 4)) === 'RIFF') {
    channels = new DataView(head.buffer).getUint16(22, true) || 2
  }
  return { sampleRate: sampleRate ?? 44100, channels }
}

export function estimateBytes(seconds: number, format: ExportFormat, sampleRate: number, channels: number): number {
  if (format === 'wav') return wavSize(seconds, sampleRate, channels)
  return mp3Size(seconds, kbpsOf(format), Math.min(sampleRate, MP3_MAX_SAMPLE_RATE))
}

/** 저장된 파형으로 클리핑을 미리 어림한다. 1을 넘으면 깨지는 구간이 있다 */
export function estimateCuePeak(cue: Cue, meta: AudioMeta): number {
  return estimatePeak(cue, meta.peaks, meta.peaksPerSecond, meta.duration)
}

/**
 * 큐 하나 추출.
 * @param askOnClip 미리 어림하지 못한 클리핑이 렌더링에서 발견됐을 때 정책을 묻는 함수
 */
export async function exportCue(
  cue: Cue,
  fileName: string,
  format: ExportFormat,
  policy: ClipPolicy | null,
  askOnClip: (overDb: number) => Promise<ClipPolicy>,
  onStage: (stage: ExportStage, ratio?: number) => void,
): Promise<ExportedFile> {
  onStage('reading')
  const blob = await getAudioBlob(cue.audioId)
  if (!blob) throw new Error('저장된 음원 파일을 찾을 수 없습니다')
  const data = await blob.arrayBuffer()

  onStage('rendering')
  const audio = await renderCue(data, cue, format === 'wav' ? undefined : MP3_MAX_SAMPLE_RATE)
  const peak = audio.peak
  let loweredDb = 0
  if (peak > 1) {
    const choice = policy ?? (await askOnClip(20 * Math.log10(peak)))
    if (choice === 'lower') loweredDb = lowerToAvoidClipping(audio)
  }

  onStage('encoding', 0)
  const out =
    format === 'wav'
      ? encodeWav16(audio.channels, audio.sampleRate)
      : await encodeMp3(audio.channels, audio.sampleRate, kbpsOf(format), (r) => onStage('encoding', r))
  onStage('encoding', 1)

  const file = new File([out], safeFileName(fileName, format), { type: out.type })
  return { file, loweredDb, peak, sampleRate: audio.sampleRate, channels: audio.channels.length }
}
