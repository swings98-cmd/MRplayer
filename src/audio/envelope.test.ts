import { describe, expect, it } from 'vitest'
import { FakeParam } from '../test/fakeAudio.ts'
import { cueRange, envelopeAt, FADE_RANGE_DB, fadeShape, GLIDE_SECONDS, scheduleEnvelope } from './envelope.ts'
import type { CueSettings } from './types.ts'

const cue = (p: Partial<CueSettings> = {}): CueSettings => ({
  audioId: 'a',
  inPoint: 0,
  outPoint: null,
  fadeIn: 0,
  fadeOut: 0,
  volumeDb: 0,
  ...p,
})

describe('cueRange: 트림 경계', () => {
  it('아웃 포인트가 없으면 파일 끝까지', () => {
    expect(cueRange(cue(), 120)).toMatchObject({ inPoint: 0, outPoint: 120 })
  })
  it('파일 범위를 벗어난 인/아웃은 파일 안으로 맞춘다', () => {
    expect(cueRange(cue({ inPoint: -5, outPoint: 500 }), 120)).toMatchObject({ inPoint: 0, outPoint: 120 })
    expect(cueRange(cue({ inPoint: 200 }), 120)).toMatchObject({ inPoint: 120, outPoint: 120 })
  })
  it('아웃이 인보다 앞이면 인과 같게 (길이 0)', () => {
    expect(cueRange(cue({ inPoint: 30, outPoint: 10 }), 120)).toMatchObject({ inPoint: 30, outPoint: 30 })
  })
  it('숫자가 아닌 값은 기본값으로', () => {
    expect(cueRange(cue({ inPoint: Number.NaN, outPoint: Number.POSITIVE_INFINITY }), 60)).toMatchObject({
      inPoint: 0,
      outPoint: 60,
    })
  })
  it('페이드는 트림 길이를 넘지 않는다', () => {
    const r = cueRange(cue({ inPoint: 10, outPoint: 14, fadeIn: 30, fadeOut: 30 }), 120)
    expect(r.fadeIn).toBe(4)
    expect(r.fadeOut).toBe(4)
  })
  it('마커 재생은 페이드 인을 쓰지 않는다', () => {
    expect(cueRange(cue({ fadeIn: 3 }), 60, true).fadeIn).toBe(0)
  })
  it('볼륨 dB를 선형으로', () => {
    expect(cueRange(cue({ volumeDb: -6 }), 60).gain).toBeCloseTo(0.501, 3)
    expect(cueRange(cue({ volumeDb: -200 }), 60).gain).toBe(0)
  })
})

const db = (g: number) => 20 * Math.log10(g)
/** dB 값이 기대값 ±1dB 안인지 */
const nearDb = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1)

describe('fadeShape: 귀에 고르게 들리는 페이드 곡선', () => {
  it('양 끝은 정확히 무음과 원래 크기', () => {
    expect(fadeShape(0)).toBe(0)
    expect(fadeShape(1)).toBe(1)
    expect(fadeShape(-1)).toBe(0)
    expect(fadeShape(2)).toBe(1)
  })
  it('dB가 고르게 변한다: 절반 지점 약 -24dB, 3/4 지점 약 -12dB', () => {
    nearDb(db(fadeShape(0.5)), -FADE_RANGE_DB / 2)
    nearDb(db(fadeShape(0.75)), -FADE_RANGE_DB / 4)
  })
  it('계속 커지기만 한다', () => {
    for (let k = 0; k < 1; k += 0.01) expect(fadeShape(k + 0.01)).toBeGreaterThan(fadeShape(k))
  })
  it('페이드 길이에 따라 들리는 크기가 달라진다 (페이드 아웃 시작 1초 뒤)', () => {
    const oneSecondIn = (fadeOut: number) =>
      db(envelopeAt(cueRange(cue({ inPoint: 0, outPoint: 20, fadeOut }), 60), 20 - fadeOut + 1))
    // 2초 페이드는 이미 -24dB, 8초 페이드는 아직 -6dB (직선 페이드였다면 -6dB와 -1.2dB로 둘 다 크게 들린다)
    nearDb(oneSecondIn(2), -24)
    nearDb(oneSecondIn(8), -6)
  })
})

