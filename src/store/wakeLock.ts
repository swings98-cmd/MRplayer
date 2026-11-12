/**
 * 재생 중 화면 꺼짐 방지 (Screen Wake Lock API).
 * 설정이 켜져 있고 재생/페이드/일시정지 중이면 잠금을 걸고, 정지하면 푼다.
 * 화면이 가려지면 브라우저가 잠금을 풀기 때문에, 다시 보일 때 자동으로 다시 건다.
 */
import { create } from 'zustand'
import { audioEngine } from '../audio/index.ts'
import { useSettingsStore } from './settingsStore.ts'

interface WakeLockState {
  supported: boolean
  /** 지금 화면 꺼짐 방지가 걸려 있는지 */
  active: boolean
  error: string | null
}

const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

export const useWakeLock = create<WakeLockState>(() => ({ supported, active: false, error: null }))

let sentinel: WakeLockSentinel | null = null
let requesting = false
let started = false

function wanted(): boolean {
  return (
    useSettingsStore.getState().keepScreenOn &&
    audioEngine.getSnapshot().state !== 'stopped' &&
    document.visibilityState === 'visible'
  )
}

async function sync(): Promise<void> {
  if (!supported) return
  if (wanted()) {
    if (sentinel || requesting) return
    requesting = true
    try {
      const s = await navigator.wakeLock.request('screen')
      requesting = false
      if (!wanted()) {
        // 기다리는 사이에 정지됐으면 바로 푼다
        void s.release()
        return
      }
      sentinel = s
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null
        useWakeLock.setState({ active: false })
      })
      useWakeLock.setState({ active: true, error: null })
    } catch (err) {
      requesting = false
      useWakeLock.setState({ active: false, error: err instanceof Error ? err.message : String(err) })
    }
  } else if (sentinel) {
    const s = sentinel
    sentinel = null
    useWakeLock.setState({ active: false })
    await s.release().catch(() => {})
  }
}

export function initWakeLock(): void {
  if (started || !supported) return
  started = true
  let lastState = audioEngine.getSnapshot().state
  audioEngine.subscribe((snap) => {
    if (snap.state !== lastState) {
      lastState = snap.state
      void sync()
    }
  })
  useSettingsStore.subscribe((s, prev) => {
    if (s.keepScreenOn !== prev.keepScreenOn) void sync()
  })
  document.addEventListener('visibilitychange', () => void sync())
  void sync()
}
