export type PageKey = 'tasks' | 'calendar' | 'agent' | 'files' | 'settings'

export interface NavItem {
  key: PageKey
  label: string
  icon: 'tasks' | 'calendar' | 'agent' | 'files' | 'settings'
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'tasks', label: '任务', icon: 'tasks' },
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'agent', label: '对话', icon: 'agent' },
  { key: 'files', label: '文件', icon: 'files' },
  { key: 'settings', label: '设置', icon: 'settings' }
]

/** DDL 紧急度配色（规格 §8） */
export function urgencyOf(ddl?: string | null): 'danger' | 'warn' | 'near' | 'normal' {
  if (!ddl) return 'normal'
  const t = new Date(ddl).getTime()
  if (Number.isNaN(t)) return 'normal'
  const hours = (t - Date.now()) / 3600000
  if (hours <= 24) return 'danger'
  if (hours <= 72) return 'warn'
  if (hours <= 168) return 'near'
  return 'normal'
}

export function formatDdl(ddl?: string | null): string {
  if (!ddl) return '无截止时间'
  const d = new Date(ddl)
  if (Number.isNaN(d.getTime())) return ddl
  const now = Date.now()
  const diff = d.getTime() - now
  const abs = Math.abs(diff)
  const day = 86400000
  const hour = 3600000
  const min = 60000

  let rel: string
  if (abs < hour) rel = `${Math.round(abs / min)} 分钟`
  else if (abs < day) rel = `${Math.round(abs / hour)} 小时`
  else rel = `${Math.round(abs / day)} 天`

  const text = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`

  if (diff < 0) return `${text} · 已过期 ${rel}`
  return `${text} · 还剩 ${rel}`
}

export const PLATFORM_LABEL: Record<string, string> = {
  chaoxing: '学习通',
  xiaoya: '小雅',
  wechat: '微信群',
  manual: '手动'
}

export const PLATFORM_COLOR: Record<string, string> = {
  chaoxing: 'bg-[#1f3a5f] text-[#7db4ff]',
  xiaoya: 'bg-[#3a2a4f] text-[#c39bff]',
  wechat: 'bg-[#1f4f38] text-[#6ee7a8]',
  manual: 'bg-[#3a3a46] text-[#c8c8d4]'
}
