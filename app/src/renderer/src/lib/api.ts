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
  confidence?: number | null
}

export const listTasks = (
  params: Record<string, string> = {}
): Promise<{ items: Task[]; total: number }> => {
  const qs = new URLSearchParams(params).toString()
  return request(`/tasks${qs ? `?${qs}` : ''}`)
}

// ---- 适配器状态（规格 §7.2）----
export interface AdaptersStatus {
  chaoxing: { logged_in: boolean }
  xiaoya: { logged_in: boolean }
  wechat: { state: 'running' | 'offline' | 'not_configured' }
}
export const adaptersStatus = (): Promise<AdaptersStatus> => request('/adapters/status')

// ---- 设置（规格 §7.5）----
export const getSettings = (): Promise<Record<string, string>> => request('/settings')
export const putSettings = (patch: Record<string, string>): Promise<{ ok: boolean }> =>
  request('/settings', { method: 'PUT', body: JSON.stringify(patch) })
