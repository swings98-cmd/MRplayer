/** 이 값 이하의 dB는 무음(0)으로 취급한다 */
export const SILENCE_DB = -96

/** dB → 선형 배율. 0dB = 1, -6dB ≈ 0.5 */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= SILENCE_DB) return 0
  return Math.pow(10, db / 20)
}

/** 선형 배율 → dB */
export function gainToDb(gain: number): number {
  if (!(gain > 0)) return -Infinity
  return 20 * Math.log10(gain)
}
