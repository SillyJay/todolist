/**
 * 两日计划（艾森豪威尔矩阵）的预取与缓存。
 *
 * 为什么放在这里：这份内容要「打开软件就开始加载」，而不是等用户切到对话页才发请求。
 * 于是把它提成模块级单例：App 启动时调 ensurePlan()，AgentPage 订阅同一份状态，
 * 页面打开时通常已经有结果（或正在流式输出）。
 */
import { chatStream } from './api'

export interface PlanState {
  text: string
  error: string
  busy: boolean
  /** 计划对应的日期（YYYY-M-D），跨天自动失效重生成 */
  day: string
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

export function dayLabel(offset = 0): string {
  const d = new Date(Date.now() + offset * 86400000)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEK_CN[d.getDay()]}`
}

function dayKey(offset = 0): string {
  const d = new Date(Date.now() + offset * 86400000)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 打开对话页/启动时执行的规划指令 */
export function planPrompt(): string {
  return [
    `今天是 ${dayLabel(0)}，明天是 ${dayLabel(1)}。`,
    '请先调用工具查看我未来 48 小时的任务与课程，再按艾森豪威尔矩阵给我行动建议。',
    '输出格式严格如下，不要任何多余解释：',
    '【今天】',
    '- Q1 紧急且重要：事项（时间）',
    '- Q2 重要不紧急：事项（时间）',
    '- Q3 紧急不重要：事项（时间）',
    '【明天】',
    '- Q1 紧急且重要：事项（时间）',
    '- Q2 重要不紧急：事项（时间）',
    '每个象限最多 3 条，没有就写「—」；最后单独一行写「先做：xxx」。'
  ].join('\n')
}

let state: PlanState = { text: '', error: '', busy: false, day: '' }
const listeners = new Set<(s: PlanState) => void>()
let inflight: Promise<void> | null = null

function emit(): void {
  for (const fn of listeners) fn(state)
}

export function getPlan(): PlanState {
  return state
}

export function subscribePlan(fn: (s: PlanState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 生成/复用两日计划。
 * - 默认：同一天内已有结果或正在生成 → 直接复用
 * - force：强制重新生成（用户点刷新）
 */
export function ensurePlan(force = false): Promise<void> {
  const key = dayKey()

  if (inflight) return inflight
  if (!force && state.day === key && (state.text || state.busy)) {
    return Promise.resolve()
  }

  state = { text: '', error: '', busy: true, day: key }
  emit()

  inflight = (async () => {
    try {
      let acc = ''
      await chatStream(planPrompt(), [], (e) => {
        if (e.type === 'delta') {
          acc += e.content || ''
          state = { ...state, text: acc }
          emit()
        } else if (e.type === 'message') {
          state = { ...state, text: e.content || acc }
          emit()
        } else if (e.type === 'error') {
          state = { ...state, error: e.message || '生成失败' }
          emit()
        }
      })
    } catch (e) {
      state = { ...state, error: String(e) }
      emit()
    } finally {
      state = { ...state, busy: false }
      emit()
      inflight = null
    }
  })()

  return inflight
}
