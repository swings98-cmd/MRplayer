/**
 * 단위 테스트용 가짜 Web Audio. 예약 호출을 기록하고, 아무 시각의 값을 계산해 준다.
 * (브라우저 없이 엔진의 시간 계산을 검사하기 위함)
 */

type Event =
  | { type: 'set'; value: number; time: number }
  | { type: 'ramp'; value: number; time: number }

export class FakeParam {
  value = 1
  events: Event[] = []

  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'set', value, time })
    return this
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'ramp', value, time })
    return this
  }

  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time)
    return this
  }

  setTargetAtTime(): this {
    return this
  }

  /** 예약대로라면 t 시각의 값 */
  valueAt(t: number): number {
    const evs = [...this.events].sort((a, b) => a.time - b.time)
    let prev: Event | null = null
    for (const e of evs) {
      if (t < e.time) {
        if (e.type === 'ramp' && prev) {
          return prev.value + ((e.value - prev.value) * (t - prev.time)) / (e.time - prev.time)
        }
        return prev ? prev.value : this.value
      }
      prev = e
    }
    return prev ? prev.value : this.value
  }
}

export class FakeNode {
  connected: unknown[] = []
  connect(dest: unknown) {
    this.connected.push(dest)
    return dest
  }
  disconnect() {
    this.connected = []
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam()
}

export class FakeSource extends FakeNode {
  buffer: unknown = null
  onended: (() => void) | null = null
  startArgs: number[] | null = null
  stops: (number | undefined)[] = []
  start(...args: number[]) {
    this.startArgs = args
  }
  stop(t?: number) {
    this.stops.push(t)
  }
}

export class FakeContext {
  currentTime = 0
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  destination = new FakeNode()
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
}

/** AudioBuffer 대신 쓰는 최소 객체 */
export function fakeBuffer(duration: number, sampleRate = 48000, channels = 2) {
  return { duration, sampleRate, numberOfChannels: channels, length: Math.round(duration * sampleRate) }
}
