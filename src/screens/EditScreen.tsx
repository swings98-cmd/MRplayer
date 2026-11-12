import { useState } from 'react'
import { FileDropZone } from '../components/FileDropZone.tsx'
import { formatBytes } from '../components/format.ts'
import { RelinkButton } from '../components/RelinkButton.tsx'
import { useEngineState } from '../components/useEngine.ts'
import { usePlayerStore } from '../store/playerStore.ts'
import { useProjectStore, type ImportResult } from '../store/projectStore.ts'
import { useStorageStore } from '../store/storageStore.ts'
import { CueEditor } from './CueEditor.tsx'
import { ProjectPanel } from './ProjectPanel.tsx'

/** 편집 탭: 플레이 화면에서 고른 큐를 편집한다. 아래에는 프로젝트 관리와 음원 불러오기. */
export function EditScreen() {
  const { ready, error, cues, audio, importing, importFiles } = useProjectStore()
  const { selectedCueId, select } = usePlayerStore()
  const refreshEstimate = useStorageStore((s) => s.refreshEstimate)
  const [result, setResult] = useState<ImportResult | null>(null)
  const playing = useEngineState() !== 'stopped'

  if (error) return <p className="error-text">{error}</p>
  if (!ready) return <p className="muted">불러오는 중…</p>

  const cue = cues.find((c) => c.id === selectedCueId)
  const meta = cue ? audio[cue.audioId] : undefined

  const runImport = async (files: File[]) => {
    setResult(null)
    setResult(await importFiles(files))
    void refreshEstimate()
  }

  return (
    <FileDropZone onFiles={runImport} disabled={!!importing || playing}>
      <div className="page page-wide">
        <div className="editor-head">
          <select
            className="select grow"
            value={cue?.id ?? ''}
            onChange={(e) => select(e.target.value)}
            aria-label="편집할 큐"
            disabled={cues.length === 0}
          >
            {!cue && <option value="">큐를 고르세요</option>}
            {cues.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.name}
              </option>
            ))}
          </select>
        </div>

        {cues.length === 0 ? (
          <p className="muted">아직 큐가 없습니다. 아래에서 음원을 불러오세요.</p>
        ) : !cue ? (
          <p className="muted">플레이 화면에서 큐를 탭하거나 위에서 고르세요.</p>
        ) : !meta ? (
          <section className="card missing-card">
            <h2>음원 없음 · {cue.name}</h2>
            <p>
              설정만 가져온 큐라서 이 기기에 맞는 음원이 없습니다.
              {cue.missingAudio && (
                <>
                  {' '}
                  원래 음원: <b>{cue.missingAudio.fileName}</b> ({cue.missingAudio.duration.toFixed(1)}초,{' '}
                  {formatBytes(cue.missingAudio.size)})
                </>
              )}
            </p>
            <p className="muted small">같은 음원 파일을 지정하면 이 파일이 없던 다른 큐들도 함께 연결됩니다.</p>
            <RelinkButton cueId={cue.id} />
          </section>
        ) : (
          <CueEditor key={cue.id} cue={cue} meta={meta} />
        )}

        <details className="card project-details" open={cues.length === 0}>
          <summary>프로젝트 · 음원 불러오기</summary>
          <ProjectPanel result={result} setResult={setResult} onImport={(f) => void runImport(f)} />
        </details>
      </div>
    </FileDropZone>
  )
}