describe('envelopeAt: 위치별 볼륨', () => {
  const r = cueRange(cue({ inPoint: 10, outPoint: 30, fadeIn: 4, fadeOut: 5, volumeDb: 0 }), 60)
  it('페이드 인 / 유지 / 페이드 아웃', () => {
    expect(envelopeAt(r, 10)).toBe(0)
    expect(envelopeAt(r, 12)).toBeCloseTo(fadeShape(0.5))
    expect(envelopeAt(r, 20)).toBe(1)
    expect(envelopeAt(r, 27.5)).toBeCloseTo(fadeShape(0.5))
    expect(envelopeAt(r, 30)).toBe(0)
  })
  it('트림 밖은 0', () => {
    expect(envelopeAt(r, 5)).toBe(0)
    expect(envelopeAt(r, 40)).toBe(0)
  })
})

describe('scheduleEnvelope: 페이드 예약 시각', () => {
  it('처음부터 재생: 페이드 경계가 실제 시각에 예약된다', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ inPoint: 10, outPoint: 30, fadeIn: 4, fadeOut: 5 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 10, 100)
    const times = p.events.map((e) => e.time)
    for (const t of [100, 104, 115, 120]) expect(times).toContainEqual(expect.closeTo(t, 9))
    expect(Math.min(...times)).toBe(100)
    expect(Math.max(...times)).toBe(120)
    expect(p.valueAt(100)).toBe(0) // 시작: 무음
    expect(p.valueAt(102)).toBeCloseTo(fadeShape(0.5), 6) // 페이드 인 절반
    expect(p.valueAt(104)).toBeCloseTo(1, 9) // 페이드 인 끝
    expect(p.valueAt(115)).toBeCloseTo(1, 9) // 페이드 아웃 시작 (25초)
    expect(p.valueAt(120)).toBe(0) // 아웃 포인트
  })

  it('페이드 인 중간에서 시작하면 그 지점 볼륨에서 이어간다', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ inPoint: 0, outPoint: 20, fadeIn: 4 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 1, 50)
    expect(p.valueAt(50)).toBeCloseTo(fadeShape(0.25), 6)
    expect(p.valueAt(51)).toBeCloseTo(fadeShape(0.5), 6)
    expect(p.valueAt(53)).toBeCloseTo(1)
  })

  it('페이드 인과 아웃이 겹치면 만나는 지점까지 올라갔다 내려온다', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ inPoint: 0, outPoint: 4, fadeIn: 3, fadeOut: 3 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 0, 0)
    // 두 페이드가 x=2에서 만난다 (진행도 2/3)
    for (const t of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) expect(p.valueAt(t)).toBeCloseTo(envelopeAt(r, t), 6)
    expect(p.valueAt(2)).toBeCloseTo(fadeShape(2 / 3), 6)
    expect(p.valueAt(1.9)).toBeLessThan(p.valueAt(2))
    expect(p.valueAt(2.1)).toBeLessThan(p.valueAt(2))
  })

  it('어느 지점에서 시작해도 예약값 ≈ 계산값 (곡선을 잘게 나눈 오차 1% 이내)', () => {
    const r = cueRange(cue({ inPoint: 2, outPoint: 40, fadeIn: 6, fadeOut: 9, volumeDb: -3 }), 60)
    for (const from of [2, 3.3, 8, 20, 31, 35, 39.9]) {
      const p = new FakeParam()
      scheduleEnvelope(p as unknown as AudioParam, r, from, 1000)
      for (let x = from; x <= 40; x += 0.13) {
        expect(Math.abs(p.valueAt(1000 + x - from) - envelopeAt(r, x))).toBeLessThan(0.01)
      }
    }
  })

  it('재생 중 변경(glide): 이전 값에서 시작해 20ms 뒤 새 곡선에 붙는다', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ volumeDb: 0 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 10, 5, 0.1)
    expect(p.valueAt(5)).toBeCloseTo(0.1)
    expect(p.valueAt(5 + GLIDE_SECONDS / 2)).toBeCloseTo(0.55)
    expect(p.valueAt(5 + GLIDE_SECONDS)).toBeCloseTo(1)
    expect(p.valueAt(8)).toBeCloseTo(1)
  })
})
