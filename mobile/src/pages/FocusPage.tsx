import { useEffect, useMemo, useRef, useState } from 'react'
import { IconPause, IconPlay, IconNote, IconClockSm } from '../components/Icons'

type Mode = 'pomodoro' | 'countup' | 'countdown'

const PRESET: Record<Mode, number> = { pomodoro: 25 * 60, countup: 0, countdown: 10 * 60 }
const LABEL: Record<Mode, string> = { pomodoro: '番茄钟', countup: '正计时', countdown: '倒计时' }

/** Tab 2：专注（番茄钟 / 正计时 / 倒计时） */
export default function FocusPage(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('pomodoro')
  const [left, setLeft] = useState(PRESET.pomodoro)
  const [running, setRunning] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!running) {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
      return
    }
    timer.current = window.setInterval(() => {
      setLeft((v) => {
        if (mode === 'countup') return v + 1
        if (v <= 1) {
          setRunning(false)
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
    }
  }, [running, mode])

  const switchMode = (m: Mode): void => {
    setMode(m)
    setRunning(false)
    setLeft(PRESET[m])
  }

  const total = mode === 'countup' ? Math.max(left, 60) : PRESET[mode]
  const progress = mode === 'countup' ? 0 : 1 - left / total
  const text = useMemo(() => {
    const mm = Math.floor(left / 60)
    const ss = left % 60
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }, [left])

  const R = 128
  const C = 2 * Math.PI * R

  return (
    <div className="screen">
      <div className="nav">
        <span className="nav-title">快捷专注</span>
        <span className="nav-actions">
          <button className="icon-btn" aria-label="设置">
            <IconNote />
          </button>
        </span>
      </div>

      <div className="focus-wrap">
        <div className="seg">
          {(Object.keys(LABEL) as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => switchMode(m)}>
              {LABEL[m]}
            </button>
          ))}
        </div>

        <div className="ring-wrap">
          <svg width={270} height={270} viewBox="0 0 270 270">
            <circle cx="135" cy="135" r={R} fill="none" stroke="var(--line)" strokeWidth="2" />
            <circle
              cx="135"
              cy="135"
              r={R}
              fill="none"
              stroke="var(--fg)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              transform="rotate(-90 135 135)"
              style={{ transition: 'stroke-dashoffset .4s linear' }}
            />
            <circle
              cx={135 + R * Math.sin(2 * Math.PI * progress)}
              cy={135 - R * Math.cos(2 * Math.PI * progress)}
              r="5.5"
              fill="var(--fg)"
            />
          </svg>
          <div className="ring-time">{text}</div>
        </div>

        <div className="focus-actions">
          <button aria-label="白噪音" style={{ opacity: 0.55 }}>
            <IconNote />
          </button>
          <button
            className="play"
            onClick={() => setRunning((v) => !v)}
            aria-label={running ? '暂停' : '开始'}
          >
            {running ? <IconPause /> : <IconPlay />}
          </button>
          <button aria-label="历史" style={{ opacity: 0.55 }}>
            <IconClockSm />
          </button>
        </div>
      </div>
    </div>
  )
}
