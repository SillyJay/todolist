import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

interface Props {
  children: ReactNode
  /** 页面名，用于错误提示 */
  name?: string
}

interface State {
  error: string
}

/**
 * 页面级错误边界。
 *
 * 之前某个页面组件里一个未定义的图标（Sparkles）直接把整页渲染崩掉，
 * 用户只看到"这块内容不见了"，控制台才有线索。这里兜住异常并显式提示，
 * 其它页面仍然可用。
 */
export default class PageBoundary extends Component<Props, State> {
  state: State = { error: '' }

  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[page error]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="status-note" style={{ margin: 20 }}>
        <AlertCircle size={14} />
        <div style={{ minWidth: 0 }}>
          <div>
            {this.props.name || '该页面'}渲染出错：{this.state.error}
          </div>
          <div style={{ color: 'var(--faint)', marginTop: 4 }}>
            其它页面仍可用。按 Ctrl+R 重新加载，或把这条信息反馈给开发者。
          </div>
          <button
            className="btn btn-secondary sm"
            style={{ marginTop: 8 }}
            onClick={() => this.setState({ error: '' })}
          >
            重试
          </button>
        </div>
      </div>
    )
  }
}
