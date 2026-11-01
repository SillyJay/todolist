import { useEffect, useState } from 'react'
import { CalendarDays, Check, FolderOpen, Inbox, ListTodo, MessageSquare, Settings } from 'lucide-react'
import { NAV_ITEMS, PLATFORMS, type PageKey } from '../lib/ui'
import { wechatFeedUnread } from '../lib/api'

const ICONS = {
  tasks: ListTodo,
  messages: Inbox,
  calendar: CalendarDays,
  agent: MessageSquare,
  files: FolderOpen,
  settings: Settings
}

interface Props {
  current: PageKey
  onChange: (p: PageKey) => void
  platforms: string[]
  onTogglePlatform: (key: string) => void
}

function Sidebar({
  current,
  onChange,
  platforms,
  onTogglePlatform
}: Props): React.JSX.Element {
  // 未读红点自己轮询：放在 Sidebar 内部，父级 MainLayout 就不会每 60 秒整树重渲染
  // （之前放在 MainLayout，会让三个页面跟着重渲染，肉眼就是「文字闪一下」）
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void wechatFeedUnread()
        .then((r) => {
          if (alive) setUnread(r.total)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('ca:wechat-read', refresh)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('ca:wechat-read', refresh)
    }
  }, [])

  return (
    <aside className="sidebar">
      <nav className="nav" aria-label="主导航">
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
              {item.key === 'messages' && unread > 0 && (
                <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="side-block">
        <div className="side-label">
          <span>来源筛选</span>
        </div>
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
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

export default Sidebar
