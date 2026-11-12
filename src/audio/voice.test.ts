import { describe, expect, it } from 'vitest'
import { FakeContext, fakeBuffer } from '../test/fakeAudio.ts'
import { cueRange, fadeShape } from './envelope.ts'
import type { CueSettings } from './types.ts'
import { DECLICK, Voice } from './voice.ts'

const cue = (p: Partial<CueSettings> = {}): CueSettings => ({
  audioId: 'a',
  inPoint: 0,
  outPoint: null,
  fadeIn: 0,
  fadeOut: 0,
  volumeDb: 0,
  ...p,
})

function setup(c: CueSettings, offset?: number, startFade?: number, now = 10) {
  const ctx = new FakeContext()
  ctx.currentTime = now
  const buffer = fakeBuffer(60)
  const range = cueRange(c, buffer.duration)
  const voice = new Voice(
    ctx as unknown as BaseAudioContext,
    ctx.destination as unknown as AudioNode,
    buffer as unknown as AudioBuffer,
    'a',
    range,
    offset ?? range.inPoint,
    startFade,
  )
  const [source] = ctx.sources
  const [, ctl] = ctx.gains // env, ctl 순서로 만든다
  return { ctx, voice, source, ctl }
}

describe('Voice: 시작 예약', () => {
  it('지금 시각에 offset부터, 아웃 포인트까지의 길이로 시작', () => {
    const { source } = setup(cue({ inPoint: 5, outPoint: 25 }))
    expect(source.startArgs).toEqual([10, 5, 20])
  })
  it('중간(마커)에서 시작하면 남은 길이만큼', () => {
    const { source } = setup(cue({ inPoint: 5, outPoint: 25 }), 18)
    expect(source.startArgs).toEqual([10, 18, 7])
  })
  it('시작 디클릭: 0에서 10ms 동안 올라온다', () => {
    const { ctl } = setup(cue())
    expect(ctl.gain.valueAt(10)).toBe(0)
    expect(ctl.gain.valueAt(10 + DECLICK / 2)).toBeCloseTo(0.5)
    expect(ctl.gain.valueAt(10 + DECLICK)).toBe(1)
  })
  it('프리롤 시작 페이드(0.5초)', () => {
    const { ctl } = setup(cue(), 0, 0.5)
    expect(ctl.gain.valueAt(10)).toBe(0)
    expect(ctl.gain.valueAt(10.25)).toBeCloseTo(fadeShape(0.5), 6) // 귀에 고른 곡선
    expect(ctl.gain.valueAt(10.5)).toBeCloseTo(1, 9)
  })
})

describe('Voice: 재생 위치', () => {
  it('오디오 시계를 따라가고 아웃 포인트에서 멈춘다', () => {
    const { voice } = setup(cue({ inPoint: 5, outPoint: 25 }))
    expect(voice.position(10)).toBe(5)
    expect(voice.position(13.5)).toBeCloseTo(8.5)
    expect(voice.position(40)).toBe(25)
  })
  it('시작 전 시각이면 시작 위치', () => {
    const { voice } = setup(cue({ inPoint: 5 }))
    expect(voice.position(9)).toBe(5)
  })
})

describe('Voice: 정지 예약', () => {
  it('release: 지금 값에서 0까지 줄인 뒤 source 정지', () => {
    const { ctx, voice, source, ctl } = setup(cue())
    ctx.currentTime = 12
    voice.release(3)
    expect(ctl.gain.valueAt(12)).toBe(1)
    expect(ctl.gain.valueAt(13.5)).toBeCloseTo(fadeShape(0.5), 6) // 절반 지점 -24dB
    expect(ctl.gain.valueAt(15)).toBe(0)
    expect(source.stops.at(-1)).toBeCloseTo(15.005)
    expect(voice.isReleasing).toBe(true)
  })
  it('페이드 아웃 중 정지: 더 짧은 쪽으로 바뀌고, 그 순간 값에서 이어진다', () => {
    const { ctx, voice, ctl } = setup(cue())
    ctx.currentTime = 12
    voice.release(4) // 16초에 0
    ctx.currentTime = 13 // 1/4 지났으므로 곡선 값 fadeShape(0.75)
    voice.release(DECLICK)
    expect(ctl.gain.valueAt(13)).toBeCloseTo(fadeShape(0.75), 6)
    expect(ctl.gain.valueAt(13 + DECLICK)).toBe(0)
  })
  it('더 긴 release는 무시한다 (정지 후 페이드 아웃을 눌러도 길어지지 않음)', () => {
    const { ctx, voice, ctl } = setup(cue())
    ctx.currentTime = 12
    voice.release(DECLICK)
    voice.release(5)
    expect(ctl.gain.valueAt(12 + DECLICK)).toBe(0)
  })
  it('시작 디클릭 도중 정지해도 값이 튀지 않는다', () => {
    const { ctx, voice, ctl } = setup(cue())
    ctx.currentTime = 10 + DECLICK / 2 // 0.5까지 올라온 순간
    voice.release(DECLICK)
    expect(ctl.gain.valueAt(10 + DECLICK / 2)).toBeCloseTo(0.5)
  })
  it('kill: 즉시 0, 연결 해제, 끝 알림', () => {
    const { ctx, voice, ctl, source } = setup(cue())
    let ended = false
    voice.onEnded = () => (ended = true)
    ctx.currentTime = 11
    voice.kill()
    expect(ctl.gain.valueAt(11)).toBe(0)
    expect(source.connected).toEqual([])
    expect(ended).toBe(true)
    expect(voice.isEnded).toBe(true)
  })
})

describe('Voice: 재생 중 설정 변경', () => {
  it('reschedule: 지금 볼륨에서 새 볼륨으로 이어진다 (재생은 그대로)', () => {
    const { ctx, voice, source } = setup(cue({ volumeDb: -20 }))
    const env = ctx.gains[0]
    ctx.currentTime = 15
    voice.reschedule(cueRange(cue({ volumeDb: 0 }), 60))
    expect(env.gain.valueAt(15)).toBeCloseTo(0.1)
    expect(env.gain.valueAt(15.02)).toBeCloseTo(1)
    expect(source.stops).toEqual([]) // 끊지 않았다
  })
})
