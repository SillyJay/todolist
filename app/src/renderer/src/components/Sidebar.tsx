import {
  CalendarDays,
  Check,
  FolderOpen,
  ListTodo,
  MessageSquare,
  Settings
} from 'lucide-react'
import { NAV_ITEMS, PLATFORMS, type PageKey } from '../lib/ui'

const ICONS = {
  tasks: ListTodo,
  calendar: CalendarDays,
  agent: MessageSquare,
  files: FolderOpen,
  settings: Settings
}

export interface SyncStatus {
  chaoxing: boolean
  xiaoya: boolean
  wechat: 'running' | 'offline' | 'not_configured'
  ai: boolean
}

interface Props {
  current: PageKey
  onChange: (p: PageKey) => void
  platforms: string[]
  onTogglePlatform: (key: string) => void
  workspaceRoot: string
  status: SyncStatus
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

function stateText(on: boolean, textOn: string, textOff: string): string {
  return on ? textOn : textOff
}

function Sidebar({
  current,
  onChange,
  platforms,
  onTogglePlatform,
  workspaceRoot,
  status
}: Props): React.JSX.Element {
  const wsName = baseName(workspaceRoot) || '未配置工作区'
  const wechatOn = status.wechat === 'running'
  const wechatText =
    status.wechat === 'running' ? '监听中' : status.wechat === 'offline' ? '未启动' : '未配置'

  return (
    <aside className="sidebar">
      <div className="ws-card" title={workspaceRoot || '在设置中指定工作区目录'}>
        <div className="ws-icon" aria-hidden="true">
          <FolderOpen size={15} strokeWidth={1.7} />
        </div>
        <div className="ws-text">
          <div className="ws-name">{wsName}</div>
          <div className="ws-sub">{workspaceRoot ? '本地工作区' : '设置中可指定'}</div>
        </div>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon]
          const active = current === item.key
          return (
            <button
              key={item.key}
              type="button"
              data-guide={item.key}
              onClick={() => onChange(item.key)}
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="nav-icon" size={16} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="side-label">
        <span>来源</span>
      </div>
      <div>
        {PLATFORMS.map((p) => {
          const on = platforms.includes(p.key)
          return (
            <button
              key={p.key}
              type="button"
              className="filter-item"
              aria-pressed={on}
              onClick={() => onTogglePlatform(p.key)}
            >
              <span className="filter-box" aria-hidden="true">
                <Check size={10} strokeWidth={3} />
              </span>
              <span
                className="filter-dot"
                aria-hidden="true"
                style={{ '--plat': `var(--plat-${p.key})` } as React.CSSProperties}
              />
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>

      <div className="sync-card">
        <div className="sync-inner">
          <div className="sync-title">
            <span>连接状态</span>
          </div>

          <div className="sync-row">
            <span className={`dot ${status.chaoxing ? 'ok' : 'off'}`} aria-hidden="true" />
            <span>学习通</span>
            <span className="state">{stateText(status.chaoxing, '已登录', '未登录')}</span>
          </div>

          <div className="sync-row">
            <span className={`dot ${status.xiaoya ? 'ok' : 'off'}`} aria-hidden="true" />
            <span>小雅</span>
            <span className="state">{stateText(status.xiaoya, '已登录', '未登录')}</span>
          </div>

          <div className="sync-row">
            <span className={`dot ${wechatOn ? 'ok' : 'off'}`} aria-hidden="true" />
            <span>微信群</span>
            <span className="state">{wechatText}</span>
          </div>

          <div className="sync-row">
            <span className={`dot ${status.ai ? 'ok' : 'off'}`} aria-hidden="true" />
            <span>AI 模型</span>
            <span className="state">{stateText(status.ai, '已连接', '未配置')}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
