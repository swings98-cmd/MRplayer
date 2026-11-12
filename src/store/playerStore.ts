/**
 * 플레이 상태: 대기 큐, 재생 중인 큐, GO/정지 등 조작, 디코딩 캐시 관리.
 *
 * 선택한 큐(selectedCueId): 플레이 화면에서 사용자가 고른 큐. 편집 화면이 이 큐를 편집한다.
 *   GO로 대기 큐가 넘어가도 선택은 그대로 둔다.
 *
 * 디코딩 캐시: [재생/일시정지 중인 큐, 대기 큐, 그다음 큐, 선택한 큐] 순서로, 크기 예산(아이패드 400MB) 안에서만
 * 메모리에 둔다. 대기 큐와 다음 큐는 미리 디코딩해서 GO를 누르면 바로 나오게 하고, 나머지는 해제한다.
 * 미리 디코딩은 한 번에 하나씩 한다.
 *
 * 재생 요청(GO, 마커, 편집 재생)이 디코딩을 기다리는 동안 다른 요청이 오면 마지막 요청만 실행한다.
 * 디코딩에 실패한 음원은 기록해 두고 자동으로 다시 시도하지 않는다 (다른 큐 재생은 막지 않음).
 */
import { create } from 'zustand'
import { audioEngine, type PlayOptions } from '../audio/index.ts'
import { decodedBytes, defaultBudget, planCache } from './cachePlan.ts'
import { pickEditValues, sameEditValues } from './cueRules.ts'
import { loadCueAudio, useProjectStore } from './projectStore.ts'
import { useSettingsStore } from './settingsStore.ts'
import type { Cue, Marker } from './types.ts'

/** 마커에서 바로 시작할 때 딸깍 소리만 막는 페이드(초) */
export const MARKER_START_FADE = 0.02
/** 프리롤로 시작할 때 자연스럽게 올라오는 페이드(초, 프리롤보다 길지 않게) */
export const PREROLL_START_FADE = 0.5

/** 마지막으로 재생을 시작한 지점 ("다시" 버튼용) */
export interface StartPoint {
  cueId: string
  position: number
  options?: PlayOptions
  /** 마커에서 시작했으면 그 마커 */
  markerId?: string
  /** 화면 표시용: 어디서 시작했는지 */
  label: string
}

interface PlayerState {
  /** 다음에 GO 하면 나올 큐. 목록 끝까지 갔으면 null */
  standbyCueId: string | null
  /** 재생/페이드/일시정지 중인 큐 */
  playingCueId: string | null
  /** 미리 디코딩이 끝난 음원 id */
  readyAudioIds: Record<string, true>
  /** GO를 눌렀는데 아직 디코딩 중인 큐 */
  waitingCueId: string | null
  /** 사용자가 고른 큐 (편집 대상, 플레이 화면 마커 목록 대상) */
  selectedCueId: string | null
  /** 정지 상태의 "현재 위치" (편집 화면 탭 위치, 마지막으로 멈춘 위치). 재생 중에는 엔진 위치를 쓴다 */
  cursor: { cueId: string; time: number } | null
  lastStart: StartPoint | null
  error: string | null
  /** 잠깐 보여주는 안내 (오류가 아님) */
  notice: string | null
  /** 디코딩에 실패한 음원: audioId → 이유 */
  failedAudio: Record<string, string>

  /** 대기 큐 지정. select가 true(기본)면 편집 대상으로도 고른다 */
  setStandby(id: string | null, select?: boolean): void
  /** 대기 큐는 그대로 두고 편집 대상만 고른다 */
  select(id: string | null): void
  /** 편집 화면 미리듣기: 이 큐를 position부터 재생 (대기 큐는 그대로) */
  playFrom(cueId: string, position?: number): void
  /** 트림 핸들 미리듣기: center 앞뒤를 짧게 (트림 무시, 큐 볼륨 적용) */
  previewAround(cueId: string, center: number): void
  setCursor(cueId: string, time: number): void
  /** 이 큐의 지금 위치: 재생/일시정지 중이면 엔진 위치, 아니면 커서(없으면 인 포인트) */
  positionOf(cueId: string): number
  /** 마커 지점부터 재생 (프리롤 설정 적용, 큐 페이드 인 대신 짧은 페이드) */
  playMarker(cueId: string, markerId: string): void
  /** 지금 위치 기준 이전(-1)/다음(+1) 마커부터 재생 */
  playAdjacentMarker(cueId: string, dir: -1 | 1): void
  /** 마지막으로 시작한 지점에서 다시 */
  restartLast(): void
  /** 지금 위치에 마커 추가: 재생 중이면 재생 중인 큐, 아니면 선택한 큐. 재생은 끊지 않는다 */
  addMarkerHere(): Marker | null
  moveStandby(delta: number): void
  go(): void
  stop(): void
  togglePause(): void
  fadeOutStop(): void
  panic(): void
  seek(position: number): void
  clearError(): void
  /** 공연 전 점검 결과로 음원 상태를 기록 (null이면 정상) */
  setAudioHealth(audioId: string, error: string | null): void
}

