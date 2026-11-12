import { describe, expect, it } from 'vitest'
import { MIN_TRIM, normalizeEdit, ORIGINAL_VALUES } from './cueRules.ts'

const v = (p: Partial<typeof ORIGINAL_VALUES> = {}) => ({ ...ORIGINAL_VALUES, ...p })

describe('normalizeEdit: 편집 규칙', () => {
  it('아웃 포인트가 파일 끝이면 "끝까지"(null)', () => {
    expect(normalizeEdit(v({ outPoint: 60 }), 60).outPoint).toBeNull()
  })
  it('인/아웃 사이는 최소 0.1초', () => {
    const r = normalizeEdit(v({ inPoint: 10, outPoint: 10 }), 60)
    expect(r.outPoint! - r.inPoint).toBeCloseTo(MIN_TRIM)
  })
  it('인 포인트는 파일 끝 0.1초 전까지', () => {
    expect(normalizeEdit(v({ inPoint: 100 }), 60).inPoint).toBeCloseTo(59.9)
  })
  it('페이드 합이 트림 길이를 넘으면 방금 바꾼 쪽을 줄인다', () => {
    expect(normalizeEdit(v({ outPoint: 10, fadeIn: 3, fadeOut: 9 }), 60, 'fadeOut')).toMatchObject({ fadeIn: 3, fadeOut: 7 })
  })
  it('트림을 줄여 넘치면 두 페이드를 같은 비율로', () => {
    expect(normalizeEdit(v({ outPoint: 6, fadeIn: 4, fadeOut: 8 }), 60)).toMatchObject({ fadeIn: 2, fadeOut: 4 })
  })
  it('페이드 최대 30초, 볼륨 -40~+6dB', () => {
    const r = normalizeEdit(v({ fadeIn: 50, volumeDb: 20 }), 600)
    expect(r.fadeIn).toBe(30)
    expect(r.volumeDb).toBe(6)
  })
})
