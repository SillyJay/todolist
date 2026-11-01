import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles/tokens.css'
import './styles/app.css'
import TodoPage from './pages/TodoPage'
import FocusPage from './pages/FocusPage'
import CalendarPage from './pages/CalendarPage'
import MessagesPage from './pages/MessagesPage'
import SettingsPage, { type ThemeMode } from './pages/SettingsPage'
import LoginScreen from './pages/LoginScreen'
import type { Course, Ev, Msg, Task } from './lib/types'

const APP_VERSION = '0.3.2'
import {
  applyOps,
  fetchChanges,
  getBase,
  health,
  newId,
  newOpId,
  parseEvent,
  setBase,
  loadCache,
  saveCache,
  isNative,
  clearToken,
  hasToken,
  type ApiEvent,
  type ApiTask
} from './lib/api'

/** 版本号：设置页会显示，用来确认真机装的是哪一版 */
import { listenOnce, scheduleReminders, scheduledCount } from './lib/native'
import {
  IconCal,
  IconChevronDown,
  IconGear,
  IconHistory,
  IconPlus,
  IconTimer,
  IconTodo
} from './components/Icons'

type Tab = 'todo' | 'focus' | 'cal' | 'msg' | 'set'

interface Draft {
  text: string
  date: string
  time: string
  voice: boolean
  custom: boolean
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dateOffset(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return localDate(d)
}

const DAY_LABEL = ['今天', '明天', '后天', '大后天']
const TIME_OPTIONS = ['09:00', '12:00', '18:00', '21:00', '23:59']
const CARET_TO_END = -1

function dayText(date: string): string {
  if (!date) return ''
  if (date === dateOffset(0)) return '今天'
  if (date === dateOffset(1)) return '明天'
  if (date === dateOffset(2)) return '后天'
  if (date === dateOffset(3)) return '大后天'
  const [, m, d] = date.split('-')
  return `${Number(m)}月${Number(d)}日`
}

function draftPrefix(d: { date: string; time: string }): string {
  if (!d.date) return ''
  return d.time ? `${dayText(d.date)} ${d.time} ` : `${dayText(d.date)} `
}

function stripPrefix(text: string, d: { date: string; time: string }): string {
  const p = draftPrefix(d)
  return p && text.startsWith(p) ? text.slice(p.length) : text
}

function toTask(t: ApiTask): Task {
  const ddl = (t.ddl || '').replace('T', ' ')
  return {
    id: String(t.id),
    title: t.title,
    display: t.display_title || t.title,
    kind: t.kind === 'chapter' ? 'chapter' : 'task',
    // 没有截止时间就留空，不要编一个「今天 23:59」
    due: ddl.slice(0, 16) || '',
    done: t.status === 'done',
    course: t.course || undefined
  }
}

function toEvent(e: ApiEvent): Ev {
  return {
    id: e.id,
    date: e.date,
    title: e.title,
    start: e.start,
    end: e.end,
    location: e.location || undefined
  }
}

/** 增量合并：按 id 覆盖/新增，deleted 里的移除。增量接口只返回变化的行，不能整体替换。 */
function mergeRows<T extends { id: string }>(prev: T[], incoming: T[], deleted: Set<string>): T[] {
  const map = new Map(prev.map((x) => [x.id, x]))
  for (const row of incoming) map.set(row.id, row)
  for (const id of deleted) map.delete(id)
  return [...map.values()]
}

/** 应用外壳：五个 Tab + 右下角 +（点按加日程，长按语音） */
export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('todo')
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [semesterStart, setSemesterStart] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<Msg[]>([])
  const [pendingMessages, setPendingMessages] = useState(0)
  const [account, setAccount] = useState<{ email: string; display_name: string; avatar: string } | null>(
    null
  )
  const [online, setOnline] = useState<boolean | null>(null)
  // ?pair=1 只是「方便手动进配对页」：已经配对过就不再强制，
  // 否则每次打开带参数的链接都会被要求重新配对
  const [needPair, setNeedPair] = useState<boolean>(
    () => new URLSearchParams(location.search).has('pair') && !hasToken()
  )
  const [lastSync, setLastSync] = useState('—')
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [notifications, setNotifications] = useState(true)
  const [server, setServer] = useState(getBase())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [caret, setCaret] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const holdTimer = useRef<number | null>(null)
  const pressing = useRef(false)
  const cursorRef = useRef('')

