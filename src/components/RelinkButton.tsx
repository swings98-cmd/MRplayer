/** "음원 없음"인 큐에 파일을 다시 지정하는 버튼 (설정만 가져온 프로젝트) */
import { useRef, useState } from 'react'
import { AUDIO_ACCEPT, useProjectStore } from '../store/projectStore.ts'
import { useStorageStore } from '../store/storageStore.ts'

interface Props {
  cueId: string
  className?: string
  label?: string
}

export function RelinkButton({ cueId, className = 'btn btn-primary', label = '음원 파일 지정' }: Props) {
  const relinkAudio = useProjectStore((s) => s.relinkAudio)
  const refreshEstimate = useStorageStore((s) => s.refreshEstimate)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button className={className} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '불러오는 중…' : label}
      </button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            const { linked, warning } = await relinkAudio(cueId, file)
            void refreshEstimate()
            window.alert(`"${file.name}"을(를) 큐 ${linked}개에 연결했습니다.${warning ? `\n\n⚠️ ${warning}` : ''}`)
          } catch (err) {
            window.alert(`음원을 지정하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}
