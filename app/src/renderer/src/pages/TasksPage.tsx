import { useEffect, useMemo, useState } from 'react'
import { Plus, CalendarPlus, Check, Trash2, ExternalLink, Loader2, ListPlus } from 'lucide-react'
import ImportTaskDialog from '../components/ImportTaskDialog'
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  exportCalendar,
  type Task
} from '../lib/api'
import { formatDdl, urgencyOf, PLATFORM_LABEL } from '../lib/ui'

interface Props {
  onSelectTask: (t: Task | null) => void
  selectedTaskId?: number
}

type Filter = 'pending' | 'done' | 'all'

function TasksPage({ onSelectTask, selectedTaskId }: Props): React.JSX.Element {
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

  const visibleTasks = useMemo(
    () => (onlyDdl ? tasks.filter((t) => t.ddl) : tasks),
    [tasks, onlyDdl]
  )

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
                  ? 'bg-[#242430] text-[#e8e8ec]'
                  : 'text-[#7a7a88] hover:text-[#c0c0cc]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          data-guide="import"
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] bg-[#1c1c22] border border-[#2e2e38] text-[#b0b0be] hover:border-[#4f8cff] hover:text-[#e8e8ec] transition-colors"
          title="粘贴通知文本，自动解析成任务"
        >
          <ListPlus size={13} /> 文本导入
        </button>
        <button
          onClick={() => setSemesterOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border transition-colors ${
            semesterOnly
              ? 'bg-[#1e2432] border-[#3a4a68] text-[#7db4ff]'
              : 'bg-[#1c1c22] border-[#2e2e38] text-[#8a8a98] hover:text-[#e0e0e8]'
          }`}
          title="隐藏往届课程遗留的作业"
        >
          本学期
        </button>
        <button
          onClick={() => setOnlyDdl((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border transition-colors ${
            onlyDdl
              ? 'bg-[#1e2432] border-[#3a4a68] text-[#7db4ff]'
              : 'bg-[#1c1c22] border-[#2e2e38] text-[#8a8a98] hover:text-[#e0e0e8]'
          }`}
          title="过滤掉老师没有设置截止时间的作业"
        >
          仅有截止时间
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] bg-[#1c1c22] border border-[#2e2e38] text-[#b0b0be] hover:border-[#4f8cff] hover:text-[#e8e8ec] transition-colors disabled:opacity-50"
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
      <div className="mb-5 p-3 rounded-lg bg-[#1a1a20] border border-[#26262f]">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
            placeholder="添加任务，回车确认…"
            className="flex-1 bg-transparent text-[13px] placeholder:text-[#5c5c6a] outline-none"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={adding || !title.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#4f8cff] text-white text-[12px] disabled:opacity-40"
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
            className="w-32 bg-transparent text-[12px] placeholder:text-[#4a4a58] outline-none border-b border-transparent focus:border-[#2e2e38]"
          />
          <input
            type="datetime-local"
            value={ddl}
            onChange={(e) => setDdl(e.target.value)}
            className="bg-transparent text-[12px] text-[#9a9aa8] outline-none [color-scheme:dark]"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-[#3a1f22] text-[#ff9aa2] text-[12px]">
          {error}
        </div>
      )}

      {toast && (
        <div className="mb-4 px-3 py-2 rounded-md bg-[#16302a] text-[#7ee2b8] text-[12px]">
          {toast}
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="text-[13px] text-[#5c5c6a] py-8">加载中…</div>
      ) : tasks.length === 0 ? (
        <div className="py-14 text-center">
          <div className="text-[13px] text-[#6b6b7a]">
            {filter === 'pending' ? '暂无待办，清静一会儿' : '这里还没有内容'}
          </div>
          <div className="text-[12px] text-[#4a4a58] mt-1.5">
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
            />
          ))}
        </div>
      )}

      {importOpen && (
        <ImportTaskDialog onClose={() => setImportOpen(false)} onCreated={() => void refresh()} />
      )}

      <div className="mt-6 text-[11px] text-[#4a4a58]">
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
  onDelete
}: {
  task: Task
  active: boolean
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
}): React.JSX.Element {
  const urgency = urgencyOf(task.ddl)
  const bar =
    urgency === 'danger'
      ? 'bg-[#ef4444]'
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
          ? 'bg-[#1e2432] border-[#3a4a68]'
          : 'bg-[#1a1a20] border-[#26262f] hover:border-[#34343f]'
      }`}
    >
      <div className={`absolute left-0 top-3 bottom-3 w-[2px] rounded ${bar}`} />

      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
          done ? 'bg-[#4f8cff] border-[#4f8cff]' : 'border-[#4a4a58] hover:border-[#4f8cff]'
        }`}
      >
        {done && <Check size={11} className="text-white" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#2a2a34] text-[#8a8a98]">
            {PLATFORM_LABEL[task.platform] ?? task.platform}
          </span>
          {task.confidence != null && task.confidence < 0.8 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#3a2f1f] text-[#f0c070]">
              ❓待确认
            </span>
          )}
        </div>

        <div
          className={`mt-1 text-[13.5px] leading-snug truncate ${
            done ? 'line-through text-[#6b6b7a]' : 'text-[#e0e0e8]'
          }`}
        >
          {task.title}
        </div>

        <div className="mt-1 flex items-center gap-2 text-[11.5px]">
          {task.course_abbr && <span className="text-[#8a8a98]">{task.course_abbr}</span>}
          {task.course_abbr && <span className="text-[#3a3a46]">·</span>}
          <span
            className={
              urgency === 'danger'
                ? 'text-[#ff8080]'
                : urgency === 'warn'
                  ? 'text-[#f0a860]'
                  : 'text-[#7a7a88]'
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
            className="p-1 rounded text-[#6b6b7a] hover:text-[#4f8cff]"
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
          className="p-1 rounded text-[#6b6b7a] hover:text-[#ff8080]"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

export default TasksPage
