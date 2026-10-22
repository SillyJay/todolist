import { ListTodo, CalendarDays, MessageSquare, FolderOpen, Settings } from 'lucide-react'
import { NAV_ITEMS, PLATFORMS, type PageKey } from '../lib/ui'

const ICONS = {
  tasks: ListTodo,
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

function Sidebar({ current, onChange, platforms, onTogglePlatform }: Props): React.JSX.Element {
  return (
    <aside className="h-full flex flex-col bg-[#131317] border-r border-[#24242c] py-3">
      <nav className="px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon]
          const active = current === item.key
          return (
            <button
              key={item.key}
              data-guide={item.key}
              onClick={() => onChange(item.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${
                active
                  ? 'bg-[#242430] text-[#e8e8ec]'
                  : 'text-[#9a9aa8] hover:bg-[#1c1c22] hover:text-[#d0d0da]'
              }`}
            >
              <Icon size={16} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {current === 'tasks' && (
        <div className="mt-5 px-4">
          <div className="text-[11px] text-[#5c5c6a] mb-2 tracking-wide">平台筛选</div>
          <div className="space-y-2 text-[12px] text-[#8a8a98]">
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p.key)
              return (
                <label
                  key={p.key}
                  className="flex items-center gap-2 cursor-pointer hover:text-[#c0c0cc]"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onTogglePlatform(p.key)}
                    className="accent-[#4f8cff] w-3.5 h-3.5 cursor-pointer"
                  />
                  <span className={on ? '' : 'text-[#4a4a58]'}>{p.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </aside>
  )
}

export default Sidebar
