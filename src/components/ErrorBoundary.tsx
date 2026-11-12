import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../store/appErrors.ts'

interface Props {
  /** 화면 이름 (안내 문구용) */
  name: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 화면 하나에서 그리기 오류가 나도 앱 전체가 빈 화면이 되지 않게 막는다.
 * 오디오 엔진은 React와 따로 돌기 때문에 재생은 계속된다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(`${this.props.name} 화면에서 오류가 났습니다: ${error.message} (재생은 계속됩니다)`)
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card error-card">
        <h2>{this.props.name} 화면을 표시하지 못했습니다</h2>
        <p className="muted small">{this.state.error.message}</p>
        <p className="muted small">재생 중이던 소리는 계속 나고 있습니다. 다른 탭은 그대로 쓸 수 있습니다.</p>
        <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
          다시 시도
        </button>
      </div>
    )
  }
}
