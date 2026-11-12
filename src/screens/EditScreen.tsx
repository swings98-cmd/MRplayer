import { useRef, useState } from 'react'
import { FileDropZone } from '../components/FileDropZone.tsx'
import { formatDuration } from '../components/format.ts'
import { isEngineActive } from '../store/playerStore.ts'
import { AUDIO_ACCEPT, useProjectStore, type ImportResult } from '../store/projectStore.ts'
import { useStorageStore } from '../store/storageStore.ts'

/** 재생 중이면 경고를 덧붙인다 */
const playingWarning = (extra: string) => (isEngineActive() ? `⚠️ 지금 재생 중입니다. ${extra}\n\n` : '')

/** 마우스가 있는 기기(데스크톱)에서만 드래그 안내를 보여준다 */
const canDrag = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

export function EditScreen() {
  const {
    ready,
    error,
    projects,
    currentProjectId,
    cues,
    audio,
    importing,
    createProject,
    renameProject,
    deleteProject,
    switchProject,
    importFiles,
    updateCue,
    deleteCue,
  } = useProjectStore()
  const refreshEstimate = useStorageStore((s) => s.refreshEstimate)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (error) return <p className="error-text">{error}</p>
  if (!ready) return <p className="muted">불러오는 중…</p>

  const project = projects.find((p) => p.id === currentProjectId)
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  const runImport = async (files: File[]) => {
    setResult(null)
    const r = await importFiles(files)
    setResult(r)
    void refreshEstimate()
  }

  const onNewProject = async () => {
    if (isEngineActive() && !window.confirm('⚠️ 지금 재생 중입니다. 새 프로젝트로 바꾸면 재생이 멈춥니다.\n계속할까요?')) return
    const name = window.prompt('새 프로젝트 이름', '새 프로젝트')
    if (name === null) return
    await createProject(name)
    setResult(null)
  }

  const onRenameProject = async () => {
    if (!project) return
    const name = window.prompt('프로젝트 이름', project.name)
    if (name !== null) await renameProject(project.id, name)
  }

  const onDeleteProject = async () => {
    if (!project) return
    const ok = window.confirm(
      playingWarning('삭제하면 재생이 멈춥니다.') +
        `"${project.name}" 프로젝트와 큐 ${project.cueIds.length}개를 삭제할까요?\n` +
        '다른 프로젝트가 쓰지 않는 음원 파일도 함께 삭제되며, 되돌릴 수 없습니다.',
    )
    if (!ok) return
    await deleteProject(project.id)
    setResult(null)
    void refreshEstimate()
  }

  const onRenameCue = (id: string, current: string) => {
    const name = window.prompt('큐 이름', current)
    if (name !== null && name.trim()) updateCue(id, { name: name.trim() })
  }

  const onDeleteCue = async (id: string, name: string) => {
    const ok = window.confirm(
      playingWarning('') +
        `"${name}" 큐를 삭제할까요?\n다른 큐가 쓰지 않는 음원 파일도 함께 삭제되며, 되돌릴 수 없습니다.`,
    )
    if (!ok) return
    await deleteCue(id)
    void refreshEstimate()
  }

  return (
    <FileDropZone onFiles={runImport} disabled={!!importing}>
      <div className="page">
        <section className="card">
          <h2>프로젝트</h2>
          <div className="row">
            <select
              className="select grow"
              value={currentProjectId ?? ''}
              disabled={!!importing}
              onChange={(e) => {
                const id = e.target.value
                if (isEngineActive() && !window.confirm('⚠️ 지금 재생 중입니다. 프로젝트를 바꾸면 재생이 멈춥니다.\n바꿀까요?')) {
                  e.target.value = currentProjectId ?? ''
                  return
                }
                setResult(null)
                void switchProject(id)
              }}
              aria-label="프로젝트 선택"
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.cueIds.length})
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button className="btn" onClick={onNewProject} disabled={!!importing}>
              새 프로젝트
            </button>
            <button className="btn" onClick={onRenameProject} disabled={!project}>
              이름 바꾸기
            </button>
            <button className="btn btn-danger" onClick={onDeleteProject} disabled={!project || !!importing}>
              삭제
            </button>
          </div>
        </section>

        <section className="card">
          <h2>음원 불러오기</h2>
          <button className="btn btn-primary wide" disabled={!!importing} onClick={() => fileInput.current?.click()}>
            음원 파일 선택 (여러 개 가능)
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = '' // 같은 파일을 다시 고를 수 있게
              if (files.length > 0) void runImport(files)
            }}
          />
          <p className="muted small">
            mp3 · wav · m4a · aac · flac
            {canDrag && ' — 파일을 이 화면에 끌어다 놓아도 됩니다'}
          </p>
          {importing && (
            <p className="status-text">
              불러오는 중 {importing.done + 1}/{importing.total}: {importing.current}
            </p>
          )}
          {result && (
            <div className="status-text">
              <p>{result.imported}개 불러옴{result.failed.length > 0 && `, ${result.failed.length}개 실패`}</p>
              {result.failed.length > 0 && (
                <ul className="error-list">
                  {result.failed.map((f, i) => (
                    <li key={i}>
                      {f.fileName} — {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2>큐 목록 ({cues.length})</h2>
          {cues.length === 0 ? (
            <p className="muted">아직 큐가 없습니다. 음원을 불러오면 파일마다 큐가 하나씩 만들어집니다.</p>
          ) : (
            <ol className="cue-list">
              {cues.map((c, i) => {
                const meta = audio[c.audioId]
                return (
                  <li key={c.id} className="cue-row">
                    <span className="cue-no">{i + 1}</span>
                    <button className="cue-name" onClick={() => onRenameCue(c.id, c.name)} title="탭해서 이름 바꾸기">
                      <span className="cue-title">{c.name}</span>
                      <span className="muted small">
                        {meta ? `${formatDuration(meta.duration)} · ${meta.fileName}` : '음원 정보 없음'}
                      </span>
                    </button>
                    <button className="btn btn-danger small-btn" onClick={() => onDeleteCue(c.id, c.name)}>
                      삭제
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </FileDropZone>
  )
}
