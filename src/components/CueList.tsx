import { useEffect, useRef, useState } from 'react'
import type { PlaybackState } from '../audio/index.ts'
import type { AudioMeta, Cue } from '../store/types.ts'
import { formatDuration } from './format.ts'

interface Props {
  cues: Cue[]
  audio: Record<string, AudioMeta>
  standbyId: string | null
  playingId: string | null
  playState: PlaybackState
  readyAudioIds: Record<string, true>
  waitingId: string | null
  onSelect: (id: string) => void
  onMove: (from: number, to: number) => void
  onRename: (cue: Cue) => void
  onMemo: (cue: Cue) => void
  onDuplicate: (cue: Cue) => void
  onDelete: (cue: Cue) => void
  /** 공연 모드: 순서 변경과 메뉴(이름 변경, 메모, 복제, 삭제)를 막는다. 탭해서 대기 큐 고르기는 된다 */
  locked?: boolean
}

interface DragState {
  pointerId: number
  from: number
  over: number
  startY: number
  startScroll: number
  /** 끄는 큐의 높이 */
  height: number
  /** 각 큐 가운데의 목록 내부 좌표 */
  mids: number[]
  offset: number
}

const STATE_BADGE: Partial<Record<PlaybackState, string>> = {
  playing: '재생 중',
  paused: '일시정지',
  fading: '페이드 아웃',
}

function trimmedLength(cue: Cue, meta: AudioMeta | undefined): number | null {
  if (!meta) return null
  const out = cue.outPoint === null ? meta.duration : Math.min(cue.outPoint, meta.duration)
  return Math.max(0, out - cue.inPoint)
}

export function CueList(props: Props) {
  const { cues, audio, standbyId, playingId, playState, readyAudioIds, waitingId } = props
  const listRef = useRef<HTMLOListElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const [drag, setDrag] = useState<DragState | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  // 대기 큐가 바뀌면 보이는 곳으로 스크롤
  useEffect(() => {
    if (!standbyId || drag) return
    rowRefs.current.get(standbyId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [standbyId, drag])

  const startDrag = (e: React.PointerEvent, index: number) => {
    const list = listRef.current
    if (!list) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const listTop = list.getBoundingClientRect().top
    const mids = cues.map((c) => {
      const r = rowRefs.current.get(c.id)!.getBoundingClientRect()
      return r.top - listTop + list.scrollTop + r.height / 2
    })
    const height = rowRefs.current.get(cues[index].id)!.getBoundingClientRect().height
    setMenuId(null)
    setDrag({
      pointerId: e.pointerId,
      from: index,
      over: index,
      startY: e.clientY,
      startScroll: list.scrollTop,
      height,
      mids,
      offset: 0,
    })
  }

  const moveDrag = (e: React.PointerEvent) => {
    const list = listRef.current
    if (!drag || !list || e.pointerId !== drag.pointerId) return
    // 위아래 끝에 가까우면 목록을 스크롤
    const rect = list.getBoundingClientRect()
    const edge = 60
    if (e.clientY < rect.top + edge) list.scrollTop -= 12
    else if (e.clientY > rect.bottom - edge) list.scrollTop += 12

    const offset = e.clientY - drag.startY + (list.scrollTop - drag.startScroll)
    const center = drag.mids[drag.from] + offset
    let over = 0
    drag.mids.forEach((m, i) => {
      if (i !== drag.from && m < center) over++
    })
    setDrag({ ...drag, offset, over })
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { from, over } = drag
    setDrag(null)
    if (from !== over) props.onMove(from, over)
  }

  /** 끄는 동안 다른 큐가 비켜 주는 거리 */
  const shiftFor = (i: number): number => {
    if (!drag || i === drag.from) return 0
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.height
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return drag.height
    return 0
  }

  if (cues.length === 0) {
    return <p className="muted cue-empty">큐가 없습니다. 편집 탭에서 음원을 불러오세요.</p>
  }

  return (
    <ol ref={listRef} className={`play-list${drag ? ' is-dragging' : ''}`}>
      {cues.map((cue, i) => {
        const meta = audio[cue.audioId]
        const isPlaying = cue.id === playingId
        const isStandby = cue.id === standbyId
        const isDragged = drag?.from === i
        const len = trimmedLength(cue, meta)
        const cls = [
          'play-row',
          isPlaying && `is-${playState}`,
          isStandby && 'is-standby',
          isDragged && 'is-dragged',
        ]
          .filter(Boolean)
          .join(' ')
        const translate = isDragged ? drag!.offset : shiftFor(i)

        return (
          <li
            key={cue.id}
            ref={(el) => {
              if (el) rowRefs.current.set(cue.id, el)
              else rowRefs.current.delete(cue.id)
            }}
            className={cls}
            style={translate ? { transform: `translateY(${translate}px)` } : undefined}
          >
            <div className="play-row-main">
              {props.locked ? (
                <span className="drag-handle locked" aria-hidden="true" />
              ) : (
              <button
                className="drag-handle"
                aria-label="끌어서 순서 바꾸기"
                onPointerDown={(e) => startDrag(e, i)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={() => setDrag(null)}
              >
                ≡
              </button>
              )}
              <button className="play-row-body" onClick={() => props.onSelect(cue.id)}>
                <span className="play-no">{i + 1}</span>
                <span className="play-text">
                  <span className="play-name">{cue.name}</span>
                  {cue.memo && <span className="play-memo">{cue.memo}</span>}
                </span>
                <span className="play-side">
                  {isPlaying && STATE_BADGE[playState] && (
                    <span className="badge badge-playing">{STATE_BADGE[playState]}</span>
                  )}
                  {isStandby && !isPlaying && <span className="badge badge-standby">대기</span>}
                  {cue.id === waitingId && <span className="badge">준비 중…</span>}
                  {isStandby && !readyAudioIds[cue.audioId] && cue.id !== waitingId && (
                    <span className="badge badge-muted">디코딩 중</span>
                  )}
                  <span className="play-len">{len === null ? '-' : formatDuration(len)}</span>
                </span>
              </button>
              {!props.locked && (
                <button
                  className="row-menu-btn"
                  aria-label="큐 메뉴"
                  aria-expanded={menuId === cue.id}
                  onClick={() => setMenuId(menuId === cue.id ? null : cue.id)}
                >
                  ⋯
                </button>
              )}
            </div>
            {menuId === cue.id && !props.locked && (
              <div className="row-menu">
                <button className="btn" onClick={() => { setMenuId(null); props.onRename(cue) }}>
                  이름 변경
                </button>
                <button className="btn" onClick={() => { setMenuId(null); props.onMemo(cue) }}>
                  메모
                </button>
                <button className="btn" onClick={() => { setMenuId(null); props.onDuplicate(cue) }}>
                  복제
                </button>
                <button className="btn btn-danger" onClick={() => { setMenuId(null); props.onDelete(cue) }}>
                  삭제
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
