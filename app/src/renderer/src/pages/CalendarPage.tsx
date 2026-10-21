import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { listTasks, type Task } from '../lib/api'

const locales = { 'zh-CN': zhCN }
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales
})

interface CalEvent {
  id: number
  title: string
  start: Date
  end: Date
  resource: Task
  kind: 'ddl'
}

/** 日历页（规格 §8）：作业与课表双色。课表事件 Phase 3 接入。 */
function CalendarPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<View>('month')
  const [date, setDate] = useState(new Date())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await listTasks({})
        setTasks(res.items)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const events: CalEvent[] = useMemo(() => {
    return tasks
      .filter((t) => t.ddl)
      .map((t) => {
        const end = new Date(t.ddl as string)
        const start = new Date(end.getTime() - 30 * 60000)
        return {
          id: t.id,
          title: `${t.course_abbr ? t.course_abbr + ' · ' : ''}${t.title}`,
          start,
          end,
          resource: t,
          kind: 'ddl' as const
        }
      })
  }, [tasks])

  const eventPropGetter = useCallback((event: CalEvent) => {
    const done = event.resource.status === 'done'
    return {
      style: {
        backgroundColor: done ? '#2a3a2e' : '#1e2c44',
        borderLeft: `3px solid ${done ? '#4ea877' : '#4f8cff'}`,
        color: done ? '#8fd0aa' : '#cfe0ff',
        fontSize: 11.5,
        borderRadius: 4,
        border: 'none',
        opacity: done ? 0.75 : 1
      }
    }
  }, [])

  if (loading) return <div className="text-[13px] text-[#5c5c6a] py-8">加载中…</div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 mb-3 text-[11.5px] text-[#7a7a88]">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-[#4f8cff]" /> 作业 DDL
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-[#4ea877]" /> 已完成
        </span>
        <span className="text-[#4a4a58]">· 课表将在 Phase 3 接入</span>
      </div>

      <div className="flex-1 min-h-0 cal-wrapper">
        <Calendar
          localizer={localizer}
          culture="zh-CN"
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={['month', 'week', 'agenda']}
          eventPropGetter={eventPropGetter}
          messages={{
            month: '月',
            week: '周',
            agenda: '议程',
            today: '今天',
            previous: '上一页',
            next: '下一页',
            noEventsInRange: '这段时间没有截止任务'
          }}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  )
}

export default CalendarPage
