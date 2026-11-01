import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, Minimize2, X } from 'lucide-react'

/**
 * 关闭窗口确认框（应用内自绘，和新建任务等弹窗同一套 .overlay/.dialog 样式）。
 *
 * 为什么不用 Electron 原生 dialog：原生框用的是系统字体和配色，和界面不统一。
 * 主进程在 window 'close' 里 preventDefault，然后 send('app:close-request')；
 * 这里渲染弹窗，用户选择后回传 respondClose(action, remember)。
 */
export default function ClosePrompt(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    const off = window.api?.onCloseRequest?.(() => {
      setRemember(false)
      setOpen(true)
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [])

  if (!open) return null

  const respond = (action: 'tray' | 'quit' | 'cancel'): void => {
    setOpen(false)
    void window.api?.respondClose?.(action, remember)
  }

  return createPortal(
    <div className="overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="关闭 ToDoList">
        <div className="dialog-head">
          <div>
            <div className="dialog-title">关闭 ToDoList</div>
            <div className="dialog-sub">要最小化到托盘，还是直接退出？</div>
          </div>
          <button className="icon-btn" onClick={() => respond('cancel')} aria-label="取消">
            <X size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="setting-stack">
            <label
              className="inline-actions"
              style={{ gap: 8, cursor: 'pointer', fontSize: 12.5, color: 'var(--muted)' }}
            >
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              不再询问（之后可在「设置 → 常规 → 关闭窗口」里修改）
            </label>
          </div>
        </div>

        <div className="dialog-foot">
          <button className="btn btn-ghost sm" onClick={() => respond('cancel')}>
            取消
          </button>
          <button className="btn btn-secondary sm" onClick={() => respond('tray')}>
            <Minimize2 size={14} strokeWidth={1.9} /> 最小化到托盘
          </button>
          <button className="btn btn-danger sm" onClick={() => respond('quit')}>
            <LogOut size={14} strokeWidth={1.9} /> 退出程序
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
