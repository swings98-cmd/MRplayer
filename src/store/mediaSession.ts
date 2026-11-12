/**
 * Media Session: 잠금 화면과 제어 센터에 재생 중인 큐 이름을 보여주고,
 * 재생/일시정지 버튼을 엔진에 연결한다.
 * (여기서 처리기를 등록하면 iOS가 <audio> 요소를 직접 멈추지 않고 이 처리기를 부른다)
 */
import { audioEngine } from '../audio/index.ts'
import { usePlayerStore } from './playerStore.ts'
import { useProjectStore } from './projectStore.ts'

const ARTWORK = [
  { src: `${import.meta.env.BASE_URL}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
  { src: `${import.meta.env.BASE_URL}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
]

let started = false

export function initMediaSession(): void {
  if (started || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  started = true
  const ms = navigator.mediaSession

  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    [
      'play',
      () => {
        const st = audioEngine.getSnapshot()
        if (st.needsReconnect) audioEngine.unlock()
        if (st.state === 'paused') audioEngine.resume()
      },
    ],
    [
      'pause',
      () => {
        if (audioEngine.getSnapshot().state === 'playing') audioEngine.pause()
      },
    ],
    ['stop', () => usePlayerStore.getState().stop()],
  ]
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler)
    } catch {
      /* 지원하지 않는 동작은 건너뜀 */
    }
  }

  let lastKey = ''
  /** 마지막으로 잠금 화면에 알려준 위치 (건너뛰기 감지용) */
  let reported: { pos: number; at: number; playing: boolean } | null = null
  const update = () => {
    const snap = audioEngine.getSnapshot()
    const { playingCueId } = usePlayerStore.getState()
    const ps = useProjectStore.getState()
    const cue = ps.cues.find((c) => c.id === playingCueId)
    const project = ps.projects.find((p) => p.id === ps.currentProjectId)
    const title = cue?.name ?? 'MR 큐 플레이어'
    const playback: MediaSessionPlaybackState =
      snap.state === 'playing' || snap.state === 'fading' ? 'playing' : snap.state === 'paused' ? 'paused' : 'none'

    // 같은 내용이면 다시 설정하지 않는다 (엔진 상태는 화면 프레임마다 알려오므로)
    const key = `${title}|${project?.name}|${playback}|${playingCueId}`
    const now = performance.now()
    const expected = reported ? reported.pos + (reported.playing ? (now - reported.at) / 1000 : 0) : NaN
    const jumped = !(Math.abs(snap.position - expected) < 0.5)
    if (key === lastKey && !jumped) return
    if (key !== lastKey) {
      lastKey = key
      ms.metadata = new MediaMetadata({ title, artist: project?.name ?? '', album: 'MR 큐 플레이어', artwork: ARTWORK })
      ms.playbackState = playback
    }
    reported = { pos: snap.position, at: now, playing: playback === 'playing' }

    // 잠금 화면 진행 막대: 시작·일시정지 때 한 번 알려주면 시스템이 이어서 그린다
    const meta = cue ? ps.audio[cue.audioId] : undefined
    if (cue && meta && 'setPositionState' in ms) {
      const start = cue.inPoint
      const end = cue.outPoint ?? meta.duration
      try {
        ms.setPositionState({
          duration: Math.max(0.001, end - start),
          position: Math.min(end - start, Math.max(0, snap.position - start)),
          playbackRate: 1,
        })
      } catch {
        /* 무시 */
      }
    }
  }

  audioEngine.subscribe(update)
  usePlayerStore.subscribe(update)
  update()
}
