import { useEffect } from 'react'
import { formatBytes } from '../components/format.ts'
import { useStorageStore, type PersistStatus } from '../store/storageStore.ts'

const PERSIST_TEXT: Record<PersistStatus, string> = {
  unknown: '확인 중…',
  granted: '허용됨 — 브라우저가 저장된 음원과 설정을 임의로 지우지 않습니다',
  denied: '허용 안 됨 — 저장 공간이 부족하면 브라우저가 데이터를 지울 수 있습니다',
  unsupported: '이 브라우저는 지원하지 않습니다',
}

export function SettingsScreen() {
  const { persist, usage, quota, requestPersist, refreshEstimate } = useStorageStore()

  useEffect(() => {
    void refreshEstimate()
  }, [refreshEstimate])

  const percent = usage !== null && quota ? ((usage / quota) * 100).toFixed(1) : null

  return (
    <div className="page">
      <section className="card">
        <h2>저장 공간</h2>
        <dl className="info-list">
          <dt>영구 저장</dt>
          <dd className={persist === 'granted' ? 'ok-text' : persist === 'denied' ? 'warn-text' : ''}>
            {PERSIST_TEXT[persist]}
          </dd>
          <dt>사용 중</dt>
          <dd>
            {formatBytes(usage)}
            {quota !== null && ` / 최대 ${formatBytes(quota)}`}
            {percent !== null && ` (${percent}%)`}
          </dd>
        </dl>
        <div className="row">
          {persist === 'denied' && (
            <button className="btn" onClick={() => void requestPersist()}>
              영구 저장 다시 요청
            </button>
          )}
          <button className="btn" onClick={() => void refreshEstimate()}>
            사용량 새로고침
          </button>
        </div>
        <p className="muted small">
          아이패드/아이폰은 홈 화면에 추가한 앱에서 영구 저장이 허용되는 경우가 많습니다.
        </p>
      </section>
    </div>
  )
}
