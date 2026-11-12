/** "음원 없음"인 큐에 파일을 다시 지정하는 버튼 (설정만 가져온 프로젝트) */
import { useRef, useState } from 'react'
import { showAlert } from '../store/dialogStore.ts'
import { useEngineState } from './useEngine.ts'
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
  // 재생 안정성: 재생 중에는 새 음원 디코딩을 하지 않는다
  const playing = useEngineState() !== 'stopped'

  return (
    <>
      <button
        className={className}
        disabled={busy || playing}
        title={playing ? '재생 중에는 지정할 수 없습니다' : undefined}
        onClick={() => input.current?.click()}
      >
        {busy ? '불러오는 중…' : playing ? `${label} (정지 후)` : label}
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
            void showAlert(`"${file.name}"을(를) 큐 ${linked}개에 연결했습니다.${warning ? `\n\n⚠️ ${warning}` : ''}`)
          } catch (err) {
            void showAlert(`음원을 지정하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}
