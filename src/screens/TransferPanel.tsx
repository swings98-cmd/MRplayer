/**
 * 프로젝트 내보내기(전체 .mrcue / 설정만 .json)와 가져오기.
 * 재생 안정성을 위해 재생 중에는 시작할 수 없다.
 */
import { useMemo, useRef, useState } from 'react'
import { formatBytes } from '../components/format.ts'
import { useEngineState } from '../components/useEngine.ts'
import { canShareFile, downloadFile, shareFile } from '../store/fileSave.ts'
import { isEngineActive } from '../store/playerStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import {
  applyImport,
  estimateExport,
  exportFull,
  exportSettings,
  ImportError,
  inspectImport,
  type ExportKind,
  type ExportProgress,
  type PreparedImport,
} from '../store/projectTransfer.ts'
import { useStorageStore } from '../store/storageStore.ts'

type Busy = { title: string; progress: ExportProgress | null } | null

export function TransferPanel() {
  const { projects, currentProjectId, cues, audio, markExported, refreshProjects, switchProject } = useProjectStore()
  const refreshEstimate = useStorageStore((s) => s.refreshEstimate)
  const playing = useEngineState() !== 'stopped'
  const project = projects.find((p) => p.id === currentProjectId)
  const [busy, setBusy] = useState<Busy>(null)
  const [ready, setReady] = useState<{ file: File; kind: ExportKind } | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [prepared, setPrepared] = useState<PreparedImport | null>(null)
  const [imported, setImported] = useState<{ id: string; name: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const estimate = useMemo(
    () => (project ? estimateExport({ project, cues, audio }) : null),
    [project, cues, audio],
  )

  const reset = () => {
    setReady(null)
    setMessage(null)
    setPrepared(null)
    setImported(null)
  }

  // ───── 내보내기 ─────
  const runExport = async (kind: ExportKind) => {
    if (!project) return
    reset()
    setBusy({ title: kind === 'full' ? '전체 내보내기' : '설정만 내보내기', progress: null })
    try {
      const src = { project, cues, audio }
      const file = kind === 'full' ? await exportFull(src, (p) => setBusy({ title: '전체 내보내기', progress: p })) : exportSettings(src)
      setBusy(null)
      if (canShareFile(file)) {
        // 공유 시트는 탭 안에서만 열 수 있으므로 버튼을 보여준다
        setReady({ file, kind })
      } else {
        downloadFile(file)
        await markExported(project.id, kind)
        setMessage({ ok: true, text: `${file.name} (${formatBytes(file.size)})을(를) 다운로드했습니다.` })
      }
    } catch (err) {
      setBusy(null)
      setMessage({ ok: false, text: `내보내지 못했습니다: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const onShare = async () => {
    if (!ready || !project) return
    try {
      const saved = await shareFile(ready.file)
      if (saved) {
        await markExported(project.id, ready.kind)
        setMessage({ ok: true, text: `${ready.file.name}을(를) 보냈습니다.` })
        setReady(null)
      }
    } catch {
      // 공유가 안 되면 다운로드로 대신
      downloadFile(ready.file)
      await markExported(project.id, ready.kind)
      setMessage({ ok: true, text: `공유할 수 없어 다운로드했습니다: ${ready.file.name}` })
      setReady(null)
    }
  }

  // ───── 가져오기 ─────
  const onPick = async (file: File) => {
    reset()
    setBusy({ title: '파일 검사', progress: null })
    try {
      setPrepared(await inspectImport(file, (p) => setBusy({ title: '파일 검사', progress: p })))
    } catch (err) {
      setMessage({
        ok: false,
        text: `가져올 수 없습니다: ${err instanceof ImportError ? err.message : err instanceof Error ? err.message : String(err)} (아무것도 바뀌지 않았습니다)`,
      })
    } finally {
      setBusy(null)
    }
  }

  const onImport = async () => {
    if (!prepared) return
    setBusy({ title: '가져오는 중', progress: null })
    try {
      const p = await applyImport(
        prepared,
        projects.map((x) => x.name),
        (pr) => setBusy({ title: '가져오는 중', progress: pr }),
      )
      await refreshProjects()
      void refreshEstimate()
      setPrepared(null)
      setImported({ id: p.id, name: p.name })
    } catch (err) {
      setMessage({ ok: false, text: `가져오지 못했습니다: ${err instanceof Error ? err.message : String(err)} (아무것도 바뀌지 않았습니다)` })
    } finally {
      setBusy(null)
    }
  }

  const openImported = () => {
    if (!imported) return
    if (isEngineActive() && !window.confirm('⚠️ 지금 재생 중입니다. 프로젝트를 바꾸면 재생이 멈춥니다.\n바꿀까요?')) return
    void switchProject(imported.id)
    setImported(null)
  }

  const disabled = !!busy || playing
  const pct = busy?.progress ? Math.round((busy.progress.done / Math.max(1, busy.progress.total)) * 100) : null

  return (
    <section className="card">
      <h2>내보내기 · 가져오기</h2>

      {estimate && project && (
        <dl className="info-list">
          <dt>전체 (.mrcue)</dt>
          <dd>
            약 {formatBytes(estimate.full)} · 큐 {cues.length}개, 음원 {estimate.audioCount}개 포함
            {estimate.missing > 0 && <span className="warn-text"> · 음원 없는 큐 {estimate.missing}개는 설정만 담김</span>}
          </dd>
          <dt>설정만 (.json)</dt>
          <dd>약 {formatBytes(estimate.settings)} · 음원 없이 큐 설정과 마커만</dd>
        </dl>
      )}

      <div className="row">
        <button className="btn btn-primary" disabled={disabled || !project} onClick={() => void runExport('full')}>
          전체 내보내기 (.mrcue)
        </button>
        <button className="btn" disabled={disabled || !project} onClick={() => void runExport('settings')}>
          설정만 내보내기 (.json)
        </button>
        <button className="btn" disabled={disabled} onClick={() => input.current?.click()}>
          가져오기
        </button>
        {/* iPad 파일 앱에서 .mrcue가 흐리게 보이지 않도록 형식 제한을 두지 않고, 고른 뒤 검사한다 */}
        <input
          ref={input}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onPick(f)
          }}
        />
      </div>
      {playing && <p className="warn-text small">재생 중에는 내보내기/가져오기를 할 수 없습니다. 정지한 뒤 다시 시도하세요.</p>}
      <p className="muted small">가져오기는 항상 새 프로젝트로 추가되고, 기존 프로젝트는 바뀌지 않습니다.</p>

      {busy && (
        <div className="transfer-box">
          <p>
            <b>{busy.title}</b> {busy.progress?.label && <span className="muted small">· {busy.progress.label}</span>}
          </p>
          <div className="bar">
            <div className={`bar-fill${pct === null ? ' indeterminate' : ''}`} style={{ width: `${pct ?? 30}%` }} />
          </div>
          {pct !== null && <p className="muted small">{pct}%</p>}
        </div>
      )}

      {ready && (
        <div className="transfer-box">
          <p>
            <b>{ready.file.name}</b> ({formatBytes(ready.file.size)}) 준비됨
          </p>
          <p className="muted small">"공유"를 누른 뒤 "파일에 저장" 또는 AirDrop을 고르세요.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => void onShare()}>
              공유 (파일에 저장 · AirDrop)
            </button>
            <button className="btn" onClick={() => setReady(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {prepared && (
        <div className="transfer-box">
          <p>
            <b>"{prepared.summary.projectName}"</b> ({prepared.kind === 'full' ? '전체' : '설정만'}) — 큐{' '}
            {prepared.summary.cueCount}개, 마커 {prepared.summary.markerCount}개, 음원 {prepared.summary.audioCount}개
          </p>
          <p className="muted small">내보낸 시각: {new Date(prepared.summary.exportedAt).toLocaleString('ko-KR')}</p>
          {prepared.kind === 'full' ? (
            <p className="ok-text small">✓ 검사 완료: 손상된 곳이 없습니다.</p>
          ) : (
            <>
              <p className="small">
                기기에 있는 같은 음원(파일 이름·길이 일치)과 연결: <b>큐 {prepared.summary.linked}개</b>
              </p>
              {prepared.summary.missing.length > 0 && (
                <p className="warn-text small">
                  음원 없음 {prepared.summary.missing.length}개: {prepared.summary.missing.join(', ')} — 가져온 뒤 큐에서 파일을 다시
                  지정할 수 있습니다.
                </p>
              )}
            </>
          )}
          <div className="row">
            <button className="btn btn-primary" onClick={() => void onImport()} disabled={!!busy}>
              새 프로젝트로 가져오기
            </button>
            <button className="btn" onClick={() => setPrepared(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {imported && (
        <div className="transfer-box">
          <p className="ok-text">✓ "{imported.name}" 프로젝트를 추가했습니다.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={openImported}>
              이 프로젝트 열기
            </button>
            <button className="btn" onClick={() => setImported(null)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {message && <p className={message.ok ? 'ok-text' : 'error-text'}>{message.text}</p>}
    </section>
  )
}
