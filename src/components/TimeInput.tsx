import { useRef, useState } from 'react'
import { formatTimeMs, parseTime } from './format.ts'

interface Props {
  label: string
  /** 초 */
  value: number
  /** Enter를 누르거나 칸을 벗어날 때 한 번 호출. 읽을 수 없는 값이면 원래 값으로 되돌린다. */
  onCommit: (seconds: number) => void
}

/** "분:초.밀리초"로 시간을 직접 입력하는 칸 */
export function TimeInput({ label, value, onCommit }: Props) {
  /** 입력 중인 글자. 입력 중이 아닐 때(null)는 바깥 값(핸들 끌기, 실행 취소 등)을 그대로 보여준다 */
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? formatTimeMs(value)
  /** Esc로 취소했으면 칸을 벗어날 때 저장하지 않는다 */
  const cancelled = useRef(false)

  const commit = () => {
    const v = draft === null || cancelled.current ? null : parseTime(draft)
    cancelled.current = false
    setDraft(null)
    if (v !== null) onCommit(v)
  }

  return (
    <label className="time-input">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder="0:00.000"
        onFocus={(e) => {
          setDraft(formatTimeMs(value))
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelled.current = true
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
