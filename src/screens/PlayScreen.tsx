import { CueList } from '../components/CueList.tsx'
import { formatDuration } from '../components/format.ts'
import { markerHex } from '../components/markerColors.ts'
import { ProgressBar } from '../components/ProgressBar.tsx'
import { useEngineSnapshot, useEngineState } from '../components/useEngine.ts'
import { isEngineActive, usePlayerStore } from '../store/playerStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import { useSettingsStore } from '../store/settingsStore.ts'
import type { Cue } from '../store/types.ts'
import { MarkerPad } from './MarkerPad.tsx'
import { usePlayShortcuts } from './usePlayShortcuts.ts'

const canKeyboard = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

export function PlayScreen() {
  usePlayShortcuts()
  const { ready, cues, audio, updateCue, duplicateCue, deleteCue, moveCue } = useProjectStore()
  const { standbyCueId, playingCueId, readyAudioIds, waitingCueId, error, notice, failedAudio, setStandby, clearError } =
    usePlayerStore()
  const playState = useEngineState()
  const performanceMode = useSettingsStore((s) => s.performanceMode)

  if (!ready) return <p className="muted">불러오는 중…</p>

  const onRename = (cue: Cue) => {
    const name = window.prompt('큐 이름', cue.name)
    if (name !== null && name.trim()) updateCue(cue.id, { name: name.trim() })
  }

  const onMemo = (cue: Cue) => {
    const memo = window.prompt('짧은 메모 (예: 암전 후 GO)', cue.memo)
    if (memo !== null) updateCue(cue.id, { memo: memo.trim() })
  }

  const onDelete = (cue: Cue) => {
    let msg = `"${cue.name}" 큐를 삭제할까요?\n다른 큐가 쓰지 않는 음원 파일도 함께 삭제되며, 되돌릴 수 없습니다.`
    if (cue.id === playingCueId) msg = `⚠️ 지금 재생 중인 큐입니다. 삭제하면 소리가 멈춥니다.\n\n${msg}`
    else if (isEngineActive()) msg = `⚠️ 지금 재생 중입니다.\n\n${msg}`
    if (window.confirm(msg)) void deleteCue(cue.id)
  }

  return (
    <div className="play">
      <section className="play-cues">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="btn small-btn" onClick={clearError}>
              닫기
            </button>
          </div>
        )}
        {notice && (
          <div className="notice-banner" role="status">
            {notice}
          </div>
        )}
        <CueList
          failedAudio={failedAudio}
          locked={performanceMode}
          cues={cues}
          audio={audio}
          standbyId={standbyCueId}
          playingId={playingCueId}
          playState={playState}
          readyAudioIds={readyAudioIds}
          waitingId={waitingCueId}
          onSelect={setStandby}
          onMove={(from, to) => void moveCue(from, to)}
          onRename={onRename}
          onMemo={onMemo}
          onDuplicate={(cue) => void duplicateCue(cue.id)}
          onDelete={onDelete}
        />
        <MarkerPad />
      </section>

      <aside className="play-panel">
        <PanicBar />
        <NowPlaying />
        <Transport />
        <MasterVolume />
        {canKeyboard && (
          <p className="muted small shortcut-help">
            스페이스 GO · Esc 정지 (두 번: 패닉) · P 일시정지 · F 페이드 아웃 · ↑↓ 대기 큐 · 1~9 마커
            {!performanceMode && ' · M 마커 추가'} · R 다시
          </p>
        )}
      </aside>
    </div>
  )
}

/** 패닉: 다른 버튼과 떨어진 맨 위에 */
function PanicBar() {
  const panic = usePlayerStore((s) => s.panic)
  const performanceMode = useSettingsStore((s) => s.performanceMode)
  const update = useSettingsStore((s) => s.update)

  const toggle = () => {
    if (!performanceMode) update({ performanceMode: true })
    // 끌 때는 실수로 풀리지 않게 한 번 더 묻는다
    else if (window.confirm('공연 모드를 끌까요?\n큐 삭제, 순서 변경, 편집이 다시 가능해집니다.')) update({ performanceMode: false })
  }

  return (
    <div className="panic-bar">
      <button
        className={`perf-switch${performanceMode ? ' on' : ''}`}
        role="switch"
        aria-checked={performanceMode}
        onClick={toggle}
      >
        <span className="perf-knob" />
        {performanceMode ? '🔒 공연 모드' : '공연 모드'}
      </button>
      <button className="btn-panic" onClick={panic}>
        패닉 · 전체 정지
      </button>
    </div>
  )
}

