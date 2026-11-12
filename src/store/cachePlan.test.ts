import { describe, expect, it } from 'vitest'
import { decodedBytes, planCache, TOUCH_BUDGET_BYTES } from './cachePlan.ts'

const MB = 1024 * 1024
const FIVE_MIN = decodedBytes(300, 48000, 2)

describe('decodedBytes', () => {
  it('5분 스테레오 48kHz ≈ 115MB', () => {
    expect(FIVE_MIN).toBe(300 * 48000 * 2 * 4)
    expect(FIVE_MIN / 1e6).toBeCloseTo(115.2, 1)
  })
})

describe('planCache: 아이패드 예산 400MB', () => {
  const c = (id: string, bytes = FIVE_MIN) => ({ audioId: id, bytes })

  it('5분 곡: 재생 중 + 대기 + 그다음 = 3개까지, 편집 대상은 빠진다', () => {
    expect(planCache([c('play'), c('standby'), c('next'), c('selected')], TOUCH_BUDGET_BYTES)).toEqual([
      'play',
      'standby',
      'next',
    ])
  })
  it('페이드 중인 이전 곡이 메모리를 쓰고 있으면 그만큼 덜 올린다', () => {
    expect(planCache([c('play'), c('standby'), c('next')], TOUCH_BUDGET_BYTES, FIVE_MIN)).toEqual(['play', 'standby'])
  })
  it('재생 중과 대기 큐는 예산을 넘어도 둔다', () => {
    expect(planCache([c('play', 300 * MB), c('standby', 300 * MB), c('next', 10 * MB)], TOUCH_BUDGET_BYTES)).toEqual([
      'play',
      'standby',
    ])
  })
  it('짧은 곡은 여러 개 올린다', () => {
    const short = decodedBytes(60, 48000, 2)
    expect(planCache([c('a', short), c('b', short), c('c', short), c('d', short)], TOUCH_BUDGET_BYTES)).toHaveLength(4)
  })
  it('같은 음원(복제한 큐)은 한 번만 센다', () => {
    expect(planCache([c('a'), c('a'), c('b'), c('c')], TOUCH_BUDGET_BYTES)).toEqual(['a', 'b', 'c'])
  })
})
