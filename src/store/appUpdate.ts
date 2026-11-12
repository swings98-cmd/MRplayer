/**
 * 서비스 워커 등록, 새 버전 알림, 오프라인 준비 상태.
 *
 * 새 버전이 배포돼도 자동으로 바꾸지 않는다. needRefresh가 true가 되면 화면이 알림을 띄우고,
 * 사용자가 "업데이트"를 눌렀을 때만 applyUpdate()로 새 버전을 적용(새로고침)한다.
 */
import { registerSW } from 'virtual:pwa-register'
import { create } from 'zustand'

export type OfflineStatus = 'checking' | 'ready' | 'not-ready' | 'unsupported' | 'dev'

interface AppUpdateState {
  /** 새 버전이 받아져서 적용을 기다리는 중 */
  needRefresh: boolean
  /** 사용자가 이번 실행에서 "나중에"를 눌렀는지 */
  dismissed: boolean
  offline: OfflineStatus
  /** 미리 캐시된 파일 수 */
  cachedFiles: number
}

export const useAppUpdate = create<AppUpdateState>(() => ({
  needRefresh: false,
  dismissed: false,
  offline: 'checking',
  cachedFiles: 0,
}))

/** 새 버전을 확인하는 간격 (앱을 켜 둔 동안) */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null
let started = false

export function initServiceWorker(): void {
  if (started) return
  started = true
  if (import.meta.env.DEV) {
    useAppUpdate.setState({ offline: 'dev' })
    return
  }
  if (!('serviceWorker' in navigator)) {
    useAppUpdate.setState({ offline: 'unsupported' })
    return
  }
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useAppUpdate.setState({ needRefresh: true })
    },
    onOfflineReady() {
      void checkOffline()
    },
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update().catch(() => {}), CHECK_INTERVAL_MS)
      void checkOffline()
    },
    onRegisterError() {
      useAppUpdate.setState({ offline: 'not-ready' })
    },
  })
}

/** 새 버전 적용 (새로고침). 재생 중에는 부르지 않는다. */
export function applyUpdate(): void {
  void updateSW?.(true)
}

export function dismissUpdate(): void {
  useAppUpdate.setState({ dismissed: true })
}

/** 서비스 워커가 앱 파일을 모두 미리 캐시했는지 확인 */
export async function checkOffline(): Promise<void> {
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || !('caches' in window)) return
  try {
    await navigator.serviceWorker.ready
    const names = await caches.keys()
    let files = 0
    let hasIndex = false
    for (const name of names.filter((n) => n.includes('precache'))) {
      const reqs = await (await caches.open(name)).keys()
      files += reqs.length
      if (reqs.some((r) => new URL(r.url).pathname.endsWith('/index.html'))) hasIndex = true
    }
    useAppUpdate.setState({ offline: hasIndex ? 'ready' : 'not-ready', cachedFiles: files })
  } catch {
    useAppUpdate.setState({ offline: 'not-ready' })
  }
}

export function buildInfo(): { time: Date; commit: string } {
  return { time: new Date(__BUILD_TIME__), commit: __BUILD_COMMIT__ }
}
