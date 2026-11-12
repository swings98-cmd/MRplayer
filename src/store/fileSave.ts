/**
 * 파일 저장: 데스크톱은 다운로드, 아이패드/아이폰은 공유 시트(→ "파일에 저장").
 * 공유 시트는 사용자 탭 안에서만 열 수 있으므로, 화면이 "저장" 버튼을 보여주고 그 안에서 shareFile을 부른다.
 */

/** 공유 시트로 저장하는 기기인지 (터치 기기 + 파일 공유 지원) */
export function usesShareSheet(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  const touch = navigator.maxTouchPoints > 1
  try {
    return touch && navigator.canShare({ files: [new File([''], 'test.wav', { type: 'audio/wav' })] })
  } catch {
    return false
  }
}

/** 사용자 탭 안에서 호출. 취소하면 false */
export async function shareFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: file.name })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
    throw err
  }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 다운로드가 시작될 시간을 준 뒤 해제
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
