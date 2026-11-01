/** 课表节次与时间（设置页 / 日历共用） */

export interface SectionTime {
  no: number
  start: string
  end: string
}

/** 未配置时的默认节次时间（用户给定） */
export const DEFAULT_SECTIONS: SectionTime[] = [
  { no: 1, start: '08:30', end: '10:00' },
  { no: 2, start: '10:20', end: '11:50' },
  { no: 3, start: '13:50', end: '15:30' },
  { no: 4, start: '15:30', end: '16:55' },
  { no: 5, start: '19:00', end: '20:30' }
]

export const KEY_AUTO_TIME = 'chaoxing_auto_time'
export const KEY_SECTIONS = 'section_times'

/** 解析设置里的节次配置；返回 null 表示用户没配置过 */
export function parseSections(raw?: string | null): SectionTime[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw) as SectionTime[]
    if (!Array.isArray(arr) || arr.length === 0) return null
    const ok = arr
      .filter((x) => x && typeof x.start === 'string' && typeof x.end === 'string')
      .map((x, i) => ({ no: Number(x.no) || i + 1, start: x.start, end: x.end }))
    return ok.length ? ok : null
  } catch {
    return null
  }
}

/** 取第 n 节的起止时间；超出范围时返回最后一节 */
export function sectionRange(no: number, list: SectionTime[]): SectionTime {
  const hit = list.find((s) => s.no === no)
  if (hit) return hit
  return list[list.length - 1] ?? DEFAULT_SECTIONS[0]
}

export const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
