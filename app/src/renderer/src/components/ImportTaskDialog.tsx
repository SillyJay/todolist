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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[560px] max-h-[86vh] overflow-y-auto rounded-xl border border-[#2e2e38] bg-[#17171c] shadow-2xl">
        <header className="flex items-center justify-between px-4 h-11 border-b border-[#26262f]">
          <span className="flex items-center gap-1.5 text-[13px] text-[#e0e0e8]">
            <ListPlus size={14} /> 从文本导入任务
          </span>
          <button onClick={onClose} className="text-[#7a7a88] hover:text-[#e0e0e8]">
            <X size={15} />
          </button>
        </header>

        <div className="p-4 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="把老师发的通知粘贴进来，例如：\n【高数】第三章习题请于10月25日23:59前提交，逾期不候"
            className="w-full px-3 py-2 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[12.5px] leading-relaxed outline-none focus:border-[#4f8cff] resize-none placeholder:text-[#3d3d48]"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => void doExtract()}
              disabled={busy || !text.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#4f8cff] text-white text-[12px] disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              解析
            </button>
            {draft?.hint && (
              <span className="text-[11px] text-[#e0b080] flex items-center gap-1">
                <AlertCircle size={11} /> {draft.hint}
              </span>
            )}
          </div>

          {draft && (
            <div className="space-y-2 pt-2 border-t border-[#26262f]">
              <Field label="标题">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-transparent text-[12.5px] outline-none"
                />
              </Field>
              <div className="flex gap-2">
                <Field label="课程" className="flex-1">
                  <input
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    placeholder="可不填"
                    className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-[#3d3d48]"
                  />
                </Field>
                <Field label="截止时间" className="flex-1">
                  <input
                    type="datetime-local"
                    value={ddl}
                    onChange={(e) => setDdl(e.target.value)}
                    className="w-full bg-transparent text-[12px] text-[#d0d0da] outline-none [color-scheme:dark]"
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-[#5c5c6a]">
                  置信度 {Math.round((draft.confidence || 0) * 100)}% ·{' '}
                  {draft.engine === 'llm' ? 'AI 解析' : '本地规则'}
                </span>
                <button
                  onClick={() => void doConfirm()}
                  disabled={busy || !title.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#16302a] text-[#7ee2b8] text-[12px] disabled:opacity-40"
                >
                  <Check size={13} /> 确认添加
                </button>
              </div>
            </div>
          )}

          {error && <div className="text-[11.5px] text-[#ff9aa2] break-all">{error}</div>}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  className
}: {
  label: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={`block rounded-md bg-[#1a1a20] border border-[#2e2e38] px-2.5 py-1.5 ${className ?? ''}`}>
      <div className="text-[10.5px] text-[#5c5c6a] mb-0.5">{label}</div>
      {children}
    </label>
  )
}
