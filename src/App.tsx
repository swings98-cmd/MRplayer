import { TabBar } from './components/TabBar.tsx'
import { EditScreen } from './screens/EditScreen.tsx'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { useUiStore } from './store/uiStore.ts'

export default function App() {
  const tab = useUiStore((s) => s.tab)

  return (
    <div className="app">
      <TabBar />
      <main className="screen">{tab === 'play' ? <PlayScreen /> : <EditScreen />}</main>
    </div>
  )
}
