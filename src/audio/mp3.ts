/** MP3 인코딩 (Web Worker에서). 화면은 진행률만 받는다. */
import type { Mp3Request, Mp3Response } from './mp3Worker.ts'

/** LAME이 지원하는 최대 샘플레이트 */
export const MP3_MAX_SAMPLE_RATE = 48000

export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3Worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Mp3Response>) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress?.(msg.ratio)
      else {
        worker.terminate()
        if (msg.type === 'done') resolve(new Blob(msg.parts as BlobPart[], { type: 'audio/mpeg' }))
        else reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'MP3 인코더를 시작하지 못했습니다'))
    }
    // AudioBuffer의 채널 배열은 옮길(transfer) 수 없는 경우가 있어 복사해서 보낸다
    const req: Mp3Request = { channels, sampleRate, kbps }
    worker.postMessage(req)
  })
}

/** 실제로 쓰이는 비트레이트: 32kHz 미만(MPEG-2)은 규격상 160kbps가 최대 */
export function effectiveKbps(kbps: number, sampleRate: number): number {
  return sampleRate < 32000 ? Math.min(kbps, 160) : kbps
}

/** 예상 MP3 크기(바이트) */
export function mp3Size(seconds: number, kbps: number, sampleRate: number): number {
  return Math.round((seconds * effectiveKbps(kbps, sampleRate) * 1000) / 8)
}
