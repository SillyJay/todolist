import { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import AiPanel from '../components/AiPanel'
import TasksPage from '../pages/TasksPage'
import CalendarPage from '../pages/CalendarPage'
import AgentPage from '../pages/AgentPage'
import FilesPage from '../pages/FilesPage'
import SettingsPage from '../pages/SettingsPage'
import type { PageKey } from '../lib/ui'
import type { Task } from '../lib/api'

interface Props {
  page: PageKey
  onPageChange: (p: PageKey) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenLogin: () => void
}

const TITLES: Record<PageKey, string> = {
  tasks: '任务',
  calendar: '日历',
  agent: 'AI 对话',
  files: '文件',
  settings: '设置'
}

function MainLayout({ page, onPageChange, theme, onToggleTheme, onOpenLogin }: Props): React.JSX.Element {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [aiPanelVisible, setAiPanelVisible] = useState(true)

  return (
    <div className="h-full flex flex-col bg-[#16161a] text-[#e8e8ec]">
      <TopBar
        title={TITLES[page]}
        theme={theme}
        onToggleTheme={onToggleTheme}
        aiPanelVisible={aiPanelVisible}
        onToggleAiPanel={() => setAiPanelVisible((v) => !v)}
        onOpenLogin={onOpenLogin}
      />

      <PanelGroup direction="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize={18} minSize={12} maxSize={26}>
          <Sidebar current={page} onChange={onPageChange} />
        </Panel>

        <PanelResizeHandle className="w-[1px] bg-[#2a2a34] hover:bg-[#4f8cff] transition-colors" />

        <Panel minSize={40}>
          <main className="h-full overflow-y-auto px-6 py-5">
            {page === 'tasks' && (
              <TasksPage onSelectTask={setSelectedTask} selectedTaskId={selectedTask?.id} />
            )}
            {page === 'calendar' && <CalendarPage />}
            {page === 'agent' && <AgentPage />}
            {page === 'files' && <FilesPage />}
            {page === 'settings' && <SettingsPage />}
          </main>
        </Panel>

        {aiPanelVisible && (
          <>
            <PanelResizeHandle className="w-[1px] bg-[#2a2a34] hover:bg-[#4f8cff] transition-colors" />
            <Panel defaultSize={26} minSize={18} maxSize={40}>
              <AiPanel task={selectedTask} />
            </Panel>
          </>
        )}
      </PanelGroup>

      <FooterBar />
    </div>
  )
}

function FooterBar(): React.JSX.Element {
  return (
    <div className="h-8 shrink-0 flex items-center justify-between px-4 text-[11px] text-[#6b6b7a] border-t border-[#24242c] bg-[#131317]">
      <span>工作区：未配置</span>
      <span>监听状态：未配置</span>
    </div>
  )
}

export default MainLayout
