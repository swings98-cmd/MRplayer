/**
 * 파형 편집기: 저장된 피크로 canvas에 파형을 그린다.
 *
 * 조작
 * - 탭/클릭: 그 위치로 이동 (onSeek)
 * - IN/OUT 핸들 끌기: 트림 조절 (놓을 때 onTrimEnd 한 번)
 * - 한 손가락/마우스로 빈 곳 끌기: 좌우 스크롤
 * - 두 손가락 핀치, Ctrl/Cmd + 휠(트랙패드 핀치 포함): 확대/축소
 * - 트랙패드 좌우 쓸기: 좌우 스크롤
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatTimeMs } from './format.ts'

interface Props {
  peaks: Uint8Array
  peaksPerSecond: number
  duration: number
  inPoint: number
  /** 실제 아웃 포인트(초). "끝까지"면 duration */
  outPoint: number
  fadeIn: number
  fadeOut: number
  /** 재생 위치(초) */
  playhead: number
  /** 재생 중이면 재생 위치를 따라 화면을 넘긴다 */
  following: boolean
  minTrim: number
  onSeek: (t: number) => void
  onTrimEnd: (kind: 'in' | 'out', t: number) => void
}

const HEIGHT = 240
const RULER_H = 26
const MAX_PPS = 400
const TICK_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

const COLORS = {
  bg: '#0b0c10',
  ruler: '#14161c',
  rulerText: '#8a91a1',
  wave: '#7fa7d9',
  outside: 'rgba(0, 0, 0, 0.62)',
  fadeShade: 'rgba(0, 0, 0, 0.45)',
  envelope: '#ffc94d',
  in: '#3ccf7a',
  out: '#ff6b6b',
  playhead: '#ffffff',
}

type Gesture =
  | { type: 'handle'; kind: 'in' | 'out' }
  | { type: 'pending' | 'pan'; x0: number; start0: number }
  | { type: 'pinch'; d0: number; pps0: number; anchorT: number }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

function rulerLabel(t: number, step: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0
  const sText = s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0')
  return `${m}:${sText}`
}

