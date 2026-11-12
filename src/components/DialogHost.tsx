import { useEffect, useRef, useState } from 'react'
import { useDialog, type DialogRequest } from '../store/dialogStore.ts'

/** 앱 안 확인/입력 창을 그린다 (App에 하나만 둔다) */
export function DialogHost() {
  const req = useDialog((s) => s.current)
  // 창마다 새로 그려서 입력값이 처음 값에서 시작하게 한다
  return req ? <Dialog key={req.id} req={req} /> : null
}

function Dialog({ req }: { req: DialogRequest }) {
  const [text, setText] = useState(req.defaultValue ?? '')
  const input = useRef<HTMLInputElement>(null)
  const okButton = useRef<HTMLButtonElement>(null)

  // 창이 뜨면 입력 칸(또는 확인 버튼)에 바로 포커스
  useEffect(() => {
    const t = setTimeout(() => (req.kind === 'prompt' ? input.current?.select() : okButton.current?.focus()), 0)
    return () => clearTimeout(t)
  }, [req.kind])

  const cancel = () => req.resolve(req.kind === 'prompt' ? null : false)
  const ok = () => req.resolve(req.kind === 'prompt' ? text : true)

  return (
    <div
      className="modal-backdrop dialog-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && cancel()}
    >
      <form
        className="modal dialog"
        onSubmit={(e) => {
          e.preventDefault()
          ok()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            cancel()
          }
        }}
      >
        {req.title && <h2>{req.title}</h2>}
        <p className="dialog-message">{req.message}</p>
        {req.kind === 'prompt' && (
          <input ref={input} className="dialog-input" type="text" value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <div className="row dialog-buttons">
          {req.kind !== 'alert' && (
            <button type="button" className="btn" onClick={cancel}>
              {req.cancelLabel ?? '취소'}
            </button>
          )}
          <button ref={okButton} type="submit" className={`btn ${req.danger ? 'btn-danger-solid' : 'btn-primary'}`}>
            {req.confirmLabel ?? '확인'}
          </button>
        </div>
      </form>
    </div>
  )
}
