import { create } from 'zustand'

export type Tab = 'play' | 'edit' | 'settings'

interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'play',
  setTab: (tab) => set({ tab }),
}))
