/**
 * 플레이 상태: 대기 큐, 재생 중인 큐, GO/정지 등 조작, 디코딩 캐시 관리.
 *
 * 디코딩 캐시: [재생/일시정지 중인 큐, 대기 큐, 그다음 큐]의 음원만 메모리에 둔다.
 * 대기 큐와 다음 큐는 미리 디코딩해서 GO를 누르면 바로 나오게 하고,
 * 나머지는 해제해서 아이패드 메모리가 넘치지 않게 한다.
 */
import { create } from 'zustand'
import { audioEngine } from '../audio/index.ts'
import { loadCueAudio, useProjectStore } from './projectStore.ts'
import { useSettingsStore } from './settingsStore.ts'
import type { Cue } from './types.ts'

interface PlayerState {
  /** 다음에 GO 하면 나올 큐. 목록 끝까지 갔으면 null */
  standbyCueId: string | null
  /** 재생/페이드/일시정지 중인 큐 */
  playingCueId: string | null
  /** 미리 디코딩이 끝난 음원 id */
  readyAudioIds: Record<string, true>
  /** GO를 눌렀는데 아직 디코딩 중인 큐 */
  waitingCueId: string | null
  error: string | null

  setStandby(id: string | null): void
  moveStandby(delta: number): void
  go(): void
  stop(): void
  togglePause(): void
  fadeOutStop(): void
  panic(): void
  seek(position: number): void
  clearError(): void
}

const cues = (): Cue[] => useProjectStore.getState().cues
const indexOf = (id: string | null): number => (id ? cues().findIndex((c) => c.id === id) : -1)

/** 재생/일시정지/페이드 중인지 */
export function isEngineActive(): boolean {
  return audioEngine.getSnapshot().state !== 'stopped'
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  const loading = new Set<string>()

  function updateCache(): void {
    const list = cues()
    const keepCues = new Set<string>()
    const { standbyCueId, playingCueId } = get()
    const si = indexOf(standbyCueId)
    if (si >= 0) {
      keepCues.add(list[si].id)
      if (list[si + 1]) keepCues.add(list[si + 1].id)
    }
    if (playingCueId) keepCues.add(playingCueId)

    const keepAudio = new Set(list.filter((c) => keepCues.has(c.id)).map((c) => c.audioId))
    // 재생 중인 음원은 큐가 목록에서 사라졌어도 엔진이 쓰고 있을 수 있으므로 남긴다
    const engineAudio = audioEngine.getSnapshot().audioId
    if (engineAudio) keepAudio.add(engineAudio)

    // 멀리 떨어진 음원 해제
    let changed = false
    const ready = { ...get().readyAudioIds }
    for (const id of audioEngine.loadedIds()) {
      if (!keepAudio.has(id)) {
        audioEngine.unload(id)
        delete ready[id]
        changed = true
      }
    }
    if (changed) set({ readyAudioIds: ready })

    // 필요한 음원 미리 디코딩 (대기 큐 먼저)
    const order = [standbyCueId, list[si + 1]?.id, playingCueId]
    for (const cueId of order) {
      const cue = list.find((c) => c.id === cueId)
      if (cue) void preload(cue)
    }
  }

  async function preload(cue: Cue): Promise<boolean> {
    if (audioEngine.isLoaded(cue.audioId)) {
      if (!get().readyAudioIds[cue.audioId]) set({ readyAudioIds: { ...get().readyAudioIds, [cue.audioId]: true } })
      return true
    }
    if (loading.has(cue.audioId)) return false
    loading.add(cue.audioId)
    try {
      await loadCueAudio(cue)
      set({ readyAudioIds: { ...get().readyAudioIds, [cue.audioId]: true } })
      return true
    } catch (err) {
      set({ error: `"${cue.name}" 음원을 준비하지 못했습니다: ${err instanceof Error ? err.message : String(err)}` })
      return false
    } finally {
      loading.delete(cue.audioId)
    }
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
    error: null,

    setStandby(id) {
      const i = indexOf(id)
      set({ standbyCueId: i >= 0 ? id : null })
      updateCache()
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
      const next = standbyAfter(i)

      if (audioEngine.isLoaded(cue.audioId)) {
        playCue(cue)
        set({ standbyCueId: next, waitingCueId: null })
        updateCache()
        return
      }
      // 아직 디코딩 중: 끝나는 대로 재생 (다른 조작이 끼어들면 취소)
      set({ standbyCueId: next, waitingCueId: cue.id })
      void preload(cue).then((ok) => {
        if (ok && get().waitingCueId === cue.id) playCue(cue)
        if (get().waitingCueId === cue.id) set({ waitingCueId: null })
        updateCache()
      })
    },

    stop() {
      set({ waitingCueId: null })
      audioEngine.stop()
    },

    togglePause() {
      const st = audioEngine.getSnapshot().state
      if (st === 'playing') audioEngine.pause()
      else if (st === 'paused') audioEngine.resume()
    },

    fadeOutStop() {
      set({ waitingCueId: null })
      audioEngine.fadeOutAndStop(useSettingsStore.getState().fadeOutSeconds)
    },

    panic() {
      set({ waitingCueId: null })
      audioEngine.panic()
    },

    seek(position) {
      audioEngine.seek(position)
    },

    clearError() {
      set({ error: null })
    },
  }
})

// 엔진이 정지 상태가 되면 재생 중 큐 표시를 지운다
audioEngine.subscribe((snap) => {
  const { playingCueId } = usePlayerStore.getState()
  if (snap.state === 'stopped' && playingCueId) usePlayerStore.setState({ playingCueId: null })
})

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

  let standby = p.standbyCueId
  if (projectChanged || before.length === 0) {
    // 프로젝트를 열었을 때 / 빈 목록에 처음 불러왔을 때: 첫 큐
    standby = list[0]?.id ?? null
  } else if (standby !== null && !list.some((c) => c.id === standby)) {
    // 대기 큐가 지워졌으면 그 자리에 온 큐 (끝이었으면 마지막 큐)
    const oldIndex = before.findIndex((c) => c.id === standby)
    standby = list[Math.min(oldIndex, list.length - 1)]?.id ?? null
  }
  usePlayerStore.getState().setStandby(standby)
})
