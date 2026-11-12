import { describe, expect, it } from 'vitest'
import { FakeParam } from '../test/fakeAudio.ts'
import { cueRange, envelopeAt, GLIDE_SECONDS, scheduleEnvelope } from './envelope.ts'
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

describe('envelopeAt: 위치별 볼륨', () => {
  const r = cueRange(cue({ inPoint: 10, outPoint: 30, fadeIn: 4, fadeOut: 5, volumeDb: 0 }), 60)
  it('페이드 인 / 유지 / 페이드 아웃', () => {
    expect(envelopeAt(r, 10)).toBe(0)
    expect(envelopeAt(r, 12)).toBeCloseTo(0.5)
    expect(envelopeAt(r, 20)).toBe(1)
    expect(envelopeAt(r, 27.5)).toBeCloseTo(0.5)
    expect(envelopeAt(r, 30)).toBe(0)
  })
  it('트림 밖은 0', () => {
    expect(envelopeAt(r, 5)).toBe(0)
    expect(envelopeAt(r, 40)).toBe(0)
  })
})

describe('scheduleEnvelope: 페이드 예약 시각', () => {
  it('처음부터 재생: 꺾이는 지점마다 실제 시각에 예약', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ inPoint: 10, outPoint: 30, fadeIn: 4, fadeOut: 5 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 10, 100)
    expect(p.events).toEqual([
      { type: 'set', value: 0, time: 100 },
      { type: 'ramp', value: 1, time: 104 }, // 페이드 인 끝
      { type: 'ramp', value: 1, time: 115 }, // 페이드 아웃 시작 (25초)
      { type: 'ramp', value: 0, time: 120 }, // 아웃 포인트
    ])
  })

  it('페이드 인 중간에서 시작하면 그 지점 볼륨에서 이어간다', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ inPoint: 0, outPoint: 20, fadeIn: 4 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 1, 50)
    expect(p.valueAt(50)).toBeCloseTo(0.25)
    expect(p.valueAt(51)).toBeCloseTo(0.5)
    expect(p.valueAt(53)).toBeCloseTo(1)
  })

  it('페이드 인과 아웃이 겹치면 만나는 지점까지 올라갔다 내려온다', () => {
    const p = new FakeParam()
    const r = cueRange(cue({ inPoint: 0, outPoint: 4, fadeIn: 3, fadeOut: 3 }), 60)
    scheduleEnvelope(p as unknown as AudioParam, r, 0, 0)
    // 두 직선이 x=2에서 만난다 (높이 2/3)
    for (const t of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) expect(p.valueAt(t)).toBeCloseTo(envelopeAt(r, t), 6)
    expect(p.valueAt(2)).toBeCloseTo(2 / 3)
  })

  it('어느 지점에서 시작해도 예약값 = 계산값', () => {
    const r = cueRange(cue({ inPoint: 2, outPoint: 40, fadeIn: 6, fadeOut: 9, volumeDb: -3 }), 60)
    for (const from of [2, 3.3, 8, 20, 31, 35, 39.9]) {
      const p = new FakeParam()
      scheduleEnvelope(p as unknown as AudioParam, r, from, 1000)
      for (let x = from; x <= 40; x += 0.25) expect(p.valueAt(1000 + x - from)).toBeCloseTo(envelopeAt(r, x), 6)
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
