import { audioEngine } from '../audio/index.ts'
import { applyUpdate, dismissUpdate, useAppUpdate } from '../store/appUpdate.ts'
import { useEngineState, useNeedsReconnect } from './useEngine.ts'

/** 오디오가 끊겼을 때(화면 복귀, 전화·알람·다른 앱 소리) 화면 맨 위에 뜨는 배너 */
export function ReconnectBanner() {
  const needs = useNeedsReconnect()
  if (!needs) return null
  return (
    <button className="banner banner-reconnect" onClick={() => audioEngine.unlock()}>
      🔇 오디오 연결이 끊겼습니다 — <b>탭해서 오디오 다시 연결</b>
    </button>
  )
}

/** 새 버전 알림. 재생 중에는 띄우지 않는다. */
export function UpdateBanner() {
  const { needRefresh, dismissed } = useAppUpdate()
  const state = useEngineState()
  if (!needRefresh || dismissed || state !== 'stopped') return null
  return (
    <div className="banner banner-update" role="status">
      <span>새 버전이 있습니다.</span>
      <button className="btn small-btn btn-primary" onClick={applyUpdate}>
        업데이트
      </button>
      <button className="btn small-btn" onClick={dismissUpdate}>
        나중에
      </button>
    </div>
  )
}
