import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  MapPin,
  Upload,
  Download,
  Check,
  Info
} from 'lucide-react'
import { toast } from '../components/Toast'
import { readViewCache, writeViewCache } from '../lib/viewCache'
import { weeksContain, weekOfDate } from '../lib/weeks'
import { withViewTransition } from '../lib/viewTransition'
import {
  DEFAULT_SECTIONS,
  parseSections,
  sectionRange,
  toMin as secToMin,
  type SectionTime
} from '../lib/schedule'
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
  getSettings,
  chaoxingRefreshSchedule,
  type DayInfo,
  type DailyPlan,
  type CourseSlot,
  type WeekCourse,
  type Task
} from '../lib/api'

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日']

/** 日历页快照：切回本页时先复用上次的月份数据，避免日期格上的任务点/课程先空一下 */
interface CalendarSnapshot {
  month: string
  infos: Record<string, DayInfo>
  tasks: Task[]
  plans: DailyPlan[]
  coursesAll: WeekCourse[]
  weekNo: number | null
  firstWeekDate: string | null
}

const CALENDAR_VIEW_KEY = 'calendar:snapshot'

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

type ViewMode = 'month' | 'week' | 'day' | 'list'

const VIEWS: [ViewMode, string][] = [
  ['month', '月'],
  ['week', '周'],
  ['day', '日'],
  ['list', '列表']
]

