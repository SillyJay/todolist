import { useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import Sidebar, { type SyncStatus } from '../components/Sidebar'
import TopBar from '../components/TopBar'
import AiPanel from '../components/AiPanel'
import TasksPage from '../pages/TasksPage'
import CalendarPage from '../pages/CalendarPage'
import AgentPage from '../pages/AgentPage'
import FilesPage from '../pages/FilesPage'
import SettingsPage from '../pages/SettingsPage'
import type { PageKey } from '../lib/ui'
import {
  adaptersStatus,
  aiStatus,
  wechatStatus,
  workspaceInfo,
  type Task
} from '../lib/api'

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

const EMPTY_STATUS: SyncStatus = {
  chaoxing: false,
  xiaoya: false,
  wechat: 'not_configured',
  ai: false
}

function MainLayout({
  page,
  onPageChange,
  theme,
  onToggleTheme,
  onOpenLogin
}: Props): React.JSX.Element {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [aiPanelVisible, setAiPanelVisible] = useState(true)
  const [platforms, setPlatforms] = useState<string[]>(['chaoxing', 'xiaoya', 'wechat', 'manual'])
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [status, setStatus] = useState<SyncStatus>(EMPTY_STATUS)

  // 侧栏与底栏共享的连接状态（只读，不改变任何业务逻辑）
  useEffect(() => {
    void (async () => {
      try {
        const w = await workspaceInfo()
        setWorkspaceRoot(w.root)
      } catch {
        /* 后端未就绪 */
      }

      const [adapters, wechat, ai] = await Promise.allSettled([
        adaptersStatus(),
        wechatStatus(),
        aiStatus()
      ])

      setStatus({
        chaoxing: adapters.status === 'fulfilled' ? adapters.value.chaoxing.logged_in : false,
        xiaoya: adapters.status === 'fulfilled' ? adapters.value.xiaoya.logged_in : false,
        wechat:
          wechat.status === 'fulfilled'
            ? wechat.value.listener.state
            : ('not_configured' as SyncStatus['wechat']),
        ai: ai.status === 'fulfilled' ? ai.value.configured : false
      })
    })()
  }, [])

  return (
    <div className="app">
      <TopBar
        title={TITLES[page]}
        theme={theme}
        onToggleTheme={onToggleTheme}
        aiPanelVisible={aiPanelVisible}
        onToggleAiPanel={() => setAiPanelVisible((v) => !v)}
        onOpenLogin={onOpenLogin}
      />

      <div className="workspace">
        <PanelGroup direction="horizontal" className="panels">
          <Panel defaultSize={17} minSize={12} maxSize={30}>
            <Sidebar
              current={page}
              onChange={onPageChange}
              platforms={platforms}
              onTogglePlatform={(k) =>
                setPlatforms((prev) =>
                  prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
                )
              }
              workspaceRoot={workspaceRoot}
              status={status}
            />
          </Panel>

          <PanelResizeHandle className="handle" />

          <Panel minSize={38}>
            <div className="main-panel">
              <main className="page-scroll">
                {page === 'tasks' && (
                  <TasksPage
                    onSelectTask={setSelectedTask}
                    selectedTaskId={selectedTask?.id}
                    platforms={platforms}
                  />
                )}
                {page === 'calendar' && <CalendarPage onNavigate={onPageChange} />}
                {page === 'agent' && <AgentPage />}
                {page === 'files' && <FilesPage />}
                {page === 'settings' && <SettingsPage />}
              </main>
            </div>
          </Panel>

          {aiPanelVisible && page !== 'files' && page !== 'settings' && (
            <>
              <PanelResizeHandle className="handle" />
              <Panel defaultSize={25} minSize={16} maxSize={40}>
                <div className="ai-panel">
                  <AiPanel task={selectedTask} />
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <StatusBar root={workspaceRoot} status={status} />
    </div>
  )
}

function StatusBar({ root, status }: { root: string; status: SyncStatus }): React.JSX.Element {
  const wechatText =
    status.wechat === 'running' ? '监听中' : status.wechat === 'offline' ? '未启动' : '未配置'

  return (
    <div className="statusbar">
      <div className="status-left">
        <span title={root}>工作区：{root || '未配置'}</span>
      </div>
      <div className="status-right">
        <span>微信：{wechatText}</span>
        <span className="status-sep" aria-hidden="true" />
        <span>AI：{status.ai ? '已连接' : '未配置'}</span>
      </div>
    </div>
  )
}

export default MainLayout
