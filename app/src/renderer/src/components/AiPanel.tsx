import { useEffect, useState } from 'react'
import { Info, Sparkles, Wand2, Loader2 } from 'lucide-react'
import { getSettings, summarizeText, type Task } from '../lib/api'

/** 右侧 AI 面板（规格 §8）：展示选中任务的原文/摘要、置信度、AI 调用日志。 */
function AiPanel({ task }: { task: Task | null }): React.JSX.Element {
  const [mode, setMode] = useState<'summary' | 'raw'>('summary')
  const [aiOn, setAiOn] = useState(true)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)

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

  return (
    <aside className="h-full flex flex-col bg-[#131317] border-l border-[#24242c]">
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-[#24242c]">
        <span className="text-[12px] text-[#9a9aa8]">AI 面板</span>
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
                {task.confidence != null && <Tag>置信度 {(task.confidence * 100).toFixed(0)}%</Tag>}
              </div>
            </div>

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

            <Block title="AI 调用日志">
              <span className="text-[#5c5c6a]">
                {aiOn ? '暂无调用记录（Phase 2 接入）' : 'AI 展示已关闭'}
              </span>
            </Block>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-[#24242c] text-[11px] text-[#4a4a58] flex items-center gap-1">
        <Info size={11} />
        AI 结果均保留原文，可随时重算
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
