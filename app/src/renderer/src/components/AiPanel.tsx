import { useEffect, useState } from 'react'
import {
  Info,
  Sparkles,
  Wand2,
  Loader2,
  Paperclip,
  Download,
  FileText,
  Image as ImageIcon,
  Check,
  FolderOpen,
  AlertCircle
} from 'lucide-react'
import {
  getSettings,
  summarizeText,
  listAttachments,
  downloadAttachments,
  openFile,
  revealFile,
  type AttachmentItem,
  type Task
} from '../lib/api'

/** 右侧 AI 面板（规格 §8）：任务详情、附件发现与下载、摘要。 */
function AiPanel({ task }: { task: Task | null }): React.JSX.Element {
  const [mode, setMode] = useState<'summary' | 'raw'>('summary')
  const [aiOn, setAiOn] = useState(true)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)

  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [attMsg, setAttMsg] = useState('')
  const [attLoading, setAttLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        setAiOn((s.ai_display_mode ?? 'on') === 'on')
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  // 选中任务变化时重新发现附件
  useEffect(() => {
    setAttachments([])
    setAttMsg('')
    setSummary('')
    if (!task) return

    let alive = true
    setAttLoading(true)
    void (async () => {
      try {
        const r = await listAttachments(task.id)
        if (!alive) return
        setAttachments(r.items)
        setAttMsg(r.supported ? '' : r.message)
      } catch (e) {
        if (alive) setAttMsg(String(e).slice(0, 160))
      } finally {
        if (alive) setAttLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [task?.id])

  const doDownloadAll = async (keys?: string[]): Promise<void> => {
    if (!task) return
    setDownloading(true)
    setAttMsg('')
    try {
      const r = await downloadAttachments(task.id, keys)
      setAttMsg(r.message)
      const fresh = await listAttachments(task.id)
      setAttachments(fresh.items)
    } catch (e) {
      setAttMsg(String(e).slice(0, 160))
    } finally {
      setDownloading(false)
    }
  }

  const pendingCount = attachments.filter((a) => !a.downloaded).length
  const isXiaoya = task?.platform === 'xiaoya'
  const downloadHint = isXiaoya ? '小雅需逐个触发浏览器下载，约 20-30 秒' : ''

  return (
    <aside className="h-full flex flex-col bg-[var(--bg-deep)] border-l border-[var(--border-soft)]">
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-[var(--border-soft)]">
        <span className="text-[12px] text-[var(--faint)]">任务详情</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode('summary')}
            className={`px-1.5 py-0.5 rounded text-[11px] ${
              mode === 'summary' ? 'bg-[var(--surface-3)] text-[var(--fg)]' : 'text-[var(--faint)]'
            }`}
          >
            摘要
          </button>
          <button
            onClick={() => setMode('raw')}
            className={`px-1.5 py-0.5 rounded text-[11px] ${
              mode === 'raw' ? 'bg-[var(--surface-3)] text-[var(--fg)]' : 'text-[var(--faint)]'
            }`}
          >
            原文
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!task ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Sparkles size={18} className="text-[var(--faint)] mb-2" />
            <div className="text-[12px] text-[var(--faint)]">选中左侧任务查看详情</div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-[13px] text-[var(--fg)] leading-snug">{task.title}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                <Tag>{task.platform}</Tag>
                {task.course_abbr && <Tag>{task.course_abbr}</Tag>}
                {task.ddl && <Tag>{task.ddl.slice(5, 16).replace('T', ' ')}</Tag>}
                {task.confidence != null && <Tag>置信度 {(task.confidence * 100).toFixed(0)}%</Tag>}
              </div>
            </div>

            {/* 附件区 */}
            {(attLoading || attachments.length > 0 || attMsg) && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[var(--faint)] flex items-center gap-1">
                    <Paperclip size={10} />
                    附件
                    {attachments.length > 0 && ` · ${attachments.length} 个`}
                  </span>
                  {pendingCount > 0 && (
                    <button
                      onClick={() => void doDownloadAll()}
                      disabled={downloading}
                      className="flex items-center gap-1 text-[10.5px] text-[var(--accent-strong)] hover:text-[var(--accent-strong)] disabled:opacity-50"
                    >
                      {downloading ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Download size={10} />
                      )}
                      {downloading ? (isXiaoya ? '下载中（约 20 秒）' : '下载中…') : '全部下载'}
                    </button>
                  )}
                </div>

                {attLoading ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11.5px] text-[var(--faint)]">
                    <Loader2 size={11} className="animate-spin" /> 正在读取附件…
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="px-2.5 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11.5px] text-[var(--faint)]">
                    {attMsg || '该任务没有附件'}
                  </div>
                ) : (
                  <div className="rounded-md border border-[var(--border)] divide-y divide-[var(--border-soft)] overflow-hidden">
                    {attachments.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-2 px-2 py-1.5 bg-[var(--surface)] hover:bg-[var(--surface-2)]"
                      >
                        {a.kind === 'image' ? (
                          <ImageIcon size={12} className="shrink-0 text-[var(--faint)]" />
                        ) : (
                          <FileText size={12} className="shrink-0 text-[var(--faint)]" />
                        )}
                        <span
                          className="min-w-0 flex-1 text-[11.5px] text-[var(--muted)] truncate"
                          title={a.dir ? `${a.name}\n目录：${a.dir}` : a.name}
                        >
                          {a.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--faint)]">
                          {a.size_text || (a.size ? `${(a.size / 1024).toFixed(0)}K` : '')}
                        </span>
                        {a.downloaded && a.file_id ? (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => void openFile(a.file_id as number)}
                              className="p-1 rounded text-[var(--ok)] hover:bg-[color-mix(in_oklch,var(--ok)_14%,transparent)]"
                              title="打开文件"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={() => void revealFile(a.file_id as number)}
                              className="p-1 rounded text-[var(--faint)] hover:bg-[var(--surface-3)] hover:text-[var(--muted)]"
                              title="在文件夹中显示"
                            >
                              <FolderOpen size={11} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => void doDownloadAll([a.key])}
                            disabled={downloading}
                            className="shrink-0 p-1 rounded text-[var(--faint)] hover:bg-[var(--surface-3)] hover:text-[var(--accent-strong)] disabled:opacity-40"
                            title="下载"
                          >
                            <Download size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {downloadHint && pendingCount > 0 && !attMsg && (
                  <div className="mt-1 text-[10.5px] text-[var(--faint)]">{downloadHint}</div>
                )}

                {attMsg && attachments.length > 0 && (
                  <div className="mt-1 flex items-start gap-1 text-[10.5px] text-[var(--faint)]">
                    <AlertCircle size={10} className="mt-0.5 shrink-0" />
                    <span>{attMsg}</span>
                  </div>
                )}
              </div>
            )}

            <Block
              title={mode === 'summary' ? 'AI 摘要' : '原文'}
              action={
                mode === 'summary' && task.raw_text ? (
                  <button
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const r = await summarizeText(task.raw_text as string)
                        setSummary(r.summary || r.message || '生成失败')
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="flex items-center gap-1 text-[10.5px] text-[var(--faint)] hover:text-[var(--accent-strong)]"
                  >
                    {busy ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                    生成摘要
                  </button>
                ) : null
              }
            >
              {mode === 'summary'
                ? summary || task.summary || '（还没有摘要，点右上角生成；需先配置 API Key）'
                : task.raw_text || '（该任务没有保留原文）'}
            </Block>

            <Block title="来源">
              <span className="text-[var(--faint)]">
                {aiOn
                  ? `${task.platform} · ${task.status === 'done' ? '已完成' : task.status === 'expired' ? '已过期' : '待办'}`
                  : 'AI 展示已关闭'}
              </span>
            </Block>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-[var(--border-soft)] text-[11px] text-[var(--faint)] flex items-center gap-1">
        <Info size={11} />
        附件按「平台/课程/任务」归档到工作区
      </div>
    </aside>
  )
}

function Tag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--faint)]">{children}</span>
  )
}

function Block({
  title,
  children,
  action
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-[var(--faint)]">{title}</span>
        {action}
      </div>
      <div className="p-2.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[12px] leading-relaxed text-[var(--muted)] whitespace-pre-wrap">
        {children}
      </div>
    </div>
  )
}

export default AiPanel
