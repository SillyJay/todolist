/** 课表周次工具（与后端 services/schedule.py 保持一致） */

export function parseWeeks(weeks?: string | null): Set<number> {
  const out = new Set<number>()
  if (!weeks) return out
  for (const part of weeks.split(',')) {
    const s = part.trim()
    if (!s) continue
    if (s.includes('-')) {
      const [a, b] = s.split('-').map((x) => Number(x))
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let i = a; i <= b; i++) out.add(i)
      }
    } else {
      const n = Number(s)
      if (Number.isFinite(n)) out.add(n)
    }
  }
  return out
}

export function weeksContain(weeks: string | null | undefined, weekNo: number): boolean {
  const set = parseWeeks(weeks)
  return set.size === 0 || set.has(weekNo)
}

/** 按学期第一周周一推算教学周（第 1 周 = 1） */
export function weekOfDate(date: Date, firstWeekDate: string): number {
  const first = new Date(`${firstWeekDate}T00:00:00`)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((d.getTime() - first.getTime()) / (7 * 86400000)) + 1
}
