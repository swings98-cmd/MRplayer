import { useEffect } from 'react'
import { TabBar } from './components/TabBar.tsx'
import { AudioTestScreen } from './screens/AudioTestScreen.tsx' // 임시
import { EditScreen } from './screens/EditScreen.tsx'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { useProjectStore } from './store/projectStore.ts'
import { useStorageStore } from './store/storageStore.ts'
import { useUiStore } from './store/uiStore.ts'

export default function App() {
  const tab = useUiStore((s) => s.tab)

  useEffect(() => {
    void useStorageStore.getState().init()
    void useProjectStore.getState().init()
  }, [])

  return (
    <div className="app">
      <TabBar />
      <main className="screen">
        {tab === 'play' && <PlayScreen />}
        {tab === 'edit' && <EditScreen />}
        {tab === 'settings' && <SettingsScreen />}
        {tab === 'test' && <AudioTestScreen />}
      </main>
    </div>
  )
}
