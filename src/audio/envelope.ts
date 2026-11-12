/**
 * 큐 볼륨 곡선(페이드 인 → 유지 → 페이드 아웃) 계산.
 * 곡선은 직선 구간들로만 이루어져 있으므로, 꺾이는 지점마다
 * linearRampToValueAtTime을 예약하면 오디오 스레드가 정확히 따라 그린다. (타이머 없음)
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

/** 파일 위치 x(초)에서의 볼륨 */
export function envelopeAt(r: CueRange, x: number): number {
  let k = 1
  if (r.fadeIn > 0) k = Math.min(k, (x - r.inPoint) / r.fadeIn)
  if (r.fadeOut > 0) k = Math.min(k, (r.outPoint - x) / r.fadeOut)
  return r.gain * Math.max(0, Math.min(1, k))
}

/** from 이후(초과) 곡선이 꺾이는 지점들. 마지막은 항상 outPoint */
function breakpoints(r: CueRange, from: number): number[] {
  const xs = [r.outPoint]
  if (r.fadeIn > 0) xs.push(r.inPoint + r.fadeIn)
  if (r.fadeOut > 0) xs.push(r.outPoint - r.fadeOut)
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
