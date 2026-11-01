/** 日期小工具（原型用，不做时区库） */
export const pad = (n: number): string => String(n).padStart(2, '0')

export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export const sameDay = (a: Date, b: Date): boolean => ymd(a) === ymd(b)

export const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

export const monthLabel = (d: Date): string =>
  `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`

/** 相对时间：今天/明天/昨天，其余显示 M.D */
export function relativeDay(target: Date, base = new Date()): string {
  const t = target.getTime()
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()
  const diff = Math.round((t - b) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return `${target.getMonth() + 1}.${target.getDate()}`
}

/** 距离截止还有多少小时（负数表示已过） */
export function hoursLeft(due: string): number {
  return (parseYmd(due.slice(0, 10)).getTime() + 20 * 3600_000 - Date.now()) / 3600_000
}