function CalendarPage({
  onNavigate
}: {
  onNavigate?: (p: 'settings') => void
} = {}): React.JSX.Element {
  const today = useMemo(() => new Date(), [])
  const initialMonth = ymd(new Date(today.getFullYear(), today.getMonth(), 1))
  const cachedCal = readViewCache<CalendarSnapshot>(CALENDAR_VIEW_KEY)
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<string>(ymd(today))
  const [view, setView] = useState<ViewMode>('month')
  // 是否显示农历（设置 → 日历 里可开关）
  const [showLunar, setShowLunar] = useState(true)
  const [infos, setInfos] = useState<Record<string, DayInfo>>(() =>
    cachedCal && cachedCal.month === initialMonth ? cachedCal.infos : {}
  )
  const [tasks, setTasks] = useState<Task[]>(() => cachedCal?.tasks ?? [])
  const [plans, setPlans] = useState<DailyPlan[]>(() => cachedCal?.plans ?? [])
  const [courses, setCourses] = useState<CourseSlot[]>([])
  const [coursesAll, setCoursesAll] = useState<WeekCourse[]>(() => cachedCal?.coursesAll ?? [])
  const [weekNo, setWeekNo] = useState<number | null>(() => cachedCal?.weekNo ?? null)
  const [firstWeekDate, setFirstWeekDate] = useState<string | null>(
    () => cachedCal?.firstWeekDate ?? null
  )
  const [chaoxingLogged, setChaoxingLogged] = useState(true) // 默认不打扰，查到未登录才提示
  const [formOpen, setFormOpen] = useState(false)
  // 课表时间：是否信任超星返回的时间；关闭时用节次显示
  const [autoTime, setAutoTime] = useState(false)
  const [sections, setSections] = useState<SectionTime[]>(DEFAULT_SECTIONS)
  const [customSections, setCustomSections] = useState(false)
  const monthKey = useMemo(
    () => ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1)),
    [cursor]
  )

  useEffect(() => {
    writeViewCache<CalendarSnapshot>(CALENDAR_VIEW_KEY, {
      month: monthKey,
      infos,
      tasks,
      plans,
      coursesAll,
      weekNo,
      firstWeekDate
    })
  }, [monthKey, infos, tasks, plans, coursesAll, weekNo, firstWeekDate])

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
    void getSettings()
      .then((s) => {
        setAutoTime(s.chaoxing_auto_time === 'on')
        setShowLunar(s.calendar_lunar !== 'off')
        const parsed = parseSections(s.section_times)
        setCustomSections(!!parsed)
        if (parsed) setSections(parsed)
      })
      .catch(() => {
        /* 后端未就绪 */
      })
    void adaptersStatus()
      .then((st) => setChaoxingLogged(!!st.chaoxing?.logged_in))
      .catch(() => {
        /* 后端未就绪时不提示 */
      })
  }, [reloadInfos, reloadPlans])

  useEffect(() => {
    void scheduleOf(selected).then((r) => setCourses(r.items))
  }, [selected])

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

  const selectedDate = useMemo(() => {
    const d = new Date(`${selected}T00:00:00`)
    return Number.isNaN(d.getTime()) ? today : d
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
    toast('已加入日程')
  }

  const toggleDone = async (p: DailyPlan): Promise<void> => {
    await updatePlan(p.id, { done: p.done ? 0 : 1 })
    await reloadPlans()
  }

  const doExport = async (): Promise<void> => {
    const r = await exportCalendar()
    toast(`已导出 ${r.count} 个事件 → ${r.path}`)
  }

  const step = (dir: number): void => {
    // 月/周/日翻页统一为「带方向的横向滑动」：向后翻，内容向左走；向前翻则相反
    withViewTransition('calendar', dir > 0 ? 'left' : 'right', () => {
      if (view === 'week') {
        setSelected(ymd(addDays(weekStart, dir * 7)))
        return
      }
      if (view === 'day') {
        setSelected(ymd(addDays(selectedDate, dir)))
        return
      }
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1))
    })
  }

  const goToday = (): void => {
    const target = new Date(today.getFullYear(), today.getMonth(), 1)
    if (target.getTime() === cursor.getTime()) {
      setSelected(ymd(today))
      return
    }
    withViewTransition('calendar', target > cursor ? 'left' : 'right', () => {
      setCursor(target)
      setSelected(ymd(today))
    })
  }

  const period =
    view === 'week'
      ? `${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${addDays(weekStart, 6).getMonth() + 1}/${addDays(weekStart, 6).getDate()}`
      : view === 'day'
        ? `${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日 · 周${
            WEEK_CN[(selectedDate.getDay() + 6) % 7]
          }`
        : `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`

  const dayPlans = plansByDate[selected] || []
  const dayTasks = tasksByDate[selected] || []
  const selIsToday = selected === ymd(today)
  const selectedInfo = infos[selected]

  // 视图 + 当前周期一起决定 key：换视图、翻月、翻周、换日都会重放入场动画
  const viewKey =
    view === 'month' || view === 'list'
      ? `${view}:${cursor.getFullYear()}-${cursor.getMonth()}`
      : view === 'week'
        ? `week:${ymd(weekStart)}`
        : `day:${ymd(selectedDate)}`

  return (
    <div className="cal-shell">
      {/* ============ 主区 ============ */}
      <div className="cal-main">
        <div className="cal-toolbar">
          <div className="cal-title-wrap">
            <span className="cal-period">{period}</span>
            {/* 周次：数字到位时才渐显，不再显示「正在同步/课表未同步」这类提示 */}
            {showLunar && selectedInfo?.lunar && (
              <span className="cal-sub cal-lunar-label">{selectedInfo.lunar}</span>
            )}
            {weekNo != null && (
              <span className="cal-sub cal-week-label">
                第 <b key={weekNo} className="cal-week-no">{weekNo}</b> 周
              </span>
            )}
          </div>

          <div className="cal-nav">
            <button className="mini-btn" onClick={() => step(-1)} aria-label="上一页">
              <ChevronLeft size={16} />
            </button>
            <button className="mini-btn" onClick={() => step(1)} aria-label="下一页">
              <ChevronRight size={16} />
            </button>
            <button className="btn btn-ghost sm" onClick={goToday}>
              今天
            </button>
          </div>

          <div className="segment">
            {VIEWS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={view === k ? 'active' : ''}
                onClick={() => setView(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="right">
            <button
              className="btn btn-secondary sm"
              onClick={async () => {
                toast('正在同步课表…')
                const r = await chaoxingRefreshSchedule()
                toast(r.ok ? r.message || '课表已同步' : r.message || '同步失败')
                const [all, meta] = await Promise.all([scheduleAll(), scheduleMeta()])
                setCoursesAll(all.items)
                setWeekNo(meta.current_week)
              }}
            >
              <Upload size={13} strokeWidth={1.8} /> 导入课表
            </button>
            <button className="btn btn-secondary sm" onClick={() => void doExport()}>
              <Download size={13} strokeWidth={1.8} /> 导出 ics
            </button>
            <button className="btn btn-primary sm" onClick={() => setFormOpen((v) => !v)}>
              <Plus size={13} strokeWidth={2} /> 新建日程
            </button>
          </div>
        </div>

        {!autoTime && !customSections && (
          <div className="status-note" style={{ flex: 'none' }}>
            <Info size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>
              课表时间可能不准确（超星返回的作息常与学校实际不符）。可到「设置 → 学习通」开启自动获取，
              或手动配置每节课的起止时间。
            </span>
            {onNavigate && (
              <button className="btn btn-secondary sm" onClick={() => onNavigate('settings')}>
                去设置
              </button>
            )}
          </div>
        )}

        {/* 图例：月 / 周 / 日视图通用，说明颜色含义 */}
        {(
          <div className="cal-legend-bar">
            <span>
              <i className="lg q1" />紧急且重要
            </span>
            <span>
              <i className="lg q2" />重要不紧急
            </span>
            <span>
              <i className="lg q3" />紧急不重要
            </span>
            <span>
              <i className="lg q4" />不紧急不重要
            </span>
            <span>
              <i className="lg course" />课程
            </span>
            <span>
              <i className="lg due" />作业截止
            </span>
            <em>虚线 = 线上课</em>
          </div>
        )}

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
          <div className="status-note" style={{ flex: 'none' }}>
            <Info size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>
              还没有课表数据。登录学习通后会自动同步本学期课程，周视图和日视图就能看到每天在哪上课。
            </span>
            {onNavigate && (
              <button className="btn btn-secondary sm" onClick={() => onNavigate('settings')}>
                去设置登录
              </button>
            )}
          </div>
        )}

        <div className="cal-body view-swap" key={viewKey}>
          {view === 'month' ? (
            <div className="cal-month">
              {WEEK_CN.map((w) => (
                <div key={w} className="cal-weekday">
                  周{w}
                </div>
              ))}
              {cells.map((d) => {
                const key = ymd(d)
                const info = infos[key]
                const inMonth = d.getMonth() === cursor.getMonth()
                const isToday = key === ymd(today)
                const isSel = key === selected
                const weekend = d.getDay() === 0 || d.getDay() === 6
                const cellPlans = plansByDate[key] || []
                const cellTasks = tasksByDate[key] || []
                const more = cellPlans.length - 2
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    onDoubleClick={() => {
                      setSelected(key)
                      setFormOpen(true)
                    }}
                    className={`cal-cell${inMonth ? '' : ' out'}${weekend ? ' weekend' : ''}${
                      isSel ? ' selected' : ''
                    }${isToday ? ' today' : ''}${info?.is_holiday && inMonth ? ' holiday' : ''}`}
                  >
                    <div className="cal-cell-head">
                      <span className="cal-daynum">{d.getDate()}</span>
                      {info?.is_holiday && inMonth && <span className="cal-holiday-tag">休</span>}
                      {d.getDate() === 1 && (
                        <span className="cal-month-chip">{d.getMonth() + 1}月</span>
                      )}
                      {showLunar && <span className="cal-lunar">{info?.lunar}</span>}
                    </div>

                    <div className="cal-events">
                      {cellPlans.slice(0, 2).map((p) => {
                        const q = qOf(p.quadrant)
                        return (
                          <div key={p.id} className="cal-event">
                            <span className="dot" style={{ background: q.color }} />
                            <span className="t">{minToText(p.start_min)}</span>
                            <span className="n">{p.title}</span>
                          </div>
                        )
                      })}
                      {more > 0 && <span className="cal-more">+{more} 项</span>}
                      {cellTasks.length > 0 && (
                        <div className="cal-event task">
                          <span className="dot" style={{ background: 'var(--violet)' }} />
                          <span className="t">{cellTasks[0].ddl?.slice(11, 16)}</span>
                          <span className="n">截止 {cellTasks.length} 项作业</span>
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
              autoTime={autoTime}
              sections={sections}
              showLunar={showLunar}
              selected={selected}
              onSelect={setSelected}
            />
          ) : view === 'day' ? (
            <DayView
              date={selected}
              plans={dayPlans}
              tasks={dayTasks}
              courses={courses}
              autoTime={autoTime}
              sections={sections}
              onAdd={(title, start, mins, quadrant) =>
                void addPlan({ date: selected, start, mins, title, quadrant })
              }
              onDelete={(id) => void deletePlan(id).then(reloadPlans)}
              onToggle={(p) => void toggleDone(p)}
            />
          ) : (
            <div className="cal-list">
              {Array.from({ length: 42 }, (_, i) => addDays(cells[0], i))
                .filter((d) => {
                  const k = ymd(d)
                  return (plansByDate[k] || []).length > 0 || (tasksByDate[k] || []).length > 0
                })
                .map((d) => {
                  const k = ymd(d)
                  return (
                    <div key={k} className="cal-list-day">
                      <div className="cal-list-date">
                        <b>
                          {d.getMonth() + 1}/{d.getDate()} 周
                          {WEEK_CN[(d.getDay() + 6) % 7]}
                        </b>
                        <span>
                          {infos[k]?.lunar} {infos[k]?.festivals?.[0] ?? ''}
                        </span>
                      </div>
                      {(plansByDate[k] || []).map((p) => {
                        const q = qOf(p.quadrant)
                        return (
                          <div key={p.id} className="cal-list-row">
                            <span className="time">
                              {minToText(p.start_min)}–{minToText(p.end_min)}
                            </span>
                            <span className="dot" style={{ background: q.color }} />
                            <span className="name" style={p.done ? { color: 'var(--faint)', textDecoration: 'line-through' } : undefined}>
                              {p.title}
                            </span>
                          </div>
                        )
                      })}
                      {(tasksByDate[k] || []).map((t) => (
                        <div key={t.id} className="cal-list-row">
                          <span className="time">{t.ddl?.slice(11, 16)}</span>
                          <span className="dot" style={{ background: 'var(--violet)' }} />
                          <span className="name">{t.title}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              {tasks.length === 0 && plans.length === 0 && (
                <div className="empty" style={{ margin: 14 }}>
                  <p>这个月还没有安排。</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ============ 右栏 ============ */}
      <aside className="cal-rail">
        <section className="rail-card">
          <div className="rail-head">
            <div>
              <div className="rail-kicker">{selIsToday ? 'Today' : 'Selected day'}</div>
              <div className="rail-date">
                {selectedDate.getDate()}
                <small>
                  {selectedDate.getMonth() + 1} 月 · 周
                  {WEEK_CN[(selectedDate.getDay() + 6) % 7]}
                </small>
              </div>
            </div>
            <button
              className="mini-btn"
              onClick={() => setFormOpen(true)}
              title="在这一天新建日程"
            >
              <Plus size={15} />
            </button>
          </div>

          {dayPlans.length === 0 && dayTasks.length === 0 ? (
            <div className="rail-empty">这一天没有安排。</div>
          ) : (
            <div className="agenda view-swap" key={selected}>
              {dayPlans.map((p) => {
                const q = qOf(p.quadrant)
                return (
                  <div key={p.id} className="agenda-row">
                    <span className="dot" style={{ background: q.color }} />
                    <span className="time">{minToText(p.start_min)}</span>
                    <div className="body">
                      <div className={`name${p.done ? ' done' : ''}`}>{p.title}</div>
                      <div className="sub">
                        {minToText(p.start_min)}–{minToText(p.end_min)} · {q.short}
                      </div>
                    </div>
                    <button
                      className={`agenda-check${p.done ? ' on' : ''}`}
                      onClick={() => void toggleDone(p)}
                      title={p.done ? '标记为未完成' : '标记为完成'}
                    >
                      {p.done && <Check size={9} strokeWidth={3} />}
                    </button>
                    <button
                      className="mini-btn danger"
                      onClick={() => void deletePlan(p.id).then(reloadPlans)}
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
              {dayTasks.map((t) => (
                <div key={t.id} className="agenda-row">
                  <span className="dot" style={{ background: 'var(--violet)' }} />
                  <span className="time">{t.ddl?.slice(11, 16)}</span>
                  <div className="body">
                    <div className="name">{t.title}</div>
                    <div className="sub">截止 · {t.course_abbr || t.platform}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="rail-foot">双击日期格或点 + 新建日程</div>
        </section>

        <section className="rail-card">
          <div className="rail-head">
            <div>
              <div className="rail-kicker">Courses</div>
              <div className="rail-title">当日课表</div>
            </div>
          </div>
          {courses.length === 0 ? (
            <div className="rail-empty">今天没有课</div>
          ) : (
            <div className="agenda">
              {courses.map((c) => (
                <div key={c.id} className="agenda-row" style={{ cursor: 'default' }}>
                  <span className="dot" style={{ background: 'var(--accent)' }} />
                  <span className="time">{c.start_time}</span>
                  <div className="body">
                    <div className="name">{c.course_abbr || c.course_name}</div>
                    <div className="sub">
                      {c.start_time}–{c.end_time}
                      {c.location ? ` · ${c.location}` : ''}
                    </div>
                  </div>
                  {c.location && <MapPin size={11} style={{ color: 'var(--faint)', flex: 'none', marginTop: 4 }} />}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rail-card">
          <div className="rail-head">
            <div>
              <div className="rail-kicker">Next 7 days</div>
              <div className="rail-title">接下来 7 天</div>
            </div>
          </div>
          <div className="agenda">
            {next7.map(({ date: d, key, plans: dayPlans2, tasks: dayTasks2 }) => {
              const count = dayPlans2.length + dayTasks2.length
              const first = dayPlans2[0]?.title || (dayTasks2[0] ? `截止 ${dayTasks2[0].title}` : '—')
              const isToday = key === ymd(today)
              return (
                <button key={key} className="rail-day" onClick={() => setSelected(key)}>
                  <span className="d">{isToday ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`}</span>
                  <span className="n">{first}</span>
                  <span className="c">{count || ''}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rail-card">
          <div className="rail-head">
            <div>
              <div className="rail-kicker">Holiday</div>
              <div className="rail-title">法定节假日</div>
            </div>
          </div>
          {nextHoliday ? (
            <>
              <div className="rail-date" style={{ fontSize: 22 }}>
                {nextHoliday.name}
                <small>
                  {nextHoliday.date.getMonth() + 1} 月 {nextHoliday.date.getDate()} 日 · 还有{' '}
                  {Math.round((nextHoliday.date.getTime() - today.getTime()) / 86400000)} 天
                </small>
              </div>
              <div className="rail-foot">
                农历与节气为算法推算；放假区间按规则近似，遇国务院调休通知可能偏差。
              </div>
            </>
          ) : (
            <div className="rail-empty">未来 120 天内暂无识别到的法定节假日。</div>
          )}

          <div className="rail-foot" style={{ marginTop: 14 }}>
            <div className="rail-title" style={{ marginBottom: 6 }}>
              图例
            </div>
            <div className="legend">
              {Object.values(QUADRANTS).map((q) => (
                <span key={q.key}>
                  <i style={{ background: q.color }} />
                  {q.name}
                </span>
              ))}
              <span>
                <i style={{ background: 'var(--violet)' }} /> 作业截止
              </span>
              <span>
                <i style={{ background: 'var(--accent)' }} /> 课程
              </span>
            </div>
          </div>
        </section>
      </aside>
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
    <div className="plan-form">
      <div className="plan-form-row">
        <input
          autoFocus
          className="input grow"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit({ date, start, mins, title, quadrant })}
          placeholder="日程内容"
          style={{ height: 34 }}
        />
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ width: 148, height: 34 }}
        />
        <input
          type="time"
          className="input"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          style={{ width: 110, height: 34 }}
        />
        <select
          className="select"
          value={mins}
          onChange={(e) => setMins(Number(e.target.value))}
          style={{ width: 118, height: 34 }}
        >
          {[15, 30, 45, 60, 90, 120, 180].map((n) => (
            <option key={n} value={n}>
              {n} 分钟
            </option>
          ))}
        </select>
      </div>

      <div className="plan-form-row">
        <div className="pill-row" style={{ marginRight: 'auto' }}>
          {Object.values(QUADRANTS).map((q) => (
            <button
              key={q.key}
              className="pill"
              aria-pressed={quadrant === q.key}
              title={q.name}
              onClick={() => setQuadrant(q.key)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span className="dot" style={{ background: q.color, width: 6, height: 6, borderRadius: 999 }} />
              {q.short}
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary sm"
          onClick={() => onSubmit({ date, start, mins, title, quadrant })}
        >
          添加
        </button>
        <button className="btn btn-ghost sm" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

/** 周视图：7 列时间网格，高度自适应容器（默认 07:00–23:00，有越界事件时自动扩展） */
function WeekView({
  weekStart,
  today,
  infos,
  plansByDate,
  tasksByDate,
  courses,
  firstWeekDate,
  autoTime,
  sections,
  showLunar,
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
  autoTime: boolean
  sections: SectionTime[]
  showLunar: boolean
  selected: string
  onSelect: (d: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(0)

  // 容器高度 → 每个小时的高度，让 24 小时在可视区域内排得下
  // 画布有内边距，扣掉后网格才不会在自适应模式下被底部裁切
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): number => {
      const cs = window.getComputedStyle(el)
      const pad = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
      return Math.max(0, el.clientHeight - pad)
    }
    const ro = new ResizeObserver(() => setBoxH(measure()))
    ro.observe(el)
    setBoxH(measure())
    return () => ro.disconnect()
  }, [])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const coursesByDay = useMemo(() => {
    const m: Record<number, WeekCourse[]> = {}
    for (const c of courses) (m[c.weekday] ||= []).push(c)
    return m
  }, [courses])

  /** 老数据没有 section 时，用开始时间排位兜底 */
  const rank = useMemo(() => {
    const times = Array.from(
      new Set(courses.map((c) => c.start_time).filter(Boolean) as string[])
    ).sort()
    const m: Record<string, number> = {}
    times.forEach((t, i) => {
      m[t] = i + 1
    })
    return m
  }, [courses])

  const blocksByDay = useMemo(() => {
    type Block = {
      s: number
      e: number
      left: string
      width: string
      label: string
      sub: string
      color: string
      done?: boolean
      online?: boolean
      z: number
    }
    const out: Record<string, Block[]> = {}

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

      // 周视图不再把日程铺在网格上：会和课程块叠在一起，反而看不清。
      // 现在只在日视图/侧栏展示，周视图用列头的小圆点提示「这天有事」。
      const weekNo = firstWeekDate ? weekOfDate(d, firstWeekDate) : null
      for (const c of coursesByDay[d.getDay() === 0 ? 7 : d.getDay()] || []) {
        if (autoTime && (!c.start_time || !c.end_time)) continue
        if (weekNo != null && !weeksContain(c.weeks, weekNo)) continue

        const sec = c.section ?? (c.start_time ? rank[c.start_time] : 1) ?? 1
        const range = autoTime
          ? { start: c.start_time as string, end: c.end_time as string }
          : sectionRange(sec, sections)

        raw.push({
          start: autoTime ? textToMin(c.start_time as string) : secToMin(range.start),
          end: autoTime ? textToMin(c.end_time as string) : secToMin(range.end),
          label: c.course_abbr || c.course_name || '课程',
          sub: autoTime
            ? `${c.start_time}–${c.end_time}${c.location ? ' · ' + c.location : ''}`
            : `第${sec}节${c.location ? ' · ' + c.location : ''}`,
          color: 'var(--accent)',
          online: (c.location || '').includes('线上'),
          kind: 'course' as const
        })
      }

      // 课程之间才分道；日程用半透明覆盖层，避免把本来就窄的列再切碎
      const coursesOnly = raw.filter((x) => x.kind === 'course').sort((a, b) => a.start - b.start)

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

      out[key] = placedCourses.map((it) => ({
        s: it.start,
        e: it.end,
        left: `calc(${(it.lane * 100) / total}% + 1px)`,
        width: `calc(${100 / total}% - 2px)`,
        label: it.label,
        sub: it.sub,
        color: it.color,
        done: it.done,
        online: it.online,
        z: 1
      }))
    }
    return out
  }, [days, coursesByDay, firstWeekDate])

  /** 可视时间窗：默认 07:00–23:00；有事件越界时向外扩 */
  const [winStart, winEnd] = useMemo(() => {
    let s = 7
    let e = 23
    for (const list of Object.values(blocksByDay)) {
      for (const b of list) {
        s = Math.min(s, Math.floor(b.s / 60))
        e = Math.max(e, Math.ceil(b.e / 60))
      }
    }
    s = Math.max(0, s)
    e = Math.min(24, e)
    if (e - s < 4) e = Math.min(24, s + 4)
    return [s, e]
  }, [blocksByDay])

  const span = Math.max(1, winEnd - winStart)
  // 让整段窗口正好铺满容器；太挤时给下限并允许滚动
  const hourH = boxH > 120 ? Math.max(22, boxH / span) : 34
  const overflowing = hourH * span > boxH + 1
  const gridH = span * hourH

  const nowMin = today.getHours() * 60 + today.getMinutes()
  const nowTop = ((nowMin - winStart * 60) / 60) * hourH
  const nowVisible = nowMin >= winStart * 60 && nowMin <= winEnd * 60

  useEffect(() => {
    if (overflowing && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [overflowing, weekStart])

  return (
    <div className="cal-week">
      {/* 表头 */}
      <div className="cal-week-head">
        <div className="corner" />
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
              className={`cal-week-day${isSel ? ' selected' : ''}${isToday ? ' today' : ''}${
                holiday ? ' holiday' : ''
              }`}
            >
              <div className="w">周{WEEK_CN[(d.getDay() + 6) % 7]}</div>
              <div className="d">
                {d.getDate()}
                {(() => {
                  const plans = (plansByDate[key] || []).length
                  const dues = (tasksByDate[key] || []).length
                  const n = plans + dues
                  if (!n) return null
                  return (
                    <span
                      className="cal-week-dot"
                      title={`${plans ? `${plans} 项日程` : ''}${plans && dues ? '，' : ''}${
                        dues ? `${dues} 个截止` : ''
                      }（点这天看详情）`}
                    />
                  )
                })()}
              </div>
              <div className="l">{info?.festivals?.[0] || (showLunar ? info?.lunar : '')}</div>
            </button>
          )
        })}
      </div>

      {/* 时间网格 */}
      <div
        ref={scrollRef}
        className={`cal-week-scroll${overflowing ? '' : ' fit'}`}
      >
        <div className="cal-week-grid" style={{ height: gridH }}>
          <div className="cal-week-times">
            {Array.from({ length: span + 1 }, (_, i) => (
              <div key={i} className="cal-week-time" style={{ top: i * hourH }}>
                {pad(winStart + i)}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const key = ymd(d)
            const isToday = key === ymd(today)
            return (
              <div key={key} className="cal-week-col">
                {Array.from({ length: span + 1 }, (_, i) => (
                  <div key={i} className="cal-week-line" style={{ top: i * hourH }} />
                ))}

                {isToday && nowVisible && (
                  <div className="cal-now" style={{ top: nowTop }} aria-hidden="true" />
                )}


                {(blocksByDay[key] || []).map((b, i) => {
                  const top = ((b.s - winStart * 60) / 60) * hourH
                  const height = Math.max(14, ((b.e - b.s) / 60) * hourH - 1)
                  return (
                    <div
                      key={i}
                      className={`cal-week-block${b.done ? ' done' : ''}${
                        b.online ? ' online' : ''
                      }`}
                      style={{
                        top,
                        height,
                        left: b.left,
                        width: b.width,
                        zIndex: b.z,
                        background: `color-mix(in oklch, ${b.color} ${
                          b.online ? 9 : b.z > 1 ? 18 : 12
                        }%, transparent)`,
                        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${b.color} 34%, transparent)`
                      }}
                      title={`${b.label} ${b.sub}`}
                    >
                      <div className="lbl">{b.label}</div>
                      {height > 30 && <div className="sub">{b.sub}</div>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 日视图：单日时间轴，同样自适应高度 */
function DayView({
  date,
  plans,
  tasks,
  courses,
  autoTime,
  sections,
  onAdd,
  onDelete,
  onToggle
}: {
  date: string
  plans: DailyPlan[]
  tasks: Task[]
  courses: CourseSlot[]
  autoTime: boolean
  sections: SectionTime[]
  onAdd: (title: string, start: string, mins: number, quadrant: string) => void
  onDelete: (id: number) => void
  onToggle: (p: DailyPlan) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(0)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('20:00')
  const [minutes, setMinutes] = useState(60)
  const [quadrant, setQuadrant] = useState('q2')

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): number => {
      const cs = window.getComputedStyle(el)
      const pad = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
      return Math.max(0, el.clientHeight - pad)
    }
    const ro = new ResizeObserver(() => setBoxH(measure()))
    ro.observe(el)
    setBoxH(measure())
    return () => ro.disconnect()
  }, [])

  const blocks = useMemo(() => {
    const list: {
      s: number
      e: number
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
        s: p.start_min,
        e: p.end_min,
        label: p.title,
        sub: `${minToText(p.start_min)}–${minToText(p.end_min)}`,
        color: q.color,
        done: !!p.done
      })
    }
    const rank: Record<string, number> = {}
    Array.from(new Set(courses.map((c) => c.start_time).filter(Boolean) as string[]))
      .sort()
      .forEach((t, i) => {
        rank[t] = i + 1
      })
    for (const c of courses) {
      if (autoTime && (!c.start_time || !c.end_time)) continue
      const sec = c.section ?? (c.start_time ? rank[c.start_time] : 1) ?? 1
      const range = autoTime
        ? { start: c.start_time as string, end: c.end_time as string }
        : sectionRange(sec, sections)
      list.push({
        s: autoTime ? textToMin(c.start_time as string) : secToMin(range.start),
        e: autoTime ? textToMin(c.end_time as string) : secToMin(range.end),
        label: c.course_abbr || c.course_name || '课程',
        sub: autoTime
          ? `${c.start_time}–${c.end_time}${c.location ? ' · ' + c.location : ''}`
          : `第${sec}节 ${range.start}–${range.end}${c.location ? ' · ' + c.location : ''}`,
        color: 'var(--accent)',
        online: (c.location || '').includes('线上')
      })
    }
    return list.sort((a, b) => a.s - b.s)
  }, [plans, courses, autoTime, sections])

  const [winStart, winEnd] = useMemo(() => {
    let s = 7
    let e = 23
    for (const b of blocks) {
      s = Math.min(s, Math.floor(b.s / 60))
      e = Math.max(e, Math.ceil(b.e / 60))
    }
    s = Math.max(0, s)
    e = Math.min(24, e)
    if (e - s < 4) e = Math.min(24, s + 4)
    return [s, e]
  }, [blocks])

  const span = Math.max(1, winEnd - winStart)
  const hourH = boxH > 120 ? Math.max(22, boxH / span) : 34
  const overflowing = hourH * span > boxH + 1
  const gridH = span * hourH

  return (
    <div className="cal-day">
      <div className="cal-day-head">
        <span className="cal-day-title">
          <b>{date.slice(5).replace('-', '/')}</b>
          <span className="cal-day-wd">
            周{WEEK_CN[(new Date(`${date}T00:00:00`).getDay() + 6) % 7]}
          </span>
          <span className="cal-day-kicker">日计划</span>
        </span>
        <div className="cal-day-form">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd(title, time, minutes, quadrant)}
            placeholder="事项"
            style={{ width: 132, height: 30 }}
          />
          <input
            type="time"
            className="input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ width: 104, height: 30 }}
          />
          <select
            className="select"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            style={{ width: 92, height: 30 }}
          >
            {[15, 30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n} 分
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {Object.values(QUADRANTS).map((q) => (
              <button
                key={q.key}
                onClick={() => setQuadrant(q.key)}
                title={q.name}
                aria-pressed={quadrant === q.key}
                className="qdot"
                style={{ background: q.color }}
              />
            ))}
          </div>
          <button
            className="btn btn-primary sm"
            onClick={() => {
              onAdd(title || '新事项', time, minutes, quadrant)
              setTitle('')
            }}
          >
            <Plus size={12} strokeWidth={2} /> 添加
          </button>
        </div>
      </div>

      <div ref={scrollRef} className={`cal-day-scroll${overflowing ? '' : ' fit'}`}>
        <div className="cal-day-grid" style={{ height: gridH }}>
          {Array.from({ length: span + 1 }, (_, i) => (
            <div key={i} className="cal-hour" style={{ top: i * hourH }}>
              <span>{pad(winStart + i)}:00</span>
            </div>
          ))}
          <div className="cal-day-track">
            {tasks.map((t, i) => {
              if (!t.ddl) return null
              const m = textToMin(t.ddl.slice(11, 16))
              return (
                <div
                  key={`task-${t.id}`}
                  className="cal-block"
                  style={{
                    top: ((m - winStart * 60) / 60) * hourH + i * 14,
                    height: 22,
                    background: 'color-mix(in oklch, var(--violet) 12%, var(--surface-2))',
                    boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--violet) 32%, transparent)'
                  }}
                  title={`${t.title} 截止 ${t.ddl.slice(11, 16)}`}
                >
                  <span className="label">
                    {t.ddl.slice(11, 16)} 截止 · {t.title}
                  </span>
                </div>
              )
            })}

            {blocks.map((b, i) => {
              const top = ((b.s - winStart * 60) / 60) * hourH
              const height = Math.max(16, ((b.e - b.s) / 60) * hourH - 1)
              return (
                <div
                  key={i}
                  className={`cal-block${b.done ? ' done' : ''}${b.online ? ' online' : ''}`}
                  style={{
                    top,
                    height,
                    background: `color-mix(in oklch, ${b.color} ${b.online ? 9 : 16}%, var(--surface-2))`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${b.color} 34%, transparent)`
                  }}
                  title={`${b.label} ${b.sub}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="label" style={{ flex: 1, minWidth: 0 }}>
                      {b.label}
                    </span>
                    {b.id != null && (
                      <span className="actions" style={{ display: 'flex', gap: 2 }}>
                        <button
                          className="mini-btn"
                          style={{ width: 20, height: 20 }}
                          onClick={() => {
                            const p = plans.find((x) => x.id === b.id)
                            if (p) onToggle(p)
                          }}
                          title="标记完成"
                        >
                          <Check size={11} />
                        </button>
                        <button
                          className="mini-btn danger"
                          style={{ width: 20, height: 20 }}
                          onClick={() => onDelete(b.id as number)}
                          title="删除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    )}
                  </div>
                  {height > 26 && <div className="sub">{b.sub}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CalendarPage