export function Waveform(props: Props) {
  const { peaks, peaksPerSecond, duration, inPoint, outPoint, fadeIn, fadeOut, playhead, following, minTrim } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  /** pps 0 = 전체 보기 */
  const [view, setView] = useState({ start: 0, pps: 0 })
  const [drag, setDrag] = useState<{ kind: 'in' | 'out'; t: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)

  const fitPps = width > 0 && duration > 0 ? width / duration : 1
  const pps = clamp(view.pps || fitPps, fitPps, Math.max(fitPps, MAX_PPS))
  const span = width / pps
  const maxStart = Math.max(0, duration - span)
  const start = clamp(view.start, 0, maxStart)
  const zoomed = pps > fitPps * 1.001

  // 최신 값을 이벤트 처리기에서 쓰기 위한 참조
  const live = useRef({ start, pps, fitPps, span, duration, width })
  useLayoutEffect(() => {
    live.current = { start, pps, fitPps, span, duration, width }
  })

  const toX = (t: number) => (t - start) * pps
  const toT = (x: number) => start + x / pps

  /** anchorX(화면 좌표)의 시간을 고정한 채 확대 배율을 바꾼다 */
  const zoomTo = useCallback((newPps: number, anchorX: number) => {
    const l = live.current
    const p = clamp(newPps, l.fitPps, Math.max(l.fitPps, MAX_PPS))
    const anchorT = l.start + anchorX / l.pps
    setView({ start: anchorT - anchorX / p, pps: p <= l.fitPps * 1.001 ? 0 : p })
  }, [])

  // 폭 측정
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // 휠: Ctrl/Cmd(트랙패드 핀치 포함)이면 확대, 좌우 쓸기면 스크롤
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const l = live.current
      const x = e.clientX - el.getBoundingClientRect().left
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomTo(l.pps * Math.exp(-e.deltaY * 0.01), x)
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        setView((v) => ({ ...v, start: l.start + e.deltaX / l.pps }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  // 재생 중 재생 위치가 화면 밖으로 나가면 따라간다 (사용자가 조작 중이 아닐 때)
  useEffect(() => {
    if (!following || !zoomed || gesture.current) return
    if (playhead > start + span * 0.95 || playhead < start) {
      // 바깥 값(재생 위치)에 맞춰 화면을 한 페이지 넘긴다. 페이지가 넘어간 뒤에는 다시 조건이 거짓이 된다.
      // oxlint-disable-next-line react/set-state-in-effect
      setView((v) => ({ ...v, start: playhead - span * 0.05 }))
    }
  }, [following, zoomed, playhead, start, span])

  // 그리기
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const laneTop = RULER_H
    const laneH = HEIGHT - RULER_H
    const mid = laneTop + laneH / 2
    const shownIn = drag?.kind === 'in' ? drag.t : inPoint
    const shownOut = drag?.kind === 'out' ? drag.t : outPoint

    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, width, HEIGHT)

    // 시간 눈금
    ctx.fillStyle = COLORS.ruler
    ctx.fillRect(0, 0, width, RULER_H)
    const step = TICK_STEPS.find((s) => s * pps >= 70) ?? 600
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = COLORS.rulerText
    ctx.strokeStyle = '#3a404d'
    ctx.beginPath()
    for (let t = Math.ceil(start / step) * step; t <= start + span; t += step) {
      const x = Math.round(toX(t)) + 0.5
      ctx.moveTo(x, RULER_H - 8)
      ctx.lineTo(x, RULER_H)
      ctx.fillText(rulerLabel(t, step), x + 3, 14)
    }
    // 작은 눈금
    const minor = step / 5
    for (let t = Math.ceil(start / minor) * minor; t <= start + span; t += minor) {
      const x = Math.round(toX(t)) + 0.5
      ctx.moveTo(x, RULER_H - 3)
      ctx.lineTo(x, RULER_H)
    }
    ctx.stroke()

    // 파형
    ctx.fillStyle = COLORS.wave
    const amp = laneH / 2 - 4
    for (let x = 0; x < width; x++) {
      const t0 = toT(x)
      const i0 = Math.floor(t0 * peaksPerSecond)
      const i1 = Math.max(i0 + 1, Math.ceil(toT(x + 1) * peaksPerSecond))
      let m = 0
      for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > m) m = peaks[i]
      const h = Math.max(1, (m / 255) * amp)
      ctx.fillRect(x, mid - h, 1, h * 2)
    }

    // 페이드: 볼륨 곡선 위쪽을 어둡게 + 곡선
    const fi = Math.max(0, fadeIn)
    const fo = Math.max(0, fadeOut)
    const envAt = (t: number) => {
      let k = 1
      if (fi > 0) k = Math.min(k, (t - shownIn) / fi)
      if (fo > 0) k = Math.min(k, (shownOut - t) / fo)
      return clamp(k, 0, 1)
    }
    const pts = [shownIn, shownIn + fi, shownOut - fo, shownOut]
    if (fi > 0 && fo > 0) pts.push((shownOut * fi + shownIn * fo) / (fi + fo))
    const xs = pts.filter((t) => t >= shownIn && t <= shownOut).sort((a, b) => a - b)
    const envY = (g: number) => laneTop + 4 + (1 - g) * (laneH - 8)
    ctx.beginPath()
    ctx.moveTo(toX(shownIn), laneTop)
    for (const t of xs) ctx.lineTo(toX(t), envY(envAt(t)))
    ctx.lineTo(toX(shownOut), laneTop)
    ctx.closePath()
    ctx.fillStyle = COLORS.fadeShade
    ctx.fill()
    ctx.beginPath()
    xs.forEach((t, i) => (i === 0 ? ctx.moveTo(toX(t), envY(envAt(t))) : ctx.lineTo(toX(t), envY(envAt(t)))))
    ctx.strokeStyle = COLORS.envelope
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.lineWidth = 1

    // 트림 바깥 어둡게
    ctx.fillStyle = COLORS.outside
    const xIn = toX(shownIn)
    const xOut = toX(shownOut)
    if (xIn > 0) ctx.fillRect(0, laneTop, xIn, laneH)
    if (xOut < width) ctx.fillRect(xOut, laneTop, width - xOut, laneH)

    // IN / OUT 핸들
    const handle = (x: number, color: string, label: string, side: 1 | -1) => {
      if (x < -40 || x > width + 40) return
      ctx.fillStyle = color
      ctx.fillRect(Math.round(x) - 1, laneTop, 3, laneH)
      const tabW = 34
      const tabX = side === 1 ? x : x - tabW
      ctx.fillRect(tabX, laneTop, tabW, 22)
      ctx.fillRect(tabX, HEIGHT - 22, tabW, 22)
      ctx.fillStyle = '#0b0c10'
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillText(label, tabX + 5, laneTop + 15)
    }
    handle(xIn, COLORS.in, 'IN', 1)
    handle(xOut, COLORS.out, 'OUT', -1)

    // 재생 위치
    const xp = toX(playhead)
    if (xp >= -2 && xp <= width + 2) {
      ctx.fillStyle = COLORS.playhead
      ctx.fillRect(Math.round(xp) - 1, 0, 2, HEIGHT)
      ctx.beginPath()
      ctx.moveTo(xp - 6, 0)
      ctx.lineTo(xp + 6, 0)
      ctx.lineTo(xp, 8)
      ctx.closePath()
      ctx.fill()
    }

    // 끄는 중인 핸들 시간
    if (drag) {
      const x = toX(drag.t)
      const text = formatTimeMs(drag.t)
      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif'
      const w = ctx.measureText(text).width + 12
      const bx = clamp(x - w / 2, 2, width - w - 2)
      ctx.fillStyle = drag.kind === 'in' ? COLORS.in : COLORS.out
      ctx.fillRect(bx, laneTop + 28, w, 22)
      ctx.fillStyle = '#0b0c10'
      ctx.fillText(text, bx + 6, laneTop + 44)
    }
  })

  // ───────── 포인터 조작 ─────────

  const localX = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: localX(e), y: e.clientY })

    if (pointers.current.size === 2) {
      // 두 손가락: 핀치 (끌던 핸들은 취소)
      const [a, b] = [...pointers.current.values()]
      const midX = (a.x + b.x) / 2
      gesture.current = { type: 'pinch', d0: Math.max(10, Math.abs(a.x - b.x)), pps0: pps, anchorT: toT(midX) }
      setDrag(null)
      return
    }
    if (pointers.current.size > 2) return

    const x = localX(e)
    const hit = e.pointerType === 'mouse' ? 10 : 28
    const dIn = Math.abs(x - toX(inPoint))
    const dOut = Math.abs(x - toX(outPoint))
    if (Math.min(dIn, dOut) <= hit) {
      const kind = dIn <= dOut ? 'in' : 'out'
      gesture.current = { type: 'handle', kind }
      setDrag({ kind, t: kind === 'in' ? inPoint : outPoint })
    } else {
      gesture.current = { type: 'pending', x0: x, start0: start }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: localX(e), y: e.clientY })
    const g = gesture.current
    if (!g) return
    const x = localX(e)

    if (g.type === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const [a, b] = pts
      const d = Math.max(10, Math.abs(a.x - b.x))
      const midX = (a.x + b.x) / 2
      const l = live.current
      const p = clamp((g.pps0 * d) / g.d0, l.fitPps, Math.max(l.fitPps, MAX_PPS))
      setView({ start: g.anchorT - midX / p, pps: p <= l.fitPps * 1.001 ? 0 : p })
    } else if (g.type === 'handle') {
      const t = toT(x)
      const v = g.kind === 'in' ? clamp(t, 0, outPoint - minTrim) : clamp(t, inPoint + minTrim, duration)
      setDrag({ kind: g.kind, t: v })
    } else if (g.type === 'pending') {
      if (Math.abs(x - g.x0) > 6) gesture.current = { ...g, type: 'pan' }
    } else if (g.type === 'pan') {
      setView((v) => ({ ...v, start: g.start0 - (x - g.x0) / live.current.pps }))
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g?.type === 'pinch') {
      // 손가락이 하나 남아도 다른 조작으로 이어지지 않게
      if (pointers.current.size === 0) gesture.current = null
      return
    }
    gesture.current = null
    if (g?.type === 'handle' && drag) {
      setDrag(null)
      props.onTrimEnd(drag.kind, drag.t)
    } else if (g?.type === 'pending') {
      props.onSeek(clamp(toT(localX(e)), 0, duration))
    }
  }

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    setDrag(null)
  }

  const zoomCenter = (factor: number) => {
    const xp = toX(playhead)
    const anchor = xp >= 0 && xp <= width ? xp : width / 2
    zoomTo(pps * factor, anchor)
  }

  return (
    <div className="waveform">
      <div className="waveform-tools">
        <button className="btn small-btn" onClick={() => zoomCenter(1 / 2)} disabled={!zoomed} aria-label="축소">
          − 축소
        </button>
        <button className="btn small-btn" onClick={() => zoomCenter(2)} disabled={pps >= MAX_PPS} aria-label="확대">
          + 확대
        </button>
        <button className="btn small-btn" onClick={() => setView({ start: 0, pps: 0 })} disabled={!zoomed}>
          전체 보기
        </button>
        <span className="muted small waveform-hint">
          핸들을 끌어 트림 · 탭하면 이동 · 두 손가락/⌘+휠로 확대
        </span>
      </div>
      <div ref={wrapRef} className="waveform-canvas-wrap" style={{ height: HEIGHT }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: HEIGHT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
      {zoomed && (
        <input
          className="waveform-scroll"
          type="range"
          min={0}
          max={maxStart}
          step="any"
          value={start}
          aria-label="파형 좌우 스크롤"
          onChange={(e) => setView((v) => ({ ...v, start: parseFloat(e.target.value) }))}
        />
      )}
    </div>
  )
}
