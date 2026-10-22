import { Moon, Sun, PanelRight, UserRound } from 'lucide-react'

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
    <header className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-[#24242c] bg-[#131317]">
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-[#4f8cff] flex items-center justify-center text-[11px] font-bold text-white">
          校
        </div>
        <span className="text-[14px] font-medium">{title}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          data-guide="account"
          onClick={onOpenLogin}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] text-[#9a9aa8] hover:text-[#e0e0e8] hover:bg-[#1c1c22]"
        >
          <UserRound size={13} /> 账号
        </button>
        <StatusDot label="AI" ok={false} />
        <IconBtn onClick={onToggleAiPanel} active={aiPanelVisible} title="AI 面板">
          <PanelRight size={16} strokeWidth={1.8} />
        </IconBtn>
        <IconBtn onClick={onToggleTheme} title="切换主题">
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
        </IconBtn>
      </div>
    </header>
  )
}

function StatusDot({ label, ok }: { label: string; ok: boolean }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-2 text-[11px] text-[#7a7a88]">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-[#22c55e]' : 'bg-[#5c5c6a]'}`} />
      {label}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  active,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'text-[#4f8cff] bg-[#1e2432]'
          : 'text-[#8a8a98] hover:text-[#d0d0da] hover:bg-[#1c1c22]'
      }`}
    >
      {children}
    </button>
  )
}

export default TopBar
