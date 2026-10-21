import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, Clock, MapPin, CalendarPlus } from 'lucide-react'
import {
  dayInfo,
  listPlans,
  createPlan,
  deletePlan,
  scheduleOf,
  listTasks,
  exportCalendar,
  type DayInfo,
  type DailyPlan,
  type CourseSlot,
  type Task
} from '../lib/api'

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日']
const HOUR_H = 56
const PLAN_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: 'rgba(79,140,255,0.20)', border: '#4f8cff', text: '#bcd4ff' },
  green: { bg: 'rgba(52,199,123,0.18)', border: '#34c77b', text: '#a9edc9' },
  amber: { bg: 'rgba(240,168,64,0.18)', border: '#f0a840', text: '#ffd9a3' },
  violet: { bg: 'rgba(160,120,255,0.18)', border: '#a078ff', text: '#d6c4ff' },
  rose: { bg: 'rgba(255,110,140,0.18)', border: '#ff6e8c', text: '#ffc2cf' }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000)
const minToText = (m: number): string => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

function CalendarPage(): React.JSX.Element {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<string>(ymd(today))
  const [infos, setInfos] = useState<Record<string, DayInfo>>({})
  const [tasks, setTasks] = useState<Task[]>([])
  const [plans, setPlans] = useState<DailyPlan[]>([])
  const [courses, setCourses] = useState<CourseSlot[]>([])
  const [toast, setToast] = useState('')

  const week7 = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    [today]
  )

  // 载入：月视图农历/节日 + 整个范围（月 + 7 天）的计划
  const reloadInfos = useCallback(async () => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(first, -((first.getDay() + 6) % 7))
    const gridEnd = addDays(gridStart, 41)
    const res = await dayInfo(ymd(gridStart), ymd(gridEnd))
    const map: Record<string, DayInfo> = {}
    for (const i of res.items) map[i.date] = i
    setInfos(map)
  }, [cursor])

  const reloadPlans = useCallback(async () => {
    const from = ymd(addDays(today, -1))
    const to = ymd(addDays(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 5), 5))
    const res = await listPlans(from, to)
    setPlans(res.items)
  }, [cursor, today])

  const reloadTasks = useCallback(async () => {
    const res = await listTasks({})
    setTasks(res.items)
  }, [])

  useEffect(() => {
    void reloadInfos()
    void reloadPlans()
    void reloadTasks()
  }, [reloadInfos, reloadPlans, reloadTasks])

  useEffect(() => {
    void (async () => {
      const r = await scheduleOf(selected)
      setCourses(r.items)
    })()
  }, [selected])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const t of tasks) {
      if (!t.ddl) continue
      const key = t.ddl.slice(0, 10)
      ;(map[key] ||= []).push(t)
    }
    return map
  }, [tasks])

  const plansByDate = useMemo(() => {
    const map: Record<string, DailyPlan[]> = {}
    for (const p of plans) (map[p.date] ||= []).push(p)
    return map
  }, [plans])

  const addPlan = async (date: string, title: string, startMin: number, minutes = 60): Promise<void> => {
    if (!title.trim()) return
    await createPlan({
      date,
      start_min: startMin,
      end_min: Math.min(1440, startMin + minutes),
      title: title.trim(),
      color: 'blue'
    })
    await reloadPlans()
    setToast('已添加到日程')
  }

  const removePlan = async (id: number): Promise<void> => {
    await deletePlan(id)
    await reloadPlans()
  }

  const doExport = async (): Promise<void> => {
    const r = await exportCalendar()
    setToast(`已导出 ${r.count} 个事件 → ${r.path}`)
  }

  // 月网格
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(first, -((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [cursor])

  return (
    <div className="flex gap-4 h-[calc(100vh-116px)] min-h-[560px]">
      {/* 左侧：未来 7 天 */}
      <aside className="w-[280px] shrink-0 overflow-y-auto pr-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] text-[#8a8a98]">未来 7 天</span>
          <button
            onClick={() => void doExport()}
            className="flex items-center gap-1 text-[11px] text-[#7a7a88] hover:text-[#4f8cff]"
            title="导出 ICS 到助手目录 exports/（不写 C 盘）"
          >
            <CalendarPlus size={12} /> 导出
          </button>
        </div>

        <div className="space-y-2">
          {week7.map((d) => {
            const key = ymd(d)
            const info = infos[key]
            const dayPlans = plansByDate[key] || []
            const dayTasks = tasksByDate[key] || []
            const isToday = key === ymd(today)
            return (
              <div
                key={key}
                className={`rounded-lg border p-2.5 ${
                  isToday ? 'border-[#3a4a68] bg-[#1a2030]' : 'border-[#26262f] bg-[#1a1a20]'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-[13px] ${isToday ? 'text-[#7db4ff]' : 'text-[#d0d0da]'}`}>
                      {d.getMonth() + 1}/{d.getDate()}
                    </span>
                    <span className="text-[11px] text-[#6b6b7a]">周{WEEK_CN[(d.getDay() + 6) % 7]}</span>
                    {info?.festivals?.[0] && (
                      <span className="text-[10px] px-1 rounded bg-[#3a2f1f] text-[#f0c070]">
                        {info.festivals[0]}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const title = window.prompt(`${key} 添加事项`)
                      if (title) void addPlan(key, title, 20 * 60)
                    }}
                    className="text-[#5c5c6a] hover:text-[#4f8cff]"
                    title="添加事项"
                  >
                    <Plus size={13} />
                  </button>
                </div>

                <div className="mt-1.5 space-y-1">
                  {dayTasks.map((t) => (
                    <div key={`t${t.id}`} className="flex items-center gap-1.5 text-[11.5px]">
                      <span className="w-1 h-1 rounded-full bg-[#ff8080] shrink-0" />
                      <span className="text-[#a8a8b6] truncate">{t.title}</span>
                      <span className="text-[10px] text-[#ff8080] shrink-0">
                        {t.ddl?.slice(11, 16)}
                      </span>
                    </div>
                  ))}
                  {dayPlans.map((p) => (
                    <div key={`p${p.id}`} className="group flex items-center gap-1.5 text-[11.5px]">
                      <span
                        className="w-1 h-1 rounded-full shrink-0"
                        style={{ background: PLAN_COLORS[p.color]?.border ?? '#4f8cff' }}
                      />
                      <span className="text-[#c0c0cc] truncate">{p.title}</span>
                      <span className="text-[10px] text-[#6b6b7a] shrink-0">
                        {minToText(p.start_min)}
                      </span>
                      <button
                        onClick={() => void removePlan(p.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-[#6b6b7a] hover:text-[#ff8080]"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  {dayTasks.length === 0 && dayPlans.length === 0 && (
                    <div className="text-[11px] text-[#4a4a58]">暂无安排</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </aside>

      {/* 右侧：月历 + 当日详情 */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="p-1 rounded text-[#8a8a98] hover:text-[#e0e0e8] hover:bg-[#1c1c22]"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[14px] text-[#e0e0e8]">
              {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
            </span>
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="p-1 rounded text-[#8a8a98] hover:text-[#e0e0e8] hover:bg-[#1c1c22]"
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => {
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
                setSelected(ymd(today))
              }}
              className="ml-1 px-2 py-0.5 rounded text-[11px] text-[#8a8a98] border border-[#2e2e38] hover:text-[#e0e0e8]"
            >
              今天
            </button>
          </div>
          <span className="text-[11px] text-[#4a4a58]">
            农历与节气为算法推算 · 放假区间仅供参考
          </span>
        </div>

        <div className="grid grid-cols-7 gap-px bg-[#26262f] rounded-lg overflow-hidden border border-[#26262f]">
          {WEEK_CN.map((w) => (
            <div key={w} className="bg-[#16161a] py-1.5 text-center text-[11px] text-[#6b6b7a]">
              周{w}
            </div>
          ))}
          {cells.map((d) => {
            const key = ymd(d)
            const info = infos[key]
            const inMonth = d.getMonth() === cursor.getMonth()
            const isToday = key === ymd(today)
            const isSel = key === selected
            const dayTaskCount = (tasksByDate[key] || []).length
            const dayPlanCount = (plansByDate[key] || []).length
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`relative h-[62px] px-1.5 py-1 text-left transition-colors ${
                  isSel
                    ? 'bg-[#1e2432]'
                    : info?.is_holiday && inMonth
                      ? 'bg-[#201a1a] hover:bg-[#26202a]'
                      : 'bg-[#16161a] hover:bg-[#1c1c22]'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className={`text-[12.5px] ${
                      isToday
                        ? 'text-white bg-[#4f8cff] rounded-full w-[18px] h-[18px] inline-flex items-center justify-center'
                        : inMonth
                          ? 'text-[#d0d0da]'
                          : 'text-[#4a4a58]'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {(dayTaskCount > 0 || dayPlanCount > 0) && (
                    <span className="flex gap-0.5">
                      {dayTaskCount > 0 && <span className="w-1 h-1 rounded-full bg-[#ff8080]" />}
                      {dayPlanCount > 0 && <span className="w-1 h-1 rounded-full bg-[#4f8cff]" />}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 leading-tight">
                  <div className={`text-[10px] ${inMonth ? 'text-[#6b6b7a]' : 'text-[#3a3a46]'}`}>
                    {info?.lunar}
                  </div>
                  {info?.festivals?.[0] && (
                    <div className="text-[10px] text-[#f0a860] truncate">{info.festivals[0]}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <DayView
          date={selected}
          plans={plansByDate[selected] || []}
          tasks={tasksByDate[selected] || []}
          courses={courses}
          onAdd={(title, start, mins) => void addPlan(selected, title, start, mins)}
          onDelete={(id) => void removePlan(id)}
        />
      </div>

      {toast && (
        <div className="fixed bottom-12 right-6 px-3 py-2 rounded-md bg-[#16302a] text-[#7ee2b8] text-[12px] shadow-lg max-w-[420px] break-all">
          {toast}
        </div>
      )}
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
  onDelete
}: {
  date: string
  plans: DailyPlan[]
  tasks: Task[]
  courses: CourseSlot[]
  onAdd: (title: string, startMin: number, mins?: number) => void
  onDelete: (id: number) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('20:00')
  const [minutes, setMinutes] = useState(60)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H - 20
  }, [date])

  const blocks = useMemo(() => {
    const list: { top: number; height: number; label: string; sub: string; color: string; id?: number }[] = []
    for (const p of plans) {
      const c = PLAN_COLORS[p.color] ?? PLAN_COLORS.blue
      list.push({
        id: p.id,
        top: (p.start_min / 60) * HOUR_H,
        height: Math.max(18, ((p.end_min - p.start_min) / 60) * HOUR_H - 2),
        label: p.title,
        sub: `${minToText(p.start_min)}–${minToText(p.end_min)}`,
        color: c.border
      })
    }
    for (const c of courses) {
      if (!c.start_time || !c.end_time) continue
      const [sh, sm] = c.start_time.split(':').map(Number)
      const [eh, em] = c.end_time.split(':').map(Number)
      const startM = sh * 60 + sm
      const endM = eh * 60 + em
      list.push({
        top: (startM / 60) * HOUR_H,
        height: Math.max(18, ((endM - startM) / 60) * HOUR_H - 2),
        label: c.course_abbr || c.course_name || '课程',
        sub: `${c.start_time}–${c.end_time}${c.location ? ' · ' + c.location : ''}`,
        color: '#2f6fbf'
      })
    }
    return list
  }, [plans, courses])

  const add = (): void => {
    const [h, m] = time.split(':').map(Number)
    onAdd(title || '新事项', h * 60 + m, minutes)
    setTitle('')
  }

  return (
    <div className="flex-1 min-h-0 flex gap-3">
      {/* 时间轴 */}
      <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-[#26262f] bg-[#16161a] overflow-hidden">
        <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-[#26262f]">
          <span className="text-[12px] text-[#9a9aa8]">{date} · 日计划</span>
          <div className="flex items-center gap-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="事项"
              className="w-24 bg-transparent text-[11.5px] px-1.5 py-0.5 rounded border border-[#2e2e38] outline-none focus:border-[#4f8cff] placeholder:text-[#4a4a58]"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-transparent text-[11.5px] px-1 py-0.5 rounded border border-[#2e2e38] outline-none [color-scheme:dark]"
            />
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="bg-[#16161a] text-[11.5px] px-1 py-0.5 rounded border border-[#2e2e38] outline-none"
            >
              {[15, 30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {n} 分钟
                </option>
              ))}
            </select>
            <button
              onClick={add}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#4f8cff] text-white text-[11px]"
            >
              <Plus size={11} /> 添加
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
          <div className="relative" style={{ height: 24 * HOUR_H }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-[#22222a]"
                style={{ top: h * HOUR_H }}
              >
                <span className="absolute -top-2 left-1.5 text-[10px] text-[#4a4a58]">
                  {pad(h)}:00
                </span>
              </div>
            ))}

            <div className="absolute left-12 right-2 top-0 bottom-0">
              {blocks.map((b, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 rounded px-2 py-1 text-[11px] leading-tight overflow-hidden group"
                  style={{
                    top: b.top,
                    height: b.height,
                    background: `${b.color}33`,
                    borderLeft: `2px solid ${b.color}`,
                    color: '#dcdce6'
                  }}
                  title={`${b.label} ${b.sub}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{b.label}</span>
                    {b.id != null && (
                      <button
                        onClick={() => onDelete(b.id as number)}
                        className="opacity-0 group-hover:opacity-100 text-[#8a8a98] hover:text-[#ff8080]"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                  {b.height > 30 && (
                    <div className="text-[10px] opacity-70 truncate">{b.sub}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 当日课表 */}
      <aside className="w-[210px] shrink-0 rounded-lg border border-[#26262f] bg-[#1a1a20] p-2.5 overflow-y-auto">
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={12} className="text-[#5c5c6a]" />
          <span className="text-[11.5px] text-[#9a9aa8]">当日课表</span>
        </div>

        {courses.length === 0 ? (
          <div className="text-[11px] text-[#4a4a58] leading-relaxed">
            今天没有课
            <br />
            <span className="text-[#3d3d48]">（课表数据需在学习通刷新后获得）</span>
          </div>
        ) : (
          <div className="space-y-2">
            {courses.map((c) => (
              <div key={c.id} className="rounded border border-[#2a2a34] bg-[#16161a] p-2">
                <div className="text-[12px] text-[#dcdce6] truncate">
                  {c.course_abbr || c.course_name}
                </div>
                <div className="text-[10.5px] text-[#7a7a88] mt-0.5">
                  {c.start_time}–{c.end_time}
                </div>
                {c.location && (
                  <div className="flex items-center gap-1 text-[10.5px] text-[#6b6b7a] mt-0.5">
                    <MapPin size={9} /> {c.location}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="mt-3 pt-2 border-t border-[#26262f]">
            <div className="text-[11px] text-[#9a9aa8] mb-1.5">当日截止</div>
            {tasks.map((t) => (
              <div key={t.id} className="text-[11px] text-[#c8a0a0] truncate">
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
