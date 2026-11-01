/**
 * 本地通知（规格模块 1）
 * 主进程每分钟检查一次待办任务的 DDL，进入 60 分钟窗口时弹 Windows 通知。
 * 点击通知聚焦主窗口并跳到任务页。
 */
import { Notification, BrowserWindow } from 'electron'
import { log } from './logger'

const CHECK_INTERVAL_MS = 60_000
const WARN_WINDOW_MS = 60 * 60 * 1000 // 提前 1 小时提醒
const notified = new Set<number>()

let timer: NodeJS.Timeout | null = null

interface DueTask {
  id: number
  title: string
  ddl: string | null
  course_abbr?: string | null
  status: string
}


/** 当前是否处于免打扰时段（跨零点也支持） */
function inDnd(start: string, end: string): boolean {
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  const parse = (v: string): number => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v || '')
    if (!m) return -1
    return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]))
  }
  const s = parse(start)
  const e = parse(end)
  if (s < 0 || e < 0 || s === e) return false
  return s < e ? mins >= s && mins < e : mins >= s || mins < e
}

async function dndActive(baseUrl: () => string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/settings`)
    if (!res.ok) return false
    const data = (await res.json()) as Record<string, string>
    if (data.dnd_enabled !== '1') return false
    return inDnd(data.dnd_start || '23:00', data.dnd_end || '07:00')
  } catch {
    return false
  }
}

async function checkDue(window: BrowserWindow | null, baseUrl: () => string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl()}/tasks?status=pending`)
    if (!res.ok) return
    const data = (await res.json()) as { items: DueTask[] }
    if (await dndActive(baseUrl)) {
      log('[notify] 免打扰时段，本次不提醒')
      return
    }
    const now = Date.now()

    for (const t of data.items) {
      if (!t.ddl || notified.has(t.id)) continue
      const ddl = new Date(t.ddl).getTime()
      if (Number.isNaN(ddl)) continue
      const diff = ddl - now
      // 已过期超过 1 天的不再提醒；仅在 1 小时窗口内提醒
      if (diff < 0 || diff > WARN_WINDOW_MS) continue

      const minutes = Math.max(1, Math.round(diff / 60000))
      const body = `${t.course_abbr ? t.course_abbr + ' · ' : ''}${t.title}\n还有 ${minutes} 分钟截止`

      if (Notification.isSupported()) {
        const n = new Notification({ title: '作业即将截止', body })
        n.on('click', () => {
          if (window) {
            window.show()
            window.focus()
            window.webContents.send('navigate', 'tasks')
          }
        })
        n.show()
      }
      notified.add(t.id)
      log(`[notify] ${body.replace('\n', ' / ')}`)
    }
  } catch {
    /* 后端未就绪时静默跳过 */
  }
}

export function startNotificationWatcher(
  getWindow: () => BrowserWindow | null,
  baseUrl: () => string
): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => void checkDue(getWindow(), baseUrl), CHECK_INTERVAL_MS)
  // 启动 10 秒后先跑一次
  setTimeout(() => void checkDue(getWindow(), baseUrl), 10_000)
}

export function stopNotificationWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}
