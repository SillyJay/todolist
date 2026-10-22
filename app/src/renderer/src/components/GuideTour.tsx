import { useEffect, useLayoutEffect, useState } from 'react'

interface Step {
  selector: string
  title: string
  text: string
  place?: 'right' | 'bottom' | 'left' | 'top'
}

const STEPS: Step[] = [
  {
    selector: '[data-guide="settings"]',
    title: '第一步：配好 AI',
    text: '点这里进设置，把智谱 GLM 的 API Key 填上。填完点「测试连接」，看到"正常"就成了。\n没有 Key 也能用，只是解析质量会差一些。',
    place: 'right'
  },
  {
    selector: '[data-guide="account"]',
    title: '第二步：登录平台',
    text: '点「账号」，登录学习通和讯飞小雅。\n学习通用手机号+密码；小雅点「用内置浏览器登录」，登录完关掉窗口就行。',
    place: 'bottom'
  },
  {
    selector: '[data-guide="import"]',
    title: '第三步：随时收作业',
    text: '群里的通知复制过来，点这里粘贴，自动解析成任务。\n配了微信监听的话，这一步可以省略。',
    place: 'bottom'
  },
  {
    selector: '[data-guide="calendar"]',
    title: '第四步：看课表',
    text: '日历页切到「周」，能看到每天几点在哪上课。\n点某一天，下面还有分钟级的日程表和当日课表。',
    place: 'right'
  }
]

const KEY = 'ca_guide_done'

/** 引导式遮罩（模糊其余界面，聚焦单个入口） */
export default function GuideTour({
  force = false,
  onDone
}: {
  force?: boolean
  onDone?: () => void
}): React.JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const step = STEPS[index]

  useLayoutEffect(() => {
    const el = document.querySelector(step.selector)
    if (!el) {
      // 目标不在当前页面：跳过这一步
      if (index < STEPS.length - 1) setIndex(index + 1)
      else finish()
      return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const r = el.getBoundingClientRect()
    setRect(r)

    const onResize = (): void => setRect(el.getBoundingClientRect())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step.selector])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
      if (e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const finish = (): void => {
    localStorage.setItem(KEY, '1')
    onDone?.()
  }

  const next = (): void => {
    if (index < STEPS.length - 1) setIndex(index + 1)
    else finish()
  }

  if (!force && localStorage.getItem(KEY) === '1') return null
  if (!rect) return null

  const pad = 6
  const spot = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2
  }

  // 提示框位置
  const tooltipW = 300
  let tipStyle: React.CSSProperties = { width: tooltipW }
  if (step.place === 'right') {
    tipStyle = { ...tipStyle, left: Math.min(spot.left + spot.width + 14, window.innerWidth - tooltipW - 20), top: Math.min(spot.top, window.innerHeight - 200) }
  } else if (step.place === 'left') {
    tipStyle = { ...tipStyle, left: Math.max(spot.left - tooltipW - 14, 16), top: spot.top }
  } else if (step.place === 'top') {
    tipStyle = { ...tipStyle, left: Math.max(16, spot.left), top: Math.max(16, spot.top - 170) }
  } else {
    tipStyle = { ...tipStyle, left: Math.max(16, Math.min(spot.left, window.innerWidth - tooltipW - 20)), top: spot.top + spot.height + 14 }
  }

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* 遮罩：用超大 box-shadow 做出挖洞效果 */}
      <div
        className="absolute rounded-lg pointer-events-none"
        style={{
          ...spot,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
          border: '2px solid #4f8cff'
        }}
      />

      <div
        className="absolute rounded-xl border border-[#33405a] bg-[#171b24] p-3.5 shadow-2xl"
        style={tipStyle}
      >
        <div className="text-[13px] text-[#e8e8ec] mb-1.5">{step.title}</div>
        <div className="text-[11.5px] text-[#9a9aa8] leading-relaxed whitespace-pre-line">
          {step.text}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10.5px] text-[#4a4a58]">
            {index + 1} / {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={finish} className="text-[11px] text-[#6b6b7a] hover:text-[#c0c0cc]">
              跳过
            </button>
            <button
              onClick={next}
              className="px-2.5 py-1 rounded-md bg-[#4f8cff] text-white text-[11.5px]"
            >
              {index < STEPS.length - 1 ? '下一步' : '开始使用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
