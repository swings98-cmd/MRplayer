/**
 * 앱 안에서 그리는 확인/입력 창.
 * 브라우저 기본 창(confirm, prompt, alert)은 아이패드 사파리에서 떠 있는 동안 페이지를 멈춰,
 * 재생 중이면 B 경로 <audio>가 마지막 조각을 반복("두두두")한다. 그래서 기본 창을 쓰지 않는다.
 */
import { create } from 'zustand'

export interface DialogRequest {
  /** 창마다 다른 번호 (화면이 새 창으로 다시 그리도록) */
  id: number
  kind: 'confirm' | 'prompt' | 'alert'
  title?: string
  message: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 확인 버튼을 빨간색으로 (삭제 등) */
  danger?: boolean
  resolve: (value: string | boolean | null) => void
}

interface DialogState {
  current: DialogRequest | null
}

export const useDialog = create<DialogState>(() => ({ current: null }))

let nextId = 1

function open(req: Omit<DialogRequest, 'resolve' | 'id'>): Promise<string | boolean | null> {
  // 이미 떠 있는 창이 있으면 취소로 닫고 새 창을 띄운다
  useDialog.getState().current?.resolve(req.kind === 'prompt' ? null : false)
  return new Promise((resolve) => {
    useDialog.setState({
      current: {
        ...req,
        id: nextId++,
        resolve: (v) => {
          useDialog.setState({ current: null })
          resolve(v)
        },
      },
    })
  })
}

interface Options {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export async function askConfirm(message: string, opts: Options = {}): Promise<boolean> {
  return (await open({ kind: 'confirm', message, ...opts })) === true
}

/** 입력 창. 취소하면 null */
export async function askPrompt(message: string, defaultValue = '', opts: Options = {}): Promise<string | null> {
  const v = await open({ kind: 'prompt', message, defaultValue, ...opts })
  return typeof v === 'string' ? v : null
}

export async function showAlert(message: string, opts: Options = {}): Promise<void> {
  await open({ kind: 'alert', message, ...opts })
}
