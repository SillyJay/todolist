import { useState } from 'react'
import { X, Wand2, Loader2, Check, AlertCircle, ListPlus } from 'lucide-react'
import { importText, confirmDraft, type TaskDraft } from '../lib/api'

interface Props {
  onClose: () => void
  onCreated: () => void
}

/** 从文本导入任务：粘贴通知 → AI/规则提取 → 用户确认 → 入库 */
export default function ImportTaskDialog({ onClose, onCreated }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [title, setTitle] = useState('')
  const [course, setCourse] = useState('')
  const [ddl, setDdl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const doExtract = async (): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await importText(text)
      const d = res.draft
      setDraft(d)
      setTitle(d.title)
      setCourse(d.course_name || '')
      setDdl(d.ddl ? d.ddl.slice(0, 16) : '')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const doConfirm = async (): Promise<void> => {
    if (!title.trim()) return
    setBusy(true)
    setError('')
    try {
      await confirmDraft({
        title: title.trim(),
        course_name: course.trim() || null,
        ddl: ddl ? new Date(ddl).toISOString() : null,
        summary: draft?.summary || null,
        raw_text: text,
        confidence: draft?.confidence ?? null
      })
      onCreated()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <div className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ListPlus size={17} strokeWidth={1.9} /> 从文本导入
            </div>
            <div className="dialog-sub">粘贴老师发的通知，自动提取标题、课程与截止时间</div>
          </div>
          <button onClick={onClose} className="icon-btn" title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="把老师发的通知粘贴进来，例如：&#10;【高数】第三章习题请于10月25日23:59前提交，逾期不候"
            className="input"
            style={{ resize: 'vertical', minHeight: 120, lineHeight: 1.7, padding: '10px 12px' }}
          />

          <div className="inline-actions" style={{ marginTop: -4 }}>
            <button
              onClick={() => void doExtract()}
              disabled={busy || !text.trim()}
              className="btn btn-primary sm"
            >
              {busy ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
              解析
            </button>
            {draft?.hint && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
                <AlertCircle size={12} /> {draft.hint}
              </span>
            )}
          </div>

          {draft && (
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 16 }}>
              <div className="setting-stack">
                <label className="field">
                  <span className="field-label">标题</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="input"
                  />
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label className="field" style={{ flex: 1 }}>
                    <span className="field-label">课程</span>
                    <input
                      value={course}
                      onChange={(e) => setCourse(e.target.value)}
                      placeholder="可不填"
                      className="input"
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    <span className="field-label">截止时间</span>
                    <input
                      type="datetime-local"
                      value={ddl}
                      onChange={(e) => setDdl(e.target.value)}
                      className="input"
                    />
                  </label>
                </div>
              </div>

              <div className="dialog-foot" style={{ padding: '16px 0 0' }}>
                <span className="left">
                  置信度 {Math.round((draft.confidence || 0) * 100)}% ·{' '}
                  {draft.engine === 'llm' ? 'AI 解析' : '本地规则'}
                </span>
                <button onClick={onClose} className="btn btn-ghost sm">
                  取消
                </button>
                <button
                  onClick={() => void doConfirm()}
                  disabled={busy || !title.trim()}
                  className="btn btn-primary sm"
                >
                  <Check size={13} /> 确认添加
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="status-note" style={{ color: 'var(--danger)', borderColor: 'color-mix(in oklch,var(--danger) 30%,transparent)' }}>
              <AlertCircle size={13} />
              <span style={{ wordBreak: 'break-all' }}>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
