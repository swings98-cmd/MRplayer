/**
 * 음원 추출용 렌더링. 재생 엔진과 같은 코드(cueRange + Voice)로 OfflineAudioContext에서 그려서,
 * 앱에서 들리는 소리와 파일이 똑같게 한다. 마스터 볼륨은 적용하지 않는다(큐 자체 설정만).
 */
import { decodeAudio } from './decode.ts'
import { cueRange, envelopeAt } from './envelope.ts'
import { sniffSampleRate } from './sniff.ts'
import type { CueSettings } from './types.ts'
import { Voice } from './voice.ts'

/** 원본 샘플레이트를 알 수 없을 때 */
const FALLBACK_SAMPLE_RATE = 44100

export interface RenderedAudio {
  /** 채널별 샘플 (-1~1, 볼륨을 올렸으면 넘을 수 있음) */
  channels: Float32Array[]
  sampleRate: number
  /** 가장 큰 진폭. 1을 넘으면 클리핑 */
  peak: number
}

function offlineCtor(): typeof OfflineAudioContext {
  return (
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  )
}

/**
 * 큐의 현재 설정(인/아웃, 페이드 인/아웃, 큐 볼륨)으로 렌더링한다.
 * 원본의 샘플레이트와 채널 수를 유지한다.
 * @param data 원본 파일 (디코딩 후 비워질 수 있다)
 * @param maxSampleRate 이보다 높으면 낮춘다 (MP3는 48kHz까지만 가능)
 */
export async function renderCue(data: ArrayBuffer, cue: CueSettings, maxSampleRate?: number): Promise<RenderedAudio> {
  const original = sniffSampleRate(new Uint8Array(data)) ?? FALLBACK_SAMPLE_RATE
  const sampleRate = maxSampleRate ? Math.min(original, maxSampleRate) : original
  const OAC = offlineCtor()

  const buffer = await decodeAudio(new OAC(1, 1, sampleRate), data)
  const range = cueRange(cue, buffer.duration)
  const length = Math.max(1, Math.round((range.outPoint - range.inPoint) * sampleRate))

  const ctx = new OAC(buffer.numberOfChannels, length, sampleRate)
  // 재생과 똑같은 Voice: 볼륨 곡선 + 시작 디클릭 + 아웃 포인트에서 끝
  new Voice(ctx, ctx.destination, buffer, cue.audioId, range, range.inPoint)
  const rendered = await ctx.startRendering()

  const channels = Array.from({ length: rendered.numberOfChannels }, (_, c) => rendered.getChannelData(c))
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i])
      if (v > peak) peak = v
    }
  }
  return { channels, sampleRate, peak }
}

/** 클리핑이 생기지 않게 전체를 낮춘다 (가장 큰 소리를 약 -0.2dBFS로). 낮춘 dB를 돌려준다 */
export function lowerToAvoidClipping(audio: RenderedAudio): number {
  if (audio.peak <= 1) return 0
  const scale = 0.977 / audio.peak
  for (const ch of audio.channels) for (let i = 0; i < ch.length; i++) ch[i] *= scale
  audio.peak *= scale
  return 20 * Math.log10(scale)
}

/**
 * 저장된 파형 피크로 추출 결과의 가장 큰 진폭을 미리 어림한다 (렌더링 없이, 클리핑 경고용).
 * 재생과 같은 볼륨 곡선(cueRange, envelopeAt)을 쓴다.
 */
export function estimatePeak(
  cue: CueSettings,
  peaks: Uint8Array,
  peaksPerSecond: number,
  duration: number,
): number {
  const range = cueRange(cue, duration)
  const from = Math.floor(range.inPoint * peaksPerSecond)
  const to = Math.min(peaks.length, Math.ceil(range.outPoint * peaksPerSecond))
  let peak = 0
  for (let i = from; i < to; i++) {
    const t = Math.min(range.outPoint, Math.max(range.inPoint, (i + 0.5) / peaksPerSecond))
    const v = (peaks[i] / 255) * envelopeAt(range, t)
    if (v > peak) peak = v
  }
  return peak
}
