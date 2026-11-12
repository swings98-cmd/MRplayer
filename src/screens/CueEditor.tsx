/**
 * 큐 하나 편집: 파형, 트림, 페이드, 볼륨, 미리듣기, 실행 취소.
 * 모든 변경은 projectStore.updateCue로 자동 저장되고,
 * 재생 중인 큐면 playerStore가 엔진에 바로 반영한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTimeMs } from '../components/format.ts'
import { TimeInput } from '../components/TimeInput.tsx'
import { useEngineSnapshot } from '../components/useEngine.ts'
import { Waveform } from '../components/Waveform.tsx'
import {
  MAX_FADE,
  MAX_VOLUME_DB,
  MIN_TRIM,
  MIN_VOLUME_DB,
  normalizeEdit,
  ORIGINAL_VALUES,
  pickEditValues,
  sameEditValues,
  type EditValues,
} from '../store/cueRules.ts'
import { useEditHistory } from '../store/editHistory.ts'
import { usePlayerStore } from '../store/playerStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import type { AudioMeta, Cue } from '../store/types.ts'
import { isTyping } from './usePlayShortcuts.ts'

interface Props {
  cue: Cue
  meta: AudioMeta
}

const DOUBLE_TAP_MS = 350

export function CueEditor({ cue, meta }: Props) {
  const updateCue = useProjectStore((s) => s.updateCue)
  const history = useEditHistory()
  const stacks = history.stacks[cue.id]
  const { playFrom, previewAround, seek, stop, togglePause } = usePlayerStore()
  const snap = useEngineSnapshot()
  const [cursor, setCursor] = useState(cue.inPoint)
  const [previewOnRelease, setPreviewOnRelease] = useState(true)

  const duration = meta.duration
  const out = cue.outPoint ?? duration
  const trimLength = out - cue.inPoint

  const engineOnThis = snap.state !== 'stopped' && snap.audioId === cue.audioId
  const playingThis = engineOnThis && (snap.state === 'playing' || snap.state === 'fading')
  const playhead = engineOnThis ? snap.position : cursor

  // 가장 큰 소리(dBFS): 볼륨을 올렸을 때 깨지는지 알려주기 위함
  const peakDb = useMemo(() => {
    let m = 0
    for (const p of meta.peaks) if (p > m) m = p
    return m > 0 ? 20 * Math.log10(m / 255) : -Infinity
  }, [meta.peaks])

  /** 값 바꾸기 (규칙 적용 + 실행 취소 기록 + 자동 저장) */
  const apply = (patch: Partial<EditValues>, opts: { changed?: 'fadeIn' | 'fadeOut'; step?: boolean } = {}) => {
    const before = pickEditValues(cue)
    const next = normalizeEdit({ ...before, ...patch }, duration, opts.changed)
    if (sameEditValues(before, next)) return
    // step: 버튼·핸들처럼 한 번에 끝나는 변경은 실행 취소 한 단계로 따로 둔다
    if (opts.step) history.cut(cue.id)
    history.record(cue.id, before)
    if (opts.step) history.cut(cue.id)
    updateCue(cue.id, next)
  }

  const undo = () => {
    const prev = history.undo(cue.id, pickEditValues(cue))
    if (prev) updateCue(cue.id, prev)
  }
  const redo = () => {
    const next = history.redo(cue.id, pickEditValues(cue))
    if (next) updateCue(cue.id, next)
  }

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (글자 입력 중에는 입력 칸의 기본 동작)
  const keyRef = useRef({ undo, redo })
  useEffect(() => {
    keyRef.current = { undo, redo }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e.target)) return
      if (e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) keyRef.current.redo()
        else keyRef.current.undo()
      } else if (e.code === 'KeyY' && e.ctrlKey) {
        e.preventDefault()
        keyRef.current.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ───────── 재생 ─────────

  const startPoint = () => (cursor >= cue.inPoint && cursor < out - 0.05 ? cursor : cue.inPoint)

  const onPlayToggle = () => {
    if (playingThis) {
      setCursor(snap.position)
      stop()
    } else if (engineOnThis && snap.state === 'paused') {
      togglePause()
    } else {
      playFrom(cue.id, startPoint())
    }
  }

  const onSeek = (t: number) => {
    setCursor(t)
    if (engineOnThis) seek(t)
  }

  const onTrimEnd = (kind: 'in' | 'out', t: number) => {
    apply(kind === 'in' ? { inPoint: t } : { outPoint: t }, { step: true })
    // 이 큐를 듣는 중이 아니면 놓은 지점 앞뒤를 짧게 들려준다
    if (previewOnRelease && !playingThis) previewAround(cue.id, t)
  }

  const onReset = () => {
    if (window.confirm(`"${cue.name}"의 트림, 페이드, 볼륨을 모두 원래대로 되돌릴까요?\n(실행 취소로 다시 돌아올 수 있습니다)`)) {
      apply(ORIGINAL_VALUES, { step: true })
    }
  }

  // ───────── 볼륨 더블 탭 ─────────
  const lastTap = useRef(0)
  const onVolumeTap = () => {
    const now = performance.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      apply({ volumeDb: 0 }, { step: true })
      lastTap.current = 0
    } else lastTap.current = now
  }

  const fadeInMax = Math.min(MAX_FADE, Math.max(0, trimLength - cue.fadeOut))
  const fadeOutMax = Math.min(MAX_FADE, Math.max(0, trimLength - cue.fadeIn))
  const louderBy = peakDb + cue.volumeDb

  return (
    <div className="editor">
      <section className="card">
        <Waveform
          peaks={meta.peaks}
          peaksPerSecond={meta.peaksPerSecond}
          duration={duration}
          inPoint={cue.inPoint}
          outPoint={out}
          fadeIn={cue.fadeIn}
          fadeOut={cue.fadeOut}
          playhead={playhead}
          following={playingThis}
          minTrim={MIN_TRIM}
          onSeek={onSeek}
          onTrimEnd={onTrimEnd}
        />

        <div className="editor-transport">
          <button className={`btn ${playingThis ? 'btn-danger' : 'btn-primary'}`} onClick={onPlayToggle}>
            {playingThis ? '정지' : engineOnThis && snap.state === 'paused' ? '이어 재생' : '재생'}
          </button>
          <button className="btn" onClick={() => playFrom(cue.id, cue.inPoint)}>
            처음부터
          </button>
          <button className="btn" onClick={() => playFrom(cue.id, Math.max(cue.inPoint, out - 10))}>
            끝 10초 전부터
          </button>
          <div className="editor-position">
            <span className="muted small">위치</span>
            <b>{formatTimeMs(playhead)}</b>
          </div>
        </div>

        <div className="row editor-row">
          <button className="btn small-btn" onClick={undo} disabled={!stacks?.undo.length} title="Ctrl/⌘+Z">
            ↶ 실행 취소
          </button>
          <button className="btn small-btn" onClick={redo} disabled={!stacks?.redo.length} title="Ctrl/⌘+Shift+Z">
            ↷ 다시 실행
          </button>
          <label className="check">
            <input type="checkbox" checked={previewOnRelease} onChange={(e) => setPreviewOnRelease(e.target.checked)} />
            핸들을 놓으면 그 지점 앞뒤 미리듣기
          </label>
        </div>
      </section>

      <div className="editor-grid">
        <section className="card">
          <h2>트림</h2>
          <div className="trim-row">
            <TimeInput label="인 포인트" value={cue.inPoint} onCommit={(v) => apply({ inPoint: v }, { step: true })} />
            <button className="btn" onClick={() => apply({ inPoint: playhead }, { step: true })}>
              현재 위치를 인 포인트로
            </button>
          </div>
          <div className="trim-row">
            <TimeInput label="아웃 포인트" value={out} onCommit={(v) => apply({ outPoint: v }, { step: true })} />
            <button className="btn" onClick={() => apply({ outPoint: playhead }, { step: true })}>
              현재 위치를 아웃 포인트로
            </button>
          </div>
          <p className="muted small">
            트림 길이 {formatTimeMs(trimLength)} · 원본 {formatTimeMs(duration)}
          </p>
        </section>

        <section className="card">
          <h2>페이드</h2>
          <SliderField
            label="페이드 인"
            unit="초"
            value={cue.fadeIn}
            min={0}
            max={MAX_FADE}
            step={0.1}
            limit={fadeInMax}
            onChange={(v) => apply({ fadeIn: v }, { changed: 'fadeIn' })}
          />
          <SliderField
            label="페이드 아웃"
            unit="초"
            value={cue.fadeOut}
            min={0}
            max={MAX_FADE}
            step={0.1}
            limit={fadeOutMax}
            onChange={(v) => apply({ fadeOut: v }, { changed: 'fadeOut' })}
          />
          <p className="muted small">페이드 인 + 페이드 아웃은 트림 길이를 넘을 수 없습니다.</p>
        </section>

        <section className="card">
          <h2>볼륨</h2>
          <SliderField
            label="큐 볼륨"
            unit="dB"
            value={cue.volumeDb}
            min={MIN_VOLUME_DB}
            max={MAX_VOLUME_DB}
            step={0.5}
            onChange={(v) => apply({ volumeDb: v })}
            onSliderTap={onVolumeTap}
            signed
          />
          <p className="muted small">슬라이더를 두 번 탭하면 0dB로 돌아갑니다.</p>
          {cue.volumeDb > 0 && (
            <p className="warn-text">
              ⚠ 0dB를 넘기면 소리가 깨질 수 있습니다.
              {louderBy > 0 && ` 이 음원은 지금 볼륨에서 가장 큰 소리가 약 ${louderBy.toFixed(1)}dB 넘칩니다.`}
            </p>
          )}
        </section>
      </div>

      <div className="row">
        <button className="btn btn-danger" onClick={onReset}>
          모든 편집 초기화
        </button>
      </div>
    </div>
  )
}

interface SliderFieldProps {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  /** 지금 허용되는 최댓값 (다른 값 때문에 max보다 작을 때 표시) */
  limit?: number
  signed?: boolean
  onChange: (v: number) => void
  onSliderTap?: () => void
}

/** 슬라이더 + 숫자 입력 */
function SliderField({ label, unit, value, min, max, step, limit, signed, onChange, onSliderTap }: SliderFieldProps) {
  const [text, setText] = useState<string | null>(null)
  const shown = signed && value > 0 ? `+${value}` : String(value)
  return (
    <div className="slider-field">
      <div className="slider-head">
        <span>{label}</span>
        <span className="slider-value">
          <input
            type="text"
            inputMode="decimal"
            value={text ?? shown}
            onFocus={(e) => {
              setText(shown)
              e.currentTarget.select()
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const v = parseFloat((text ?? '').replace(',', '.'))
              if (Number.isFinite(v)) onChange(v)
              setText(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label={`${label} (${unit})`}
          />
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onSliderTap}
        aria-label={label}
      />
      {limit !== undefined && limit < max && <span className="muted small">지금 최대 {limit.toFixed(1)}{unit}</span>}
    </div>
  )
}
