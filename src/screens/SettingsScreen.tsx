import { useEffect, useState } from 'react'
import type { OutputMode } from '../audio/index.ts'
import { formatBytes } from '../components/format.ts'
import { useEngineSnapshot } from '../components/useEngine.ts'
import { PREROLL_CHOICES, useSettingsStore, type GoMode } from '../store/settingsStore.ts'
import { buildInfo, checkOffline, useAppUpdate, type OfflineStatus } from '../store/appUpdate.ts'
import { useStorageStore, type PersistStatus } from '../store/storageStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import { useWakeLock } from '../store/wakeLock.ts'
import { PreflightDialog } from './PreflightDialog.tsx'

const OFFLINE_TEXT: Record<OfflineStatus, string> = {
  checking: '확인 중…',
  ready: '오프라인 준비 완료 — 인터넷 없이도 열립니다',
  'not-ready': '아직 준비되지 않음 — 인터넷에 연결된 상태로 앱을 한 번 더 열어 주세요',
  unsupported: '이 브라우저는 오프라인 실행을 지원하지 않습니다',
  dev: '개발 모드에서는 꺼져 있습니다 (배포된 앱에서 확인)',
}

function formatBuildTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

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
  const { goMode, fadeOutSeconds, outputMode, prerollSeconds, keepScreenOn, update } = useSettingsStore()
  const wake = useWakeLock()
  const { offline, cachedFiles, needRefresh } = useAppUpdate()
  const build = buildInfo()
  const [preflight, setPreflight] = useState(false)
  const project = useProjectStore((s) => s.projects.find((p) => p.id === s.currentProjectId))
  const when = (t: number | undefined) => (t ? new Date(t).toLocaleString('ko-KR') : '없음')
  const outputKind = useEngineSnapshot().outputKind

  useEffect(() => {
    void refreshEstimate()
    void checkOffline()
  }, [refreshEstimate])

  const percent = usage !== null && quota ? ((usage / quota) * 100).toFixed(1) : null

  return (
    <div className="page">
      <section className="card preflight-card">
        <h2>공연 전 점검</h2>
        <p className="muted small">
          현재 프로젝트의 모든 큐가 열리는지, 음원이 빠진 큐가 없는지, 오프라인 준비와 저장 공간 보호가 됐는지 한 번에
          확인합니다.
        </p>
        <button className="btn btn-primary wide" onClick={() => setPreflight(true)}>
          공연 전 점검
        </button>
      </section>
      {preflight && <PreflightDialog onClose={() => setPreflight(false)} />}

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

      <section className="card">
        <h2>화면</h2>
        <p className="setting-label">재생 중 화면 꺼짐 방지</p>
        <div className="row">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              className={`btn chip${keepScreenOn === v ? ' selected' : ''}`}
              aria-pressed={keepScreenOn === v}
              disabled={!wake.supported}
              onClick={() => update({ keepScreenOn: v })}
            >
              {v ? '켬' : '끔'}
            </button>
          ))}
        </div>
        <p className={`small ${wake.supported ? 'muted' : 'warn-text'}`}>
          {!wake.supported
            ? '이 기기에서는 지원하지 않음 — 화면 자동 잠금 시간을 길게 바꾸거나 "안 함"으로 두세요.'
            : wake.active
              ? '지금 켜져 있음 — 재생이 끝나면 자동으로 풀립니다.'
              : wake.error
                ? `켜지 못함: ${wake.error}`
                : '재생/일시정지 중에는 화면이 꺼지지 않게 합니다. 앱이 다시 보이면 자동으로 다시 겁니다.'}
        </p>
      </section>

      <section className="card">
        <h2>앱 정보</h2>
        <dl className="info-list">
          <dt>버전</dt>
          <dd>
            {formatBuildTime(build.time)} 빌드{build.commit && ` (${build.commit})`}
            {needRefresh && <span className="warn-text"> · 새 버전 있음</span>}
          </dd>
          <dt>마지막 백업</dt>
          <dd>
            {project ? (
              <>
                <span className={project.lastBackupAt ? '' : 'warn-text'}>
                  "{project.name}" 전체 내보내기: {when(project.lastBackupAt)}
                </span>
                <br />
                <span className="muted small">설정만 내보내기: {when(project.lastSettingsExportAt)}</span>
                {!project.lastBackupAt && (
                  <span className="muted small">
                    <br />
                    편집 탭 아래 "프로젝트 · 음원 불러오기" → 전체 내보내기로 백업하세요.
                  </span>
                )}
              </>
            ) : (
              '-'
            )}
          </dd>
          <dt>오프라인</dt>
          <dd className={offline === 'ready' ? 'ok-text' : offline === 'not-ready' ? 'warn-text' : ''}>
            {OFFLINE_TEXT[offline]}
            {offline === 'ready' && cachedFiles > 0 && ` (파일 ${cachedFiles}개)`}
          </dd>
          <dt>오픈소스</dt>
          <dd className="small">
            MP3 인코더: @breezystack/lamejs (LAME 기반, LGPL-3.0) — 소스: github.com/shijinyu/lamejs · 앱 안의
            별도 파일(mp3Worker)로 들어 있습니다.
          </dd>
        </dl>
      </section>

      <section className="card help">
        <h2>도움말</h2>
        <ul>
          <li>
            <b>공연 중 실수로 앱이 바뀌는 것을 막으려면</b> 아이패드 설정 &gt; 손쉬운 사용 &gt; 사용법 유도를 켜세요. 앱을 연
            뒤 홈 버튼(또는 측면 버튼)을 세 번 누르면 시작됩니다.
          </li>
          <li>
            플레이 화면의 <b>공연 모드</b>를 켜면 큐 삭제, 순서 변경, 이름 변경, 편집 탭 이동이 잠기고 재생 조작과 마커
            재생만 됩니다.
          </li>
          <li>
            전화, 알람, 다른 앱 소리 때문에 소리가 끊기면 화면 맨 위에 <b>"탭해서 오디오 다시 연결"</b> 배너가 뜹니다.
            탭하면 다시 연결됩니다.
          </li>
          <li>잠금 화면과 제어 센터에서 재생 중인 큐 이름을 보고 일시정지/재생할 수 있습니다.</li>
          <li>새 버전은 자동으로 바뀌지 않습니다. 정지 상태에서 뜨는 "새 버전이 있습니다" 알림의 업데이트를 눌러야 적용됩니다.</li>
        </ul>
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
