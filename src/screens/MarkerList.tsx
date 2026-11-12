/** 편집 화면의 마커 목록 (시간순): 색, 이름, 시간 입력, 재생, 삭제 */
import { useState } from 'react'
import { ColorPicker } from '../components/ColorPicker.tsx'
import { markerHex } from '../components/markerColors.ts'
import { TimeInput } from '../components/TimeInput.tsx'
import { usePlayerStore } from '../store/playerStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import type { Cue, Marker } from '../store/types.ts'

interface Props {
  cue: Cue
  duration: number
  /** 지금 위치에 마커 추가 */
  onAdd: () => void
}

export function MarkerList({ cue, duration, onAdd }: Props) {
  const { updateMarker, deleteMarker } = useProjectStore()
  const playMarker = usePlayerStore((s) => s.playMarker)
  const [colorFor, setColorFor] = useState<string | null>(null)

  const rename = (m: Marker) => {
    const name = window.prompt('마커 이름', m.name)
    if (name !== null && name.trim()) updateMarker(cue.id, m.id, { name: name.trim() })
  }

  const remove = (m: Marker) => {
    if (window.confirm(`"${m.name}" 마커를 삭제할까요?`)) deleteMarker(cue.id, m.id)
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>마커 ({cue.markers.length})</h2>
        <button className="btn btn-primary small-btn" onClick={onAdd} title="단축키 M">
          + 지금 위치에 마커 (M)
        </button>
      </div>
      {cue.markers.length === 0 ? (
        <p className="muted small">
          재생 중이든 멈춘 상태든 "+ 지금 위치에 마커"를 누르면 그 위치에 마커가 생깁니다. 파형 위에서 끌어 위치를 고칠 수
          있습니다.
        </p>
      ) : (
        <ol className="marker-list">
          {cue.markers.map((m, i) => (
            <li key={m.id} className="marker-item">
              <div className="marker-row">
                <span className="marker-no">{i + 1}</span>
                <button
                  className="marker-color"
                  style={{ background: markerHex(m.color) }}
                  aria-label="색 바꾸기"
                  aria-expanded={colorFor === m.id}
                  onClick={() => setColorFor(colorFor === m.id ? null : m.id)}
                />
                <button className="marker-name" onClick={() => rename(m)} title="탭해서 이름 바꾸기">
                  {m.name}
                </button>
                <TimeInput
                  label=""
                  value={m.time}
                  onCommit={(t) => updateMarker(cue.id, m.id, { time: Math.min(duration, Math.max(0, t)) })}
                />
                <button className="btn small-btn" onClick={() => playMarker(cue.id, m.id)} aria-label={`${m.name}부터 재생`}>
                  ▶
                </button>
                <button className="btn btn-danger small-btn" onClick={() => remove(m)}>
                  삭제
                </button>
              </div>
              {colorFor === m.id && (
                <ColorPicker
                  value={m.color}
                  onChange={(c) => {
                    updateMarker(cue.id, m.id, { color: c })
                    setColorFor(null)
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
