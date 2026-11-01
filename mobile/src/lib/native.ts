/**
 * 原生能力封装：语音识别 + 本地通知
 *
 * 只在 Capacitor 壳里生效；浏览器里会优雅降级（语音返回空、通知直接跳过）。
 */

import { isNative } from './api'

/* ---------------- 语音识别 ---------------- */

type PartialListener = { remove: () => Promise<void> }

/**
 * 说一句话，返回识别文本。
 * Android 上走系统 SpeechRecognizer（可能是本地识别，也可能走 Google 服务）。
 */
export async function listenOnce(timeoutMs = 12000): Promise<string> {
  if (!isNative()) return ''
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')

  const perm = await SpeechRecognition.requestPermissions()
  if (perm.speechRecognition !== 'granted') {
    throw new Error('没有麦克风权限')
  }
  const { available } = await SpeechRecognition.available()
  if (!available) {
    throw new Error('这台设备没有可用的语音识别服务')
  }

  return new Promise<string>((resolve, reject) => {
    let done = false
    let listener: PartialListener | null = null
    let timer = 0

    const finish = (text: string, err?: Error): void => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      void listener?.remove()
      void SpeechRecognition.stop().catch(() => undefined)
      if (err) reject(err)
      else resolve(text.trim())
    }

    timer = window.setTimeout(() => finish(''), timeoutMs)

    void (async () => {
      try {
        listener = (await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
          const text = data?.matches?.[0]
          if (text) finish(text)
        })) as unknown as PartialListener
        await SpeechRecognition.start({
          language: 'zh-CN',
          maxResults: 3,
          partialResults: true,
          popup: false
        })
      } catch (e) {
        finish('', e as Error)
      }
    })()
  })
}

/** 长按开始时调用：先拿到权限并预热（可选） */
export async function warmUpVoice(): Promise<void> {
  if (!isNative()) return
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    await SpeechRecognition.requestPermissions()
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 本地通知 ---------------- */

const SCHEDULED_KEY = 'ca.scheduled'

function hashId(taskId: string, slot: number): number {
  let h = 0
  for (let i = 0; i < taskId.length; i++) h = (h * 31 + taskId.charCodeAt(i)) % 100000
  return h * 10 + slot
}

export interface ReminderTask {
  id: string
  title: string
  /** 没有截止时间的任务不排提醒 */
  due?: string
  done: boolean
}

/**
 * 给「未来 14 天内未完成的任务」排提醒：
 *   - 截止前 1 小时
 *   - 截止当时
 * 每次同步后重排一遍，先把上次排的撤掉，避免重复/过期堆积。
 */
export async function scheduleReminders(tasks: ReminderTask[]): Promise<number> {
  if (!isNative()) return 0
  const { LocalNotifications } = await import('@capacitor/local-notifications')

  const perm = await LocalNotifications.checkPermissions()
  let granted = perm.display === 'granted'
  if (!granted) {
    const req = await LocalNotifications.requestPermissions()
    granted = req.display === 'granted'
  }
  if (!granted) return 0

  // 撤掉上一轮
  const prev: number[] = JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '[]')
  if (prev.length) {
    await LocalNotifications.cancel({ notifications: prev.map((id) => ({ id })) }).catch(() => undefined)
  }

  const now = Date.now()
  const horizon = now + 14 * 86400000
  const items: { id: number; at: Date; title: string; body: string }[] = []

  for (const t of tasks) {
    if (t.done || !t.due) continue
    const at = new Date(t.due.replace(' ', 'T')).getTime()
    if (!Number.isFinite(at) || at < now || at > horizon) continue

    const oneHourBefore = at - 3600000
    if (oneHourBefore > now) {
      items.push({
        id: hashId(t.id, 1),
        at: new Date(oneHourBefore),
        title: '还有 1 小时截止',
        body: t.title
      })
    }
    items.push({
      id: hashId(t.id, 2),
      at: new Date(at),
      title: '现在截止',
      body: t.title
    })
  }

  if (!items.length) {
    localStorage.setItem(SCHEDULED_KEY, '[]')
    return 0
  }

  // Android 8+ 必须先有通知渠道
  await LocalNotifications.createChannel({
    id: 'reminders',
    name: '截止提醒',
    description: '任务截止前与到点时提醒',
    importance: 4,
    visibility: 1
  }).catch(() => undefined)

  await LocalNotifications.schedule({
    notifications: items.map((x) => ({
      id: x.id,
      title: x.title,
      body: x.body,
      schedule: { at: x.at, allowWhileIdle: true },
      channelId: 'reminders'
    }))
  })

  localStorage.setItem(SCHEDULED_KEY, JSON.stringify(items.map((x) => x.id)))
  return items.length
}

/** 今天有多少条提醒在排队（给设置页显示） */
export function scheduledCount(): number {
  try {
    return (JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '[]') as number[]).length
  } catch {
    return 0
  }
}
