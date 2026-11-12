import type { MarkerColor } from '../store/types.ts'
import { MARKER_COLOR_KEYS, MARKER_COLORS } from './markerColors.ts'

interface Props {
  value: MarkerColor | undefined
  onChange: (c: MarkerColor) => void
}

/** 마커 색 고르기 (몇 가지 중에서) */
export function ColorPicker({ value, onChange }: Props) {
  const current = value ?? 'orange'
  return (
    <div className="color-picker" role="radiogroup" aria-label="마커 색">
      {MARKER_COLOR_KEYS.map((k) => (
        <button
          key={k}
          role="radio"
          aria-checked={current === k}
          aria-label={MARKER_COLORS[k].label}
          className={`swatch${current === k ? ' selected' : ''}`}
          style={{ background: MARKER_COLORS[k].hex }}
          onClick={() => onChange(k)}
        />
      ))}
    </div>
  )
}
