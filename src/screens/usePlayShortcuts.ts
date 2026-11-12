import { useEffect } from 'react'
import { useDialog } from '../store/dialogStore.ts'
import { usePlayerStore } from '../store/playerStore.ts'
import { useProjectStore } from '../store/projectStore.ts'
import { useSettingsStore } from '../store/settingsStore.ts'

/** Esc를 이 시간 안에 두 번 누르면 패닉 */
const DOUBLE_ESC_MS = 400

/** 글자 입력 중인지 (이때는 단축키를 쓰지 않는다) */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file'].includes(type)
  }
  return false
}

/**
 * 플레이 화면 키보드 단축키 (데스크톱).
 * 한글 입력 상태에서도 동작하도록 e.code(물리 키 위치)로 판별한다.
 */
export function usePlayShortcuts(): void {
  useEffect(() => {
    let lastEsc = 0

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) return
      // 확인/입력 창이 떠 있으면 단축키를 쓰지 않는다 (스페이스로 GO가 눌리지 않게)
      if (useDialog.getState().current) return
      const p = usePlayerStore.getState()

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          // 포커스된 버튼이 스페이스로 한 번 더 눌리는 것을 막는다
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          if (!e.repeat) p.go()
          break
        case 'Escape': {
          e.preventDefault()
          const now = performance.now()
          if (now - lastEsc < DOUBLE_ESC_MS) {
            p.panic()
            lastEsc = 0
          } else {
            p.stop()
            lastEsc = now
          }
          break
        }
        case 'KeyP':
          e.preventDefault()
          if (!e.repeat) p.togglePause()
          break
        case 'KeyF':
          e.preventDefault()
          if (!e.repeat) p.fadeOutStop()
          break
        case 'ArrowUp':
          e.preventDefault()
          p.moveStandby(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          p.moveStandby(1)
          break
        case 'KeyM':
          // 지금 위치에 마커 (재생은 끊지 않는다). 공연 모드에서는 막는다
          e.preventDefault()
          if (!e.repeat && !useSettingsStore.getState().performanceMode) p.addMarkerHere()
          break
        case 'KeyR':
          e.preventDefault()
          if (!e.repeat) p.restartLast()
          break
        default: {
          // 1~9: 선택한 큐의 해당 순서 마커부터 재생
          const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
          if (digit && !e.repeat && p.selectedCueId) {
            const cue = useProjectStore.getState().cues.find((c) => c.id === p.selectedCueId)
            const marker = cue?.markers[Number(digit[1]) - 1]
            if (cue && marker) {
              e.preventDefault()
              p.playMarker(cue.id, marker.id)
            }
          }
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])
}
