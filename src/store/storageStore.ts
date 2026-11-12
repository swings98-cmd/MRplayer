/**
 * 브라우저 저장 공간 상태: 영구 저장 허용 여부(navigator.storage.persist)와 사용량.
 */
import { create } from 'zustand'

/** granted: 허용됨, denied: 거부됨(브라우저가 지울 수 있음), unsupported: 이 브라우저는 지원 안 함 */
export type PersistStatus = 'unknown' | 'granted' | 'denied' | 'unsupported'

interface StorageState {
  persist: PersistStatus
  usage: number | null
  quota: number | null
  /** 앱 시작 시 한 번: 이미 허용됐는지 보고, 아니면 요청 */
  init(): Promise<void>
  /** 다시 요청 (버튼 탭 안에서 호출) */
  requestPersist(): Promise<void>
  refreshEstimate(): Promise<void>
}

const storage = (): StorageManager | undefined =>
  typeof navigator !== 'undefined' ? navigator.storage : undefined

export const useStorageStore = create<StorageState>((set, get) => ({
  persist: 'unknown',
  usage: null,
  quota: null,

  init() {
    initPromise ??= initOnce(set, get)
    return initPromise
  },

  async requestPersist() {
    const s = storage()
    if (!s || typeof s.persist !== 'function') return
    try {
      set({ persist: (await s.persist()) ? 'granted' : 'denied' })
    } catch {
      set({ persist: 'denied' })
    }
  },

  async refreshEstimate() {
    const s = storage()
    if (!s || typeof s.estimate !== 'function') return
    try {
      const e = await s.estimate()
      set({ usage: e.usage ?? null, quota: e.quota ?? null })
    } catch {
      /* 무시 */
    }
  },
}))

let initPromise: Promise<void> | null = null

/** 이미 허용됐는지 보고, 아니면 요청한 뒤 사용량을 읽는다 (한 번만) */
async function initOnce(
  set: (s: Partial<StorageState>) => void,
  get: () => StorageState,
): Promise<void> {
  const s = storage()
  if (!s || typeof s.persist !== 'function') {
    set({ persist: 'unsupported' })
  } else {
    try {
      const already = typeof s.persisted === 'function' ? await s.persisted() : false
      set({ persist: already ? 'granted' : (await s.persist()) ? 'granted' : 'denied' })
    } catch {
      set({ persist: 'denied' })
    }
  }
  await get().refreshEstimate()
}
