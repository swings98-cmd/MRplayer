/**
 * 큐 볼륨 곡선(페이드 인 → 유지 → 페이드 아웃) 계산.
 *
 * 페이드는 귀에 고르게 들리도록 dB가 일정하게 변하는 곡선(fadeShape)을 쓴다.
 * (진폭을 직선으로 줄이면 중간까지 -6dB밖에 안 줄어 "끝에서 툭" 줄어드는 것처럼 들리고,
 *  페이드 길이를 바꿔도 비슷하게 들린다)
 * 오디오 예약은 곡선을 짧은 직선 조각으로 나눠 linearRampToValueAtTime으로 한다. (타이머 없음)
 * 재생, 정지 페이드, 음원 추출, 파형 그림이 모두 이 파일의 계산을 쓴다.
 */
import type { CueSettings } from './types.ts'
import { dbToGain } from './volume.ts'

export interface CueRange {
  inPoint: number
  outPoint: number
  fadeIn: number
  fadeOut: number
  /** 선형 볼륨 */
  gain: number
}

const EPS = 1e-6

/** 페이드 곡선이 다루는 범위(dB). 이만큼 아래에서 0dB까지를 일정한 빠르기로 오르내린다 */
export const FADE_RANGE_DB = 48
const FLOOR = 10 ** (-FADE_RANGE_DB / 20)

/**
 * 페이드 진행도 k(0=무음, 1=원래 크기) → 볼륨 배율.
 * dB가 일정하게 변하는 곡선이라 귀에 고르게 들린다. 절반 지점은 -24dB. 양 끝은 정확히 0과 1.
 */
export function fadeShape(k: number): number {
  if (!(k > 0)) return 0
  if (k >= 1) return 1
  return (10 ** ((-(1 - k) * FADE_RANGE_DB) / 20) - FLOOR) / (1 - FLOOR)
}

/** 곡선을 직선 조각으로 나눌 때 조각 하나의 길이(초)와 개수 범위 */
const CURVE_STEP = 0.05
const CURVE_MIN_SEGMENTS = 8
const CURVE_MAX_SEGMENTS = 120

/** a~b 구간을 곡선 예약용으로 나눈 지점들 (a, b 포함) */
export function curvePoints(a: number, b: number): number[] {
  const n = Math.min(CURVE_MAX_SEGMENTS, Math.max(CURVE_MIN_SEGMENTS, Math.ceil((b - a) / CURVE_STEP)))
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n)
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * 큐 설정을 파일 길이에 맞게 정리해 볼륨 곡선 범위로 바꾼다.
 * 재생 엔진과 음원 추출이 이 함수를 함께 쓴다 (들리는 소리 = 추출한 파일).
 * @param ignoreFadeIn 마커 재생처럼 큐 페이드 인을 쓰지 않을 때
 */
export function cueRange(cue: CueSettings, duration: number, ignoreFadeIn = false): CueRange {
  const inPoint = clamp(Number.isFinite(cue.inPoint) ? cue.inPoint : 0, 0, duration)
  const rawOut = cue.outPoint === null || !Number.isFinite(cue.outPoint) ? duration : cue.outPoint
  const outPoint = clamp(rawOut, inPoint, duration)
  const len = outPoint - inPoint
  return {
    inPoint,
    outPoint,
    fadeIn: ignoreFadeIn ? 0 : clamp(cue.fadeIn || 0, 0, len),
    fadeOut: clamp(cue.fadeOut || 0, 0, len),
    gain: dbToGain(cue.volumeDb),
  }
}

/** 파일 위치 x(초)에서의 페이드 진행도 (0~1, 페이드가 겹치면 작은 쪽) */
export function fadeProgress(r: CueRange, x: number): number {
  let k = 1
  if (r.fadeIn > 0) k = Math.min(k, (x - r.inPoint) / r.fadeIn)
  if (r.fadeOut > 0) k = Math.min(k, (r.outPoint - x) / r.fadeOut)
  return Math.max(0, Math.min(1, k))
}

/** 파일 위치 x(초)에서의 볼륨 */
export function envelopeAt(r: CueRange, x: number): number {
  return r.gain * fadeShape(fadeProgress(r, x))
}

/** from 이후(초과) 예약할 지점들: 페이드 구간은 곡선을 따라 잘게, 마지막은 항상 outPoint */
function breakpoints(r: CueRange, from: number): number[] {
  const xs = [r.outPoint]
  if (r.fadeIn > 0) xs.push(...curvePoints(r.inPoint, r.inPoint + r.fadeIn))
  if (r.fadeOut > 0) xs.push(...curvePoints(r.outPoint - r.fadeOut, r.outPoint))
  if (r.fadeIn > 0 && r.fadeOut > 0 && r.fadeIn + r.fadeOut > r.outPoint - r.inPoint) {
    // 페이드 인과 페이드 아웃이 겹칠 때 두 직선이 만나는 지점
    xs.push((r.outPoint * r.fadeIn + r.inPoint * r.fadeOut) / (r.fadeIn + r.fadeOut))
  }
  const sorted = xs.filter((x) => x > from + EPS && x <= r.outPoint + EPS).sort((a, b) => a - b)
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1] > EPS)
}

/** 재생 중 볼륨 곡선을 바꿀 때 이전 값에서 새 곡선으로 이어지는 시간(초). 딸깍 소리 방지 */
export const GLIDE_SECONDS = 0.02

/**
 * param에 볼륨 곡선을 예약한다.
 * @param from 재생을 시작하는 파일 위치(초)
 * @param when from 위치가 소리 나는 AudioContext 시각
 * @param glideFrom 주면 이 값에서 시작해 GLIDE_SECONDS 동안 새 곡선으로 이어진다 (재생 중 설정 변경)
 */
export function scheduleEnvelope(param: AudioParam, r: CueRange, from: number, when: number, glideFrom?: number): void {
  param.cancelScheduledValues(0)
  if (glideFrom === undefined) {
    param.setValueAtTime(envelopeAt(r, from), when)
    for (const x of breakpoints(r, from)) param.linearRampToValueAtTime(envelopeAt(r, x), when + (x - from))
    return
  }
  // 이전 값에서 시작해 짧게 이어 붙인 뒤 새 곡선을 따른다
  const joinX = Math.min(r.outPoint, from + GLIDE_SECONDS)
  param.setValueAtTime(glideFrom, when)
  param.linearRampToValueAtTime(envelopeAt(r, joinX), when + (joinX - from))
  for (const x of breakpoints(r, joinX)) param.linearRampToValueAtTime(envelopeAt(r, x), when + (x - from))
}
