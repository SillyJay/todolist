import { useEffect, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle
} from 'react-resizable-panels'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import AiPanel from '../components/AiPanel'
import PageBoundary from '../components/PageBoundary'
import TasksPage from '../pages/TasksPage'
import MessagesPage from '../pages/MessagesPage'
import CalendarPage from '../pages/CalendarPage'
import AgentPage from '../pages/AgentPage'
import FilesPage from '../pages/FilesPage'
import SettingsPage from '../pages/SettingsPage'
import type { PageKey } from '../lib/ui'
import type { Task } from '../lib/api'
import { withViewTransition } from '../lib/viewTransition'

interface Props {
  page: PageKey
  onPageChange: (p: PageKey) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenLogin: () => void
  account?: { email: string; display_name: string; avatar: string } | null
}

const TITLES: Record<PageKey, string> = {
  tasks: '任务',
  messages: '消息',
  calendar: '日历',
  agent: 'AI 对话',
  files: '文件',
  settings: '设置'
}

/** 侧栏顺序即空间顺序：向下走时旧内容上移、新内容从下方进入，反向则相反 */
const PAGE_ORDER: PageKey[] = ['tasks', 'messages', 'calendar', 'agent', 'files', 'settings']

function MainLayout({
  page,
  onPageChange,
  theme,
  onToggleTheme,
  onOpenLogin,
  account,
}: Props): React.JSX.Element {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const [platforms, setPlatforms] = useState<string[]>(['chaoxing', 'xiaoya', 'wechat', 'manual'])

  // 右侧任务详情：任务页自动展开，其它页自动折叠；仍允许手动切换
  const aiRef = useRef<ImperativePanelHandle>(null)
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [aiAnimating, setAiAnimating] = useState(false)
  // 切页后 0.5s 内才允许子块入场动画；之后关掉，避免数据到达时内容重挂载又重播一遍
  const [settled, setSettled] = useState(false)
  // 主滚动容器在切页时复用，需要手动回顶，否则会带着上一页的滚动位置入场
  const scrollRef = useRef<HTMLElement>(null)

  const animate = (): void => {
    setAiAnimating(true)
    window.setTimeout(() => setAiAnimating(false), 380)
  }


  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSettled(false)
    const t = window.setTimeout(() => setSettled(true), 520)
    return () => window.clearTimeout(t)
  }, [page])

  // 切页时同步真实状态（用 panel 自身的 isCollapsed，避免 state 与实际脱节）
  useEffect(() => {
    const p = aiRef.current
    if (!p) return
    animate()
    if (page === 'tasks') {
      if (p.isCollapsed()) p.expand()
    } else if (!p.isCollapsed()) {
      p.collapse()
    }
  }, [page])

  const toggleAi = (): void => {
    const p = aiRef.current
    if (!p) return
    animate()
    if (p.isCollapsed()) p.expand()
    else p.collapse()
  }

  // 板块之间按空间顺序纵向推动；新旧页面同帧交接，旧页面才真的能滑走
  const switchPage = (next: PageKey): void => {
    if (next === page) return
    const from = PAGE_ORDER.indexOf(page)
    const to = PAGE_ORDER.indexOf(next)
    if (from < 0 || to < 0) {
      onPageChange(next)
      return
    }
    withViewTransition('page', to > from ? 'up' : 'down', () => {
      onPageChange(next)
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }

  return (
    <div className="app">
      <TopBar
        title={TITLES[page]}
        theme={theme}
        onToggleTheme={onToggleTheme}
        aiPanelVisible={!aiCollapsed}
        onToggleAiPanel={toggleAi}
        onOpenLogin={onOpenLogin}
        account={account}
      />

      <div className="workspace">
        <PanelGroup direction="horizontal" className="panels">
          <Panel defaultSize={16} minSize={12} maxSize={26}>
            <Sidebar
              current={page}
              onChange={switchPage}
              platforms={platforms}
              onTogglePlatform={(k) =>
                setPlatforms((prev) =>
                  prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
                )
              }
            />
          </Panel>

          <PanelResizeHandle className="handle" />

          <Panel minSize={38}>
            <div className="main-panel">
              <main ref={scrollRef} className={`page-scroll${page === 'calendar' ? ' flush' : ''}`}>
                {/* key 换页即重挂载，让 pageSwap 每次都真的播放 */}
                <div className={`page-stage${settled ? ' is-settled' : ''}`} key={page}>
                  <PageBoundary name={TITLES[page]}>
                    {page === 'tasks' && (
                      <TasksPage
                        onSelectTask={setSelectedTask}
                        selectedTaskId={selectedTask?.id}
                        platforms={platforms}
                      />
                    )}
                    {page === 'messages' && <MessagesPage />}
                    {page === 'calendar' && <CalendarPage onNavigate={switchPage} />}
                    {page === 'agent' && <AgentPage />}
                    {page === 'files' && <FilesPage />}
                    {page === 'settings' && <SettingsPage />}
                  </PageBoundary>
                </div>
              </main>
            </div>
          </Panel>

          {/* 面板常驻，只做折叠，避免卸载/重挂导致 ref 与 state 脱节 */}
          <PanelResizeHandle className={`handle${aiCollapsed ? ' handle-off' : ''}`} />
          <Panel
            ref={aiRef}
            collapsible
            collapsedSize={0}
            defaultSize={24}
            minSize={16}
            maxSize={38}
            className={aiAnimating ? 'panel-anim' : undefined}
            onCollapse={() => setAiCollapsed(true)}
            onExpand={() => setAiCollapsed(false)}
          >
            <div className={`ai-panel${aiCollapsed ? ' is-collapsed' : ''}`}>
              <AiPanel task={selectedTask} onCollapse={toggleAi} />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}

export default MainLayout
