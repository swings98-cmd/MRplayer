/**
 * MP3 인코딩 Web Worker (화면이 멈추지 않게 별도 스레드에서).
 * 인코더: @breezystack/lamejs (LAME의 자바스크립트 이식판 lamejs의 ESM 포크, LGPL-3.0)
 */
import { Mp3Encoder } from '@breezystack/lamejs'

export interface Mp3Request {
  channels: Float32Array[]
  sampleRate: number
  kbps: number
}

export type Mp3Response =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; parts: Uint8Array[] }
  | { type: 'error'; message: string }

/** LAME이 한 번에 받는 샘플 수의 배수 */
const BLOCK = 1152 * 16

function toInt16(src: Float32Array, from: number, n: number): Int16Array {
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, src[from + i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

self.onmessage = (e: MessageEvent<Mp3Request>) => {
  const post = (msg: Mp3Response, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(msg, transfer)
  try {
    const { channels, sampleRate, kbps } = e.data
    const stereo = channels.length >= 2
    const left = channels[0]
    // MP3는 2채널까지: 3채널 이상이면 앞의 두 채널만 쓴다
    const right = stereo ? channels[1] : undefined
    const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps)
    const parts: Uint8Array[] = []
    const total = left.length
    let lastReport = 0

    for (let i = 0; i < total; i += BLOCK) {
      const n = Math.min(BLOCK, total - i)
      const out = right
        ? encoder.encodeBuffer(toInt16(left, i, n), toInt16(right, i, n))
        : encoder.encodeBuffer(toInt16(left, i, n))
      if (out.length > 0) parts.push(new Uint8Array(out))
      const ratio = (i + n) / total
      if (ratio - lastReport >= 0.02) {
        lastReport = ratio
        post({ type: 'progress', ratio })
      }
    }
    const tail = encoder.flush()
    if (tail.length > 0) parts.push(new Uint8Array(tail))
    post({ type: 'done', parts }, parts.map((p) => p.buffer))
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
