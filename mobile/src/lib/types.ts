/** UI 层的数据类型（由 api.ts 的接口数据映射而来） */

export interface Task {
  id: string
  /** 数据库里的原始标题 */
  title: string
  /** 展示用标题（碎片已补课程名）；没有就用 title */
  display?: string
  /** chapter = 纯章节类，折叠在「课内章节」里 */
  kind?: 'chapter' | 'task'
  /** YYYY-MM-DD HH:mm；学习通通知这类可能没有截止时间 */
  due?: string
  done: boolean
  course?: string
}

export interface Ev {
  id: string
  /** YYYY-MM-DD */
  date: string
  title: string
  start: string
  end: string
  location?: string
}

export interface Course {
  id: string
  /** 1=周一 … 7=周日 */
  weekday: number
  name: string
  start: string
  end: string
  location?: string
  /** 这门课出现在哪些周："1-8" / "1-2,5" / "4,6-8" */
  weeks?: string
}

export interface Msg {
  id: string
  /** YYYY-MM-DD HH:mm */
  at: string
  /** 列表上显示的一行：优先 AI 简化后的 digest */
  digest: string
  group: string
  category: string
  /** 简化前的原文（详情里展示） */
  text: string
  /** 是否是 AI 简化过的（false 表示只做了截断） */
  simplified: boolean
  /** high / medium / low */
  importance?: string
}
