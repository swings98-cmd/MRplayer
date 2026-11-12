import { useRef, useState } from 'react'

interface Props {
  /** 막대 시작/끝 (초, 파일 기준) */
  start: number
  end: number
  position: number
  disabled?: boolean
  /** 손을 뗄 때 한 번 호출 */
  onSeek: (position: number) => void
}

/** 탭하거나 끌어서 위치를 옮기는 진행 막대. 끄는 동안에는 미리보기만 하고, 손을 떼면 이동한다. */
export function ProgressBar({ start, end, position, disabled, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const span = Math.max(0.001, end - start)

  const toPosition = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return start + ratio * span
  }

  const shown = preview ?? position
  const ratio = Math.min(1, Math.max(0, (shown - start) / span))

  return (
    <div
      ref={ref}
      className={`progress${disabled ? ' disabled' : ''}${preview !== null ? ' dragging' : ''}`}
      role="slider"
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={Math.round(span)}
      aria-valuenow={Math.round(shown - start)}
      onPointerDown={(e) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setPreview(toPosition(e.clientX))
      }}
      onPointerMove={(e) => {
        if (preview !== null) setPreview(toPosition(e.clientX))
      }}
      onPointerUp={(e) => {
        if (preview === null) return
        const pos = toPosition(e.clientX)
        setPreview(null)
        onSeek(pos)
      }}
      onPointerCancel={() => setPreview(null)}
    >
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="progress-thumb" style={{ left: `${ratio * 100}%` }} />
    </div>
  )
}