/** 재생 중인 큐 이름, 경과/남은 시간, 진행 막대 (프레임마다 다시 그려지는 부분은 여기만) */
function NowPlaying() {
  const snap = useEngineSnapshot()
  const cues = useProjectStore((s) => s.cues)
  const audio = useProjectStore((s) => s.audio)
  const { playingCueId, standbyCueId, seek } = usePlayerStore()

  const playing = cues.find((c) => c.id === playingCueId)
  const standby = cues.find((c) => c.id === standbyCueId)

  if (!playing) {
    const meta = standby ? audio[standby.audioId] : undefined
    return (
      <div className="now-playing is-idle">
        <div className="now-label">정지</div>
        <div className="now-name">{standby ? `다음: ${standby.name}` : cues.length ? '마지막 큐까지 재생했습니다' : '큐 없음'}</div>
        <div className="now-times">
          <div>
            <span className="now-time-label">경과</span>
            <span className="now-time">0:00</span>
          </div>
          <div>
            <span className="now-time-label">길이</span>
            <span className="now-time">
              {standby && meta ? formatDuration((standby.outPoint ?? meta.duration) - standby.inPoint) : '-'}
            </span>
          </div>
        </div>
        <ProgressBar start={0} end={1} position={0} disabled onSeek={() => {}} />
      </div>
    )
  }

  const meta = audio[playing.audioId]
  const start = playing.inPoint
  const end = playing.outPoint ?? meta?.duration ?? start
  const pos = Math.min(end, Math.max(start, snap.position))
  const label = snap.state === 'paused' ? '일시정지' : snap.state === 'fading' ? '페이드 아웃 중' : '재생 중'

  return (
    <div className={`now-playing is-${snap.state}`}>
      <div className="now-label">{label}</div>
      <div className="now-name">{playing.name}</div>
      <div className="now-times">
        <div>
          <span className="now-time-label">경과</span>
          <span className="now-time">{formatDuration(Math.floor(pos - start))}</span>
        </div>
        <div>
          <span className="now-time-label">남은 시간</span>
          <span className="now-time">-{formatDuration(Math.ceil(end - pos))}</span>
        </div>
      </div>
      <ProgressBar
        start={start}
        end={end}
        position={pos}
        onSeek={seek}
        marks={playing.markers.map((m) => ({ time: m.time, color: markerHex(m.color), label: m.name }))}
      />
    </div>
  )
}

function Transport() {
  const state = useEngineState()
  const fadeOutSeconds = useSettingsStore((s) => s.fadeOutSeconds)
  const { go, stop, togglePause, fadeOutStop, standbyCueId } = usePlayerStore()
  const active = state !== 'stopped'

  return (
    <div className="transport">
      <button className="btn-go" onClick={go} disabled={!standbyCueId}>
        GO
      </button>
      <div className="transport-row">
        <button className="btn-transport" onClick={stop} disabled={!active}>
          정지
        </button>
        <button
          className="btn-transport"
          onClick={togglePause}
          disabled={state !== 'playing' && state !== 'paused'}
        >
          {state === 'paused' ? '이어 재생' : '일시정지'}
        </button>
        <button className="btn-transport" onClick={fadeOutStop} disabled={state !== 'playing' && state !== 'fading'}>
          페이드 아웃
          <span className="btn-sub">{fadeOutSeconds}초</span>
        </button>
      </div>
    </div>
  )
}

function MasterVolume() {
  const db = useSettingsStore((s) => s.masterVolumeDb)
  const update = useSettingsStore((s) => s.update)
  return (
    <div className="master">
      <label className="master-label" htmlFor="master-volume">
        마스터 볼륨 <b>{db > 0 ? `+${db}` : db} dB</b>
      </label>
      <div className="master-row">
        <input
          id="master-volume"
          type="range"
          min={-40}
          max={6}
          step={0.5}
          value={db}
          onChange={(e) => update({ masterVolumeDb: parseFloat(e.target.value) })}
        />
        <button className="btn small-btn" onClick={() => update({ masterVolumeDb: 0 })} disabled={db === 0}>
          0 dB
        </button>
      </div>
    </div>
  )
}
