/**
 * 큐 편집 값의 규칙: 트림 범위, 페이드 최대 길이, 볼륨 범위.
 * 편집 화면은 값을 바꾸기 전에 항상 normalizeEdit을 거친다.
 */
import type { Cue } from './types.ts'

export const MAX_FADE = 30
/** 트림 구간 최소 길이(초) */
export const MIN_TRIM = 0.1
export const MIN_VOLUME_DB = -40
export const MAX_VOLUME_DB = 6

/** 편집 화면에서 바꾸는 값 (실행 취소 단위) */
export type EditValues = Pick<Cue, 'inPoint' | 'outPoint' | 'fadeIn' | 'fadeOut' | 'volumeDb'>

export const ORIGINAL_VALUES: EditValues = { inPoint: 0, outPoint: null, fadeIn: 0, fadeOut: 0, volumeDb: 0 }

export function pickEditValues(c: EditValues): EditValues {
  return { inPoint: c.inPoint, outPoint: c.outPoint, fadeIn: c.fadeIn, fadeOut: c.fadeOut, volumeDb: c.volumeDb }
}

export function sameEditValues(a: EditValues, b: EditValues): boolean {
  return (
    a.inPoint === b.inPoint &&
    a.outPoint === b.outPoint &&
    a.fadeIn === b.fadeIn &&
    a.fadeOut === b.fadeOut &&
    a.volumeDb === b.volumeDb
  )
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
/** 1ms 단위로 반올림 */
const ms = (x: number) => Math.round(x * 1000) / 1000

/**
 * 규칙에 맞게 값을 고친다.
 * @param changed 방금 바꾼 페이드. 페이드 합이 트림 길이를 넘으면 바꾼 쪽을 줄인다.
 *                (트림을 줄여서 넘친 경우에는 두 페이드를 같은 비율로 줄인다)
 */
export function normalizeEdit(v: EditValues, duration: number, changed?: 'fadeIn' | 'fadeOut'): EditValues {
  const inPoint = ms(clamp(v.inPoint, 0, Math.max(0, duration - MIN_TRIM)))
  let out = v.outPoint === null ? duration : clamp(v.outPoint, inPoint + MIN_TRIM, duration)
  out = ms(out)
  // 파일 끝과 같으면 "끝까지"(null)로 저장
  const outPoint = out >= duration - 0.0005 ? null : out
  const len = (outPoint ?? duration) - inPoint

  let fadeIn = clamp(v.fadeIn || 0, 0, MAX_FADE)
  let fadeOut = clamp(v.fadeOut || 0, 0, MAX_FADE)
  if (fadeIn + fadeOut > len) {
    if (changed === 'fadeIn') fadeIn = Math.max(0, len - fadeOut)
    else if (changed === 'fadeOut') fadeOut = Math.max(0, len - fadeIn)
    else {
      const k = len / (fadeIn + fadeOut)
      fadeIn *= k
      fadeOut *= k
    }
  }
  // 반올림 때문에 합이 길이를 넘지 않게 내림
  fadeIn = Math.floor(fadeIn * 1000) / 1000
  fadeOut = Math.floor(fadeOut * 1000) / 1000

  const volumeDb = Math.round(clamp(v.volumeDb, MIN_VOLUME_DB, MAX_VOLUME_DB) * 10) / 10
  return { inPoint, outPoint, fadeIn, fadeOut, volumeDb }
}
