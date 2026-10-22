import { Moon, PanelRight, Sun, UserRound } from 'lucide-react'

interface Props {
  title: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  aiPanelVisible: boolean
  onToggleAiPanel: () => void
  onOpenLogin: () => void
}

function TopBar({
  title,
  theme,
  onToggleTheme,
  aiPanelVisible,
  onToggleAiPanel,
  onOpenLogin
}: Props): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          校
        </div>
        <div className="brand-text">
          <span className="brand-name">校园助手</span>
          <span className="brand-sub">CAMPUS AGENT</span>
        </div>
      </div>

      <div className="topbar-divider" aria-hidden="true" />
      <div className="crumb">
        <b>{title}</b>
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-actions">
        <button
          className="account-btn"
          data-guide="account"
          onClick={onOpenLogin}
          title="连接平台账号"
        >
          <span className="avatar" aria-hidden="true">
            <UserRound size={13} strokeWidth={1.8} />
          </span>
          账号
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
