/**
 * 앱 전체 오류 알림. 저장 실패, 예상하지 못한 오류 등을 화면 위쪽 배너로 보여준다.
 * 오류가 나도 앱(특히 재생)은 계속 동작해야 한다.
 */
import { create } from 'zustand'

export interface AppError {
  id: number
  text: string
}

interface AppErrorsState {
  errors: AppError[]
  report(text: string): void
  dismiss(id: number): void
}

let nextId = 1

export const useAppErrors = create<AppErrorsState>((set, get) => ({
  errors: [],
  report(text) {
    // 같은 내용이 이미 떠 있으면 다시 쌓지 않는다
    if (get().errors.some((e) => e.text === text)) return
    set({ errors: [...get().errors, { id: nextId++, text }].slice(-3) })
  },
  dismiss(id) {
    set({ errors: get().errors.filter((e) => e.id !== id) })
  },
}))

export function reportError(text: string): void {
  useAppErrors.getState().report(text)
}

/** 저장 공간 부족 오류인지 (IndexedDB QuotaExceededError 등) */
export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? ''
  const msg = err instanceof Error ? err.message : String(err)
  return name === 'QuotaExceededError' || /quota|disk|space|storage.*full/i.test(msg)
}

export const QUOTA_MESSAGE =
  '저장 공간이 부족합니다. 아이패드 저장 공간을 비우거나, 쓰지 않는 프로젝트를 내보내기(백업)한 뒤 삭제하세요.'

/** 저장 실패를 사람이 알 수 있는 문장으로 */
export function describeSaveError(err: unknown): string {
  if (isQuotaError(err)) return QUOTA_MESSAGE
  return err instanceof Error ? err.message || err.name : String(err)
}

let installed = false

/** 처리되지 않은 오류도 배너로 알린다 (앱이 조용히 멈춘 것처럼 보이지 않게) */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const ignore = (msg: string) => /ResizeObserver loop|AbortError|The play\(\) request was interrupted/.test(msg)
  window.addEventListener('error', (e) => {
    const msg = e.error instanceof Error ? e.error.message : e.message
    if (msg && !ignore(msg)) reportError(`예상하지 못한 오류가 났습니다: ${msg} (재생은 계속됩니다)`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const msg = r instanceof Error ? `${r.name}: ${r.message}` : String(r)
    if (isQuotaError(r)) reportError(QUOTA_MESSAGE)
    else if (!ignore(msg)) reportError(`예상하지 못한 오류가 났습니다: ${msg} (재생은 계속됩니다)`)
  })
}
