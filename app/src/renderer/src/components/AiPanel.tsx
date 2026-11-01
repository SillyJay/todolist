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
  AlertCircle,
  ChevronRight
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
function AiPanel({
  task,
  onCollapse
}: {
  task: Task | null
  onCollapse?: () => void
}): React.JSX.Element {
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
    <div className="h-full flex flex-col">
      <div className="ai-head">
        <span className="ai-title">任务详情</span>
        <div className="flex items-center gap-1">
          <div className="segment" style={{ padding: 2 }}>
            <button
              onClick={() => setMode('summary')}
              className={mode === 'summary' ? 'active' : ''}
              style={{ height: 24, padding: '0 9px', fontSize: 11.5 }}
            >
              摘要
            </button>
            <button
              onClick={() => setMode('raw')}
              className={mode === 'raw' ? 'active' : ''}
              style={{ height: 24, padding: '0 9px', fontSize: 11.5 }}
            >
              原文
            </button>
          </div>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              title="收起任务详情"
              aria-label="收起任务详情"
            >
              <ChevronRight size={15} strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>

      <div className="ai-body view-swap" key={task ? task.id : 'empty'}>
        {!task ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="empty-orb" style={{ marginBottom: 12 }}>
              <Sparkles size={17} strokeWidth={1.7} />
            </div>
            <div className="text-[13px] text-[var(--muted)]">选中左侧任务查看详情</div>
            <div className="text-[12px] text-[var(--faint)] mt-1">附件、摘要与原文会显示在这里</div>
          </div>
        ) : (
          <div className="space-y-1">
            <div>
              <div className="ai-task-title">{task.title}</div>
              <div className="ai-tags">
                <span className="ai-tag">{task.platform}</span>
                {task.course_abbr && <span className="ai-tag">{task.course_abbr}</span>}
                {task.ddl && <span className="ai-tag">{task.ddl.slice(5, 16).replace('T', ' ')}</span>}
                {task.confidence != null && (
                  <span className="ai-tag">置信度 {(task.confidence * 100).toFixed(0)}%</span>
                )}
              </div>
            </div>

            {/* 附件区 */}
            {(attLoading || attachments.length > 0 || attMsg) && (
              <div className="ai-block">
                <div className="ai-block-head">
                  <span className="ai-block-title" style={{ marginBottom: 0 }}>
                    <Paperclip size={11} />
                    附件
                    {attachments.length > 0 && ` · ${attachments.length}`}
                  </span>
                  {pendingCount > 0 && (
                    <button
                      onClick={() => void doDownloadAll()}
                      disabled={downloading}
                      className="inline-flex items-center gap-1 text-[11.5px] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
                    >
                      {downloading ? (
                        <Loader2 size={11} className="spin" />
                      ) : (
                        <Download size={11} />
                      )}
                      {downloading ? (isXiaoya ? '下载中（约 20 秒）' : '下载中…') : '全部下载'}
                    </button>
                  )}
                </div>

                {attLoading ? (
                  <div className="ai-note">
                    <Loader2 size={12} className="spin" /> 正在读取附件…
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="ai-note">{attMsg || '该任务没有附件'}</div>
                ) : (
                  <div className="att-list">
                    {attachments.map((a) => (
                      <div key={a.key} className="att-row">
                        {a.kind === 'image' ? (
                          <ImageIcon size={13} className="att-icon" />
                        ) : (
                          <FileText size={13} className="att-icon" />
                        )}
                        <span
                          className="att-name"
                          title={a.dir ? `${a.name}\n目录：${a.dir}` : a.name}
                        >
                          {a.name}
                        </span>
                        <span className="att-size">
                          {a.size_text || (a.size ? `${(a.size / 1024).toFixed(0)}K` : '')}
                        </span>
                        {a.downloaded && a.file_id ? (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => void openFile(a.file_id as number)}
                              className="att-btn ok"
                              title="打开文件"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => void revealFile(a.file_id as number)}
                              className="att-btn"
                              title="在文件夹中显示"
                            >
                              <FolderOpen size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => void doDownloadAll([a.key])}
                            disabled={downloading}
                            className="att-btn"
                            title="下载"
                          >
                            <Download size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {downloadHint && pendingCount > 0 && !attMsg && (
                  <div className="mt-1.5 text-[11px] text-[var(--faint)]">{downloadHint}</div>
                )}

                {attMsg && attachments.length > 0 && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--faint)]">
                    <AlertCircle size={11} className="mt-0.5 shrink-0" />
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
                    className="flex items-center gap-1 text-[11.5px] text-[var(--muted)] hover:text-[var(--fg)]"
                  >
                    {busy ? <Loader2 size={11} className="spin" /> : <Wand2 size={11} />}
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
              <span style={{ color: 'var(--muted)' }}>
                {aiOn
                  ? `${task.platform} · ${task.status === 'done' ? '已完成' : task.status === 'expired' ? '已过期' : '待办'}`
                  : 'AI 展示已关闭'}
              </span>
            </Block>
          </div>
        )}
      </div>

      <div className="ai-foot">
        <Info size={11} />
        附件按「平台 / 课程 / 任务」归档到工作区
      </div>
    </div>
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
    <div className="ai-block">
      <div className="ai-block-head" style={{ marginBottom: 6 }}>
        <span className="ai-block-title" style={{ marginBottom: 0 }}>
          {title}
        </span>
        {action}
      </div>
      <div className={`ai-block-body${title === '来源' ? ' muted' : ''}`}>{children}</div>
    </div>
  )
}

export default AiPanel
