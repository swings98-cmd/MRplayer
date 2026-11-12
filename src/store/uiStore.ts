import { create } from 'zustand'

// 'test'는 임시 오디오 엔진 확인 화면 (확인 후 삭제)
export type Tab = 'play' | 'edit' | 'settings' | 'test'

interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'play',
  setTab: (tab) => set({ tab }),
}))
