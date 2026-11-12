/**
 * 큐 볼륨 곡선(페이드 인 → 유지 → 페이드 아웃) 계산.
 * 곡선은 직선 구간들로만 이루어져 있으므로, 꺾이는 지점마다
 * linearRampToValueAtTime을 예약하면 오디오 스레드가 정확히 따라 그린다. (타이머 없음)
 */

export interface CueRange {
  inPoint: number
  outPoint: number
  fadeIn: number
  fadeOut: number
  /** 선형 볼륨 */
  gain: number
}

const EPS = 1e-6

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
  if (r.fadeIn > 0 && r.fadeOut > 0) {
    // 페이드 인과 페이드 아웃이 겹칠 때 두 직선이 만나는 지점
    xs.push((r.outPoint * r.fadeIn + r.inPoint * r.fadeOut) / (r.fadeIn + r.fadeOut))
  }
  const sorted = xs.filter((x) => x > from + EPS && x <= r.outPoint + EPS).sort((a, b) => a - b)
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1] > EPS)
}

/**
 * param에 볼륨 곡선을 예약한다.
 * @param from 재생을 시작하는 파일 위치(초)
 * @param when from 위치가 소리 나는 AudioContext 시각
 */
export function scheduleEnvelope(param: AudioParam, r: CueRange, from: number, when: number): void {
  param.cancelScheduledValues(0)
  param.setValueAtTime(envelopeAt(r, from), when)
  for (const x of breakpoints(r, from)) {
    param.linearRampToValueAtTime(envelopeAt(r, x), when + (x - from))
  }
}
