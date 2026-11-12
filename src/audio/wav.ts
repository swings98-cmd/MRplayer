/** WAV(16비트 PCM) 인코딩. 외부 라이브러리 없이 직접 쓴다. */

/** -1~1을 넘는 값은 잘라낸다 (클리핑) */
export function encodeWav16(channels: Float32Array[], sampleRate: number): Blob {
  const numCh = channels.length
  const frames = channels[0]?.length ?? 0
  const dataBytes = frames * numCh * 2
  const header = new ArrayBuffer(44)
  const h = new DataView(header)
  const str = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)))

  str(0, 'RIFF')
  h.setUint32(4, 36 + dataBytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  h.setUint32(16, 16, true) // fmt 청크 크기
  h.setUint16(20, 1, true) // PCM
  h.setUint16(22, numCh, true)
  h.setUint32(24, sampleRate, true)
  h.setUint32(28, sampleRate * numCh * 2, true) // 초당 바이트
  h.setUint16(32, numCh * 2, true) // 블록 크기
  h.setUint16(34, 16, true) // 비트
  str(36, 'data')
  h.setUint32(40, dataBytes, true)

  // 큰 파일도 메모리를 한 번에 크게 잡지 않도록 1초 단위 조각으로 만든다
  const parts: BlobPart[] = [header]
  const chunkFrames = sampleRate
  for (let start = 0; start < frames; start += chunkFrames) {
    const n = Math.min(chunkFrames, frames - start)
    const out = new Int16Array(n * numCh)
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < numCh; c++) {
        const v = Math.max(-1, Math.min(1, channels[c][start + i]))
        out[i * numCh + c] = v < 0 ? v * 0x8000 : v * 0x7fff
      }
    }
    parts.push(out)
  }
  return new Blob(parts, { type: 'audio/wav' })
}

/** 예상 WAV 크기(바이트) */
export function wavSize(seconds: number, sampleRate: number, channels: number): number {
  return 44 + Math.round(seconds * sampleRate) * channels * 2
}
