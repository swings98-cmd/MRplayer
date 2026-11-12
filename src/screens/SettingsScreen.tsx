import { useEffect } from 'react'
import type { OutputMode } from '../audio/index.ts'
import { formatBytes } from '../components/format.ts'
import { useEngineSnapshot } from '../components/useEngine.ts'
import { PREROLL_CHOICES, useSettingsStore, type GoMode } from '../store/settingsStore.ts'
import { useStorageStore, type PersistStatus } from '../store/storageStore.ts'

const PERSIST_TEXT: Record<PersistStatus, string> = {
  unknown: '확인 중…',
  granted: '허용됨 — 브라우저가 저장된 음원과 설정을 임의로 지우지 않습니다',
  denied: '허용 안 됨 — 저장 공간이 부족하면 브라우저가 데이터를 지울 수 있습니다',
  unsupported: '이 브라우저는 지원하지 않습니다',
}

const GO_MODES: { id: GoMode; label: string; desc: string }[] = [
  { id: 'cut', label: '즉시 끊고 재생', desc: '재생 중인 큐를 바로 멈추고 다음 큐를 재생' },
  { id: 'fade', label: '페이드 아웃하며 재생', desc: '재생 중인 큐를 페이드 아웃 시간 동안 줄이면서 다음 큐를 재생' },
]

const FADE_CHOICES = [1, 2, 3, 5, 8, 10]

const OUTPUT_MODES: { id: OutputMode; label: string }[] = [
  { id: 'auto', label: '자동 (권장)' },
  { id: 'stream', label: 'B 경로 (MediaStream → <audio>)' },
  { id: 'direct', label: '직접 출력 (destination)' },
]

export function SettingsScreen() {
  const { persist, usage, quota, requestPersist, refreshEstimate } = useStorageStore()
  const { goMode, fadeOutSeconds, outputMode, prerollSeconds, update } = useSettingsStore()
  const outputKind = useEngineSnapshot().outputKind

  useEffect(() => {
    void refreshEstimate()
  }, [refreshEstimate])

  const percent = usage !== null && quota ? ((usage / quota) * 100).toFixed(1) : null

  return (
    <div className="page">
      <section className="card">
        <h2>재생</h2>
        <p className="setting-label">GO를 눌렀을 때 재생 중인 큐가 있으면</p>
        <div className="choice-list">
          {GO_MODES.map((m) => (
            <button
              key={m.id}
              className={`choice${goMode === m.id ? ' selected' : ''}`}
              aria-pressed={goMode === m.id}
              onClick={() => update({ goMode: m.id })}
            >
              <b>{m.label}</b>
              <span className="muted small">{m.desc}</span>
            </button>
          ))}
        </div>

        <p className="setting-label">페이드 아웃 시간</p>
        <div className="row">
          {FADE_CHOICES.map((s) => (
            <button
              key={s}
              className={`btn chip${fadeOutSeconds === s ? ' selected' : ''}`}
              aria-pressed={fadeOutSeconds === s}
              onClick={() => update({ fadeOutSeconds: s })}
            >
              {s}초
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>마커</h2>
        <p className="setting-label">프리롤: 마커를 재생할 때 몇 초 앞에서 시작할지</p>
        <div className="row">
          {PREROLL_CHOICES.map((s) => (
            <button
              key={s}
              className={`btn chip${prerollSeconds === s ? ' selected' : ''}`}
              aria-pressed={prerollSeconds === s}
              onClick={() => update({ prerollSeconds: s })}
            >
              {s === 0 ? '끔 (0초)' : `${s}초`}
            </button>
          ))}
        </div>
        <p className="muted small">
          프리롤을 켜면 마커보다 그만큼 앞에서 짧은 페이드 인으로 시작합니다. 인 포인트보다 앞으로는 가지 않습니다.
        </p>
      </section>

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
        <p className="muted small">아이패드/아이폰은 홈 화면에 추가한 앱에서 영구 저장이 허용되는 경우가 많습니다.</p>
      </section>

      <details className="card advanced">
        <summary>고급: 출력 경로</summary>
        <p className="muted small">
          문제가 생겼을 때 비교하는 용도입니다. 평소에는 자동으로 두세요. 지금 쓰는 경로:{' '}
          <b>{outputKind === 'stream' ? 'B 경로' : outputKind === 'direct' ? '직접 출력' : '아직 없음 (화면을 한 번 탭하세요)'}</b>
        </p>
        <div className="choice-list">
          {OUTPUT_MODES.map((m) => (
            <button
              key={m.id}
              className={`choice${outputMode === m.id ? ' selected' : ''}`}
              aria-pressed={outputMode === m.id}
              onClick={() => update({ outputMode: m.id })}
            >
              <b>{m.label}</b>
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
