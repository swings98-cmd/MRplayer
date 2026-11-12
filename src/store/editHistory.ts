/**
 * 편집 실행 취소/다시 실행 기록 (큐마다 따로, 앱을 켜 둔 동안만).
 * 슬라이더를 끄는 것처럼 짧은 시간 안에 이어지는 변경은 한 번으로 묶는다.
 */
import { create } from 'zustand'
import type { EditValues } from './cueRules.ts'

/** 이 시간 안에 이어진 변경은 실행 취소 한 번으로 묶는다 */
const MERGE_MS = 700
const MAX_STEPS = 100

interface Stacks {
  undo: EditValues[]
  redo: EditValues[]
  lastAt: number
}

interface HistoryState {
  /** 화면 갱신용: 기록이 바뀔 때마다 1씩 증가 */
  version: number
  stacks: Record<string, Stacks>
  /** 값을 바꾸기 직전에 호출 (before = 바꾸기 전 값) */
  record(cueId: string, before: EditValues): void
  /** 되돌릴 값. 없으면 null */
  undo(cueId: string, current: EditValues): EditValues | null
  redo(cueId: string, current: EditValues): EditValues | null
  /** 다음 변경은 새 단계로 기록되게 한다 (핸들을 놓았을 때 등) */
  cut(cueId: string): void
}

const empty = (): Stacks => ({ undo: [], redo: [], lastAt: 0 })

export const useEditHistory = create<HistoryState>((set, get) => {
  const update = (cueId: string, s: Stacks) =>
    set({ stacks: { ...get().stacks, [cueId]: s }, version: get().version + 1 })

  return {
    version: 0,
    stacks: {},

    record(cueId, before) {
      const s = get().stacks[cueId] ?? empty()
      const now = performance.now()
      const undo = now - s.lastAt > MERGE_MS ? [...s.undo, before].slice(-MAX_STEPS) : s.undo
      update(cueId, { undo, redo: [], lastAt: now })
    },

    undo(cueId, current) {
      const s = get().stacks[cueId]
      if (!s || s.undo.length === 0) return null
      const prev = s.undo[s.undo.length - 1]
      update(cueId, { undo: s.undo.slice(0, -1), redo: [...s.redo, current], lastAt: 0 })
      return prev
    },

    redo(cueId, current) {
      const s = get().stacks[cueId]
      if (!s || s.redo.length === 0) return null
      const next = s.redo[s.redo.length - 1]
      update(cueId, { undo: [...s.undo, current], redo: s.redo.slice(0, -1), lastAt: 0 })
      return next
    },

    cut(cueId) {
      const s = get().stacks[cueId]
      if (s) update(cueId, { ...s, lastAt: 0 })
    },
  }
})
