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
    <aside className="h-full flex flex-col bg-[#131317] border-l border-[#24242c]">
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-[#24242c]">
        <span className="text-[12px] text-[#9a9aa8]">任务详情</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode('summary')}
            className={`px-1.5 py-0.5 rounded text-[11px] ${
              mode === 'summary' ? 'bg-[#242430] text-[#d0d0da]' : 'text-[#6b6b7a]'
            }`}
          >
            摘要
          </button>
          <button
            onClick={() => setMode('raw')}
            className={`px-1.5 py-0.5 rounded text-[11px] ${
              mode === 'raw' ? 'bg-[#242430] text-[#d0d0da]' : 'text-[#6b6b7a]'
            }`}
          >
            原文
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!task ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Sparkles size={18} className="text-[#3a3a46] mb-2" />
            <div className="text-[12px] text-[#5c5c6a]">选中左侧任务查看详情</div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-[13px] text-[#e0e0e8] leading-snug">{task.title}</div>
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
                  <span className="text-[11px] text-[#5c5c6a] flex items-center gap-1">
                    <Paperclip size={10} />
                    附件
                    {attachments.length > 0 && ` · ${attachments.length} 个`}
                  </span>
                  {pendingCount > 0 && (
                    <button
                      onClick={() => void doDownloadAll()}
                      disabled={downloading}
                      className="flex items-center gap-1 text-[10.5px] text-[#7db4ff] hover:text-[#a9c9ff] disabled:opacity-50"
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
                  <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-md bg-[#1a1a20] border border-[#26262f] text-[11.5px] text-[#6b6b7a]">
                    <Loader2 size={11} className="animate-spin" /> 正在读取附件…
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="px-2.5 py-2 rounded-md bg-[#1a1a20] border border-[#26262f] text-[11.5px] text-[#6b6b7a]">
                    {attMsg || '该任务没有附件'}
                  </div>
                ) : (
                  <div className="rounded-md border border-[#26262f] divide-y divide-[#22222a] overflow-hidden">
                    {attachments.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-2 px-2 py-1.5 bg-[#1a1a20] hover:bg-[#1e1e26]"
                      >
                        {a.kind === 'image' ? (
                          <ImageIcon size={12} className="shrink-0 text-[#6b8fb8]" />
                        ) : (
                          <FileText size={12} className="shrink-0 text-[#7a7a88]" />
                        )}
                        <span
                          className="min-w-0 flex-1 text-[11.5px] text-[#c0c0cc] truncate"
                          title={a.dir ? `${a.name}\n目录：${a.dir}` : a.name}
                        >
                          {a.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-[#4a4a58]">
                          {a.size_text || (a.size ? `${(a.size / 1024).toFixed(0)}K` : '')}
                        </span>
                        {a.downloaded && a.file_id ? (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => void openFile(a.file_id as number)}
                              className="p-1 rounded text-[#7ee2b8] hover:bg-[#1e2a24]"
                              title="打开文件"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={() => void revealFile(a.file_id as number)}
                              className="p-1 rounded text-[#6b6b7a] hover:bg-[#24242c] hover:text-[#c0c0cc]"
                              title="在文件夹中显示"
                            >
                              <FolderOpen size={11} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => void doDownloadAll([a.key])}
                            disabled={downloading}
                            className="shrink-0 p-1 rounded text-[#6b6b7a] hover:bg-[#24242c] hover:text-[#7db4ff] disabled:opacity-40"
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
                  <div className="mt-1 text-[10.5px] text-[#5c5c6a]">{downloadHint}</div>
                )}

                {attMsg && attachments.length > 0 && (
                  <div className="mt-1 flex items-start gap-1 text-[10.5px] text-[#7a7a88]">
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
                    className="flex items-center gap-1 text-[10.5px] text-[#6b6b7a] hover:text-[#4f8cff]"
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
              <span className="text-[#5c5c6a]">
                {aiOn
                  ? `${task.platform} · ${task.status === 'done' ? '已完成' : task.status === 'expired' ? '已过期' : '待办'}`
                  : 'AI 展示已关闭'}
              </span>
            </Block>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-[#24242c] text-[11px] text-[#4a4a58] flex items-center gap-1">
        <Info size={11} />
        附件按「平台/课程/任务」归档到工作区
      </div>
    </aside>
  )
}

function Tag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="px-1.5 py-0.5 rounded bg-[#24242c] text-[#9a9aa8]">{children}</span>
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
        <span className="text-[11px] text-[#5c5c6a]">{title}</span>
        {action}
      </div>
      <div className="p-2.5 rounded-md bg-[#1a1a20] border border-[#26262f] text-[12px] leading-relaxed text-[#b0b0be] whitespace-pre-wrap">
        {children}
      </div>
    </div>
  )
}

export default AiPanel
