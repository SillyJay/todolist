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
    // 本机密钥：后端用它区分「桌面 App 自己」和「外来请求」
    let adminToken = ''
    try {
      adminToken = (await window.api?.getAdminToken?.()) || ''
    } catch {
      adminToken = ''
    }
    const res = await fetch(`${base}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { 'X-Admin-Token': adminToken } : {})
      },
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
  /** 服务端补全过的标题（碎片会带课程名），没有时用 title */
  display_title?: string | null
  /** chapter = 纯章节类，折叠在「课内章节」里 */
  kind?: 'chapter' | 'task' | 'exam'
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
  /** 起始节次（1 起）；老数据可能为空 */
  section?: number | null
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
  chaoxing: { logged_in: boolean; account?: string }
  xiaoya: { logged_in: boolean; account?: string }
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

/** 退出学习通：清除本机 Cookie（不会注销超星账号） */
export const chaoxingLogout = (): Promise<{ ok: boolean; message: string }> =>
  request('/adapters/chaoxing/logout', { method: 'POST' })

/** 退出小雅：清除本机 Cookie */
export const xiaoyaLogout = (): Promise<{ ok: boolean; message: string }> =>
  request('/adapters/xiaoya/logout', { method: 'POST' })

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
export interface WorkspaceFile {
  name: string
  size: number
  rel: string
  ext: string
  mtime: string
}
export interface WorkspaceTask {
  name: string
  files: WorkspaceFile[]
  count: number
  size: number
}
export interface WorkspaceCourse {
  name: string
  tasks: WorkspaceTask[]
  count: number
  size: number
}
export interface WorkspacePlatform {
  platform: string
  courses: WorkspaceCourse[]
  count: number
  size: number
}
export interface WorkspaceInfo {
  root: string
  tree: WorkspacePlatform[]
}

export const workspaceInfo = (withTree = true): Promise<WorkspaceInfo> =>
  request(`/files/workspace?tree=${withTree}`)
export const openWorkspace = (): Promise<{ ok: boolean; root: string }> =>
  request('/files/open-workspace', { method: 'POST' })

/** 预览地址（给 img / iframe / fetch 用） */
export async function previewUrl(rel: string): Promise<string> {
  const base = await getBaseUrl()
  return `${base}/files/preview?rel=${encodeURIComponent(rel)}`
}

export const openPath = (rel: string): Promise<{ ok: boolean; path: string }> =>
  request('/files/open-path', { method: 'POST', body: JSON.stringify({ rel }) })

export const revealPath = (rel: string): Promise<{ ok: boolean; path: string }> =>
  request('/files/reveal-path', { method: 'POST', body: JSON.stringify({ rel }) })

export const deleteWorkspaceFile = (rel: string): Promise<{ ok: boolean }> =>
  request(`/files/file?rel=${encodeURIComponent(rel)}`, { method: 'DELETE' })

export const deleteWorkspaceTaskDir = (rel: string): Promise<{ ok: boolean }> =>
  request(`/files/task-dir?rel=${encodeURIComponent(rel)}`, { method: 'DELETE' })
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
    /** 是否管理员权限（提取微信密钥的前提） */
    admin?: boolean
    /** 本机微信版本，如 4.1.15.56 */
    wechat_version?: string
    wechat_exe?: string
    /** 探测到的微信数据目录（用于 init --db-dir） */
    db_dir?: string
    db_dir_source?: string
  }
  listener: {
    state: 'running' | 'offline' | 'not_configured'
    groups: string[]
    connected: boolean
    received: number
    /** 轮询间隔（秒） */
    interval?: number
    /** 上次轮询时间 HH:MM:SS */
    last_poll?: string
    last_error: string
    recent: { group: string; sender: string; text: string; time: string; keyword_hit: boolean }[]
    /** 已完成首次回补的群（后端 marker） */
    backfilled?: string[]
  }
  config_groups: string[]
  install: {
    preferred: string
    preferred_writable: boolean
    active: string
    fallback: string
    manifest: { exe?: string; size?: number; installed_at?: string; source?: string } | null
  }
  /** 启动时自动检查的结果（后端写入，前端只读） */
  update?: {
    current?: string
    latest?: string
    has_update?: boolean
    checked_at?: string
    error?: string
    auto?: boolean
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
  /** OK / CLI_MISSING / KEYS_MISSING / CLI_FAILED / PARSE_FAILED / EMPTY */
  code?: string
  message?: string
  cli?: string | null
}> => request('/adapters/wechat/groups')

export const wechatLaunch = (): Promise<{ ok: boolean; code?: string; message: string }> =>
  request('/adapters/wechat/launch', { method: 'POST' })

/** 检查 wechat-cli 组件是否有新提交（只读） */
export const wechatUpdateCheck = (): Promise<{
  repo: string
  current: string
  latest: string
  has_update: boolean
  baseline?: string
  checked_at?: string
  error?: string
  apply_command?: string
}> => request('/adapters/wechat/update/check', undefined, 60000)

export const wechatInit = (): Promise<{ ok: boolean; message: string; output?: string }> =>
  request('/adapters/wechat/init', { method: 'POST' })

export const wechatUninstall = (): Promise<{ ok: boolean; removed: string[] }> =>
  request('/adapters/wechat/uninstall', { method: 'POST' })

export const wechatStatus = (): Promise<WeChatStatus> => request('/adapters/wechat/status')

export const wechatSaveGroups = (
  groups: string[]
): Promise<{ ok: boolean; groups: string[]; restarted?: boolean }> =>
  request('/adapters/wechat/config', { method: 'PUT', body: JSON.stringify({ groups }) })

/** ---------------- 群消息信息流 ---------------- */

export interface WeChatFeedItem {
  id: number
  group: string
  sender: string
  text: string
  time: string
  category: string
  category_label: string
  /** AI 简化后的一句话（为空表示还没生成） */
  digest?: string
  digest_ready?: boolean
  relevance: number
  reason: string
  needs_action: boolean
  is_task: boolean
  task_id: number | null
  is_read: boolean
  ignored: boolean
  action?: string
  importance?: string
  classify_src?: string
}

export interface WeChatProfile {
  name: string
  class_name: string
  orgs: string[]
}

export interface WeChatFeed {
  items: WeChatFeedItem[]
  threshold: number
  profile: WeChatProfile
}

export const wechatFeed = (params: {
  category?: string
  group?: string
  onlyRelevant?: boolean
  onlyUnread?: boolean
  includeIgnored?: boolean
  minRelevance?: number
  /** ready（默认，只要化简好的） / pending（未处理原文） */
  status?: 'ready' | 'pending'
  q?: string
  limit?: number
} = {}): Promise<WeChatFeed> => {
  const search = new URLSearchParams()
  if (params.category && params.category !== 'all') search.set('category', params.category)
  if (params.group) search.set('group', params.group)
  if (params.onlyRelevant) search.set('only_relevant', 'true')
  if (params.onlyUnread) search.set('only_unread', 'true')
  if (params.includeIgnored) search.set('include_ignored', 'true')
  if (params.status) search.set('status', params.status)
  if (params.minRelevance) search.set('min_relevance', String(params.minRelevance))
  if (params.q) search.set('q', params.q)
  if (params.limit) search.set('limit', String(params.limit))
  const qs = search.toString()
  return request(`/wechat/feed${qs ? `?${qs}` : ''}`)
}

export interface WeChatFeedSummary {
  total: number
  relevant: number
  needs_action: number
  unread: number
  ignored: number
  pending?: number
  counts: Record<string, number>
  labels: Record<string, string>
  order: string[]
  profile: WeChatProfile
}

export const wechatFeedSummary = (): Promise<WeChatFeedSummary> =>
  request('/wechat/feed/summary')

export const wechatMessageToTask = (
  id: number
): Promise<{ ok: boolean; task_id: number; created: boolean }> =>
  request(`/wechat/feed/${id}/to-task`, { method: 'POST' }, 60000)

export const wechatReanalyze = (): Promise<{ ok: boolean; updated: number }> =>
  request('/wechat/feed/reanalyze', { method: 'POST' }, 60000)

/** 给缺摘要的消息补一句话（懒生成） */
export const wechatDigest = (ids: number[]): Promise<{ queued: number; pending: number }> =>
  request('/wechat/feed/digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  }, 20000)

export const wechatFeedGroups = (): Promise<{ items: { name: string; count: number }[] }> =>
  request('/wechat/feed/groups')

export const wechatFeedUnread = (): Promise<{ total: number; relevant: number }> =>
  request('/wechat/feed/unread')

export const wechatMarkRead = (ids?: number[]): Promise<{ ok: boolean; updated: number }> =>
  request('/wechat/feed/read-all', { method: 'POST', body: JSON.stringify(ids ?? null) }, 20000)

export const wechatIgnore = (
  id: number,
  ignored = true
): Promise<{ ok: boolean; id: number; ignored: boolean }> =>
  request(`/wechat/feed/${id}/ignore?ignored=${ignored}`, { method: 'POST' })

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
  /** 当前选择的服务商 id（空 = 未选择） */
  provider?: string
  provider_name?: string
  recommended?: boolean
}

export interface AiProvider {
  id: string
  name: string
  base_url: string
  models: string[]
  recommended: boolean
  note?: string
  key_url?: string
  /** 勾选、要在对话框里可选的模型 */
  enabled_models?: string[]
  /** 是否存过 API Key */
  configured?: boolean
  /** 是否为当前使用中的服务商 */
  active?: boolean
}

export interface AiCatalogGroup {
  id: string
  name: string
  configured: boolean
  active: boolean
  models: string[]
  current_model?: string
}

/** 对话页模型选择器：已配置的服务商 + 各自模型 */
export const aiModelCatalog = (): Promise<{
  items: AiCatalogGroup[]
  provider: string
  model: string
}> => request('/ai/models')

export const aiSetActive = (
  provider: string,
  model?: string
): Promise<{ ok: boolean; provider: string; model: string }> =>
  request('/ai/active', { method: 'POST', body: JSON.stringify({ provider, model }) })

export const aiSaveProvider = (
  pid: string,
  body: { api_key?: string; base_url?: string; models?: string[]; enabled_models?: string[] }
): Promise<{ ok: boolean }> =>
  request(`/ai/providers/${pid}`, { method: 'PUT', body: JSON.stringify(body) }, 30000)

export const aiThinking = (): Promise<{ level: string; levels: string[] }> =>
  request('/ai/thinking')

export const aiSetThinking = (level: string): Promise<{ ok: boolean; level: string }> =>
  request('/ai/thinking', { method: 'POST', body: JSON.stringify({ level }) })

export const aiDeleteProvider = (pid: string): Promise<{ ok: boolean }> =>
  request(`/ai/providers/${pid}`, { method: 'DELETE' })

export const aiProviders = (): Promise<{ items: AiProvider[]; current: string }> =>
  request('/ai/providers')

/** 拉取某服务商的模型清单；source=none 时前端显示 auto */
export const aiModels = (
  provider: string,
  apiKey?: string,
  baseUrl?: string
): Promise<{ models: string[]; source: 'remote' | 'builtin' | 'none'; error?: string; auto?: boolean }> =>
  request(
    '/ai/models',
    { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }) },
    20000
  )

/** 只切换模型，不动 Key */
export const setAiModel = (model: string): Promise<{ ok: boolean }> =>
  request('/ai/model', { method: 'POST', body: JSON.stringify({ model }) })

export const aiStatus = (): Promise<AiStatus> => request('/ai/status')

export const setAiKey = (
  apiKey: string,
  baseUrl?: string,
  model?: string,
  provider?: string
): Promise<{ ok: boolean; backend?: string }> =>
  request('/ai/key', {
    method: 'POST',
    body: JSON.stringify({ api_key: apiKey, base_url: baseUrl, model, provider })
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
/**
 * 设置项本地缓存：内存 + localStorage。
 *
 * 作用：设置页第一帧就有值可渲染，不用等后端往返（之前要等 0.6s+）。
 * 后端仍是唯一事实来源，`getSettings()` 回来后以它为准。
 */
const SETTINGS_CACHE_KEY = 'ca_settings_cache'
let settingsCache: Record<string, string> | null = null

export function cachedSettings(): Record<string, string> {
  if (settingsCache) return settingsCache
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY)
    if (raw) settingsCache = JSON.parse(raw) as Record<string, string>
  } catch {
    /* 缓存损坏时忽略 */
  }
  return settingsCache || {}
}

function rememberSettings(next: Record<string, string>): void {
  settingsCache = next
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(next))
  } catch {
    /* 超配额/隐私模式忽略 */
  }
}

export const getSettings = async (): Promise<Record<string, string>> => {
  const data = await request<Record<string, string>>('/settings')
  rememberSettings(data)
  return data
}

export const putSettings = async (patch: Record<string, string>): Promise<{ ok: boolean }> => {
  const r = await request<{ ok: boolean }>('/settings', {
    method: 'PUT',
    body: JSON.stringify(patch)
  })
  rememberSettings({ ...cachedSettings(), ...patch })
  return r
}

/* ---------------- 手机配对 ---------------- */

export interface PairCodeResp {
  ok: boolean
  code: string
  expires_at: string
  space_id: string
  ttl: number
  message?: string
}

export interface PairedDevice {
  id: string
  name: string
  platform: string
  created_at: string
  last_seen: string
}

export const createPairCode = (): Promise<PairCodeResp> =>
  request<PairCodeResp>('/pair/code', { method: 'POST' }, 10000)

export const listPairedDevices = (): Promise<{ items: PairedDevice[] }> =>
  request<{ items: PairedDevice[] }>('/pair/devices')

export const revokePairedDevice = (id: string): Promise<{ ok: boolean }> =>
  request<{ ok: boolean }>(`/pair/devices/${id}`, { method: 'DELETE' })

export const getPairMe = (): Promise<{
  space_id: string
  space_name: string
  email: string | null
  devices: number
  recovery_set: boolean
}> => request('/pair/me')

export const rotateRecovery = (): Promise<{ ok: boolean; recovery: string }> =>
  request<{ ok: boolean; recovery: string }>('/pair/recovery/rotate', { method: 'POST' })

/* ---------------- 学习通收件箱 / 考试 ---------------- */

export interface NoticeSyncResult {
  ok: boolean
  created?: number
  skipped?: number
  code?: string
  message?: string
  notice_error?: string
  exam_hint?: string
}

export const chaoxingSyncNotices = (): Promise<NoticeSyncResult> =>
  request<NoticeSyncResult>('/adapters/chaoxing/sync-notices', { method: 'POST' }, 60000)

export const chaoxingNoticePreview = (): Promise<{
  ok: boolean
  notices?: { id: string; title: string; kind: string; time: string }[]
  exams?: { id: string; title: string; time: string }[]
  code?: string
  message?: string
}> => request('/adapters/chaoxing/notices', {}, 30000)

/* ---------------- AI 分类 ---------------- */

export const wechatAiClassify = (
  limit = 60,
  force = false
): Promise<{ ok: boolean; done?: number; failed?: number; pending?: number; message?: string }> =>
  request(`/wechat/feed/ai-classify?limit=${limit}&force=${force ? 'true' : 'false'}`, {
    method: 'POST'
  }, 120000)

export const wechatReclassify = (
  mid: number,
  category: string
): Promise<{ ok: boolean; category?: string; label?: string; old?: string }> =>
  request(`/wechat/feed/${mid}/reclassify`, {
    method: 'POST',
    body: JSON.stringify({ category })
  })

export const wechatClassifyStats = (): Promise<{
  classify_src: Record<string, number>
  importance: Record<string, number>
}> => request('/wechat/feed/classify-stats')

export const wechatDigestBackfill = (
  limit = 200
): Promise<{ ok: boolean; queued: number; pending: number }> =>
  request(`/wechat/feed/digest-backfill?limit=${limit}`, { method: 'POST' }, 30000)

/* ---------------- 未处理视图 ---------------- */

export const wechatDigestOne = (
  mid: number
): Promise<{ ok: boolean; queued: number; pending: number }> =>
  request(`/wechat/feed/${mid}/digest`, { method: 'POST' })

export const wechatDigestAllPending = (): Promise<{
  ok: boolean
  queued: number
  pending: number
}> => request('/wechat/feed/digest-all-pending', { method: 'POST' }, 30000)

/* ---------------- 账号 / 邀请码 ---------------- */

export const authCreateInvite = (
  note = '',
  ttlDays = 7
): Promise<{ ok: boolean; code?: string; expires_at?: string; message?: string }> =>
  request('/auth/invite', { method: 'POST', body: JSON.stringify({ note, ttl_days: ttlDays }) })

export const authListInvites = (): Promise<{
  ok: boolean
  items: { code: string; note: string; expires_at: string; used_at: string; used_by_email: string }[]
}> => request('/auth/invites')

export const authListUsers = (): Promise<{
  ok: boolean
  items: { email: string; space_id: string; created_at: string }[]
}> => request('/auth/users')

export const authRegister = (
  email: string,
  password: string,
  invite: string,
  agree = false
): Promise<{ ok: boolean; token?: string; email?: string; space_id?: string; message?: string }> =>
  request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, invite, agree, device_name: '桌面端' })
  })

export const authLogin = (
  email: string,
  password: string
): Promise<{ ok: boolean; token?: string; email?: string; space_id?: string; message?: string }> =>
  request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, device_name: '桌面端' })
  })

/* ---------------- 账号资料（头像 / 昵称） ---------------- */

export function getAccountToken(): string {
  try {
    return window.localStorage.getItem('ca.account.token') || ''
  } catch {
    return ''
  }
}

export function setAccountToken(token: string): void {
  try {
    if (token) window.localStorage.setItem('ca.account.token', token)
    else window.localStorage.removeItem('ca.account.token')
  } catch {
    /* ignore */
  }
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl()
  const token = getAccountToken()
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  return (await res.json()) as T
}

export interface Profile {
  ok: boolean
  email?: string
  display_name?: string
  avatar?: string
  message?: string
}

export const authGetProfile = (): Promise<Profile> => authRequest('/auth/profile')

export const authPutProfile = (body: {
  display_name?: string
  avatar?: string
}): Promise<Profile> =>
  authRequest('/auth/profile', { method: 'PUT', body: JSON.stringify(body) })

export const authLogout = (): Promise<{ ok: boolean }> =>
  authRequest('/auth/logout', { method: 'POST' })

export const authRecoveryLogin = (
  email: string,
  recovery: string,
  newPassword: string
): Promise<{
  ok: boolean
  token?: string
  email?: string
  space_id?: string
  new_recovery?: string
  message?: string
}> =>
  authRequest('/auth/recovery', {
    method: 'POST',
    body: JSON.stringify({ email, recovery, new_password: newPassword })
  })

export const authRecoveryStatus = (): Promise<{ ok: boolean; recovery_set?: boolean }> =>
  authRequest('/auth/recovery/status')

export const authRecoveryRotate = (): Promise<{ ok: boolean; recovery?: string; message?: string }> =>
  authRequest('/auth/recovery/rotate', { method: 'POST' })

/* ---------------- 云端同步 ---------------- */

export const authBindLocal = (): Promise<{ ok: boolean; space_id?: string; moved_rows?: number; message?: string }> =>
  authRequest('/auth/bind-local', { method: 'POST' })

export interface CloudStatus {
  ok: boolean
  enabled: boolean
  url: string
  ready: boolean
  message: string
  has_token: boolean
  push_cursor: string
  pull_cursor: string
}

export const cloudStatus = (): Promise<CloudStatus> => request('/sync/cloud/status')

export const cloudConfig = (body: { enabled?: boolean; url?: string }): Promise<{ ok: boolean }> =>
  request('/sync/cloud/config', { method: 'POST', body: JSON.stringify(body) })

export const cloudNow = (): Promise<{ ok: boolean; push?: { pushed?: number; message?: string }; pull?: { pulled?: number } }> =>
  request('/sync/cloud/now', { method: 'POST' }, 40000)

/* ---------------- SMTP / 邮箱验证码 ---------------- */

export const emailStatus = (): Promise<{ ok: boolean; configured: boolean }> =>
  request('/auth/email/status')

export const emailSendCode = (email: string): Promise<{ ok: boolean; message?: string }> =>
  request('/auth/email/send-code', { method: 'POST', body: JSON.stringify({ email }) }, 30000)

export const resetByCode = (
  email: string,
  code: string,
  newPassword: string
): Promise<{ ok: boolean; token?: string; email?: string; new_recovery?: string; message?: string }> =>
  request('/auth/reset-by-code', {
    method: 'POST',
    body: JSON.stringify({ email, code, new_password: newPassword })
  }, 30000)

export const getSmtpConfig = (): Promise<{
  ok: boolean
  host: string
  port: string
  user: string
  sender: string
  ssl: string
}> => request('/auth/email/config')

export const saveSmtpConfig = (body: {
  host: string
  port: number
  user: string
  password?: string
  sender?: string
  ssl?: boolean
}): Promise<{ ok: boolean; message?: string }> =>
  request('/auth/email/config', { method: 'POST', body: JSON.stringify(body) })

export const testSmtp = (): Promise<{ ok: boolean; message: string }> =>
  request('/auth/email/test', { method: 'POST' }, 30000)
