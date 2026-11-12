/**
 * 파일 머리 부분을 읽어 원본 샘플레이트를 알아낸다.
 * decodeAudioData는 디코딩하는 컨텍스트의 샘플레이트로 바꿔 버리므로,
 * 추출 파일이 원본 샘플레이트를 유지하려면 디코딩 전에 원래 값을 알아야 한다.
 * 지원: WAV, FLAC, MP3, AAC(ADTS), M4A/MP4(AAC, ALAC). 모르면 null.
 */

const MP3_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
}
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len))

export function sniffSampleRate(b: Uint8Array): number | null {
  if (b.length < 12) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)

  // WAV: RIFF....WAVE + fmt 청크
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') {
    let p = 12
    while (p + 8 <= b.length) {
      const id = ascii(b, p, 4)
      const size = dv.getUint32(p + 4, true)
      if (id === 'fmt ' && p + 16 <= b.length) return dv.getUint32(p + 12, true) || null
      p += 8 + size + (size % 2)
    }
    return null
  }

  // FLAC: fLaC + STREAMINFO (샘플레이트 20비트)
  if (ascii(b, 0, 4) === 'fLaC' && b.length >= 21) {
    const d = 8
    const sr = (b[d + 10] << 12) | (b[d + 11] << 4) | (b[d + 12] >> 4)
    return sr || null
  }

  // MP4/M4A: 'mp4a' 또는 'alac' 샘플 항목 (moov가 파일 끝에 있을 수 있어 전체를 찾는다)
  if (ascii(b, 4, 4) === 'ftyp') {
    for (const tag of ['mp4a', 'alac']) {
      const t = [...tag].map((c) => c.charCodeAt(0))
      for (let i = 8; i + 32 < b.length; i++) {
        if (b[i] === t[0] && b[i + 1] === t[1] && b[i + 2] === t[2] && b[i + 3] === t[3]) {
          // 'mp4a' 다음: 예약 6 + 참조 2 + 예약 8 + 채널 2 + 비트 2 + 2 + 2 → 샘플레이트(16.16)
          const sr = dv.getUint32(i + 28) >>> 16
          if (sr >= 8000 && sr <= 192000) return tag === 'mp4a' && sr <= 24000 ? sr * 2 : sr // HE-AAC는 두 배로 나온다
        }
      }
    }
    return null
  }

  // MP3: ID3v2 태그를 건너뛰고 첫 프레임 헤더
  let p = 0
  if (ascii(b, 0, 3) === 'ID3' && b.length > 10) {
    p = 10 + ((b[6] & 0x7f) << 21) + ((b[7] & 0x7f) << 14) + ((b[8] & 0x7f) << 7) + (b[9] & 0x7f)
  }
  const limit = Math.min(b.length - 4, p + 64 * 1024)
  for (let i = p; i < limit; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue
    const version = (b[i + 1] >> 3) & 0x03
    const layer = (b[i + 1] >> 1) & 0x03
    if (layer === 0) {
      // ADTS(AAC): 레이어 비트가 00
      const idx = (b[i + 2] >> 2) & 0x0f
      const sr = AAC_RATES[idx]
      if (sr) return sr <= 24000 ? sr * 2 : sr
      continue
    }
    const idx = (b[i + 2] >> 2) & 0x03
    const rates = MP3_RATES[version]
    if (rates && idx < 3) return rates[idx]
  }
  return null
}
