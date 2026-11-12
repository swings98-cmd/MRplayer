/** 공연 전 점검 결과 창 */
import { useEffect, useRef, useState } from 'react'
import { useEngineState } from '../components/useEngine.ts'
import { runPreflight, type CheckItem, type CheckStatus } from '../store/preflight.ts'

const ICON: Record<CheckStatus, string> = { ok: '✓', warn: '⚠', fail: '✗', manual: '☐' }

export function PreflightDialog({ onClose }: { onClose: () => void }) {
  const playing = useEngineState() !== 'stopped'
  const [progress, setProgress] = useState<{ label: string; ratio: number } | null>(null)
  const [items, setItems] = useState<CheckItem[] | null>(null)
  const started = useRef(false)

  const start = () => {
    if (started.current) return
    started.current = true
    setItems(null)
    setProgress({ label: '시작', ratio: 0 })
    void runPreflight((label, ratio) => setProgress({ label, ratio }))
      .then(setItems, (err: unknown) =>
        setItems([{ label: '점검', status: 'fail', detail: `점검을 끝내지 못했습니다: ${err instanceof Error ? err.message : String(err)}` }]),
      )
      .finally(() => {
        setProgress(null)
        started.current = false
      })
  }

  // 창을 열면 바로 시작 (재생 중이면 기다린다)
  useEffect(() => {
    if (!playing && !items && !progress) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fails = items?.filter((i) => i.status === 'fail').length ?? 0
  const warns = items?.filter((i) => i.status === 'warn').length ?? 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="공연 전 점검">
      <div className="modal">
        <div className="modal-head">
          <h2>공연 전 점검</h2>
          {!progress && (
            <button className="btn small-btn" onClick={onClose}>
              닫기
            </button>
          )}
        </div>

        {playing && !progress && !items && (
          <p className="warn-text">재생 중에는 점검할 수 없습니다 (음원을 하나씩 열어 보기 때문). 정지한 뒤 다시 시도하세요.</p>
        )}

        {progress && (
          <div>
            <p className="muted">{progress.label}</p>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
          </div>
        )}

        {items && (
          <>
            <p className={`preflight-summary ${fails ? 'fail' : warns ? 'warn' : 'ok'}`}>
              {fails ? `✗ 고쳐야 할 것 ${fails}개` : warns ? `⚠ 확인할 것 ${warns}개` : '✓ 공연 준비 완료'}
              {fails === 0 && warns > 0 && ' (공연은 가능)'}
            </p>
            <ul className="preflight-list">
              {items.map((it, i) => (
                <li key={i} className={`check-${it.status}`}>
                  <span className="check-icon">{ICON[it.status]}</span>
                  <div>
                    <b>{it.label}</b>
                    <p>{it.detail}</p>
                    {it.list && (
                      <ul>
                        {it.list.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn" disabled={playing} onClick={start}>
                다시 점검
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
