/**
 * 불러올 때 한 번만 하는 음원 분석: 길이와 파형 피크.
 * 재생용 AudioContext와 분리된 OfflineAudioContext로 디코딩해서, 재생 중에도 영향이 없게 한다.
 */
import { decodeAudio } from './decode.ts'

/** 1초당 피크 개수. 5분 음원이면 30,000바이트 */
export const PEAKS_PER_SECOND = 100

export interface AudioAnalysis {
  /** 길이(초) */
  duration: number
  /** 구간별 최대 진폭 (0~255, 모든 채널 중 가장 큰 값) */
  peaks: Uint8Array
  peaksPerSecond: number
}

/**
 * 음원을 디코딩해서 길이와 파형 피크를 계산한다. 디코딩할 수 없는 파일이면 예외.
 * 주의: 넘긴 ArrayBuffer는 디코딩 후 비워질 수 있다(detached).
 */
export async function analyzeAudio(data: ArrayBuffer): Promise<AudioAnalysis> {
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const ctx = new OAC(1, 1, 44100)
  const buf = await decodeAudio(ctx, data)
  if (!(buf.duration > 0)) throw new Error('길이가 0인 음원입니다')

  const sr = buf.sampleRate
  const count = Math.ceil(buf.duration * PEAKS_PER_SECOND)
  const peaks = new Uint8Array(count)
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))

  for (let p = 0; p < count; p++) {
    const start = Math.floor((p * sr) / PEAKS_PER_SECOND)
    const end = Math.min(buf.length, Math.floor(((p + 1) * sr) / PEAKS_PER_SECOND))
    let max = 0
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(ch[i])
        if (v > max) max = v
      }
    }
    peaks[p] = Math.min(255, Math.round(max * 255))
  }

  return { duration: buf.duration, peaks, peaksPerSecond: PEAKS_PER_SECOND }
}

/**
 * 디코딩만 시험해 본다 (공연 전 점검용). 결과는 바로 버린다.
 * 메모리를 적게 쓰도록 낮은 샘플레이트로 디코딩하고, 안 되면 44.1kHz로 다시 시도한다.
 * @returns 길이(초). 디코딩할 수 없으면 예외
 */
export async function testDecode(data: ArrayBuffer): Promise<number> {
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  let ctx: OfflineAudioContext
  try {
    ctx = new OAC(1, 1, 22050)
  } catch {
    ctx = new OAC(1, 1, 44100)
  }
  const buf = await decodeAudio(ctx, data)
  if (!(buf.duration > 0)) throw new Error('길이가 0인 음원입니다')
  return buf.duration
}
