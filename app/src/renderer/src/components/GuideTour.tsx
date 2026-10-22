import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

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

/**
 * 引导式遮罩（模糊其余界面，聚焦单个入口）。
 *
 * 三个必须守住的点：
 * 1. 结束必须真的卸载 —— 之前只写 localStorage 不更新 state，按钮点了像没反应
 * 2. 遮罩层 pointer-events:none，只有提示卡接收点击，避免吃掉整页交互
 * 3. 目标元素的 rect 要等布局稳定后再测（平滑滚动会拿到旧位置，导致框选偏移）
 */
export default function GuideTour({
  force = false,
  onDone
}: {
  force?: boolean
  onDone?: () => void
}): React.JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [closed, setClosed] = useState(false)

  const step = STEPS[index]

  const finish = useCallback((): void => {
    localStorage.setItem(KEY, '1')
    setClosed(true)
    onDone?.()
  }, [onDone])

  const next = useCallback((): void => {
    if (index < STEPS.length - 1) {
      setIndex(index + 1)
    } else {
      localStorage.setItem(KEY, '1')
      setClosed(true)
      onDone?.()
    }
  }, [index, onDone])

  // 测量目标位置：跳过不可见元素，等两帧让滚动/布局稳定
  useLayoutEffect(() => {
    if (closed) return

    const list = Array.from(document.querySelectorAll(step.selector))
    const el =
      list.find((n) => {
        const r = n.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }) ?? null

    if (!el) {
      // 目标不在当前页面：跳到下一步，不卡在这一屏
      if (index < STEPS.length - 1) setIndex(index + 1)
      else finish()
      return
    }

    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })

    let raf1 = 0
    let raf2 = 0
    const measure = (): void => setRect(el.getBoundingClientRect())

    raf1 = requestAnimationFrame(() => {
      measure()
      raf2 = requestAnimationFrame(measure)
    })

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step?.selector, closed])

  // 键盘：Esc 跳过，Enter/→ 下一步
  useEffect(() => {
    if (closed) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
      if (e.key === 'Enter' || e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closed, finish, next])

  if (closed) return null
  if (!force && localStorage.getItem(KEY) === '1') return null
  if (!rect) return null

  const pad = 6
  const spot = {
    top: Math.max(4, rect.top - pad),
    left: Math.max(4, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2
  }

  // 提示卡定位：按声明的方向放，越界时自动翻转到另一侧
  const tipW = 306
  const tipH = 170
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

  let top = spot.top + spot.height + 14
  let left = spot.left

  if (step.place === 'right') {
    left = spot.left + spot.width + 14
    if (left + tipW > vw - 12) {
      const flipped = spot.left - tipW - 14
      left = flipped >= 12 ? flipped : clamp(spot.left, 12, vw - tipW - 12)
    }
    top = spot.top
  } else if (step.place === 'left') {
    left = spot.left - tipW - 14
    if (left < 12) left = clamp(spot.left + spot.width + 14, 12, vw - tipW - 12)
    top = spot.top
  } else if (step.place === 'top') {
    top = spot.top - tipH - 14
    if (top < 12) top = spot.top + spot.height + 14
    left = spot.left
  } else {
    top = spot.top + spot.height + 14
    if (top + tipH > vh - 12) top = spot.top - tipH - 14
    left = spot.left
  }

  top = clamp(top, 12, Math.max(12, vh - tipH - 12))
  left = clamp(left, 12, Math.max(12, vw - tipW - 12))

  const isLast = index === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* 挖洞高亮：外圈用超大 shadow 压暗，本身不接收点击 */}
      <div
        className="absolute rounded-xl pointer-events-none transition-all duration-200"
        style={{
          top: spot.top,
          left: spot.left,
          width: spot.width,
          height: spot.height,
          boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
          border: '2px solid var(--accent)',
          background: 'transparent'
        }}
      />

      {/* 提示卡：唯一可交互区域 */}
      <div
        className="absolute pointer-events-auto rounded-xl p-4 transition-all duration-200"
        style={{
          top,
          left,
          width: tipW,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          color: 'var(--fg)'
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span
            className="text-[13px] font-semibold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {step.title}
          </span>
          <span
            className="text-[10.5px] tabular-nums"
            style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}
          >
            {index + 1} / {STEPS.length}
          </span>
        </div>

        <div
          className="whitespace-pre-line text-[12px] leading-relaxed"
          style={{ color: 'var(--muted)' }}
        >
          {step.text}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="cursor-pointer rounded-md px-1.5 py-1 text-[11.5px] transition-colors"
            style={{ color: 'var(--faint)', background: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--fg)'
              e.currentTarget.style.background = 'var(--surface-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--faint)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            跳过
          </button>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(Math.max(0, index - 1))}
                className="cursor-pointer rounded-md px-2 py-1 text-[11.5px] transition-colors"
                style={{ color: 'var(--muted)', background: 'transparent' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface-2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-transform active:scale-[0.97]"
              style={{
                background: 'var(--primary-bg)',
                color: 'var(--primary-fg)',
                border: '1px solid var(--border)'
              }}
            >
              {isLast ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
