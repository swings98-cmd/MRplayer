import { useEffect } from 'react'

/**
 * 공연 모드일 때 브라우저 기본 동작으로 화면이 바뀌거나 메뉴가 뜨는 것을 막는다.
 * - 뒤로 가기(버튼, 가장자리 쓸기): 기록을 하나 더 쌓아 두고 뒤로 가면 다시 쌓는다
 * - 새로고침/닫기(데스크톱): 확인 창
 * - 당겨서 새로고침, 텍스트 선택, 길게 눌러 뜨는 메뉴: CSS(.perf-mode)와 이벤트 차단
 */
export function usePerformanceGuards(on: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    if (!on) {
      root.classList.remove('perf-mode')
      return
    }
    root.classList.add('perf-mode')
    history.pushState({ perfMode: true }, '')

    const onPopState = () => history.pushState({ perfMode: true }, '')
    const prevent = (e: Event) => e.preventDefault()
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('contextmenu', prevent)
    document.addEventListener('selectstart', prevent)
    return () => {
      root.classList.remove('perf-mode')
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('contextmenu', prevent)
      document.removeEventListener('selectstart', prevent)
    }
  }, [on])
}
