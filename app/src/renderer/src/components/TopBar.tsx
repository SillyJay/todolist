import { Moon, PanelRight, Sun } from 'lucide-react'
import Avatar from './Avatar'

interface Props {
  title: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  aiPanelVisible: boolean
  onToggleAiPanel: () => void
  onOpenLogin: () => void
  account?: { email: string; display_name: string; avatar: string } | null
}

function TopBar({
  title,
  theme,
  onToggleTheme,
  aiPanelVisible,
  onToggleAiPanel,
  onOpenLogin,
  account
}: Props): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          {/* 与桌面/手机应用图标同款：白色对勾 */}
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6.2 12.6l3.6 3.6L17.8 8"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-name">ToDoList</span>
          <span className="brand-sub">TASK LIST</span>
        </div>
      </div>

      <div className="topbar-divider" aria-hidden="true" />
      <div className="crumb">
        {/* key 变化触发一次轻量入场，让顶栏与页面切换的节奏对齐 */}
        <b key={title}>{title}</b>
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-actions">
        <button
          className="account-btn"
          data-guide="account"
          onClick={onOpenLogin}
          title={account?.email || "登录 / 注册账号"}
        >
          <span className="avatar" aria-hidden="true">
            <Avatar src={account?.avatar} size={18} />
          </span>
          {account?.display_name || account?.email?.split('@')[0] || '账号'}
        </button>

        <button
          className="icon-btn"
          aria-pressed={aiPanelVisible}
          onClick={onToggleAiPanel}
          title="AI 面板"
        >
          <PanelRight size={17} strokeWidth={1.8} />
        </button>

        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
        >
          {theme === 'dark' ? (
            <Sun size={17} strokeWidth={1.8} />
          ) : (
            <Moon size={17} strokeWidth={1.8} />
          )}
        </button>
      </div>
    </header>
  )
}

export default TopBar
