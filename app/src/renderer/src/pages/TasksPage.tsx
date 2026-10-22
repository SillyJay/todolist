import { useEffect, useMemo, useState } from 'react'
import { Plus, CalendarPlus, Check, Trash2, ExternalLink, Loader2, ListPlus } from 'lucide-react'
import ImportTaskDialog from '../components/ImportTaskDialog'
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  exportCalendar,
  getSettings,
  type Task
} from '../lib/api'
import { formatDdl, urgencyOf, PLATFORM_LABEL } from '../lib/ui'

interface Props {
  onSelectTask: (t: Task | null) => void
  selectedTaskId?: number
  /** 侧栏平台筛选；为空数组表示不显示任何任务 */
  platforms?: string[]
}

type Filter = 'pending' | 'done' | 'all'

function TasksPage({ onSelectTask, selectedTaskId, platforms }: Props): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<Filter>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [ddl, setDdl] = useState('')
  const [course, setCourse] = useState('')
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState('')
  const [onlyDdl, setOnlyDdl] = useState(false)
  const [aiOn, setAiOn] = useState(true)
  const [semesterOnly, setSemesterOnly] = useState(true)
  const [importOpen, setImportOpen] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const params: Record<string, string> = {}
      if (filter !== 'all') params.status = filter
      if (semesterOnly) params.semester = 'current'
      const res = await listTasks(params)
      setTasks(res.items)
      setError('')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, semesterOnly])

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

  const handleAdd = async (): Promise<void> => {
    if (!title.trim()) return
    setAdding(true)
    try {
      const ddlIso = ddl ? new Date(ddl).toISOString() : null
      await createTask({
        title: title.trim(),
        ddl: ddlIso,
        course_name: course.trim() || null,
        course_abbr: course.trim() || null
      })
      setTitle('')
      setDdl('')
      setCourse('')
      await refresh()
      setToast('任务已创建')
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

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
      setToast(`已导出 ${res.count} 个事件 → ${res.path}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <div className="max-w-3xl">
      {/* 工具行 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {(
            [
              ['pending', '待办'],
              ['done', '已完成'],
              ['all', '全部']
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
                filter === k
                  ? 'bg-[var(--surface-3)] text-[var(--fg)]'
                  : 'text-[var(--faint)] hover:text-[var(--muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          data-guide="import"
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)] transition-colors"
          title="粘贴通知文本，自动解析成任务"
        >
          <ListPlus size={13} /> 文本导入
        </button>
        <button
          onClick={() => setSemesterOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border transition-colors ${
            semesterOnly
              ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-strong)]'
              : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--faint)] hover:text-[var(--fg)]'
          }`}
          title="隐藏往届课程遗留的作业"
        >
          本学期
        </button>
        <button
          onClick={() => setOnlyDdl((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border transition-colors ${
            onlyDdl
              ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-strong)]'
              : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--faint)] hover:text-[var(--fg)]'
          }`}
          title="过滤掉老师没有设置截止时间的作业"
        >
          仅有截止时间
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)] transition-colors disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CalendarPlus size={14} strokeWidth={1.8} />
          )}
          导出日历
        </button>
      </div>

      {/* 快速添加 */}
      <div className="mb-5 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
            placeholder="添加任务，回车确认…"
            className="flex-1 bg-transparent text-[13px] placeholder:text-[var(--faint)] outline-none"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={adding || !title.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--accent)] text-white text-[12px] disabled:opacity-40"
          >
            <Plus size={13} />
            添加
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <input
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            placeholder="课程（可选）"
            className="w-32 bg-transparent text-[12px] placeholder:text-[var(--faint)] outline-none border-b border-transparent focus:border-[var(--border)]"
          />
          <input
            type="datetime-local"
            value={ddl}
            onChange={(e) => setDdl(e.target.value)}
            className="bg-transparent text-[12px] text-[var(--faint)] outline-none [color-scheme:dark]"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-[color-mix(in_oklch,var(--danger)_18%,transparent)] text-[var(--danger)] text-[12px]">
          {error}
        </div>
      )}

      {toast && (
        <div className="mb-4 px-3 py-2 rounded-md bg-[color-mix(in_oklch,var(--ok)_16%,transparent)] text-[var(--ok)] text-[12px]">
          {toast}
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="text-[13px] text-[var(--faint)] py-8">加载中…</div>
      ) : tasks.length === 0 ? (
        <div className="py-14 text-center">
          <div className="text-[13px] text-[var(--faint)]">
            {filter === 'pending' ? '暂无待办，清静一会儿' : '这里还没有内容'}
          </div>
          <div className="text-[12px] text-[var(--faint)] mt-1.5">
            可以在上方手动添加，或等学习通/微信群同步
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleTasks.map((t) => (
            <TaskCard
              key={t.id}
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

      {importOpen && (
        <ImportTaskDialog onClose={() => setImportOpen(false)} onCreated={() => void refresh()} />
      )}

      <div className="mt-6 text-[11px] text-[var(--faint)]">
        当前列表 {visibleTasks.length} 条 · 待办 {stats.pending} 条 · 3 天内 {stats.soon} 条
      </div>
    </div>
  )
}

function TaskCard({
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
  const bar =
    urgency === 'danger'
      ? 'bg-[var(--danger)]'
      : urgency === 'warn'
        ? 'bg-[#f59e0b]'
        : urgency === 'near'
          ? 'bg-[#eab308]'
          : 'bg-transparent'
  const done = task.status === 'done'

  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
        active
          ? 'bg-[var(--accent-soft)] border-[var(--accent)]'
          : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border)]'
      }`}
    >
      <div className={`absolute left-0 top-3 bottom-3 w-[2px] rounded ${bar}`} />

      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
          done ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[#4a4a58] hover:border-[var(--accent)]'
        }`}
      >
        {done && <Check size={11} className="text-white" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#2a2a34] text-[var(--faint)]">
            {PLATFORM_LABEL[task.platform] ?? task.platform}
          </span>
          {task.confidence != null && task.confidence < 0.8 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in_oklch,var(--warn)_16%,transparent)] text-[var(--warn)]">
              ❓待确认
            </span>
          )}
        </div>

        <div
          className={`mt-1 text-[13.5px] leading-snug truncate ${
            done ? 'line-through text-[var(--faint)]' : 'text-[var(--fg)]'
          }`}
        >
          {aiOn && task.summary ? task.summary : task.title}
        </div>

        <div className="mt-1 flex items-center gap-2 text-[11.5px]">
          {task.course_abbr && <span className="text-[var(--faint)]">{task.course_abbr}</span>}
          {task.course_abbr && <span className="text-[var(--faint)]">·</span>}
          <span
            className={
              urgency === 'danger'
                ? 'text-[var(--danger)]'
                : urgency === 'warn'
                  ? 'text-[var(--warn)]'
                  : 'text-[var(--faint)]'
            }
          >
            {formatDdl(task.ddl)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {task.url && (
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded text-[var(--faint)] hover:text-[var(--accent-strong)]"
            title="打开原页面"
          >
            <ExternalLink size={13} />
          </a>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 rounded text-[var(--faint)] hover:text-[var(--danger)]"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

export default TasksPage
