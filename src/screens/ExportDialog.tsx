/**
 * 음원 추출 창: 큐 고르기(여러 개), 형식, 파일 이름, 예상 크기, 클리핑 경고, 진행률, 저장.
 * 재생 중에는 시작할 수 없고, 추출 중 재생이 시작되면 남은 추출을 멈춘다 (재생 안정성 우선).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { audioEngine } from '../audio/index.ts'
import { formatBytes, formatDuration } from '../components/format.ts'
import { useEngineState } from '../components/useEngine.ts'
import {
  estimateBytes,
  estimateCuePeak,
  exportCue,
  FORMATS,
  probeOriginal,
  safeFileName,
  trimmedSeconds,
  type ClipPolicy,
  type ExportFormat,
  type ExportStage,
} from '../store/exporter.ts'
import { downloadFile, shareFile, usesShareSheet } from '../store/fileSave.ts'
import { useProjectStore } from '../store/projectStore.ts'

interface Props {
  initialCueId: string
  onClose: () => void
}

interface Result {
  name: string
  ok: boolean
  message: string
}

const STAGE_TEXT: Record<ExportStage, string> = {
  reading: '원본 읽는 중',
  rendering: '설정 적용(렌더링) 중',
  encoding: '파일로 만드는 중',
}

const share = usesShareSheet()

export function ExportDialog({ initialCueId, onClose }: Props) {
  const { cues, audio } = useProjectStore()
  const engineState = useEngineState()
  const [selected, setSelected] = useState<string[]>([initialCueId])
  const [format, setFormat] = useState<ExportFormat>('wav')
  const [singleName, setSingleName] = useState(cues.find((c) => c.id === initialCueId)?.name ?? '')
  const [probes, setProbes] = useState<Record<string, { sampleRate: number; channels: number }>>({})
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [progress, setProgress] = useState<{ index: number; total: number; name: string; stage: ExportStage; ratio?: number } | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [pendingSave, setPendingSave] = useState<{ file: File; resolve: (saved: boolean) => void } | null>(null)
  const [askClip, setAskClip] = useState<{ name: string; overDb: number; resolve: (p: ClipPolicy) => void } | null>(null)
  const cancelled = useRef(false)

  // 큐 목록 순서대로
  const items = useMemo(() => cues.filter((c) => selected.includes(c.id)), [cues, selected])
  const single = items.length === 1

  // 원본 샘플레이트·채널 어림 (예상 크기용)
  useEffect(() => {
    let alive = true
    for (const c of items) {
      if (probes[c.audioId]) continue
      void probeOriginal(c.audioId).then((p) => alive && setProbes((prev) => ({ ...prev, [c.audioId]: p })))
    }
    return () => {
      alive = false
    }
  }, [items, probes])

  const rows = useMemo(
    () =>
      items.map((c) => {
        const meta = audio[c.audioId]
        const seconds = meta ? trimmedSeconds(c, meta) : 0
        const probe = probes[c.audioId]
        const bytes = probe ? estimateBytes(seconds, format, probe.sampleRate, probe.channels) : null
        const peak = meta ? estimateCuePeak(c, meta) : 0
        return { cue: c, seconds, bytes, overDb: peak > 1 ? 20 * Math.log10(peak) : 0 }
      }),
    [items, audio, probes, format],
  )
  const totalBytes = rows.every((r) => r.bytes !== null) ? rows.reduce((s, r) => s + (r.bytes ?? 0), 0) : null
  const clipping = rows.filter((r) => r.overDb > 0)
  const playing = engineState !== 'stopped'

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const run = async (policy: ClipPolicy | null) => {
    cancelled.current = false
    setPhase('running')
    const done: Result[] = []
    for (const [i, cue] of items.entries()) {
      if (cancelled.current) {
        done.push({ name: cue.name, ok: false, message: '취소함' })
        continue
      }
      // 재생 안정성 우선: 재생이 시작되면 남은 추출을 멈춘다
      if (audioEngine.getSnapshot().state !== 'stopped') {
        done.push({ name: cue.name, ok: false, message: '재생이 시작되어 추출하지 않음' })
        cancelled.current = true
        continue
      }
      const name = single ? singleName || cue.name : cue.name
      try {
        const res = await exportCue(
          cue,
          name,
          format,
          policy,
          (overDb) => new Promise((resolve) => setAskClip({ name: cue.name, overDb, resolve })),
          (stage, ratio) => setProgress({ index: i, total: items.length, name: cue.name, stage, ratio }),
        )
        setAskClip(null)
        let saved = true
        if (share) saved = await new Promise<boolean>((resolve) => setPendingSave({ file: res.file, resolve }))
        else downloadFile(res.file)
        setPendingSave(null)
        const info = [
          formatBytes(res.file.size),
          `${(res.sampleRate / 1000).toFixed(1)}kHz ${res.channels === 1 ? '모노' : res.channels === 2 ? '스테레오' : `${res.channels}채널`}`,
          res.loweredDb < 0 ? `깨지지 않게 ${res.loweredDb.toFixed(1)}dB 낮춤` : res.peak > 1 ? '클리핑 그대로' : '',
        ]
          .filter(Boolean)
          .join(' · ')
        done.push({ name: res.file.name, ok: saved, message: saved ? info : '저장하지 않고 건너뜀' })
      } catch (err) {
        setAskClip(null)
        setPendingSave(null)
        done.push({ name: cue.name, ok: false, message: err instanceof Error ? err.message : String(err) })
      }
      setResults([...done])
    }
    setResults(done)
    setProgress(null)
    setPhase('done')
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="음원 추출">
      <div className="modal">
        <div className="modal-head">
          <h2>음원 추출</h2>
          {phase !== 'running' && (
            <button className="btn small-btn" onClick={onClose}>
              닫기
            </button>
          )}
        </div>

        {phase === 'setup' && (
          <>
            <p className="muted small">
              트림, 페이드, 큐 볼륨이 적용된 소리를 새 파일로 만듭니다. 마스터 볼륨은 적용하지 않습니다. 원본과 큐 설정은
              바뀌지 않습니다.
            </p>

            <p className="setting-label">형식</p>
            <div className="row">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={`choice choice-inline${format === f.id ? ' selected' : ''}`}
                  aria-pressed={format === f.id}
                  onClick={() => setFormat(f.id)}
                >
                  <b>{f.label}</b>
                  <span className="muted small">{f.desc}</span>
                </button>
              ))}
            </div>

            <p className="setting-label">
              추출할 큐 ({items.length}개)
              <button className="link-btn" onClick={() => setSelected(cues.filter((c) => audio[c.audioId]).map((c) => c.id))}>
                모두 선택
              </button>
              <button className="link-btn" onClick={() => setSelected([])}>
                모두 해제
              </button>
            </p>
            <ul className="export-list">
              {cues.map((c, i) => {
                const row = rows.find((r) => r.cue.id === c.id)
                return (
                  <li key={c.id}>
                    <label className="export-item">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        disabled={!audio[c.audioId]}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="export-name">
                        {i + 1}. {c.name}
                      </span>
                      {row && (
                        <span className="muted small">
                          {formatDuration(row.seconds)} · {row.bytes === null ? '크기 계산 중' : `약 ${formatBytes(row.bytes)}`}
                        </span>
                      )}
                      {row && row.overDb > 0 && <span className="warn-text small">⚠ +{row.overDb.toFixed(1)}dB 깨짐</span>}
                      {!audio[c.audioId] && <span className="warn-text small">음원 없음</span>}
                    </label>
                  </li>
                )
              })}
            </ul>

            {single && (
              <label className="time-input wide-input">
                <span>파일 이름</span>
                <input type="text" value={singleName} onChange={(e) => setSingleName(e.target.value)} />
                <span className="muted small">저장 이름: {safeFileName(singleName || items[0].name, format)}</span>
              </label>
            )}
            {!single && items.length > 1 && <p className="muted small">파일 이름은 각 큐 이름으로 정해집니다.</p>}

            <p className="export-total">
              예상 크기 합계: <b>{totalBytes === null ? '계산 중…' : `약 ${formatBytes(totalBytes)}`}</b>
              {share ? ' · 하나씩 공유 시트로 "파일에 저장"' : ' · 다운로드 폴더에 저장'}
            </p>

            {playing && <p className="warn-text">재생 중에는 추출할 수 없습니다. 정지한 뒤 다시 시도하세요.</p>}

            {clipping.length > 0 ? (
              <div className="clip-warning">
                <p className="warn-text">
                  ⚠ 볼륨을 올려서 소리가 깨지는(클리핑) 구간이 있습니다: {clipping.map((r) => `${r.cue.name} (+${r.overDb.toFixed(1)}dB)`).join(', ')}
                </p>
                <div className="row">
                  <button className="btn" disabled={playing || items.length === 0} onClick={() => void run('keep')}>
                    그대로 추출
                  </button>
                  <button className="btn btn-primary" disabled={playing || items.length === 0} onClick={() => void run('lower')}>
                    깨지지 않게 자동으로 낮춰서 추출
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary wide" disabled={playing || items.length === 0} onClick={() => void run(null)}>
                추출 ({items.length}개)
              </button>
            )}
          </>
        )}

        {phase === 'running' && progress && (
          <div className="export-progress">
            <p>
              <b>
                {progress.index + 1} / {progress.total}
              </b>{' '}
              · {progress.name}
            </p>
            <p className="muted">
              {STAGE_TEXT[progress.stage]}
              {progress.ratio !== undefined && progress.stage === 'encoding' && ` ${Math.round(progress.ratio * 100)}%`}
            </p>
            <div className="bar">
              <div
                className="bar-fill"
                style={{
                  width: `${((progress.index + (progress.stage === 'encoding' ? 0.5 + 0.5 * (progress.ratio ?? 0) : progress.stage === 'rendering' ? 0.25 : 0.05)) / progress.total) * 100}%`,
                }}
              />
            </div>

            {askClip && (
              <div className="clip-warning">
                <p className="warn-text">
                  ⚠ "{askClip.name}"을 렌더링해 보니 가장 큰 소리가 +{askClip.overDb.toFixed(1)}dB 넘쳐 깨집니다.
                </p>
                <div className="row">
                  <button className="btn" onClick={() => askClip.resolve('keep')}>
                    그대로 추출
                  </button>
                  <button className="btn btn-primary" onClick={() => askClip.resolve('lower')}>
                    깨지지 않게 자동으로 낮춰서 추출
                  </button>
                </div>
              </div>
            )}

            {pendingSave && (
              <div className="save-prompt">
                <p>
                  <b>{pendingSave.file.name}</b> ({formatBytes(pendingSave.file.size)}) 준비됨
                </p>
                <p className="muted small">"공유"를 누른 뒤 "파일에 저장"을 고르세요.</p>
                <div className="row">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const p = pendingSave
                      void shareFile(p.file).then(p.resolve, () => p.resolve(false))
                    }}
                  >
                    공유 (파일에 저장)
                  </button>
                  <button className="btn" onClick={() => pendingSave.resolve(false)}>
                    건너뛰기
                  </button>
                </div>
              </div>
            )}

            {!pendingSave && !askClip && (
              <button className="btn wide" onClick={() => (cancelled.current = true)}>
                남은 추출 취소
              </button>
            )}
          </div>
        )}

        {phase === 'done' && (
          <div>
            <ul className="export-results">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? 'ok-text' : 'warn-text'}>
                  {r.ok ? '✓' : '✗'} {r.name} <span className="muted small">— {r.message}</span>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn" onClick={() => setPhase('setup')}>
                다시 추출
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
