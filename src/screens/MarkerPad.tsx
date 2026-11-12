/**
 * 플레이 화면의 마커 패드: 선택한 큐의 마커를 큰 버튼으로 나열.
 * 탭하면 그 지점부터 바로 재생 (다른 곳을 재생 중이면 끊고).
 */
import { useState } from 'react'
import { ColorPicker } from '../components/ColorPicker.tsx'
import { formatTimeMs } from '../components/format.ts'
import { markerHex } from '../components/markerColors.ts'
import { useEngineState } from '../components/useEngine.ts'
import { usePlayerStore } from '../store/playerStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import { useSettingsStore } from '../store/settingsStore.ts'
import type { Marker } from '../store/types.ts'

const canKeyboard = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

export function MarkerPad() {
  const cues = useProjectStore((s) => s.cues)
  const { updateMarker, deleteMarker } = useProjectStore()
  const { selectedCueId, playingCueId, lastStart, playMarker, playAdjacentMarker, restartLast, addMarkerHere } =
    usePlayerStore()
  const preroll = useSettingsStore((s) => s.prerollSeconds)
  /** 공연 모드: 마커 재생만 되고 추가/이름 변경/색/삭제는 막는다 */
  const locked = useSettingsStore((s) => s.performanceMode)
  const state = useEngineState()
  const [menuId, setMenuId] = useState<string | null>(null)

  const cue = cues.find((c) => c.id === selectedCueId)
  // 재생 중인 큐가 따로 있으면 M은 그 큐에 찍힌다
  const markTarget = state !== 'stopped' && playingCueId ? cues.find((c) => c.id === playingCueId) : cue

  const rename = (m: Marker) => {
    if (!cue) return
    const name = window.prompt('마커 이름', m.name)
    if (name !== null && name.trim()) updateMarker(cue.id, m.id, { name: name.trim() })
  }
  const remove = (m: Marker) => {
    if (!cue) return
    setMenuId(null)
    let msg = `"${m.name}" 마커를 삭제할까요?`
    if (state !== 'stopped') msg = `⚠️ 지금 재생 중입니다. (재생은 계속됩니다)\n\n${msg}`
    if (window.confirm(msg)) deleteMarker(cue.id, m.id)
  }

  return (
    <section className="marker-pad">
      <div className="marker-pad-head">
        <h2>
          마커 <span className="muted">{cue ? `· ${cue.name}` : ''}</span>
          {preroll > 0 && <span className="badge">프리롤 {preroll}초</span>}
        </h2>
        <div className="marker-pad-tools">
          <button className="btn small-btn" disabled={!cue?.markers.length} onClick={() => cue && playAdjacentMarker(cue.id, -1)}>
            ◀ 이전 마커
          </button>
          <button className="btn small-btn" disabled={!cue?.markers.length} onClick={() => cue && playAdjacentMarker(cue.id, 1)}>
            다음 마커 ▶
          </button>
          <button className="btn small-btn" disabled={!lastStart} onClick={restartLast} title={lastStart?.label}>
            ↺ 다시{canKeyboard && ' (R)'}
          </button>
          {!locked && (
            <button className="btn btn-primary small-btn" disabled={!markTarget} onClick={() => addMarkerHere()}>
              + 마커{canKeyboard && ' (M)'}
            </button>
          )}
        </div>
      </div>

      {!cue ? (
        <p className="muted small">큐를 탭하면 그 큐의 마커가 여기에 나옵니다.</p>
      ) : cue.markers.length === 0 ? (
        <p className="muted small">
          마커가 없습니다.{!locked && ' 재생 중에 "+ 마커"를 누르면 그 위치에 생깁니다.'}
          {markTarget && markTarget.id !== cue.id && ` (지금은 재생 중인 "${markTarget.name}"에 찍힙니다)`}
        </p>
      ) : (
        <div className="marker-grid">
          {cue.markers.map((m, i) => (
            <div key={m.id} className="marker-cell" style={{ borderColor: markerHex(m.color) }}>
              <button className="marker-btn" onClick={() => playMarker(cue.id, m.id)}>
                <span className="marker-key" style={{ background: markerHex(m.color) }}>
                  {i < 9 ? i + 1 : '·'}
                </span>
                <span className="marker-btn-text">
                  <span className="marker-btn-name">{m.name}</span>
                  <span className="marker-btn-time">{formatTimeMs(m.time)}</span>
                </span>
              </button>
              {!locked && (
              <button
                className="marker-more"
                aria-label={`${m.name} 메뉴`}
                aria-expanded={menuId === m.id}
                onClick={() => setMenuId(menuId === m.id ? null : m.id)}
              >
                ⋯
              </button>
              )}
              {menuId === m.id && !locked && (
                <div className="marker-menu">
                  <ColorPicker value={m.color} onChange={(c) => updateMarker(cue.id, m.id, { color: c })} />
                  <div className="row">
                    <button className="btn small-btn" onClick={() => rename(m)}>
                      이름 변경
                    </button>
                    <button className="btn btn-danger small-btn" onClick={() => remove(m)}>
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canKeyboard && cue && cue.markers.length > 0 && (
        <p className="muted small marker-help">
          숫자 1~9: 해당 마커부터 재생{!locked && ' · M: 마커 추가'} · R: 마지막 시작 지점부터 다시
        </p>
      )}
    </section>
  )
}
