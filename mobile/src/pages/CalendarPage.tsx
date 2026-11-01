import { useEffect, useMemo, useRef, useState } from 'react'
import type { Course, Ev, Task } from '../lib/types'
import { addDays, monthLabel, parseYmd, sameDay, WEEK_CN, ymd } from '../lib/date'
import { IconCheck, IconChevronDown, IconMore } from '../components/Icons'

interface Props {
  tasks: Task[]
  events: Ev[]
  courses: Course[]
  /** 学期第一周的周一（YYYY-MM-DD），用于把日期换算成周次 */
  semesterStart?: string
  onToggle: (id: string) => void
}

/** 生成 6 周 × 7 天的网格（含上下月补位） */
function buildGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7 // 周一为一周起点
  const start = addDays(first, -offset)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** 日期 → 第几周（1 起）；没有学期起始日就返回 null */
function weekOf(date: Date, startISO?: string): number | null {
  if (!startISO) return null
  const s = parseYmd(startISO)
  const base = new Date(s.getFullYear(), s.getMonth(), s.getDate())
  const cur = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.floor((cur.getTime() - base.getTime()) / 86400000)
  if (diff < 0) return null
  return Math.floor(diff / 7) + 1
}

/** "1-2,5" / "4,6-8" → 判断某周是否包含 */
function weeksContain(spec: string | undefined, week: number): boolean {
  if (!spec) return true // 没写周次就都显示
  for (const part of spec.split(',')) {
    const s = part.trim()
    if (!s) continue
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (week >= a && week <= b) return true
    } else if (Number(s) === week) {
      return true
    }
  }
  return false
}

/** Tab 3：日历（月视图可折叠 + 当天日程 + 左右滑动切天） */
export default function CalendarPage({
  tasks,
  events: allEvents,
  courses: allCourses,
  semesterStart,
  onToggle
}: Props): React.JSX.Element {
  const today = useMemo(() => new Date(), [])
  const [selected, setSelected] = useState<Date>(today)
  const [anchor, setAnchor] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1))
  const [collapsed, setCollapsed] = useState(false)
  const [dir, setDir] = useState<'left' | 'right' | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [calH, setCalH] = useState(0)

  // 量出月视图真实高度（折叠动画靠它）
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const update = (): void => setCalH(el.scrollHeight)
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const grid = useMemo(() => buildGrid(anchor), [anchor])
  const dayKey = ymd(selected)
  const week = useMemo(() => weekOf(selected, semesterStart), [selected, semesterStart])

  const pick = (d: Date): void => {
    setSelected(d)
    if (d.getMonth() !== anchor.getMonth()) setAnchor(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  const stepDay = (delta: number): void => {
    setDir(delta > 0 ? 'left' : 'right')
    window.setTimeout(() => setDir(null), 260)
    pick(addDays(selected, delta))
  }

  // 同一门课每周地点/线上方式都可能不同，按周次过滤
  const courses = allCourses.filter(
    (c) =>
      c.weekday === ((selected.getDay() + 6) % 7) + 1 &&
      (week == null || weeksContain(c.weeks, week))
  )
  const events = allEvents.filter((e) => e.date === dayKey)
  const dues = tasks.filter((t) => t.due && t.due.slice(0, 10) === dayKey)

  const timeline = [
    ...courses.map((c) => ({
      id: `c${c.id}`,
      kind: 'course' as const,
      title: c.name,
      start: c.start,
      end: c.end,
      location: c.location
    })),
    ...events.map((e) => ({
      id: `e${e.id}`,
      kind: 'event' as const,
      title: e.title,
      start: e.start,
      end: e.end,
      location: e.location
    }))
  ].sort((a, b) => a.start.localeCompare(b.start))

  const has = timeline.length + dues.length > 0

  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    stepDay(dx > 0 ? -1 : 1)
  }

  return (
    <div className="screen">
      <div className="nav">
        <span className="nav-title">{monthLabel(anchor)}</span>
        <span className="nav-actions">
          <button className="icon-btn" aria-label="列表">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <button className="icon-btn" aria-label="更多">
            <IconMore />
          </button>
        </span>
      </div>

      {/* 可折叠的月视图：外层高度由内容实测得来，transition 才稳 */}
      <div
        className="cal-collapse"
        style={{ height: collapsed ? 0 : calH }}
        aria-hidden={collapsed}
      >
        <div className="cal-collapse-inner" ref={innerRef}>
          <div className="weekday">
            {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid">
            {grid.map((d) => {
              const out = d.getMonth() !== anchor.getMonth()
              const sel = sameDay(d, selected)
              const isToday = sameDay(d, today)
              return (
                <button
                  key={ymd(d)}
                  className={`day${out ? ' out' : ''}${sel ? ' sel' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 交界处的折叠把手：点这里收起/展开月视图 */}
      <button className="cal-handle" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? '展开日历' : '收起日历'}>
        <span className="cal-handle-bar" />
        <IconChevronDown className={`cal-handle-chev${collapsed ? ' up' : ''}`} />
      </button>

      <div
        className={`day-panel${dir ? ` slide-${dir}` : ''}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="panel-date">
          {selected.getMonth() + 1}月{selected.getDate()}日 周{WEEK_CN[selected.getDay()]}
          {sameDay(selected, today) ? ' · 今天' : ''}
          {week != null && <span className="panel-week">第 {week} 周</span>}
        </div>

        {!has && <div className="empty">这一天没有任务</div>}

        {timeline.map((s) => (
          <div key={s.id} className={`slot${s.kind === 'event' ? ' orange' : ''}`}>
            <div className="slot-time">{s.start}</div>
            <div className="slot-body">
              <div className="slot-title">{s.title}</div>
              <div className="slot-sub">
                {s.start}–{s.end}
                {s.location ? ` · ${s.location}` : ''}
              </div>
            </div>
          </div>
        ))}

        {dues.map((t) => (
          <div key={t.id} className={`row${t.done ? ' done' : ''}`}>
            <button className={`check${t.done ? ' on' : ''}`} onClick={() => onToggle(t.id)} aria-label="完成">
              <IconCheck />
            </button>
            <div className="row-text">{t.display || t.title}</div>
            <div className="row-right">{t.due && <span>{t.due.slice(11, 16)}</span>}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
