/**
 * 中文时间表达解析（原型版）。
 *
 * 真机上这一步会交给电脑端的 AI（/ai/parse-event）；这里先用规则实现，
 * 目的是把交互跑通：用户打「明天下午三点交报告」→ 识别出 时间 + 去掉时间后的标题。
 */

const CN_NUM: Record<string, number> = {
  零: 0,
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

function cnToNum(s: string): number | null {
  if (!s) return null
  if (/^\d{1,3}$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.length === 2 && s[0] === '十') return 10 + (CN_NUM[s[1]] ?? 0)
  if (s.length === 2 && s[1] === '十') return (CN_NUM[s[0]] ?? 0) * 10
  if (s.length === 3 && s[1] === '十') return (CN_NUM[s[0]] ?? 0) * 10 + (CN_NUM[s[2]] ?? 0)
  const single = CN_NUM[s]
  return single ?? null
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export interface Parsed {
  /** 解析出的日期（YYYY-MM-DD），没有则不填 */
  date?: string
  /** 解析出的时间（HH:mm） */
  time?: string
  /** 去掉时间词后的标题 */
  title: string
  /** 命中的原文片段，用于展示「识别到」 */
  matched: string[]
}

const DAY_WORDS: [RegExp, number][] = [
  [/(大后天)/, 3],
  [/(后天)/, 2],
  [/(明天|明日)/, 1],
  [/(今天|今日)/, 0]
]

const WEEK_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7
}

const PERIOD: Record<string, string> = {
  凌晨: 'am',
  早上: 'am',
  上午: 'am',
  中午: 'noon',
  下午: 'pm',
  傍晚: 'pm',
  晚上: 'pm'
}

export function parseWhen(raw: string, base = new Date()): Parsed {
  let text = raw
  const matched: string[] = []
  let date: Date | null = null
  let hour: number | null = null
  let minute = 0

  // 1) 相对日：今天 / 明天 / 后天 / 大后天
  for (const [re, offset] of DAY_WORDS) {
    const m = text.match(re)
    if (m) {
      const d = new Date(base)
      d.setDate(d.getDate() + offset)
      date = d
      matched.push(m[0])
      text = text.replace(m[0], '')
      break
    }
  }

  // 2) 周几（本周/下周/周X）
  if (!date) {
    const m = text.match(/(下|这|本)?(?:周|星期|礼拜)([一二三四五六日天])/)
    if (m) {
      const target = WEEK_MAP[m[2]]
      const d = new Date(base)
      const cur = d.getDay() === 0 ? 7 : d.getDay()
      let diff = target - cur
      if (m[1] === '下') diff += diff <= 0 ? 7 : 7
      if (diff < 0) diff += 7
      d.setDate(d.getDate() + diff)
      date = d
      matched.push(m[0])
      text = text.replace(m[0], '')
    }
  }

  // 3) 具体日期：10月30日 / 10.30 / 10/30
  if (!date) {
    const m = text.match(/(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/)
    if (m) {
      const month = Number(m[1])
      const day = Number(m[2])
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const d = new Date(base.getFullYear(), month - 1, day)
        if (d.getTime() < base.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1)
        date = d
        matched.push(m[0])
        text = text.replace(m[0], '')
      }
    }
  }

  // 4) 时间：下午三点 / 15:30 / 晚上八点半
  const colon = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/)
  if (colon) {
    const h = Number(colon[1])
    const mi = Number(colon[2])
    if (h <= 23 && mi <= 59) {
      hour = h
      minute = mi
      matched.push(colon[0])
      text = text.replace(colon[0], '')
    }
  }

  if (hour === null) {
    // 时段词先取出来（保留语义）
    let period: string | null = null
    const periodKey = Object.keys(PERIOD).find((k) => text.includes(k))
    if (periodKey) {
      period = PERIOD[periodKey]
      matched.push(periodKey)
      text = text.replace(periodKey, '')
    }

    const m = text.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*点\s*(半|一刻|三刻|\d{1,2}\s*分?)?/)
    if (m) {
      const h = cnToNum(m[1])
      if (h !== null && h <= 24) {
        hour = h
        if (m[2] === '半') minute = 30
        else if (m[2] === '一刻') minute = 15
        else if (m[2] === '三刻') minute = 45
        else if (m[2]) minute = Number(String(m[2]).replace(/\D/g, '')) || 0
        if (period === 'pm' && hour < 12) hour += 12
        if (period === 'noon' && hour <= 2) hour += 12
        if (period === 'am' && hour === 12) hour = 0
        matched.push(m[0])
        text = text.replace(m[0], '')
      }
    } else if (period === 'noon') {
      hour = 12
      minute = 0
    }
  }

  const title = text.replace(/\s+/g, ' ').replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim()

  const out: Parsed = { title, matched }
  if (date) out.date = ymd(date)
  if (hour !== null) out.time = `${pad2(hour)}:${pad2(minute)}`
  return out
}
