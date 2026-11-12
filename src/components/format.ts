/** 초 → "3:05" */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '-'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 바이트 → "12.3 MB" */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 초 → "1:23.456" (분:초.밀리초) */
export function formatTimeMs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const totalMs = Math.round(sec * 1000)
  const m = Math.floor(totalMs / 60000)
  const s = Math.floor((totalMs % 60000) / 1000)
  const msPart = totalMs % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(msPart).padStart(3, '0')}`
}

/**
 * "분:초.밀리초" 또는 "초" 글자를 초로. 읽을 수 없으면 null.
 * 예: "1:23.456" → 83.456, "83.5" → 83.5, "1:05" → 65
 */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d*\.?\d*$/.test(p) || p === '' || p === '.')) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p)
  return Number.isFinite(sec) ? sec : null
}
