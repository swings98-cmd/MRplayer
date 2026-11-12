/**
 * 디코딩 캐시 계획: 어떤 음원을 메모리에 둘지 크기 예산 안에서 정한다. (순수 함수: 단위 테스트 대상)
 *
 * 디코딩된 오디오는 원본 형식과 상관없이 32비트 실수라서 크다.
 * 5분 스테레오 48kHz = 300 × 48,000 × 2 × 4 ≈ 115MB
 */

/** 아이패드/아이폰: 디코딩 오디오 합계 예산 (아이패드 에어 4, 램 4GB 기준. 5분 곡 3개 ≈ 345MB) */
export const TOUCH_BUDGET_BYTES = 400 * 1024 * 1024
/** 데스크톱 예산 */
export const DESKTOP_BUDGET_BYTES = 1500 * 1024 * 1024

export function defaultBudget(): number {
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1
  return touch ? TOUCH_BUDGET_BYTES : DESKTOP_BUDGET_BYTES
}

/** 디코딩하면 차지할 메모리(바이트) 어림. 채널 수를 모르면 스테레오로 본다 */
export function decodedBytes(durationSec: number, sampleRate: number, channels = 2): number {
  return Math.ceil(Math.max(0, durationSec) * sampleRate) * channels * 4
}

export interface CacheCandidate {
  audioId: string
  bytes: number
}

/**
 * 우선순위 순서대로 예산 안에 드는 음원을 고른다.
 * @param candidates 우선순위 순서 (재생 중 → 대기 큐 → 그다음 큐 → 편집 대상). 같은 음원이 여러 번 나오면 처음 것만 센다
 * @param budget 예산(바이트)
 * @param reserved 이미 다른 곳(페이드 중인 소리 등)이 쓰고 있는 크기
 * @param minKeep 앞에서부터 이 개수는 예산을 넘어도 둔다 (재생 중, 대기 큐는 꼭 필요)
 * @returns 메모리에 둘 audioId (우선순위 순서)
 */
export function planCache(candidates: CacheCandidate[], budget: number, reserved = 0, minKeep = 2): string[] {
  const seen = new Set<string>()
  const keep: string[] = []
  let used = reserved
  let index = 0
  for (const c of candidates) {
    if (!c.audioId || seen.has(c.audioId)) continue
    seen.add(c.audioId)
    if (index < minKeep || used + c.bytes <= budget) {
      keep.push(c.audioId)
      used += c.bytes
    }
    index++
  }
  return keep
}