  // 点完按钮立即失焦：部分 Android WebView 会在按钮上画系统焦点框（黄色），
  // CSS 的 outline 管不到它，只能主动 blur。
  useEffect(() => {
    const onUp = (e: Event): void => {
      const el = (e.target as HTMLElement | null)?.closest('button')
      if (!el) return
      // 输入框/文本域不处理，避免键盘收起来
      window.setTimeout(() => el.blur(), 0)
    }
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('touchend', onUp, true)
    return () => {
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('touchend', onUp, true)
    }
  }, [])

  // Android 返回键：不要一按就退出
  //   有弹层 → 关弹层；不在待办页 → 回待办；否则才退出
  useEffect(() => {
    if (!isNative()) return
    let remove: (() => void) | undefined
    void (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app')
        const handle = await CapApp.addListener('backButton', () => {
          if (draft) {
            setDraft(null)
            return
          }
          if (tab !== 'todo') {
            setTab('todo')
            return
          }
          void CapApp.exitApp()
        })
        remove = () => void handle.remove()
      } catch {
        /* 浏览器里没有这个插件，忽略 */
      }
    })()
    return () => remove?.()
  }, [tab, draft])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', dark ? '#000000' : '#ffffff')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const sync = useCallback(async (): Promise<void> => {
    try {
      await health()
      setOnline(true)
      // 只有已经有 token 时才认为「已配对」，否则保持配对页
    } catch (e) {
      const msg = (e as Error).message || ''
      // 401 = 未配对设备；没有 token 直接进配对页
      if (msg.startsWith('401') || (!hasToken() && !/Failed to fetch|abort|NetworkError/i.test(msg))) {
        setNeedPair(true)
      }
      setOnline(false)
      return
    }
    try {
      const c = await fetchChanges(cursorRef.current || undefined)
      cursorRef.current = c.cursor

      // 增量只含变化的行 → 合并，不能整体替换
      const goneTask = new Set(c.tasks.filter((t) => t.deleted_at).map((t) => String(t.id)))
      const liveTasks = c.tasks.filter((t) => !t.deleted_at).map(toTask)
      setTasks((prev) => mergeRows(prev, liveTasks, goneTask))

      const goneEvent = new Set(c.events.filter((e) => e.deleted_at).map((e) => e.id))
      const liveEvents = c.events.filter((e) => !e.deleted_at).map(toEvent)
      setEvents((prev) => mergeRows(prev, liveEvents, goneEvent))

      if (c.semester_start) setSemesterStart(c.semester_start)
      setCourses((prev) =>
        mergeRows(
          prev,
          c.courses.map((x) => ({
            id: String(x.id),
            weekday: x.weekday,
            name: x.name,
            start: x.start,
            end: x.end,
            location: x.location || undefined,
            weeks: x.weeks || undefined
          })),
          new Set<string>()
        )
      )

      setPendingMessages(c.pending_messages ?? 0)
      if (c.account) {
        setAccount({
          email: c.account.email || '',
          display_name: c.account.display_name || '',
          avatar: c.account.avatar || ''
        })
      }
      setMessages((prev) =>
        mergeRows(
          prev,
          c.messages.map((m) => ({
            id: String(m.id),
            at: (m.time || '').slice(0, 16).replace('T', ' '),
            // 列表显示简化后的；没有 AI 摘要时退回截断文本
            digest: m.digest || m.digest_fallback || '',
            // 详情里要能看原文
            text: m.text || m.digest || '',
            simplified: m.digest_src === 'ai',
            importance: m.importance || undefined,
            group: m.group,
            category: m.category
          })),
          new Set<string>()
        )
      )
      setLastSync(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      // 重新排本地提醒（截止前 1 小时 + 到点）
      void scheduleReminders(
        c.tasks.filter((t) => !t.deleted_at).map(toTask)
      ).catch(() => undefined)

      // 落盘一份快照：下次打开先显示，断网也能看
      setTasks((snapTasks) => {
        setEvents((snapEvents) => {
          setCourses((snapCourses) => {
            setMessages((snapMessages) => {
              saveCache({
                at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                cursor: cursorRef.current,
                tasks: snapTasks,
                events: snapEvents,
                courses: snapCourses,
                messages: snapMessages
              })
              return snapMessages
            })
            return snapCourses
          })
          return snapEvents
        })
        return snapTasks
      })
    } catch {
      setOnline(false)
    }
  }, [])

  // 先用上次的缓存把界面填上（没网也能看），再在后台同步
  useEffect(() => {
    const snap = loadCache()
    if (snap) {
      cursorRef.current = snap.cursor || ''
      setTasks((snap.tasks as Task[]) || [])
      setEvents((snap.events as Ev[]) || [])
      setCourses((snap.courses as Course[]) || [])
      setMessages((snap.messages as Msg[]) || [])
      setLastSync(snap.at || '缓存')
    }
    void sync()
    const timer = window.setInterval(() => void sync(), 60_000)
    return () => window.clearInterval(timer)
  }, [sync])

  useEffect(() => {
    if (caret !== CARET_TO_END) return
    const el = inputRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [caret])

  const toggleTask = useCallback(
    (id: string): void => {
      let nowDone = false
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          nowDone = !t.done
          return { ...t, done: nowDone }
        })
      )
      void applyOps([
        {
          op_id: newOpId(),
          entity: 'task',
          id,
          action: nowDone ? 'done' : 'undone',
          patch: {}
        }
      ]).catch(() => void sync())
    },
    [sync]
  )

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    let body = stripPrefix(draft.text, draft).trim()
    if (!body) {
      setDraft(null)
      return
    }
    setBusy(true)
    try {
      let date = draft.date
      let start = draft.time
      let end = ''
      let location: string | undefined

      if (!date || !start) {
        try {
          const parsed = await parseEvent(draft.text, new Date().toISOString())
          date = parsed.date || date
          start = parsed.start || start || '09:00'
          end = parsed.end || ''
          location = parsed.location || undefined
          // 解析会剔除「明天下午四点」这类时间词，标题要用解析后的
          if (parsed.title) body = parsed.title.trim()
        } catch {
          date = date || localDate(new Date())
          start = start || '23:59'
        }
      }
      if (!end) {
        const [h, m] = start.split(':').map(Number)
        const e2 = new Date(2000, 0, 1, h || 9, m || 0)
        e2.setHours(e2.getHours() + 1)
        end = `${pad2(e2.getHours())}:${pad2(e2.getMinutes())}`
      }

      await applyOps([
        {
          op_id: newOpId(),
          entity: 'event',
          id: newId(),
          action: 'create',
          patch: {
            title: body,
            date,
            start,
            end,
            location,
            source: draft.voice ? 'voice' : 'manual'
          }
        }
      ])
      setDraft(null)
      await sync()
    } catch {
      setOnline(false)
    } finally {
      setBusy(false)
    }
  }

  /** 消息 → 任务：标题用摘要，截止时间默认今天 23:59 */
  const messageToTask = useCallback(
    async (m: Msg): Promise<void> => {
      const today = new Date()
      const ddl = `${localDate(today)} 23:59`
      try {
        await applyOps([
          {
            op_id: newOpId(),
            entity: 'task',
            id: '0',
            action: 'create',
            patch: {
              title: m.digest || m.text,
              ddl,
              platform: 'wechat',
              raw_text: m.text
            }
          }
        ])
        await sync()
        setTab('todo')
      } catch {
        setOnline(false)
      }
    },
    [sync]
  )

  /** 忽略消息 */
  const ignoreMessage = useCallback(
    (m: Msg): void => {
      setMessages((prev) => prev.filter((x) => x.id !== m.id))
      void applyOps([
        { op_id: newOpId(), entity: 'message', id: m.id, action: 'ignore', patch: {} }
      ]).catch(() => void sync())
    },
    [sync]
  )

  const openDraft = (text = '', voice = false): void => {
    setDraft({ text, date: '', time: '', voice, custom: false })
  }

  const onFabDown = (): void => {
    pressing.current = true
    holdTimer.current = window.setTimeout(() => {
      if (!pressing.current) return
      setRecording(true)
      if (navigator.vibrate) navigator.vibrate(12)
      if (isNative()) void import('./lib/native').then((m) => m.warmUpVoice())
    }, 300)
  }

  const onFabUp = (): void => {
    pressing.current = false
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    if (recording) {
      setRecording(false)
      if (isNative()) {
        // 真机：调用系统语音识别
        void (async () => {
          try {
            const text = await listenOnce()
            if (text) {
              openDraft(text, true)
            } else {
              openDraft('', false)
            }
          } catch (e) {
            setVoiceError((e as Error).message || '语音识别失败')
            openDraft('', false)
          }
        })()
      } else {
        // 浏览器里没法用系统识别，用示例文本演示解析流程
        openDraft('明天下午三点小组会议 实训515', true)
      }
    } else {
      openDraft()
    }
  }

  const sheet = draft
  const parsed = useMemo(() => (draft?.text ? parseLocal(draft.text) : null), [draft?.text])
  const suggestion =
    draft &&
    parsed &&
    (parsed.date || parsed.time) &&
    (parsed.date !== draft.date || parsed.time !== draft.time)
      ? parsed
      : null

  const adopt = (): void => {
    if (!draft || !suggestion) return
    const next = {
      ...draft,
      date: suggestion.date || draft.date,
      time: suggestion.time || draft.time
    }
    setDraft({
      ...next,
      text: draftPrefix(next) + (suggestion.title || stripPrefix(draft.text, draft))
    })
    setCaret(CARET_TO_END)
  }

  return (
    <div className="app">
      {online === false && !needPair && (
        <div className="offline-bar">
          <span>未连接电脑 · {server}</span>
          <button onClick={() => void sync()}>重试</button>
        </div>
      )}

      {needPair ? (
        <LoginScreen
          onDone={() => {
            setNeedPair(false)
            if (location.search) history.replaceState(null, '', location.pathname)
            cursorRef.current = ''
            void sync()
          }}
        />
      ) : (
        <>
      {tab === 'todo' && <TodoPage tasks={tasks} onToggle={toggleTask} />}
      {tab === 'focus' && <FocusPage />}
      {tab === 'cal' && (
        <CalendarPage
          tasks={tasks}
          events={events}
          courses={courses}
          semesterStart={semesterStart}
          onToggle={toggleTask}
          onRefresh={() => void sync()}
        />
      )}
      {tab === 'msg' && (
        <MessagesPage
          messages={messages}
          pending={pendingMessages}
          onIgnore={ignoreMessage}
          onToTask={(m) => void messageToTask(m)}
        />
      )}
      {tab === 'set' && (
        <SettingsPage
          account={account}
          onAccount={setAccount}
          theme={theme}
          onTheme={setTheme}
          notifications={notifications}
          onNotifications={setNotifications}
          lastSync={lastSync}
          onSync={() => void sync()}
          version={APP_VERSION}
          reminders={scheduledCount()}
          server={server}
          onServer={(v) => {
            setServer(v)
            setBase(v)
            cursorRef.current = ''
            void sync()
          }}
          onUnpair={() => {
            clearToken()
            cursorRef.current = ''
            setNeedPair(true)
          }}
        />
      )}

      {(tab === 'todo' || tab === 'cal' || tab === 'msg') && (
        <button
          className={`fab${recording ? ' recording' : ''}`}
          onPointerDown={onFabDown}
          onPointerUp={onFabUp}
          onPointerLeave={() => pressing.current && onFabUp()}
          aria-label="添加任务（长按语音）"
        >
          <IconPlus />
        </button>
      )}

      <div className="tabbar-wrap">
        <div className="tabbar">
          {(
            [
              ['todo', IconTodo, true],
              ['focus', IconTimer, false],
              ['cal', IconCal, false],
              ['msg', IconHistory, false],
              ['set', IconGear, false]
            ] as [Tab, React.ComponentType<{ className?: string }>, boolean][]
          ).map(([key, Icon, badge]) => (
            <button
              key={key}
              className={`tab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
              aria-label={key}
            >
              <Icon />
              {badge && <span className="badge" />}
            </button>
          ))}
        </div>
      </div>

        </>
      )}

      {recording && (
        <div className="voice">
          <div className="voice-card">
            <div className="wave">
              {Array.from({ length: 7 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * 0.08}s` }} />
              ))}
            </div>
            <div style={{ fontSize: 17, fontWeight: 550 }}>正在听…</div>
            <div className="voice-tip">{voiceError || (isNative() ? "松手后开始识别" : "松手后识别 · 演示文本")}</div>
          </div>
        </div>
      )}

      {sheet && (
        <>
          <div className="sheet-mask" onClick={() => setDraft(null)} />
          <div className="sheet">
            <div className="sheet-grab" />
            <h3>{sheet.voice ? '语音已识别' : '新建日程'}</h3>
            <input
              ref={inputRef}
              type="text"
              autoFocus={!sheet.voice}
              value={sheet.text}
              placeholder="要做什么？"
              onChange={(e) => setDraft({ ...sheet, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveDraft()
              }}
            />

            {suggestion && (
              <button className="parse-hint" onClick={adopt}>
                <span className="parse-tag">识别到</span>
                <span className="parse-value">
                  {[suggestion.date ? dayText(suggestion.date) : '', suggestion.time || '']
                    .filter(Boolean)
                    .join(' ')}
                </span>
                {suggestion.title && <span className="parse-rest">{suggestion.title}</span>}
                <span className="parse-act">采用</span>
              </button>
            )}

            <div className="pick-block">
              <div className="pick-label">哪天</div>
              <div className="chips">
                {DAY_LABEL.map((label, i) => {
                  const value = dateOffset(i)
                  return (
                    <button
                      key={label}
                      className={`chip${sheet.date === value ? ' on' : ''}`}
                      onClick={() => {
                        if (sheet.date === value) return
                        const next = { ...sheet, date: value, custom: false }
                        setDraft({
                          ...next,
                          text: draftPrefix(next) + stripPrefix(sheet.text, sheet)
                        })
                        setCaret(CARET_TO_END)
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {!!sheet.date && (
              <div className="pick-block">
                <div className="pick-label">
                  几点
                  {!!sheet.time && (
                    <span className="pick-sum">
                      {dayText(sheet.date)} {sheet.time}
                    </span>
                  )}
                </div>
                <div className="chips">
                  {(sheet.time && !TIME_OPTIONS.includes(sheet.time)
                    ? [sheet.time, ...TIME_OPTIONS]
                    : TIME_OPTIONS
                  ).map((t) => (
                    <button
                      key={t}
                      className={`chip${sheet.time === t ? ' on' : ''}`}
                      onClick={() => {
                        const next = { ...sheet, time: t, custom: false }
                        setDraft({
                          ...next,
                          text: draftPrefix(next) + stripPrefix(sheet.text, sheet)
                        })
                        setCaret(CARET_TO_END)
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  <button
                    className={`chip${sheet.custom ? ' on' : ''}`}
                    onClick={() => setDraft({ ...sheet, custom: !sheet.custom })}
                  >
                    自定义…
                  </button>
                </div>
                {sheet.custom && (
                  <input
                    className="due-input"
                    type="datetime-local"
                    value={`${sheet.date}T${sheet.time || '23:59'}`}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      const [d, t] = v.split('T')
                      setDraft({ ...sheet, date: d, time: t })
                    }}
                  />
                )}
              </div>
            )}

            <div className="sheet-actions">
              <button className="btn-plain" onClick={() => setDraft(null)}>
                取消
              </button>
              <button className="btn-solid" onClick={() => void saveDraft()} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'none' }}>
        <IconChevronDown />
      </div>
    </div>
  )
}

/** 本地解析（与后端规则同源的简化版），只用于输入时的即时提示 */
function parseLocal(raw: string): { date?: string; time?: string; title: string } | null {
  let text = raw
  let date: string | undefined
  let time: string | undefined

  for (const [word, off] of [
    ['大后天', 3],
    ['后天', 2],
    ['明天', 1],
    ['今天', 0]
  ] as [string, number][]) {
    if (text.includes(word)) {
      date = dateOffset(off)
      text = text.replace(word, '')
      break
    }
  }

  const pm = text.includes('下午') || text.includes('晚上') || text.includes('傍晚')
  text = text.replace(/上午|下午|晚上|中午|早上|凌晨|傍晚/g, '')

  const colon = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
  if (colon) {
    time = `${pad2(Number(colon[1]))}:${colon[2]}`
    text = text.replace(colon[0], '')
  } else {
    const cn: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10
    }
    const m2 = text.match(/(\d{1,2}|[一二两三四五六七八九十])\s*点\s*(半)?/)
    if (m2) {
      const h0 = /^\d+$/.test(m2[1]) ? Number(m2[1]) : (cn[m2[1]] ?? 0)
      const h = pm && h0 < 12 ? h0 + 12 : h0
      time = `${pad2(h)}:${m2[2] ? '30' : '00'}`
      text = text.replace(m2[0], '')
    }
  }

  if (!date && !time) return null
  return { date, time, title: text.replace(/\s+/g, ' ').trim() }
}
