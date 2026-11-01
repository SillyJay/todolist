import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { createTask } from '../lib/api'
import { toast } from './Toast'

interface Props {
  onClose: () => void
  onCreated: () => void
}

/** 新建任务弹窗（任务页右下角「+」触发） */
export default function AddTaskDialog({ onClose, onCreated }: Props): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [course, setCourse] = useState('')
  const [ddl, setDdl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (): Promise<void> => {
    if (!title.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      const ddlIso = ddl ? new Date(ddl).toISOString() : null
      await createTask({
        title: title.trim(),
        ddl: ddlIso,
        course_name: course.trim() || null,
        course_abbr: course.trim() || null
      })
      toast('任务已创建')
      onCreated()
      onClose()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="新建任务">
        <div className="dialog-head">
          <div>
            <div className="dialog-title">新建任务</div>
            <div className="dialog-sub">手动补一条待办；截止时间可留空，日历里只显示有时间的任务。</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <label className="form-label">任务标题</label>
          <input
            autoFocus
            className="input full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder="例如：数据结构实验四"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <div>
              <label className="form-label">课程（可选）</label>
              <input
                className="input full"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="例如：数据结构"
              />
            </div>
            <div>
              <label className="form-label">截止时间（可选）</label>
              <input
                type="datetime-local"
                className="input full"
                value={ddl}
                onChange={(e) => setDdl(e.target.value)}
              />
            </div>
          </div>

          {err && (
            <div className="status-note" style={{ marginTop: 10 }}>
              <span style={{ wordBreak: 'break-all' }}>{err}</span>
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!title.trim() || busy}
          >
            {busy ? <Loader2 size={13} className="spin" /> : null}
            {busy ? '创建中…' : '创建任务'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
