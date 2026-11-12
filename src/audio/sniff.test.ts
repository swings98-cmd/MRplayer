import { describe, expect, it } from 'vitest'
import { sniffSampleRate } from './sniff.ts'

function wavHeader(sampleRate: number): Uint8Array {
  const b = new Uint8Array(44)
  const dv = new DataView(b.buffer)
  const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
  s(0, 'RIFF')
  s(8, 'WAVE')
  s(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint32(24, sampleRate, true)
  s(36, 'data')
  return b
}

describe('sniffSampleRate: 원본 샘플레이트', () => {
  it('WAV', () => {
    expect(sniffSampleRate(wavHeader(48000))).toBe(48000)
    expect(sniffSampleRate(wavHeader(22050))).toBe(22050)
  })
  it('MP3 프레임 헤더 (MPEG-1 44.1kHz)', () => {
    expect(sniffSampleRate(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(44100)
  })
  it('모르는 형식은 null', () => {
    expect(sniffSampleRate(new Uint8Array(32))).toBeNull()
  })
})
