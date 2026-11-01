/**
 * 与电脑端后端通信（原型阶段：直接连本机 8765）。
 *
 * 真机/模拟器上要改服务器地址（设置页可改，存 localStorage）：
 *  - 模拟器：adb reverse tcp:8765 tcp:8765 → 仍用 127.0.0.1
 *  - 同一 WiFi 真机：填电脑的局域网 IP
 */

const LS_BASE = 'ca.server'
const LS_TOKEN = 'ca.token'
const LS_CACHE = 'ca.cache'

/** 是否跑在 Capacitor 原生壳里（APK） */
export function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}

export function getBase(): string {
  const saved = localStorage.getItem(LS_BASE)
  if (saved) return saved
  if (typeof location === 'undefined') return 'http://127.0.0.1:8765'
  // 原生壳里拿不到「当前页面就是后端」这种线索，只能让用户填地址
  if (isNative()) return ''
  // 隧道/公网：网页由后端同源托管（/m），接口就在同一个域名的 /api 下
  if (location.protocol === 'https:') return location.origin
  // 局域网：手机打开页面时的 hostname 就是电脑地址
  return `http://${location.hostname || '127.0.0.1'}:8765`
}

export function setBase(url: string): void {
  localStorage.setItem(LS_BASE, url.replace(/\/+$/, ''))
}

export function getToken(): string {
  return localStorage.getItem(LS_TOKEN) || ''
}

export function setToken(token: string): void {
  localStorage.setItem(LS_TOKEN, token)
}

export interface ApiTask {
  id: number
  title: string
  /** 服务端补全过的标题（碎片会带上课程名） */
  display_title?: string
  /** chapter = 纯章节类，可折叠归档 */
  kind?: 'chapter' | 'task'
  ddl: string | null
  status: string
  course: string | null
  platform?: string
  updated_at?: string | null
  deleted_at?: string | null
}

export interface ApiEvent {
  id: string
  title: string
  date: string
  start: string
  end: string
  location?: string | null
  note?: string | null
  remind_before?: number
  updated_at?: string | null
  deleted_at?: string | null
}

export interface ApiCourse {
  id: number
  name: string
  weekday: number
  start: string
  end: string
  location?: string | null
  teacher?: string | null
  /** 出现在哪些周 */
  weeks?: string | null
}

export interface ApiMessage {
  id: number
  group: string
  sender?: string
  category: string
  /** AI 简化后的一句话 */
  digest: string
  /** 没有 AI 摘要时的截断文本 */
  digest_fallback?: string
  /** ai / fallback / 空 */
  digest_src?: string
  /** 简化前的原文 */
  text?: string
  reason?: string
  relevance: number
  needs_action?: boolean
  time: string
  ignored: boolean
  /** high / medium / low（AI 判定） */
  importance?: string
  /** notify / digest / mute */
  action?: string
}

export interface Changes {
  cursor: string
  server_time: string
  /** 学期第一周的周一（YYYY-MM-DD），用于算周次 */
  semester_start?: string | null
  /** 未化简的消息数（手机只显示有没有） */
  pending_messages?: number
  /** 账号资料（头像/昵称），桌面与手机共用 */
  account?: { email?: string; display_name?: string; avatar?: string }
  tasks: ApiTask[]
  events: ApiEvent[]
  courses: ApiCourse[]
  messages: ApiMessage[]
}

export function clearToken(): void {
  localStorage.removeItem(LS_TOKEN)
}

export function hasToken(): boolean {
  return !!getToken()
}

export interface PairResult {
  ok: boolean
  token?: string
  device_id?: string
  space_id?: string
  device_name?: string
  message?: string
  code?: string
}

/** 用 6 位配对码换 token */
export const pair = (code: string, deviceName: string, platform = 'android'): Promise<PairResult> =>
  request('/api/pair', {
    method: 'POST',
    body: JSON.stringify({ code, device_name: deviceName, platform })
  })

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const base = getBase()
  if (!base) {
    throw new Error('NO_SERVER')
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) }
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (init?.body) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${base}${path}`, { ...init, headers, signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** 拉全量/增量变化 */
export const fetchChanges = (since?: string): Promise<Changes> =>
  request(`/api/sync/changes${since ? `?since=${encodeURIComponent(since)}` : ''}`, undefined, 20000)

export interface Op {
  op_id: string
  entity: 'task' | 'event' | 'message'
  id: string
  action: 'done' | 'undone' | 'create' | 'delete' | 'ignore'
  patch?: Record<string, unknown>
}

export interface CreatedRow {
  op_id: string
  entity: string
  id: number
}

export const applyOps = (
  ops: Op[]
): Promise<{ applied: string[]; conflicts: unknown[]; created?: CreatedRow[] }> =>
  request('/api/sync/ops', { method: 'POST', body: JSON.stringify({ ops }) })

export const health = (): Promise<{ ok: boolean; space_id: string; counts: Record<string, number> }> =>
  request('/api/sync/health', undefined, 6000)

export interface ParsedEvent {
  ok: boolean
  type: 'event' | 'task'
  title: string
  date: string
  start: string | null
  end: string | null
  location: string | null
  remind_before: number
  confidence: number
  source: 'ai' | 'rule'
}

export const parseEvent = (text: string, now?: string): Promise<ParsedEvent> =>
  request(
    '/api/ai/parse-event',
    { method: 'POST', body: JSON.stringify({ text, now }) },
    40000
  )

export const newId = (): string =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export const newOpId = newId

/* ---------------- 离线缓存 ---------------- */

export interface Snapshot {
  at: string
  cursor: string
  tasks: unknown[]
  events: unknown[]
  courses: unknown[]
  messages: unknown[]
}

export function saveCache(snap: Snapshot): void {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify(snap))
  } catch {
    /* 存储满了就忽略，不影响在线使用 */
  }
}

export function loadCache(): Snapshot | null {
  try {
    const raw = localStorage.getItem(LS_CACHE)
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null
  }
}

export interface AuthResult {
  ok: boolean
  token?: string
  email?: string
  space_id?: string
  message?: string
}

export const authLogin = async (
  email: string,
  password: string,
  deviceName: string
): Promise<AuthResult> => {
  const r = await fetch(`${getBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, device_name: deviceName })
  })
  return (await r.json()) as AuthResult
}

export const authRegister = async (
  email: string,
  password: string,
  invite: string,
  deviceName: string,
  agree = false
): Promise<AuthResult> => {
  const r = await fetch(`${getBase()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, invite, agree, device_name: deviceName })
  })
  return (await r.json()) as AuthResult
}

export interface Profile {
  ok: boolean
  email?: string
  display_name?: string
  avatar?: string
  message?: string
}

export const getProfile = (): Promise<Profile> => request('/api/auth/profile')

export const putProfile = (body: { display_name?: string; avatar?: string }): Promise<Profile> =>
  request('/api/auth/profile', { method: 'PUT', body: JSON.stringify(body) })
