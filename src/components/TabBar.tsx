import { useSettingsStore } from '../store/settingsStore.ts'
import { useUiStore, type Tab } from '../store/uiStore.ts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: '플레이' },
  { id: 'edit', label: '편집' },
  { id: 'settings', label: '설정' },
]

export function TabBar() {
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  const performanceMode = useSettingsStore((s) => s.performanceMode)

  return (
    <nav className="tabbar" role="tablist" aria-label="화면 전환">
      {TABS.map((t) => {
        // 공연 모드에서는 편집 탭으로 갈 수 없다
        const locked = performanceMode && t.id === 'edit'
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-disabled={locked}
            disabled={locked}
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {locked ? `🔒 ${t.label}` : t.label}
          </button>
        )
      })}
    </nav>
  )
}
