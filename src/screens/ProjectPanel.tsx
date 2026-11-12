import { useRef } from 'react'
import { TransferPanel } from './TransferPanel.tsx'
import { isEngineActive } from '../store/playerStore.ts'
import { AUDIO_ACCEPT, useProjectStore, type ImportResult } from '../store/projectStore.ts'
import { useStorageStore } from '../store/storageStore.ts'

/** 재생 중이면 경고를 덧붙인다 */
const playingWarning = (extra: string) => (isEngineActive() ? `⚠️ 지금 재생 중입니다. ${extra}\n\n` : '')

/** 마우스가 있는 기기(데스크톱)에서만 드래그 안내를 보여준다 */
const canDrag = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

interface Props {
  result: ImportResult | null
  setResult: (r: ImportResult | null) => void
  onImport: (files: File[]) => void
}

/** 프로젝트 관리와 음원 불러오기 (편집 탭 아래쪽) */
export function ProjectPanel({ result, setResult, onImport }: Props) {
  const { projects, currentProjectId, importing, createProject, renameProject, deleteProject, switchProject } =
    useProjectStore()
  const refreshEstimate = useStorageStore((s) => s.refreshEstimate)
  const fileInput = useRef<HTMLInputElement>(null)

  const project = projects.find((p) => p.id === currentProjectId)
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name, 'ko'))

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

  return (
    <>
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
              if (files.length > 0) onImport(files)
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

        <TransferPanel />
    </>
  )
}
