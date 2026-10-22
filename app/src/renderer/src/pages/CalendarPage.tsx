import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  MapPin,
  Upload,
  Download,
  Settings2,
  Check,
  Info
} from 'lucide-react'
import { weeksContain, weekOfDate } from '../lib/weeks'
import {
  dayInfo,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  adaptersStatus,
  scheduleOf,
  scheduleAll,
  scheduleMeta,
  listTasks,
  exportCalendar,
  chaoxingRefreshSchedule,
  type DayInfo,
  type DailyPlan,
  type CourseSlot,
  type WeekCourse,
  type Task
} from '../lib/api'

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日']
const HOUR_H = 52

/** 艾森豪威尔四象限配色（规格 §13.4 上色规则） */
export const QUADRANTS: Record<
  string,
  { key: string; name: string; short: string; color: string; bg: string; text: string }
> = {
  q1: {
    key: 'q1',
    name: '紧急且重要',
    short: '紧急重要',
    color: 'var(--q1)',
    bg: 'var(--q1-bg)',
    text: 'var(--q1-text)'
  },
  q2: {
    key: 'q2',
    name: '重要不紧急',
    short: '重要',
    color: 'var(--q2)',
    bg: 'var(--q2-bg)',
    text: 'var(--q2-text)'
  },
  q3: {
    key: 'q3',
    name: '紧急不重要',
    short: '紧急',
    color: 'var(--q3)',
    bg: 'var(--q3-bg)',
    text: 'var(--q3-text)'
  },
  q4: {
    key: 'q4',
    name: '不紧急不重要',
    short: '常规',
    color: 'var(--q4)',
    bg: 'var(--q4-bg)',
    text: 'var(--q4-text)'
  }
}
const qOf = (k?: string | null): (typeof QUADRANTS)['q1'] => QUADRANTS[k || 'q2'] ?? QUADRANTS.q2

const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000)
const minToText = (m: number): string => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
const textToMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

type ViewMode = 'month' | 'week' | 'list'

