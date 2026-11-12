import { useUiStore, type Tab } from '../store/uiStore.ts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: '플레이' },
  { id: 'edit', label: '편집' },
]

export function TabBar() {
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)

  return (
    <nav className="tabbar" role="tablist" aria-label="화면 전환">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={tab === t.id ? 'tab active' : 'tab'}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
