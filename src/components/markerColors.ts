import type { MarkerColor } from '../store/types.ts'

export const MARKER_COLORS: Record<MarkerColor, { hex: string; label: string }> = {
  orange: { hex: '#ff8a3d', label: '주황' },
  yellow: { hex: '#ffd23d', label: '노랑' },
  green: { hex: '#3ccf7a', label: '초록' },
  blue: { hex: '#5aa9ff', label: '파랑' },
  purple: { hex: '#b48cff', label: '보라' },
  pink: { hex: '#ff6fae', label: '분홍' },
}

export const MARKER_COLOR_KEYS = Object.keys(MARKER_COLORS) as MarkerColor[]

export function markerHex(color: MarkerColor | undefined): string {
  return MARKER_COLORS[color ?? 'orange'].hex
}
