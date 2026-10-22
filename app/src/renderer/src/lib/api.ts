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

async function request<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const base = await getBaseUrl()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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

export const xiaoyaRefresh = (): Promise<{
  ok: boolean
  created?: number
  updated?: number
  total?: number
  message?: string
}> => request('/adapters/xiaoya/refresh', { method: 'POST' })

export const xiaoyaImportCookie = (
  cookie: string
): Promise<{ ok: boolean; code: string; message: string }> =>
  request('/adapters/xiaoya/import-cookie', {
    method: 'POST',
    body: JSON.stringify({ cookie })
  })

// ---- 文件 / 工作区（Phase 3）----
export interface WorkspaceInfo {
  root: string
  tree: { platform: string; courses: { name: string; tasks: { name: string; files: { name: string; size: number }[] }[] }[] }[]
}
export const workspaceInfo = (): Promise<WorkspaceInfo> => request('/files/workspace')
export const openWorkspace = (): Promise<{ ok: boolean; root: string }> =>
  request('/files/open-workspace', { method: 'POST' })
export interface AttachmentItem {
  key: string
  name: string
  size: number
  size_text: string
  kind: 'file' | 'image'
  ext: string
  url: string
  downloaded: boolean
  file_id?: number | null
  dir?: string
}

export const listAttachments = (
  taskId: number
): Promise<{ items: AttachmentItem[]; count: number; supported: boolean; message: string }> =>
  request(`/files/attachments?task_id=${taskId}`)

export const downloadAttachments = (
  taskId: number,
  keys?: string[]
): Promise<{
  ok: boolean
  downloaded: { name: string; size: number; path: string }[]
  failed: { name: string; error: string }[]
  skipped: string[]
  message: string
}> =>
  request(
    '/files/download-attachments',
    {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, keys })
    },
    240000 // 小雅走浏览器逐个下载，单文件可能要 20-30 秒
  )

export const openFile = (fileId: number): Promise<{ ok: boolean; path: string }> =>
  request(`/files/${fileId}/open`, { method: 'POST' })

export const revealFile = (fileId: number): Promise<{ ok: boolean; path: string }> =>
  request(`/files/${fileId}/reveal`, { method: 'POST' })

export const listFiles = (taskId?: number): Promise<{ items: { id: number; name: string; local_path: string; size: number; platform: string }[] }> =>
  request(`/files${taskId ? `?task_id=${taskId}` : ''}`)

// ---- 微信监听（规格 §5 模块 3）----
export interface WeChatStatus {
  env: {
    installed: boolean
    path: string | null
    wechat_running: boolean
    initialized: boolean
    version: string
    cli_ok: boolean
    cli_message: string
  }
  listener: {
    state: 'running' | 'offline' | 'not_configured'
    groups: string[]
    connected: boolean
    received: number
    last_error: string
    recent: { group: string; sender: string; text: string; time: string; keyword_hit: boolean }[]
  }
  config_groups: string[]
  install: {
    preferred: string
    preferred_writable: boolean
    active: string
    fallback: string
    manifest: { exe?: string; size?: number; installed_at?: string; source?: string } | null
  }
}

export const wechatInstall = (
  source: string,
  sha256?: string
): Promise<{ ok: boolean; code?: string; message: string; exe?: string; size?: number; dir?: string }> =>
  request('/adapters/wechat/install', {
    method: 'POST',
    body: JSON.stringify({ source, sha256 })
  })

export const wechatGroups = (): Promise<{
  groups: { name: string; username: string; unread: number; last_message: string }[]
}> => request('/adapters/wechat/groups')

export const wechatLaunch = (): Promise<{ ok: boolean; code?: string; message: string }> =>
  request('/adapters/wechat/launch', { method: 'POST' })

export const wechatInit = (): Promise<{ ok: boolean; message: string; output?: string }> =>
  request('/adapters/wechat/init', { method: 'POST' })

export const wechatUninstall = (): Promise<{ ok: boolean; removed: string[] }> =>
  request('/adapters/wechat/uninstall', { method: 'POST' })

export const wechatStatus = (): Promise<WeChatStatus> => request('/adapters/wechat/status')

export const wechatSaveGroups = (groups: string[]): Promise<{ ok: boolean; groups: string[] }> =>
  request('/adapters/wechat/config', { method: 'PUT', body: JSON.stringify({ groups }) })

export const wechatStart = (): Promise<{ ok: boolean; code?: string; message: string }> =>
  request('/adapters/wechat/start', { method: 'POST' })

export const wechatStop = (): Promise<{ ok: boolean; message: string }> =>
  request('/adapters/wechat/stop', { method: 'POST' })

export const wechatSimulate = (
  text: string,
  group = '测试群'
): Promise<{ ok: boolean; matched?: boolean; created?: boolean; title?: string; ddl?: string; message?: string }> =>
  request('/adapters/wechat/simulate', {
    method: 'POST',
    body: JSON.stringify({ text, group })
  })

// ---- AI（规格 §7.3）----
export interface AiStatus {
  configured: boolean
  model: string | null
  base_url: string | null
}

export const aiStatus = (): Promise<AiStatus> => request('/ai/status')

export const setAiKey = (
  apiKey: string,
  baseUrl?: string,
  model?: string
): Promise<{ ok: boolean; backend?: string }> =>
  request('/ai/key', {
    method: 'POST',
    body: JSON.stringify({ api_key: apiKey, base_url: baseUrl, model })
  })

export const testAi = (): Promise<{ ok: boolean; code?: string; message: string }> =>
  request('/ai/test', { method: 'POST' })

export const summarizeText = (
  text: string
): Promise<{ summary: string | null; cached: boolean; degraded?: boolean; message?: string }> =>
  request('/ai/summarize', { method: 'POST', body: JSON.stringify({ text }) })

export interface TaskDraft {
  is_task: boolean
  title: string
  course_name: string | null
  ddl: string | null
  summary: string
  confidence: number
  engine: string
  hint: string
}

export const importText = (
  text: string
): Promise<{ draft: TaskDraft; raw_len: number }> =>
  request('/tasks/import-text', { method: 'POST', body: JSON.stringify({ text }) })

export const confirmDraft = (body: {
  title: string
  course_name?: string | null
  ddl?: string | null
  summary?: string | null
  raw_text?: string | null
  confidence?: number | null
}): Promise<Task> => request('/tasks/confirm', { method: 'POST', body: JSON.stringify(body) })

/** Agent 对话：消费 SSE，onEvent 回调 tool / message / error */
export async function chatStream(
  message: string,
  history: { role: string; content: string }[],
  onEvent: (e: { type: string; content?: string; name?: string; message?: string }) => void
): Promise<void> {
  const base = await getBaseUrl()
  const res = await fetch(`${base}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history })
  })
  if (!res.body) throw new Error('无响应流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch {
        /* 忽略坏包 */
      }
    }
  }
}

// ---- 设置（规格 §7.5）----
export const getSettings = (): Promise<Record<string, string>> => request('/settings')
export const putSettings = (patch: Record<string, string>): Promise<{ ok: boolean }> =>
  request('/settings', { method: 'PUT', body: JSON.stringify(patch) })