function CalendarPage({
  onNavigate
}: {
  onNavigate?: (p: 'settings') => void
} = {}): React.JSX.Element {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<string>(ymd(today))
  const [view, setView] = useState<ViewMode>('month')
  const [infos, setInfos] = useState<Record<string, DayInfo>>({})
  const [tasks, setTasks] = useState<Task[]>([])
  const [plans, setPlans] = useState<DailyPlan[]>([])
  const [courses, setCourses] = useState<CourseSlot[]>([])
  const [coursesAll, setCoursesAll] = useState<WeekCourse[]>([])
  const [weekNo, setWeekNo] = useState<number | null>(null)
  const [firstWeekDate, setFirstWeekDate] = useState<string | null>(null)
  const [chaoxingLogged, setChaoxingLogged] = useState(true) // 默认不打扰，查到未登录才提示
  const [toast, setToast] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const reloadInfos = useCallback(async () => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(first, -((first.getDay() + 6) % 7))
    const res = await dayInfo(ymd(gridStart), ymd(addDays(gridStart, 41)))
    const map: Record<string, DayInfo> = {}
    for (const i of res.items) map[i.date] = i
    setInfos(map)
  }, [cursor])

  const reloadPlans = useCallback(async () => {
    const from = ymd(addDays(today, -1))
    const to = ymd(addDays(today, 75))
    const res = await listPlans(from, to)
    setPlans(res.items)
  }, [today])

  useEffect(() => {
    void reloadInfos()
    void reloadPlans()
    void listTasks({}).then((r) => setTasks(r.items))
    void scheduleAll()
      .then((r) => {
        setCoursesAll(r.items)
        if (r.first_week_date) setFirstWeekDate(r.first_week_date)
      })
      .catch(() => setCoursesAll([]))
    void scheduleMeta()
      .then((m) => setWeekNo(m.current_week))
      .catch(() => setWeekNo(null))
    void adaptersStatus()
      .then((st) => setChaoxingLogged(!!st.chaoxing?.logged_in))
      .catch(() => {
        /* 后端未就绪时不提示 */
      })
  }, [reloadInfos, reloadPlans])

  useEffect(() => {
    void scheduleOf(selected).then((r) => setCourses(r.items))
  }, [selected])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const tasksByDate = useMemo(() => {
    const m: Record<string, Task[]> = {}
    for (const t of tasks) if (t.ddl) (m[t.ddl.slice(0, 10)] ||= []).push(t)
    return m
  }, [tasks])

  const plansByDate = useMemo(() => {
    const m: Record<string, DailyPlan[]> = {}
    for (const p of plans) (m[p.date] ||= []).push(p)
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.start_min - b.start_min)
    return m
  }, [plans])

  /** 接下来 7 天（今天起）合并展示：自定义计划 + 截止作业 */
  const next7 = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(today, i)
        const key = ymd(d)
        return {
          date: d,
          key,
          info: infos[key],
          plans: plansByDate[key] || [],
          tasks: tasksByDate[key] || []
        }
      }),
    [today, infos, plansByDate, tasksByDate]
  )

  /** 下一个法定节假日（未来 120 天内第一个带节日名的日期） */
  const nextHoliday = useMemo(() => {
    for (let i = 1; i <= 120; i++) {
      const d = addDays(today, i)
      const info = infos[ymd(d)]
      const festival = info?.festivals?.find((f) => f !== '假期')
      if (info?.is_holiday && festival) return { date: d, name: festival }
    }
    return null
  }, [today, infos])

  // 周视图以「选中日期」为基准（而不是月历的月初），否则会显示成上个月那一周
  const weekStart = useMemo(() => {
    const base = new Date(`${selected}T00:00:00`)
    const d = Number.isNaN(base.getTime()) ? today : base
    return addDays(d, -((d.getDay() + 6) % 7))
  }, [selected, today])

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(first, -((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [cursor])

  const addPlan = async (body: {
    date: string
    start: string
    mins: number
    title: string
    quadrant: string
  }): Promise<void> => {
    if (!body.title.trim()) return
    const start = textToMin(body.start)
    await createPlan({
      date: body.date,
      start_min: start,
      end_min: Math.min(1440, start + body.mins),
      title: body.title.trim(),
      quadrant: body.quadrant,
      color: body.quadrant,
      done: 0
    })
    await reloadPlans()
    setToast('已加入日程')
  }

  const toggleDone = async (p: DailyPlan): Promise<void> => {
    await updatePlan(p.id, { done: p.done ? 0 : 1 })
    await reloadPlans()
  }

  const doExport = async (): Promise<void> => {
    const r = await exportCalendar()
    setToast(`已导出 ${r.count} 个事件 → ${r.path}`)
  }

  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* ============ 主区 ============ */}
      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        {/* 工具栏 */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            {(
              [
                ['month', '月'],
                ['week', '周'],
                ['list', '列表']
              ] as [ViewMode, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={`px-3 py-1 text-[12px] transition-colors ${
                  view === k ? 'bg-[var(--surface-3)] text-[var(--fg)]' : 'text-[var(--faint)] hover:text-[var(--muted)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() =>
              view === 'week'
                ? setSelected(ymd(addDays(weekStart, -7)))
                : setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
            className="p-1 rounded text-[var(--faint)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[13.5px] text-[var(--fg)] min-w-[120px] text-center">
            {view === 'week'
              ? `${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${addDays(weekStart, 6).getMonth() + 1}/${addDays(weekStart, 6).getDate()}`
              : `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`}
          </span>
          <button
            onClick={() =>
              view === 'week'
                ? setSelected(ymd(addDays(weekStart, 7)))
                : setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
            className="p-1 rounded text-[var(--faint)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight size={15} />
          </button>
          <button
            onClick={() => {
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
              setSelected(ymd(today))
            }}
            className="px-2 py-1 rounded text-[11.5px] text-[var(--faint)] border border-[var(--border)] hover:text-[var(--fg)]"
          >
            今天
          </button>

          {weekNo != null && (
            <span className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              第 {weekNo} 周
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={async () => {
                setToast('正在同步课表…')
                const r = await chaoxingRefreshSchedule()
                setToast(r.ok ? r.message || '课表已同步' : r.message || '同步失败')
                const [all, meta] = await Promise.all([scheduleAll(), scheduleMeta()])
                setCoursesAll(all.items)
                setWeekNo(meta.current_week)
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11.5px] text-[var(--faint)] border border-[var(--border)] hover:text-[var(--fg)]"
            >
              <Upload size={12} /> 导入课表
            </button>
            <button
              onClick={() => void doExport()}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11.5px] text-[var(--faint)] border border-[var(--border)] hover:text-[var(--fg)]"
            >
              <Download size={12} /> 导出 ics
            </button>
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11.5px] bg-[var(--accent)] text-white"
            >
              <Plus size={12} /> 新建日程
            </button>
          </div>
        </div>

        {formOpen && (
          <PlanForm
            defaultDate={selected}
            onSubmit={async (b) => {
              await addPlan(b)
              setFormOpen(false)
            }}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {/* 未接入课表时的引导（不打扰已登录用户） */}
        {!chaoxingLogged && coursesAll.length === 0 && (
          <div
            className="flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-[11.5px]"
            style={{
              background: 'color-mix(in oklch,var(--accent) 10%,transparent)',
              borderColor: 'color-mix(in oklch,var(--accent) 28%,transparent)',
              color: 'var(--muted)'
            }}
          >
            <Info size={13} style={{ color: 'var(--accent-strong)', flex: 'none' }} />
            <span className="min-w-0 flex-1">
              还没有课表数据。登录学习通后会自动同步本学期课程，周视图和日视图就能看到每天在哪上课。
            </span>
            {onNavigate && (
              <button
                onClick={() => onNavigate('settings')}
                className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                style={{
                  background: 'var(--primary-bg)',
                  color: 'var(--primary-fg)',
                  border: '1px solid var(--border)'
                }}
              >
                去设置登录
              </button>
            )}
          </div>
        )}

        {/* 月历 / 列表 */}
        {view === 'month' ? (
          <div className="grid grid-cols-7 gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)] shrink-0">
            {WEEK_CN.map((w) => (
              <div key={w} className="bg-[var(--bg-deep)] py-1.5 text-center text-[11px] text-[var(--faint)]">
                周{w}
              </div>
            ))}
            {cells.map((d) => {
              const key = ymd(d)
              const info = infos[key]
              const inMonth = d.getMonth() === cursor.getMonth()
              const isToday = key === ymd(today)
              const isSel = key === selected
              const dayPlans = plansByDate[key] || []
              const dayTasks = tasksByDate[key] || []
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`relative h-[78px] px-1.5 pt-1 text-left align-top transition-colors ${
                    isSel
                      ? 'bg-[var(--accent-soft)]'
                      : info?.is_holiday && inMonth
                        ? 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]'
                        : 'bg-[var(--bg)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[12.5px] ${
                        isToday
                          ? 'bg-[var(--accent)] text-white rounded-full w-[17px] h-[17px] inline-flex items-center justify-center'
                          : inMonth
                            ? 'text-[var(--fg)]'
                            : 'text-[var(--faint)]'
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {info?.is_holiday && inMonth && (
                      <span className="text-[9px] px-1 rounded bg-[color-mix(in_oklch,var(--danger)_18%,transparent)] text-[var(--danger)]">休</span>
                    )}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${inMonth ? 'text-[var(--faint)]' : 'text-[var(--faint)]'}`}>
                    {info?.lunar}
                  </div>
                  {info?.festivals?.[0] && (
                    <div className="text-[10px] text-[var(--warn)] truncate leading-tight">
                      {info.festivals[0]}
                    </div>
                  )}
                  {/* 事项小块 */}
                  <div className="mt-0.5 space-y-[1px]">
                    {dayPlans.slice(0, 2).map((p) => {
                      const q = qOf(p.quadrant)
                      return (
                        <div
                          key={p.id}
                          className="text-[9.5px] px-1 rounded truncate leading-[13px]"
                          style={{ background: q.bg, color: q.text }}
                        >
                          {minToText(p.start_min)} {p.title}
                        </div>
                      )
                    })}
                    {dayTasks.length > 0 && (
                      <div className="text-[9.5px] px-1 rounded truncate leading-[13px] bg-[color-mix(in_oklch,var(--violet)_16%,transparent)] text-[var(--violet)]">
                        {dayTasks.length} 项作业截止
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : view === 'week' ? (
          <WeekView
            weekStart={weekStart}
            today={today}
            infos={infos}
            plansByDate={plansByDate}
            tasksByDate={tasksByDate}
            courses={coursesAll}
            firstWeekDate={firstWeekDate}
            selected={selected}
            onSelect={setSelected}
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] divide-y divide-[var(--border-soft)]">
            {Array.from({ length: 42 }, (_, i) => addDays(cells[0], i))
              .filter((d) => {
                const k = ymd(d)
                return (
                  (plansByDate[k] || []).length > 0 || (tasksByDate[k] || []).length > 0
                )
              })
              .map((d) => {
                const k = ymd(d)
                return (
                  <div key={k} className="px-3 py-2">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[12px] text-[var(--fg)]">
                        {d.getMonth() + 1}/{d.getDate()} 周{WEEK_CN[(d.getDay() + 6) % 7]}
                      </span>
                      <span className="text-[10.5px] text-[var(--faint)]">
                        {infos[k]?.lunar} {infos[k]?.festivals?.[0] ?? ''}
                      </span>
                    </div>
                    {(plansByDate[k] || []).map((p) => {
                      const q = qOf(p.quadrant)
                      return (
                        <div key={p.id} className="flex items-center gap-2 text-[11.5px] py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: q.color }} />
                          <span className="text-[var(--faint)] w-[88px]">
                            {minToText(p.start_min)}–{minToText(p.end_min)}
                          </span>
                          <span className={p.done ? 'text-[var(--faint)] line-through' : 'text-[var(--fg)]'}>
                            {p.title}
                          </span>
                        </div>
                      )
                    })}
                    {(tasksByDate[k] || []).map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-[11.5px] py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--violet)]" />
                        <span className="text-[var(--faint)] w-[88px]">{t.ddl?.slice(11, 16)}</span>
                        <span className="text-[var(--violet)]">{t.title}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
          </div>
        )}

        {/* 选中日的分钟级规划 + 课表 */}
        <DayView
          date={selected}
          plans={plansByDate[selected] || []}
          tasks={tasksByDate[selected] || []}
          courses={courses}
          onAdd={(title, start, mins, quadrant) =>
            void addPlan({ date: selected, start, mins, title, quadrant })
          }
          onDelete={(id) => void deletePlan(id).then(reloadPlans)}
          onToggle={(p) => void toggleDone(p)}
        />
      </div>

      {/* ============ 右栏 ============ */}
      <aside className="w-[300px] shrink-0 flex flex-col gap-2.5 overflow-y-auto">
        {/* 今天 */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[12px] text-[var(--fg)] mb-1">
            今天 · {today.getMonth() + 1} 月 {today.getDate()} 日
          </div>
          {(() => {
            const tk = ymd(today)
            const list = plansByDate[tk] || []
            const tkTasks = tasksByDate[tk] || []
            if (list.length === 0 && tkTasks.length === 0) {
              return <div className="text-[11.5px] text-[var(--faint)]">这一天没有安排。</div>
            }
            return (
              <div className="space-y-1">
                {list.map((p) => {
                  const q = qOf(p.quadrant)
                  return (
                    <div key={p.id} className="flex items-center gap-1.5 text-[11.5px]">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: q.color }} />
                      <span className="text-[var(--muted)] truncate">{p.title}</span>
                      <span className="text-[10px] text-[var(--faint)] ml-auto">
                        {minToText(p.start_min)}
                      </span>
                    </div>
                  )
                })}
                {tkTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--violet)]" />
                    <span className="text-[var(--violet)] truncate">{t.title}</span>
                    <span className="text-[10px] text-[var(--violet)] opacity-70 ml-auto">
                      {t.ddl?.slice(11, 16)}
                    </span>
                  </div>
                ))}
              </div>
            )
          })()}
        </section>

        {/* 接下来 7 天 */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[12px] text-[var(--fg)] mb-2">接下来 7 天</div>
          <div className="space-y-2">
            {next7.map(({ date: d, key, info, plans: dayPlans, tasks: dayTasks }) => {
              const empty = dayPlans.length === 0 && dayTasks.length === 0
              const isToday = key === ymd(today)
              return (
                <div key={key}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[11px] ${isToday ? 'text-[var(--accent-strong)]' : 'text-[var(--faint)]'}`}>
                      {isToday ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`}
                    </span>
                    <span className="text-[10px] text-[var(--faint)]">
                      周{WEEK_CN[(d.getDay() + 6) % 7]}
                    </span>
                    {info?.festivals?.[0] && (
                      <span className="text-[9.5px] px-1 rounded bg-[color-mix(in_oklch,var(--warn)_16%,transparent)] text-[var(--warn)]">
                        {info.festivals[0]}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setSelected(key)
                        setFormOpen(true)
                      }}
                      className="ml-auto text-[var(--faint)] hover:text-[var(--accent-strong)]"
                      title="在这一天新建"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  {empty ? (
                    <div className="text-[10.5px] text-[var(--faint)] pl-1">—</div>
                  ) : (
                    <div className="space-y-1">
                      {dayPlans.map((p) => {
                        const q = qOf(p.quadrant)
                        return (
                          <div
                            key={p.id}
                            className="group rounded-md px-2 py-1.5 flex items-start gap-1.5"
                            style={{ background: q.bg, borderLeft: `2px solid ${q.color}` }}
                          >
                            <button
                              onClick={() => void toggleDone(p)}
                              className={`mt-[2px] w-3.5 h-3.5 shrink-0 rounded-full border flex items-center justify-center ${
                                p.done ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--faint)]'
                              }`}
                            >
                              {p.done ? <Check size={9} className="text-white" strokeWidth={3} /> : null}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div
                                className={`text-[11.5px] leading-tight truncate ${
                                  p.done ? 'line-through text-[var(--faint)]' : 'text-[var(--fg)]'
                                }`}
                              >
                                {p.title}
                              </div>
                              <div className="text-[10px] text-[var(--faint)] mt-0.5">
                                {minToText(p.start_min)}–{minToText(p.end_min)}
                              </div>
                            </div>
                            {p.done ? (
                              <span className="text-[9px] px-1 rounded bg-[color-mix(in_oklch,var(--ok)_16%,transparent)] text-[var(--ok)] shrink-0">
                                已完成
                              </span>
                            ) : (
                              <span
                                className="text-[9px] px-1 rounded shrink-0"
                                style={{ background: `color-mix(in oklch, ${q.color} 14%, transparent)`, color: q.text }}
                              >
                                {q.short}
                              </span>
                            )}
                            <button
                              onClick={() => void deletePlan(p.id).then(reloadPlans)}
                              className="opacity-0 group-hover:opacity-100 text-[var(--faint)] hover:text-[var(--danger)] shrink-0"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        )
                      })}
                      {dayTasks.map((t) => (
                        <div
                          key={t.id}
                          className="rounded-md px-2 py-1.5 flex items-start gap-1.5 bg-[color-mix(in_oklch,var(--violet)_16%,transparent)] border-l-2 border-[var(--violet)]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[11.5px] text-[var(--violet)] truncate">{t.title}</div>
                            <div className="text-[10px] text-[var(--violet)] mt-0.5">
                              截止 {t.ddl?.slice(11, 16)} · {t.course_abbr || t.platform}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* 法定节假日 */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--fg)] mb-1.5">
            <Settings2 size={12} className="text-[var(--faint)]" /> 法定节假日
          </div>
          {nextHoliday ? (
            <div className="text-[11px] text-[var(--faint)] leading-relaxed">
              下一个假期：<span className="text-[var(--warn)]">{nextHoliday.name}</span>（
              {nextHoliday.date.getMonth() + 1} 月 {nextHoliday.date.getDate()} 日），还有{' '}
              {Math.round((nextHoliday.date.getTime() - today.getTime()) / 86400000)} 天。
              <div className="mt-1.5 text-[10.5px] text-[var(--faint)]">
                农历与节气为算法推算；放假区间按规则近似，遇国务院调休通知可能偏差。
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[var(--faint)]">未来 120 天内暂无识别到的法定节假日。</div>
          )}
        </section>

        {/* 图例 */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[12px] text-[var(--fg)] mb-2">图例</div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-[10.5px] text-[var(--faint)]">
            {Object.values(QUADRANTS).map((q) => (
              <div key={q.key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: q.color }} />
                {q.name}
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-[var(--violet)]" /> 作业截止
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-[var(--accent)]" /> 课程
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-[var(--danger)]" /> 法定休假
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-[var(--border)]" /> 调休补班
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[var(--faint)] leading-relaxed">
            单击日期格选中，双击空白处或点「新建日程」添加；事项颜色按艾森豪威尔矩阵区分。
          </div>
        </section>
      </aside>

      {toast && (
        <div className="fixed bottom-12 right-6 px-3 py-2 rounded-md bg-[color-mix(in_oklch,var(--ok)_16%,transparent)] text-[var(--ok)] text-[12px] shadow-lg max-w-[460px] break-all">
          {toast}
        </div>
      )}
    </div>
  )
}

/** 新建日程表单（顶栏按钮/日历格触发） */
function PlanForm({
  defaultDate,
  onSubmit,
  onCancel
}: {
  defaultDate: string
  onSubmit: (b: { date: string; start: string; mins: number; title: string; quadrant: string }) => void
  onCancel: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState('20:00')
  const [mins, setMins] = useState(60)
  const [quadrant, setQuadrant] = useState('q2')

  return (
    <div className="rounded-lg border border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] p-2.5 flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit({ date, start, mins, title, quadrant })}
        placeholder="日程内容"
        className="flex-1 min-w-[160px] bg-transparent text-[12.5px] outline-none placeholder:text-[var(--faint)]"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="bg-transparent text-[11.5px] px-1 py-0.5 rounded border border-[var(--border)] outline-none [color-scheme:dark]"
      />
      <input
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="bg-transparent text-[11.5px] px-1 py-0.5 rounded border border-[var(--border)] outline-none [color-scheme:dark]"
      />
      <select
        value={mins}
        onChange={(e) => setMins(Number(e.target.value))}
        className="bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] text-[11.5px] px-1 py-1 rounded border border-[var(--border)] outline-none"
      >
        {[15, 30, 45, 60, 90, 120, 180].map((n) => (
          <option key={n} value={n}>
            {n} 分钟
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        {Object.values(QUADRANTS).map((q) => (
          <button
            key={q.key}
            onClick={() => setQuadrant(q.key)}
            title={q.name}
            className={`px-1.5 py-1 rounded text-[10.5px] border transition-all ${
              quadrant === q.key ? 'border-transparent' : 'border-[var(--border)] opacity-70'
            }`}
            style={{
              background: quadrant === q.key ? q.bg : 'transparent',
              color: q.text
            }}
          >
            {q.short}
          </button>
        ))}
      </div>

      <button
        onClick={() => onSubmit({ date, start, mins, title, quadrant })}
        className="px-2.5 py-1 rounded bg-[var(--accent)] text-white text-[11.5px]"
      >
        添加
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 rounded text-[11.5px] text-[var(--faint)] hover:text-[var(--fg)]"
      >
        取消
      </button>
    </div>
  )
}


/** 周视图（规格 §13.1）：7 列 × 24 小时时间网格 */
function WeekView({
  weekStart,
  today,
  infos,
  plansByDate,
  tasksByDate,
  courses,
  firstWeekDate,
  selected,
  onSelect
}: {
  weekStart: Date
  today: Date
  infos: Record<string, DayInfo>
  plansByDate: Record<string, DailyPlan[]>
  tasksByDate: Record<string, Task[]>
  courses: WeekCourse[]
  firstWeekDate: string | null
  selected: string
  onSelect: (d: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 6 * HOUR_H - 12
  }, [weekStart])

  const coursesByDay = useMemo(() => {
    const m: Record<number, WeekCourse[]> = {}
    for (const c of courses) (m[c.weekday] ||= []).push(c)
    return m
  }, [courses])

  const blocksByDay = useMemo(() => {
    const out: Record<
      string,
      {
        top: number
        height: number
        left: string
        width: string
        label: string
        sub: string
        color: string
        done?: boolean
        online?: boolean
        z: number
      }[]
    > = {}

    for (const d of days) {
      const key = ymd(d)
      const raw: {
        start: number
        end: number
        label: string
        sub: string
        color: string
        done?: boolean
        online?: boolean
        kind: 'plan' | 'course'
      }[] = []

      for (const p of plansByDate[key] || []) {
        const q = qOf(p.quadrant)
        raw.push({
          start: p.start_min,
          end: p.end_min,
          label: p.title,
          sub: `${minToText(p.start_min)}–${minToText(p.end_min)}`,
          color: q.color,
          done: !!p.done,
          kind: 'plan' as const
        })
      }
      const weekNo = firstWeekDate ? weekOfDate(d, firstWeekDate) : null
      for (const c of coursesByDay[d.getDay() === 0 ? 7 : d.getDay()] || []) {
        if (!c.start_time || !c.end_time) continue
        if (weekNo != null && !weeksContain(c.weeks, weekNo)) continue
        const st = textToMin(c.start_time)
        const en = textToMin(c.end_time)
        raw.push({
          start: st,
          end: en,
          label: c.course_abbr || c.course_name || '课程',
          sub: `${c.start_time}–${c.end_time}${c.location ? ' · ' + c.location : ''}`,
          color: 'var(--accent)',
          online: (c.location || '').includes('线上'),
          kind: 'course' as const
        })
      }

      // 课程之间才分道；日程用半透明覆盖层，避免把本来就窄的列再切碎
      const coursesOnly = raw.filter((x) => x.kind === 'course').sort((a, b) => a.start - b.start)
      const plansOnly = raw.filter((x) => x.kind === 'plan').sort((a, b) => a.start - b.start)

      const laneEnds: number[] = []
      const placedCourses = coursesOnly.map((it) => {
        let lane = laneEnds.findIndex((end) => end <= it.start)
        if (lane === -1) {
          lane = laneEnds.length
          laneEnds.push(it.end)
        } else {
          laneEnds[lane] = it.end
        }
        return { ...it, lane }
      })
      const total = Math.max(1, laneEnds.length)

      const geom = (it: { start: number; end: number }): { top: number; height: number } => ({
        top: (it.start / 60) * HOUR_H,
        height: Math.max(14, ((it.end - it.start) / 60) * HOUR_H - 1)
      })

      out[key] = [
        ...placedCourses.map((it) => ({
          ...geom(it),
          left: `calc(${(it.lane * 100) / total}% + 1px)`,
          width: `calc(${100 / total}% - 2px)`,
          label: it.label,
          sub: it.sub,
          color: it.color,
          done: it.done,
          online: it.online,
          z: 1
        })),
        ...plansOnly.map((it) => ({
          ...geom(it),
          left: 'calc(2px)',
          width: 'calc(100% - 4px)',
          label: it.label,
          sub: it.sub,
          color: it.color,
          done: it.done,
          online: it.online,
          z: 3
        }))
      ]
    }
    return out
  }, [days, plansByDate, coursesByDay, firstWeekDate])

  const nowTop = ((today.getHours() * 60 + today.getMinutes()) / 60) * HOUR_H

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      {/* 表头 */}
      <div className="flex shrink-0 border-b border-[var(--border)] bg-[var(--bg-deep)]">
        <div className="w-10 shrink-0" />
        {days.map((d) => {
          const key = ymd(d)
          const info = infos[key]
          const isToday = key === ymd(today)
          const isSel = key === selected
          const holiday = info?.is_holiday
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={`flex-1 min-w-0 px-1 py-1 text-center border-l border-[var(--border-soft)] transition-colors ${
                isSel ? 'bg-[var(--accent-soft)]' : holiday ? 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]' : 'hover:bg-[var(--surface-2)]'
              }`}
            >
              <div className={`text-[10.5px] ${isToday ? 'text-[var(--accent-strong)]' : 'text-[var(--faint)]'}`}>
                周{WEEK_CN[(d.getDay() + 6) % 7]}
              </div>
              <div className={`text-[13px] ${isToday ? 'text-white' : 'text-[var(--fg)]'}`}>
                {d.getDate()}
              </div>
              <div className="text-[9px] text-[var(--faint)] truncate">
                {info?.festivals?.[0] || info?.lunar}
              </div>
            </button>
          )
        })}
      </div>

      {/* 时间网格 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR_H }}>
          <div className="w-10 shrink-0 relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-right pr-1 text-[9px] text-[var(--faint)]"
                style={{ top: h * HOUR_H + 1 }}
              >
                {pad(h)}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const key = ymd(d)
            const isToday = key === ymd(today)
            const dayTasks = tasksByDate[key] || []
            return (
              <div key={key} className="relative flex-1 min-w-0 border-l border-[var(--border-soft)]">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-[var(--border-soft)]"
                    style={{ top: h * HOUR_H }}
                  />
                ))}

                {isToday && (
                  <div
                    className="absolute left-0 right-0 border-t border-[var(--danger)] z-20"
                    style={{ top: nowTop }}
                  >
                    <span className="absolute -left-0.5 -top-[3px] w-1.5 h-1.5 rounded-full bg-[var(--danger)]" />
                  </div>
                )}

                {dayTasks.map((t, i) => {
                  if (!t.ddl) return null
                  const m = textToMin(t.ddl.slice(11, 16))
                  return (
                    <div
                      key={`task-${t.id}`}
                      className="absolute left-0.5 right-0.5 z-10 text-[9px] px-1 rounded bg-[color-mix(in_oklch,var(--violet)_16%,transparent)] text-[var(--violet)] truncate border-l-2 border-[var(--violet)]"
                      style={{ top: (m / 60) * HOUR_H + i * 12 }}
                      title={`${t.title} 截止 ${t.ddl.slice(11, 16)}`}
                    >
                      {t.ddl.slice(11, 16)} {t.title}
                    </div>
                  )
                })}

                {(blocksByDay[key] || []).map((b, i) => (
                  <div
                    key={i}
                    className="absolute rounded px-1 py-0.5 text-[9.5px] leading-tight overflow-hidden"
                    style={{
                      top: b.top,
                      height: b.height,
                      left: b.left,
                      width: b.width,
                      zIndex: b.z,
                      background: `color-mix(in oklch, ${b.color} ${b.online ? 10 : b.z > 1 ? 26 : 18}%, transparent)`,
                      borderLeft: `2px ${b.online ? 'dashed' : 'solid'} ${b.color}`,
                      color: b.done ? 'var(--faint)' : 'var(--fg)',
                      textDecoration: b.done ? 'line-through' : 'none'
                    }}
                    title={`${b.label} ${b.sub}`}
                  >
                    <div className="truncate">{b.label}</div>
                    {b.height > 30 && <div className="text-[8.5px] opacity-70 truncate">{b.sub}</div>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 日视图：分钟级时间轴 + 当日课表（规格 §13.4 / §13.5） */
function DayView({
  date,
  plans,
  tasks,
  courses,
  onAdd,
  onDelete,
  onToggle
}: {
  date: string
  plans: DailyPlan[]
  tasks: Task[]
  courses: CourseSlot[]
  onAdd: (title: string, start: string, mins: number, quadrant: string) => void
  onDelete: (id: number) => void
  onToggle: (p: DailyPlan) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('20:00')
  const [minutes, setMinutes] = useState(60)
  const [quadrant, setQuadrant] = useState('q2')

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 6 * HOUR_H - 12
  }, [date])

  const blocks = useMemo(() => {
    const list: {
      top: number
      height: number
      label: string
      sub: string
      color: string
      id?: number
      done?: boolean
      online?: boolean
    }[] = []
    for (const p of plans) {
      const q = qOf(p.quadrant)
      list.push({
        id: p.id,
        top: (p.start_min / 60) * HOUR_H,
        height: Math.max(16, ((p.end_min - p.start_min) / 60) * HOUR_H - 1),
        label: p.title,
        sub: `${minToText(p.start_min)}–${minToText(p.end_min)}`,
        color: q.color,
        done: !!p.done
      })
    }
    for (const c of courses) {
      if (!c.start_time || !c.end_time) continue
      const s = textToMin(c.start_time)
      const e = textToMin(c.end_time)
      list.push({
        top: (s / 60) * HOUR_H,
        height: Math.max(16, ((e - s) / 60) * HOUR_H - 1),
        label: c.course_abbr || c.course_name || '课程',
        sub: `${c.start_time}–${c.end_time}${c.location ? ' · ' + c.location : ''}`,
        color: 'var(--accent)',
        online: (c.location || '').includes('线上')
      })
    }
    return list
  }, [plans, courses])

  return (
    <div className="flex-1 min-h-0 flex gap-2.5">
      <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
        <div className="h-9 shrink-0 flex items-center gap-2 px-2.5 border-b border-[var(--border)]">
          <span className="text-[11.5px] text-[var(--faint)] shrink-0">{date.slice(5)} 日计划</span>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAdd(title, time, minutes, quadrant)}
              placeholder="事项"
              className="w-24 bg-transparent text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--faint)]"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-transparent text-[11px] px-1 py-0.5 rounded border border-[var(--border)] outline-none [color-scheme:dark]"
            />
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="bg-[var(--bg)] text-[11px] px-1 py-0.5 rounded border border-[var(--border)] outline-none"
            >
              {[15, 30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {n}分
                </option>
              ))}
            </select>
            <div className="flex items-center gap-0.5">
              {Object.values(QUADRANTS).map((q) => (
                <button
                  key={q.key}
                  onClick={() => setQuadrant(q.key)}
                  title={q.name}
                  className={`w-3.5 h-3.5 rounded-sm border ${
                    quadrant === q.key ? 'border-white' : 'border-transparent opacity-60'
                  }`}
                  style={{ background: q.color }}
                />
              ))}
            </div>
            <button
              onClick={() => {
                onAdd(title || '新事项', time, minutes, quadrant)
                setTitle('')
              }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--accent)] text-white text-[10.5px]"
            >
              <Plus size={10} /> 添加
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
          <div className="relative" style={{ height: 24 * HOUR_H }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-[var(--border-soft)]"
                style={{ top: h * HOUR_H }}
              >
                <span className="absolute -top-2 left-1.5 text-[9.5px] text-[var(--faint)]">
                  {pad(h)}:00
                </span>
              </div>
            ))}
            <div className="absolute left-11 right-1.5 top-0 bottom-0">
              {blocks.map((b, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 rounded px-1.5 py-0.5 text-[10.5px] leading-tight overflow-hidden group"
                  style={{
                    top: b.top,
                    height: b.height,
                    background: `color-mix(in oklch, ${b.color} ${b.online ? 10 : 19}%, transparent)`,
                    borderLeft: `2px ${b.online ? 'dashed' : 'solid'} ${b.color}`,
                    color: b.done ? 'var(--faint)' : 'var(--fg)',
                    textDecoration: b.done ? 'line-through' : 'none'
                  }}
                  title={`${b.label} ${b.sub}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate">{b.label}</span>
                    {b.id != null && (
                      <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => {
                            const p = plans.find((x) => x.id === b.id)
                            if (p) onToggle(p)
                          }}
                          className="text-[var(--faint)] hover:text-[var(--ok)]"
                        >
                          <Check size={9} />
                        </button>
                        <button
                          onClick={() => onDelete(b.id as number)}
                          className="text-[var(--faint)] hover:text-[var(--danger)]"
                        >
                          <Trash2 size={9} />
                        </button>
                      </span>
                    )}
                  </div>
                  {b.height > 26 && <div className="text-[9.5px] opacity-70 truncate">{b.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="w-[176px] shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 overflow-y-auto">
        <div className="text-[11px] text-[var(--faint)] mb-1.5">当日课表</div>
        {courses.length === 0 ? (
          <div className="text-[10.5px] text-[var(--faint)] leading-relaxed">
            今天没有课
            <div className="text-[10px] text-[var(--faint)] mt-1">课表需学习通刷新后导入</div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {courses.map((c) => (
              <div key={c.id} className="rounded border border-[var(--border)] bg-[var(--bg)] p-1.5">
                <div className="text-[11px] text-[var(--fg)] truncate">
                  {c.course_abbr || c.course_name}
                </div>
                <div className="text-[10px] text-[var(--faint)] mt-0.5">
                  {c.start_time}–{c.end_time}
                </div>
                {c.location && (
                  <div className="flex items-start gap-0.5 text-[10px] text-[var(--faint)] mt-0.5">
                    <MapPin size={8} className="mt-[1px] shrink-0" />
                    <span className="truncate">{c.location}</span>
                  </div>
                )}
                {c.weeks && c.weeks.length <= 6 && (
                  <div className="text-[9.5px] text-[var(--faint)] mt-0.5">第 {c.weeks} 周</div>
                )}
              </div>
            ))}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-[var(--border)]">
            <div className="text-[10.5px] text-[var(--faint)] mb-1">当日截止</div>
            {tasks.map((t) => (
              <div key={t.id} className="text-[10.5px] text-[var(--violet)] truncate">
                {t.ddl?.slice(11, 16)} {t.title}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}

export default CalendarPage
