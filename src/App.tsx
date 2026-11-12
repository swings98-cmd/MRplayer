import { TabBar } from './components/TabBar.tsx'
import { AudioTestScreen } from './screens/AudioTestScreen.tsx' // 임시
import { EditScreen } from './screens/EditScreen.tsx'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { useUiStore } from './store/uiStore.ts'

export default function App() {
  const tab = useUiStore((s) => s.tab)

  return (
    <div className="app">
      <TabBar />
      <main className="screen">
        {tab === 'play' && <PlayScreen />}
        {tab === 'edit' && <EditScreen />}
        {tab === 'test' && <AudioTestScreen />}
      </main>
    </div>
  )
}
