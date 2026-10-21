/**
 * 后端 API 封装（规格 §7 契约）。
 * 基址由主进程注入（端口自动顺延），渲染进程通过 preload 取得。
 */
let baseUrlPromise: Promise<string> | null = null

const FALLBACK_BASE = 'http://127.0.0.1:8765/api'

export function getBaseUrl(): Promise<string> {
  if (!baseUrlPromise) {
    baseUrlPromise = (async () => {
      try {
        if (typeof window !== 'undefined' && window.api?.getBackendBaseUrl) {
          return await window.api.getBackendBaseUrl()
        }
        console.warn('[api] window.api 不可用，回退到默认端口')
        return FALLBACK_BASE
      } catch (e) {
        console.warn('[api] 取后端地址失败，回退到默认端口:', e)
        return FALLBACK_BASE
      }
    })()
  }
  return baseUrlPromise
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...init
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} (${path})`)
    }
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`请求超时：${base}${path}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ---- 系统 ----
export interface Health {
  status: string
  service: string
}
export const health = (): Promise<Health> => request('/health')

// ---- 任务（规格 §7.1）----
export interface Task {
  id: number
  platform: 'chaoxing' | 'xiaoya' | 'wechat' | 'manual'
  course_name?: string | null
  course_abbr?: string | null
  title: string
  ddl?: string | null
  status: 'pending' | 'done' | 'expired' | 'ignored'
  url?: string | null
  summary?: string | null
  raw_text?: string | null
  confidence?: number | null
}

export const listTasks = (
  params: Record<string, string> = {}
): Promise<{ items: Task[]; total: number }> => {
  const qs = new URLSearchParams(params).toString()
  return request(`/tasks${qs ? `?${qs}` : ''}`)
}

export interface TaskCreateBody {
  title: string
  ddl?: string | null
  course_name?: string | null
  course_abbr?: string | null
  platform?: string
  url?: string | null
}

export const createTask = (body: TaskCreateBody): Promise<Task> =>
  request('/tasks', { method: 'POST', body: JSON.stringify(body) })

export const updateTask = (
  id: number,
  patch: Partial<Pick<Task, 'status' | 'title' | 'ddl' | 'course_abbr' | 'course_name' | 'summary'>>
): Promise<Task> => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteTask = (id: number): Promise<{ ok: boolean }> =>
  request(`/tasks/${id}`, { method: 'DELETE' })

// ---- 日历（规格 §7.4 + §13.7）----
export const exportCalendar = (): Promise<{ path: string; count: number }> =>
  request('/calendar/export', { method: 'POST' })

export interface DayInfo {
  date: string
  lunar: string
  festivals: string[]
  term: string | null
  is_holiday: boolean
}

export const dayInfo = (from: string, to: string): Promise<{ items: DayInfo[] }> =>
  request(`/calendar/dayinfo?from_=${from}&to=${to}`)

export interface DailyPlan {
  id: number
  date: string
  start_min: number
  end_min: number
  title: string
  note?: string | null
  color: string
  quadrant?: string
  done?: number
}

export const listPlans = (from: string, to: string): Promise<{ items: DailyPlan[] }> =>
  request(`/plans?from_=${from}&to=${to}`)

export const createPlan = (
  body: Omit<DailyPlan, 'id'>
): Promise<DailyPlan> => request('/plans', { method: 'POST', body: JSON.stringify(body) })

export const updatePlan = (
  id: number,
  patch: Partial<Omit<DailyPlan, 'id'>>
): Promise<DailyPlan> => request(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deletePlan = (id: number): Promise<{ ok: boolean }> =>
  request(`/plans/${id}`, { method: 'DELETE' })

export interface CourseSlot {
  id: number
  course_name?: string | null
  course_abbr?: string | null
  start_time?: string | null
  end_time?: string | null
  location?: string | null
  weeks?: string | null
}

export const scheduleOf = (date: string): Promise<{ date: string; items: CourseSlot[] }> =>
  request(`/schedule?date=${date}`)

export interface WeekCourse extends CourseSlot {
  weekday: number
}

export const scheduleAll = (): Promise<{
  items: WeekCourse[]
  first_week_date?: string | null
  max_week?: number | null
}> => request('/schedule/all')

export const scheduleMeta = (): Promise<{
  current_week: number | null
  synced_at: string | null
  first_week_date: string | null
  max_week: number | null
}> => request('/schedule/meta')

export const exportDir = (): Promise<{ dir: string; exists: boolean }> =>
  request('/calendar/export-dir')

// ---- 适配器状态（规格 §7.2）----
export interface AdaptersStatus {
  chaoxing: { logged_in: boolean }
  xiaoya: { logged_in: boolean }
  wechat: { state: 'running' | 'offline' | 'not_configured' }
}
export const adaptersStatus = (): Promise<AdaptersStatus> => request('/adapters/status')

export const chaoxingLogin = (
  username: string,
  password: string
): Promise<{ ok: boolean; code: string; message: string }> =>
  request('/adapters/chaoxing/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })

export const chaoxingImportCookie = (
  cookie: string
): Promise<{ ok: boolean; code: string; message: string }> =>
  request('/adapters/chaoxing/import-cookie', {
    method: 'POST',
    body: JSON.stringify({ cookie })
  })

export interface RefreshStatus {
  running: boolean
  done: number
  total: number
  current: string
  created: number
  updated: number
  error: string
}

export const chaoxingRefresh = (): Promise<{
  ok: boolean
  started?: boolean
  code?: string
  message?: string
}> => request('/adapters/chaoxing/refresh', { method: 'POST' })

export const chaoxingRefreshSchedule = (): Promise<{
  ok: boolean
  count?: number
  current_week?: number
  message?: string
}> => request('/adapters/chaoxing/refresh-schedule', { method: 'POST' })

export const refreshStatus = (): Promise<RefreshStatus> =>
  request('/adapters/chaoxing/refresh/status')

export const xiaoyaLogin = (
  username: string,
  password: string
): Promise<{ ok: boolean; code: string; message: string }> =>
  request('/adapters/xiaoya/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })

export const xiaoyaImportCookie = (
  cookie: string
): Promise<{ ok: boolean; code: string; message: string }> =>
  request('/adapters/xiaoya/import-cookie', {
    method: 'POST',
    body: JSON.stringify({ cookie })
  })

// ---- 设置（规格 §7.5）----
export const getSettings = (): Promise<Record<string, string>> => request('/settings')
export const putSettings = (patch: Record<string, string>): Promise<{ ok: boolean }> =>
  request('/settings', { method: 'PUT', body: JSON.stringify(patch) })
