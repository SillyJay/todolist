import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  CalendarPlus,
  Check,
  ChevronDown,
  ExternalLink,
  Inbox,
  ListPlus,
  Loader2,
  Plus,
  Trash2
} from 'lucide-react'
import ImportTaskDialog from '../components/ImportTaskDialog'
import AddTaskDialog from '../components/AddTaskDialog'
import { toast } from '../components/Toast'
import {
  listTasks,
  updateTask,
  deleteTask,
  exportCalendar,
  getSettings,
  type Task
} from '../lib/api'
import { formatDdl, urgencyOf, PLATFORM_LABEL } from '../lib/ui'
import { readViewCache, writeViewCache } from '../lib/viewCache'

interface Props {
  onSelectTask: (t: Task | null) => void
  selectedTaskId?: number
  /** 侧栏平台筛选；为空数组表示不显示任何任务 */
  platforms?: string[]
}

type Filter = 'pending' | 'done' | 'all' | 'exam'

const FILTERS: [Filter, string][] = [
  ['pending', '待办'],
  ['done', '已完成'],
  ['all', '全部'],
  ['exam', '考试']
]

const tasksViewKey = (filter: Filter, semester: boolean): string =>
  `tasks:${filter}:${semester ? 'cur' : 'all'}`

function TasksPage({ onSelectTask, selectedTaskId, platforms }: Props): React.JSX.Element {
  // 回到任务页时先复用上次的快照，避免「空态 → 列表」的整块闪动
  const [tasks, setTasks] = useState<Task[]>(
    () => readViewCache<Task[]>(tasksViewKey('pending', true)) ?? []
  )
  const [filter, setFilter] = useState<Filter>('pending')
  const [loading, setLoading] = useState(
    () => readViewCache<Task[]>(tasksViewKey('pending', true)) === undefined
  )
  // 有旧内容在屏上时的静默刷新：只显示一个小转圈，不替换列表
  const [refreshing, setRefreshing] = useState(
    () => readViewCache<Task[]>(tasksViewKey('pending', true)) !== undefined
  )
  const reqRef = useRef(0)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [onlyDdl, setOnlyDdl] = useState(false)
  const [aiOn, setAiOn] = useState(true)
  const [semesterOnly, setSemesterOnly] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  // 悬浮按钮挂载点：主面板（避免随内容滚动）
  const [fabHost, setFabHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFabHost(document.querySelector<HTMLElement>('.main-panel'))
  }, [])

  const refresh = async (): Promise<void> => {
    // 用户快速切筛选时，只让最后一次请求写回状态，避免旧结果覆盖新结果
    const req = ++reqRef.current
    try {
      const params: Record<string, string> = {}
      if (filter === 'exam') {
        params.kind = 'exam'
      } else if (filter !== 'all') {
        params.status = filter
      }
      if (semesterOnly) params.semester = 'current'
      const res = await listTasks(params)
      if (req !== reqRef.current) return
      setTasks(res.items)
      writeViewCache(tasksViewKey(filter, semesterOnly), res.items)
      setError('')
    } catch (e) {
      if (req === reqRef.current) setError(String(e))
    } finally {
      if (req === reqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [filter, semesterOnly])

  /**
   * 切筛选时立刻把「这个筛选上次的结果」铺上：有快照就直接显示并静默刷新，
   * 没有快照才退到骨架屏。放在点击事件里同步执行，避免先渲染一帧旧列表。
   */
  const showCachedView = (nextFilter: Filter, nextSemester: boolean): void => {
    const hit = readViewCache<Task[]>(tasksViewKey(nextFilter, nextSemester))
    setTasks(hit ?? [])
    setLoading(!hit)
    setRefreshing(Boolean(hit))
  }

  const changeFilter = (next: Filter): void => {
    if (next === filter) return
    showCachedView(next, semesterOnly)
    setFilter(next)
  }

  const toggleSemester = (): void => {
    const next = !semesterOnly
    showCachedView(filter, next)
    setSemesterOnly(next)
  }

  // AI 显示开关（settings.ai_display_mode）：开=卡片显示 AI 摘要，关=显示原题
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getSettings()
        setAiOn((cfg.ai_display_mode ?? 'on') === 'on')
      } catch {
        /* 后端未就绪时保持默认 */
      }
    })()
  }, [])

  // 纯章节类（第六章、实验1…）默认折叠，避免主列表被碎片标题淹没
  const [showChapters, setShowChapters] = useState(false)

  const visibleTasks = useMemo(() => {
    let list = tasks
    if (platforms) list = list.filter((t) => platforms.includes(t.platform))
    if (onlyDdl) list = list.filter((t) => t.ddl)
    return list
  }, [tasks, onlyDdl, platforms])

  const stats = useMemo(() => {
    const pending = tasks.filter((t) => t.status === 'pending').length
    const soon = tasks.filter(
      (t) => t.status === 'pending' && ['danger', 'warn'].includes(urgencyOf(t.ddl))
    ).length
    return { pending, soon }
  }, [tasks])


  const handleToggle = async (t: Task): Promise<void> => {
    const next = t.status === 'done' ? 'pending' : 'done'
    await updateTask(t.id, { status: next })
    await refresh()
  }

  const handleDelete = async (t: Task): Promise<void> => {
    await deleteTask(t.id)
    if (selectedTaskId === t.id) onSelectTask(null)
    await refresh()
  }

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const res = await exportCalendar()
      toast(`已导出 ${res.count} 个事件 → ${res.path}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setExporting(false)
    }
  }

  // 分成「正常任务」和「纯章节类」两组
  const mainTasks = visibleTasks.filter((t) => t.kind !== 'chapter')
  const chapterTasks = visibleTasks.filter((t) => t.kind === 'chapter')
  const chapterUndone = chapterTasks.filter((t) => t.status === 'pending').length

  return (
    <div>
      <header className="page-head compact">
        <div>
          <h1 className="page-title">任务</h1>
          <p className="page-sub">学习通 · 小雅 · 微信群汇总，点击任务可在右侧拆解。</p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary sm"
            data-guide="import"
            onClick={() => setImportOpen(true)}
            title="粘贴通知文本，自动解析成任务"
          >
            <ListPlus size={14} strokeWidth={1.8} /> 文本导入
          </button>
          <button
            className="btn btn-secondary sm"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <CalendarPlus size={14} strokeWidth={1.8} />
            )}
            导出日历
          </button>
        </div>
      </header>

      <div className="task-toolbar">
        <div className="segment">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={filter === k ? 'active' : ''}
              onClick={() => changeFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="right">
          <button
            className="chip"
            aria-pressed={semesterOnly}
            onClick={toggleSemester}
            title="隐藏往届课程遗留的作业"
          >
            本学期
          </button>
          <button
            className="chip"
            aria-pressed={onlyDdl}
            onClick={() => setOnlyDdl((v) => !v)}
            title="过滤掉老师没有设置截止时间的作业"
          >
            仅有截止时间
          </button>
        </div>
      </div>


      {error && (
        <div className="status-note" style={{ marginBottom: 14 }}>
          <AlertCircle size={14} />
          <span style={{ wordBreak: 'break-all' }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="skeleton-list" aria-label="正在读取任务">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton-row" key={i}>
              <span className="sk-box" />
              <span className="sk-lines">
                <span className="sk-line" style={{ width: `${68 - i * 5}%` }} />
                <span className="sk-line sm" style={{ width: `${34 + i * 3}%` }} />
              </span>
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="empty">
          <div className="empty-orb">
            <Inbox size={18} strokeWidth={1.6} />
          </div>
          <h3>{filter === 'pending' ? '暂无待办' : '这里还没有内容'}</h3>
          <p>点右下角「+」手动添加，或等待学习通 / 微信群同步。</p>
        </div>
      ) : (
        <>
          <div className="task-list-header">
            <span>按截止时间排序</span>
            <span className="mono">
              {refreshing && <Loader2 size={11} className="spin sync-ico" />}
              {visibleTasks.length} 条 · 待办 {stats.pending} · 3 天内 {stats.soon}
            </span>
          </div>
          <div
            className="task-list"
            key={`${filter}:${semesterOnly ? 1 : 0}:${onlyDdl ? 1 : 0}`}
          >
            {mainTasks.map((t) => (
              <TaskRow
                key={`${t.id}:${t.status}`}
                task={t}
                active={selectedTaskId === t.id}
                onSelect={() => onSelectTask(t)}
                onToggle={() => void handleToggle(t)}
                onDelete={() => void handleDelete(t)}
                aiOn={aiOn}
              />
            ))}

            {chapterTasks.length > 0 && (
              <div className="task-chapter-block">
                <button
                  type="button"
                  className="task-chapter-head"
                  onClick={() => setShowChapters((v) => !v)}
                  aria-expanded={showChapters}
                >
                  <span className="task-chapter-name">课内章节</span>
                  <span className="task-chapter-count">
                    {chapterTasks.length} 条
                    {chapterUndone > 0 ? ` · 未完成 ${chapterUndone}` : ''}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`task-chapter-chev${showChapters ? ' open' : ''}`}
                  />
                </button>
                {showChapters &&
                  chapterTasks.map((t) => (
                    <TaskRow
                      key={`${t.id}:${t.status}`}
                      task={t}
                      active={selectedTaskId === t.id}
                      onSelect={() => onSelectTask(t)}
                      onToggle={() => void handleToggle(t)}
                      onDelete={() => void handleDelete(t)}
                      aiOn={aiOn}
                    />
                  ))}
              </div>
            )}
          </div>
          {visibleTasks.length === 0 && (
            <div className="empty" style={{ marginTop: 12 }}>
              <p>当前筛选条件下没有任务。</p>
            </div>
          )}
        </>
      )}

      <div className="page-foot-note">
        <span>来源：学习通 · 小雅 · 微信群 · 手动</span>
        <span>side panel · AI 拆解</span>
      </div>

      {importOpen && (
        <ImportTaskDialog onClose={() => setImportOpen(false)} onCreated={() => void refresh()} />
      )}

      {addOpen && <AddTaskDialog onClose={() => setAddOpen(false)} onCreated={() => void refresh()} />}

      {/* 右下角悬浮「+」：挂到主面板上，避免跟随内容滚动 */}
      {fabHost &&
        createPortal(
          <button
            type="button"
            className="fab"
            onClick={() => setAddOpen(true)}
            title="新建任务"
            aria-label="新建任务"
          >
            <Plus size={22} strokeWidth={2.2} />
          </button>,
          fabHost
        )}
    </div>
  )
}

function TaskRow({
  task,
  active,
  onSelect,
  onToggle,
  onDelete,
  aiOn
}: {
  task: Task
  active: boolean
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
  aiOn: boolean
}): React.JSX.Element {
  const urgency = urgencyOf(task.ddl)
  const done = task.status === 'done'
  // 勾选后先播放回弹 + 整行收拢，再落库；避免刷新把行「瞬移」掉
  const [leaving, setLeaving] = useState(false)
  const [pop, setPop] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  const handleCheck = (): void => {
    if (leaving) return
    setPop(true)
    window.setTimeout(() => setPop(false), 280)
    if (done) {
      onToggle()
      return
    }
    rowRef.current?.style.setProperty('--row-h', `${rowRef.current.offsetHeight}px`)
    setLeaving(true)
    window.setTimeout(onToggle, 260)
    // 接口失败时任务仍是待办：兜底把行恢复，不让它一直隐身
    window.setTimeout(() => setLeaving(false), 1500)
  }

  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={`task-row${active ? ' selected' : ''}${leaving ? ' leaving' : ''}`}
      role="button"
      tabIndex={0}
      aria-busy={leaving || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <button
        type="button"
        aria-label={done ? '标记为待办' : '标记为完成'}
        onClick={(e) => {
          e.stopPropagation()
          handleCheck()
        }}
        className={`task-check${done || leaving ? ' checked' : ''}${pop ? ' pop' : ''}`}
      >
        {(done || leaving) && <Check size={11} strokeWidth={3} />}
      </button>

      <div className="task-main">
        <div className="task-top">
          <span className="task-platform">{PLATFORM_LABEL[task.platform] ?? task.platform}</span>
          {task.confidence != null && task.confidence < 0.8 && (
            <span className="task-flag">待确认</span>
          )}
        </div>

        <div className={`task-title${done || leaving ? ' done' : ''}`}>
                {task.kind === "exam" && <span className="exam-badge">考试</span>}
          {aiOn && task.summary ? task.summary : task.display_title || task.title}
        </div>

        <div className="task-meta">
          {task.course_abbr && task.kind !== 'chapter' && <span>{task.course_abbr}</span>}
          {task.course_abbr && task.kind !== 'chapter' && <span className="sep">·</span>}
          <span className={`deadline${urgency === 'danger' || urgency === 'warn' ? ' urgent' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {formatDdl(task.ddl)}
          </span>
        </div>
      </div>

      <div className="task-row-actions">
        {task.url && (
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mini-btn"
            title="打开原页面"
          >
            <ExternalLink size={13} />
          </a>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="mini-btn danger"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

export default TasksPage
