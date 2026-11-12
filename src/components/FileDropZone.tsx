import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  disabled?: boolean
  children: ReactNode
}

/**
 * 파일을 끌어다 놓을 수 있는 영역. 끌고 있는 동안 안내 오버레이를 보여준다.
 * 영역 밖에 떨어뜨려도 브라우저가 파일을 열어 버리지 않도록 화면 전체에서 기본 동작을 막는다.
 */
export function FileDropZone({ onFiles, disabled, children }: Props) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')

  return (
    <div
      className="dropzone"
      onDragEnter={(e) => {
        if (!hasFiles(e) || disabled) return
        depth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        if (disabled) return
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onFiles(files)
      }}
    >
      {children}
      {dragging && <div className="dropzone-overlay">여기에 놓으면 불러옵니다</div>}
    </div>
  )
}