const cues = (): Cue[] => useProjectStore.getState().cues
const indexOf = (id: string | null): number => (id ? cues().findIndex((c) => c.id === id) : -1)

/** 재생/일시정지/페이드 중인지 */
export function isEngineActive(): boolean {
  return audioEngine.getSnapshot().state !== 'stopped'
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  /** 진행 중인 디코딩: 같은 음원을 다시 요청하면 이 작업을 함께 기다린다 */
  const inflight = new Map<string, Promise<boolean>>()
  /** 재생 요청 번호: 디코딩을 기다리는 동안 새 요청이 오면 이전 요청은 실행하지 않는다 */
  let requestSeq = 0
  let noticeTimer: ReturnType<typeof setTimeout> | null = null

  function showNotice(text: string): void {
    set({ notice: text })
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => set({ notice: null }), 4000)
  }

  function updateCache(): void {
    const list = cues()
    const { standbyCueId, playingCueId, selectedCueId, failedAudio } = get()
    const si = indexOf(standbyCueId)
    const audioOf = (id: string | null | undefined) => list.find((c) => c.id === id)?.audioId
    const engineAudio = audioEngine.getSnapshot().audioId
    // 우선순위: 재생/일시정지 중 → 대기 큐 → 그다음 큐 → 편집 대상
    const order = [engineAudio, audioOf(playingCueId), audioOf(standbyCueId), list[si + 1]?.audioId, audioOf(selectedCueId)]
      .filter((id): id is string => !!id && !failedAudio[id])

    const mem = audioEngine.memoryInUse()
    const metas = useProjectStore.getState().audio
    const sr = audioEngine.decodeSampleRate
    const keep = planCache(
      order.map((id) => ({ audioId: id, bytes: mem.byId[id] ?? decodedBytes(metas[id]?.duration ?? 0, sr) })),
      defaultBudget(),
      mem.voicesOnly,
    )
    const keepSet = new Set(keep)

    // 예산 밖이거나 멀리 떨어진 음원 해제 (재생 중인 음원은 항상 남긴다)
    let changed = false
    const ready = { ...get().readyAudioIds }
    for (const id of audioEngine.loadedIds()) {
      if (!keepSet.has(id) && id !== engineAudio) {
        audioEngine.unload(id)
        delete ready[id]
        changed = true
      }
    }
    if (changed) set({ readyAudioIds: ready })

    // 미리 디코딩: 한 번에 하나씩 (끝나면 다음 것)
    if (inflight.size > 0) return
    const nextId = keep.find((id) => !audioEngine.isLoaded(id))
    const cue = nextId ? list.find((c) => c.audioId === nextId) : undefined
    if (cue) void preload(cue).then(() => updateCache())
  }

  function preload(cue: Cue): Promise<boolean> {
    // 음원 없음(설정만 가져온 큐)이나 손상된 음원은 다시 지정하기 전에는 준비할 수 없다
    if (!cue.audioId || get().failedAudio[cue.audioId]) return Promise.resolve(false)
    if (audioEngine.isLoaded(cue.audioId)) {
      if (!get().readyAudioIds[cue.audioId]) set({ readyAudioIds: { ...get().readyAudioIds, [cue.audioId]: true } })
      return Promise.resolve(true)
    }
    const existing = inflight.get(cue.audioId)
    if (existing) return existing
    const audioId = cue.audioId
    const p = loadCueAudio(cue)
      .then(
        () => {
          set({ readyAudioIds: { ...get().readyAudioIds, [audioId]: true } })
          return true
        },
        (err: unknown) => {
          const reason = describeAudioError(err)
          set({
            failedAudio: { ...get().failedAudio, [audioId]: reason },
            error: `"${cue.name}" 음원을 읽을 수 없습니다: ${reason} 다른 큐는 그대로 재생할 수 있습니다.`,
          })
          return false
        },
      )
      .finally(() => inflight.delete(audioId))
    inflight.set(audioId, p)
    return p
  }

  /** 기다리던 재생 요청 취소 (정지, 패닉, 일시정지/이어 재생 등 다른 조작이 들어왔을 때) */
  function cancelPending(): void {
    requestSeq++
    if (get().waitingCueId) set({ waitingCueId: null })
  }

  /** 음원이 준비되면 run을 실행. 기다리는 동안 새 요청이 오면 마지막 요청만 실행한다 */
  function whenReady(cue: Cue, run: () => void): void {
    if (audioEngine.isLoaded(cue.audioId)) {
      cancelPending()
      run()
      return
    }
    const seq = ++requestSeq
    set({ waitingCueId: cue.id })
    void preload(cue).then((ok) => {
      if (seq !== requestSeq) return
      set({ waitingCueId: null })
      if (ok) run()
      updateCache()
    })
  }

  /** 큐를 지정한 지점부터 재생하고 "마지막 시작 지점"으로 기억한다 (대기 큐는 그대로) */
  function startAt(point: StartPoint, afterStart?: () => void): void {
    const cue = cues().find((c) => c.id === point.cueId)
    if (!cue) return
    if (!cue.audioId) {
      set({ error: `"${cue.name}"은(는) 음원이 없습니다. 큐 메뉴의 "음원 파일 지정"으로 파일을 다시 지정하세요.` })
      return
    }
    if (get().failedAudio[cue.audioId]) {
      set({ error: `"${cue.name}" 음원이 손상되어 재생할 수 없습니다: ${get().failedAudio[cue.audioId]}` })
      return
    }
    set({ lastStart: point })
    whenReady(cue, () => {
      try {
        audioEngine.play(cue, point.position, point.options)
        set({ playingCueId: cue.id, error: null })
        afterStart?.()
      } catch (err) {
        set({ error: `"${cue.name}" 재생 실패: ${err instanceof Error ? err.message : String(err)}` })
      }
    })
  }

  function standbyAfter(index: number): string | null {
    return cues()[index + 1]?.id ?? null
  }

  function playCue(cue: Cue): void {
    const s = useSettingsStore.getState()
    const active = audioEngine.getSnapshot().state
    const fadePrevious = s.goMode === 'fade' && (active === 'playing' || active === 'fading')
    try {
      audioEngine.play(cue, undefined, fadePrevious ? { fadePreviousSeconds: s.fadeOutSeconds } : undefined)
      set({ playingCueId: cue.id, error: null })
    } catch (err) {
      set({ error: `"${cue.name}" 재생 실패: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return {
    standbyCueId: null,
    playingCueId: null,
    readyAudioIds: {},
    waitingCueId: null,
    selectedCueId: null,
    cursor: null,
    lastStart: null,
    error: null,
    notice: null,
    failedAudio: {},

    setStandby(id, select = true) {
      const i = indexOf(id)
      set({ standbyCueId: i >= 0 ? id : null })
      if (select && i >= 0) set({ selectedCueId: id })
      updateCache()
    },

    select(id) {
      set({ selectedCueId: indexOf(id) >= 0 ? id : null })
      updateCache()
    },

    playFrom(cueId, position) {
      const cue = cues().find((c) => c.id === cueId)
      if (!cue) return
      const from = position ?? cue.inPoint
      startAt({ cueId, position: from, label: `${cue.name} ${formatSec(from)}` })
    },

    setCursor(cueId, time) {
      set({ cursor: { cueId, time } })
    },

    positionOf(cueId) {
      const cue = cues().find((c) => c.id === cueId)
      if (!cue) return 0
      const snap = audioEngine.getSnapshot()
      if (snap.state !== 'stopped' && get().playingCueId === cueId) return audioEngine.getPosition()
      const c = get().cursor
      return c && c.cueId === cueId ? c.time : cue.inPoint
    },

    playMarker(cueId, markerId) {
      const cue = cues().find((c) => c.id === cueId)
      const marker = cue?.markers.find((m) => m.id === markerId)
      if (!cue || !marker) return
      const out = cue.outPoint ?? useProjectStore.getState().audio[cue.audioId]?.duration ?? Infinity
      if (marker.time >= out - 0.05) {
        set({ error: `"${marker.name}"이(가) 아웃 포인트 뒤에 있어 재생할 수 없습니다` })
        return
      }
      const preroll = useSettingsStore.getState().prerollSeconds
      const from = Math.max(cue.inPoint, marker.time - preroll)
      const beforeIn = marker.time < cue.inPoint
      // 프리롤 구간이 있으면 자연스럽게, 마커에서 바로 시작하면 딸깍 소리만 막는다
      const startFade = from < marker.time ? Math.min(PREROLL_START_FADE, marker.time - from) : MARKER_START_FADE
      startAt(
        {
          cueId,
          position: from,
          options: { ignoreFadeIn: true, startFade },
          markerId,
          label: `${cue.name} · ${marker.name}${from < marker.time ? ` (프리롤 ${formatSec(marker.time - from)})` : ''}`,
        },
        beforeIn ? () => showNotice(`"${marker.name}"이(가) 인 포인트보다 앞에 있어 인 포인트부터 재생합니다`) : undefined,
      )
    },

    playAdjacentMarker(cueId, dir) {
      const cue = cues().find((c) => c.id === cueId)
      if (!cue || cue.markers.length === 0) return
      const playing = audioEngine.getSnapshot().state !== 'stopped' && get().playingCueId === cueId
      const last = get().lastStart
      // 기준 위치: 재생 중이면 지금 위치, 아니면 마지막으로 시작한 마커(없으면 커서)
      const lastMarker = last?.cueId === cueId ? cue.markers.find((m) => m.id === last.markerId) : undefined
      // 기준 위치: 재생 중이면 지금 위치(프리롤 구간이면 시작한 마커), 아니면 마지막으로 시작한 마커(없으면 커서)
      let ref = playing ? audioEngine.getPosition() : (lastMarker?.time ?? get().positionOf(cueId))
      if (playing && lastMarker && ref < lastMarker.time) ref = lastMarker.time
      const sorted = cue.markers
      let target: Marker | undefined
      if (dir > 0) target = sorted.find((m) => m.time > ref + 0.05)
      else {
        // 재생 중에는 마커를 막 지난 직후(1초 안)면 그 앞 마커로 간다
        const tolerance = playing ? 1 : 0.001
        target =
          [...sorted].reverse().find((m) => m.time < ref - tolerance) ??
          // 앞 마커가 없으면 지금 구간의 마커부터 다시
          [...sorted].reverse().find((m) => m.time <= ref + 0.001)
      }
      if (target) get().playMarker(cueId, target.id)
    },

    restartLast() {
      const last = get().lastStart
      if (last) startAt(last)
    },

    addMarkerHere() {
      const snap = audioEngine.getSnapshot()
      const { playingCueId, selectedCueId } = get()
      const cueId = snap.state !== 'stopped' && playingCueId ? playingCueId : selectedCueId
      if (!cueId) return null
      return useProjectStore.getState().addMarker(cueId, get().positionOf(cueId))
    },

    previewAround(cueId, center) {
      const cue = cues().find((c) => c.id === cueId)
      const duration = cue && audioEngine.getDuration(cue.audioId)
      if (!cue || !duration) return
      try {
        audioEngine.play({
          audioId: cue.audioId,
          inPoint: Math.max(0, center - 1.5),
          outPoint: Math.min(duration, center + 1.5),
          fadeIn: 0.02,
          fadeOut: 0.15,
          volumeDb: cue.volumeDb,
        })
        // 큐 그대로의 재생이 아니므로 재생 중인 큐로 표시하지 않는다
        set({ playingCueId: null })
      } catch {
        /* 너무 짧은 구간 등은 무시 */
      }
    },

    moveStandby(delta) {
      const list = cues()
      if (list.length === 0) return
      const i = indexOf(get().standbyCueId)
      // 목록 끝을 지나 대기 큐가 없을 때: 위로 가면 마지막 큐
      const base = i >= 0 ? i : delta < 0 ? list.length : -1
      const next = Math.min(list.length - 1, Math.max(0, base + delta))
      get().setStandby(list[next].id)
    },

    go() {
      const i = indexOf(get().standbyCueId)
      if (i < 0) return
      const cue = cues()[i]
      if (!cue.audioId) {
        set({ error: `"${cue.name}"은(는) 음원이 없어 재생할 수 없습니다. 큐 메뉴의 "음원 파일 지정"으로 파일을 다시 지정하세요.` })
        return
      }
      // 앞선 재생 요청이 디코딩을 기다리는 중이면 GO를 무시한다 (연타로 큐를 건너뛰지 않게)
      if (get().waitingCueId) return
      if (get().failedAudio[cue.audioId]) {
        set({
          standbyCueId: standbyAfter(i),
          error: `"${cue.name}" 음원이 손상되어 건너뜁니다: ${get().failedAudio[cue.audioId]} 다음 GO는 그다음 큐를 재생합니다.`,
        })
        updateCache()
        return
      }
      const next = standbyAfter(i)
      set({ lastStart: { cueId: cue.id, position: cue.inPoint, label: `${cue.name} 처음` }, standbyCueId: next })
      whenReady(cue, () => playCue(cue))
      updateCache()
    },

    stop() {
      cancelPending()
      audioEngine.stop()
    },

    togglePause() {
      cancelPending()
      const st = audioEngine.getSnapshot().state
      if (st === 'playing') audioEngine.pause()
      else if (st === 'paused') audioEngine.resume()
    },

    fadeOutStop() {
      cancelPending()
      audioEngine.fadeOutAndStop(useSettingsStore.getState().fadeOutSeconds)
    },

    panic() {
      cancelPending()
      audioEngine.panic()
    },

    seek(position) {
      audioEngine.seek(position)
    },

    clearError() {
      set({ error: null })
    },

    setAudioHealth(audioId, error) {
      const failed = { ...get().failedAudio }
      if (error) failed[audioId] = error
      else delete failed[audioId]
      set({ failedAudio: failed })
    },
  }
})

// 엔진이 정지 상태가 되면 재생 중 큐 표시를 지우고, 멈춘 위치를 커서로 남긴다
let lastActive: { cueId: string; time: number } | null = null
audioEngine.subscribe((snap) => {
  const { playingCueId } = usePlayerStore.getState()
  if (snap.state !== 'stopped') {
    if (playingCueId) lastActive = { cueId: playingCueId, time: snap.position }
    return
  }
  if (playingCueId) usePlayerStore.setState({ playingCueId: null })
  if (lastActive) {
    usePlayerStore.setState({ cursor: lastActive })
    lastActive = null
  }
})

/** 음원을 읽지 못한 이유를 사람이 알 수 있게 */
export function describeAudioError(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  const msg = err instanceof Error ? err.message : String(err)
  if (/저장된 음원 파일을 찾을 수 없습니다/.test(msg)) return '기기에 저장된 음원 파일이 없습니다.'
  if (name === 'EncodingError' || /decode|unable to decode/i.test(msg)) return '파일이 손상되었거나 지원하지 않는 형식입니다.'
  if (name === 'NotReadableError') return '저장된 파일을 읽을 수 없습니다.'
  if (/memory|allocation/i.test(msg)) return '메모리가 부족합니다. 다른 앱을 닫고 다시 시도하세요.'
  return msg || '알 수 없는 오류'
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

// 큐 목록이 바뀌면(삭제, 순서 변경, 프로젝트 전환) 대기 큐와 재생 큐를 맞춘다
let prevCues = useProjectStore.getState().cues
let prevProjectId = useProjectStore.getState().currentProjectId
useProjectStore.subscribe((state) => {
  if (state.cues === prevCues && state.currentProjectId === prevProjectId) return
  const projectChanged = state.currentProjectId !== prevProjectId
  const before = prevCues
  prevCues = state.cues
  prevProjectId = state.currentProjectId

  const p = usePlayerStore.getState()
  const list = state.cues
  // 재생 중인 큐가 목록에서 사라지면 정지 (프로젝트 전환, 재생 중인 큐 삭제)
  if (p.playingCueId && !list.some((c) => c.id === p.playingCueId)) {
    audioEngine.stop()
    usePlayerStore.setState({ playingCueId: null, waitingCueId: null })
  }

  // 재생 중인 큐의 설정이 바뀌었으면 지금 나는 소리에 바로 반영
  const playing = p.playingCueId ? list.find((c) => c.id === p.playingCueId) : undefined
  const playingBefore = playing && before.find((c) => c.id === playing.id)
  // 이름/메모/마커만 바뀐 경우는 소리에 영향이 없으므로 건드리지 않는다
  if (playing && !projectChanged && playingBefore && !sameEditValues(pickEditValues(playingBefore), pickEditValues(playing))) {
    audioEngine.applyCueSettings(playing)
  }

  let standby = p.standbyCueId
  if (projectChanged || before.length === 0) {
    // 프로젝트를 열었을 때 / 빈 목록에 처음 불러왔을 때: 첫 큐
    standby = list[0]?.id ?? null
  } else if (standby !== null && !list.some((c) => c.id === standby)) {
    // 대기 큐가 지워졌으면 그 자리에 온 큐 (끝이었으면 마지막 큐)
    const oldIndex = before.findIndex((c) => c.id === standby)
    standby = list[Math.min(oldIndex, list.length - 1)]?.id ?? null
  }
  // 선택한 큐가 사라졌거나(삭제, 프로젝트 전환) 아직 없으면 대기 큐를 선택
  const selectedExists = p.selectedCueId !== null && list.some((c) => c.id === p.selectedCueId)
  if (projectChanged || !selectedExists) usePlayerStore.setState({ selectedCueId: standby })
  usePlayerStore.getState().setStandby(standby, false)
})
