import { useEffect } from 'react'
import { AppErrorBanner, ReconnectBanner, UpdateBanner } from './components/Banners.tsx'
import { DialogHost } from './components/DialogHost.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { TabBar } from './components/TabBar.tsx'
import { usePerformanceGuards } from './components/usePerformanceGuards.ts'
import { EditScreen } from './screens/EditScreen.tsx'
import { PlayScreen } from './screens/PlayScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { installGlobalErrorHandlers } from './store/appErrors.ts'
import { initServiceWorker } from './store/appUpdate.ts'
import { initMediaSession } from './store/mediaSession.ts'
import { useProjectStore } from './store/projectStore.ts'
import { useSettingsStore } from './store/settingsStore.ts'
import { useStorageStore } from './store/storageStore.ts'
import { useUiStore } from './store/uiStore.ts'
import { initWakeLock } from './store/wakeLock.ts'

export default function App() {
  const tab = useUiStore((s) => s.tab)
  const performanceMode = useSettingsStore((s) => s.performanceMode)
  usePerformanceGuards(performanceMode)

  useEffect(() => {
    installGlobalErrorHandlers()
    initServiceWorker()
    void useSettingsStore.getState().init()
    void useStorageStore.getState().init()
    void useProjectStore.getState().init()
    initWakeLock()
    initMediaSession()
  }, [])

  // 공연 모드에서는 편집 탭에 있을 수 없다
  useEffect(() => {
    if (performanceMode && tab === 'edit') useUiStore.getState().setTab('play')
  }, [performanceMode, tab])

  return (
    <div className="app">
      <ReconnectBanner />
      <AppErrorBanner />
      <UpdateBanner />
      <TabBar />
      <main className="screen">
        {tab === 'play' && (
          <ErrorBoundary name="플레이">
            <PlayScreen />
          </ErrorBoundary>
        )}
        {tab === 'edit' && (
          <ErrorBoundary name="편집">
            <EditScreen />
          </ErrorBoundary>
        )}
        {tab === 'settings' && (
          <ErrorBoundary name="설정">
            <SettingsScreen />
          </ErrorBoundary>
        )}
      </main>
      <DialogHost />
    </div>
  )
}
