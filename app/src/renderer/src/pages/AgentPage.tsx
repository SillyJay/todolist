import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Send, Wrench, Loader2, Sparkles, AlertCircle } from 'lucide-react'
import { aiStatus, chatStream, type AiStatus } from '../lib/api'

interface Msg {
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  name?: string
}

const SUGGESTIONS = ['这周有什么要交的？', '今天有什么课？', '帮我导出日历', '下周的作业有哪些']

/** Agent 对话页（规格 §7.3）：SSE + Function Calling */
function AgentPage(): React.JSX.Element {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void aiStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, model: null, base_url: null }))
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const history = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content })),
    [messages]
  )

  const send = async (text?: string): Promise<void> => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    setMessages((prev) => [...prev, { role: 'user', content: q }])

    let answer = ''
    try {
      await chatStream(q, history, (e) => {
        if (e.type === 'tool') {
          setMessages((prev) => [...prev, { role: 'tool', content: '', name: e.name }])
        } else if (e.type === 'message') {
          answer = e.content || ''
        } else if (e.type === 'error') {
          setMessages((prev) => [...prev, { role: 'error', content: e.message || '调用失败' }])
        }
      })
      if (answer) setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'error', content: String(e) }])
    } finally {
      setBusy(false)
    }
  }

  const configured = status?.configured

  return (
    <div className="max-w-3xl h-[calc(100vh-116px)] flex flex-col">
      {!configured && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-[#2a2218] border border-[#3d3320] text-[11.5px] text-[#e0b080]">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>
            尚未配置 AI API Key，对话不可用。到「设置 → AI 模型」填入智谱 GLM 的 Key
            即可（有免费额度）。
          </span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 rounded-xl bg-[#1e2432] flex items-center justify-center mb-3">
              <Bot size={20} className="text-[#4f8cff]" strokeWidth={1.8} />
            </div>
            <div className="text-[13.5px] text-[#c8c8d4]">问问你的作业和课表</div>
            <div className="text-[11.5px] text-[#6b6b7a] mt-1.5">
              可以查待办、查某天课表、创建任务、导出日历
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 w-full max-w-md">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  disabled={!configured}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a20] border border-[#26262f] text-[12px] text-[#8a8a98] hover:text-[#d0d0da] hover:border-[#3a3a46] disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageRow key={i} msg={m} />
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-[#6b6b7a]">
            <Loader2 size={13} className="animate-spin" /> 思考中…
          </div>
        )}
      </div>

      <div className="shrink-0 mt-2 flex items-end gap-2 p-2 rounded-lg bg-[#1a1a20] border border-[#26262f]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          placeholder={configured ? '问点什么…（Enter 发送，Shift+Enter 换行）' : '请先配置 API Key'}
          disabled={!configured}
          className="flex-1 bg-transparent text-[13px] placeholder:text-[#5c5c6a] outline-none resize-none py-1 disabled:cursor-not-allowed"
        />
        <button
          onClick={() => void send()}
          disabled={!configured || busy || !input.trim()}
          className="px-3 py-1.5 rounded-md bg-[#4f8cff] text-white text-[12px] disabled:opacity-40"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}

function MessageRow({ msg }: { msg: Msg }): React.JSX.Element {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2 rounded-lg bg-[#1e2c44] text-[13px] text-[#d8e4ff] whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    )
  }

  if (msg.role === 'tool') {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-[#6b6b7a] pl-1">
        <Wrench size={11} /> 调用工具 · {msg.name}
      </div>
    )
  }

  if (msg.role === 'error') {
    return (
      <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-[#2a1a1c] text-[12px] text-[#ff9aa2]">
        <AlertCircle size={12} className="mt-0.5 shrink-0" />
        <span className="break-all">{msg.content}</span>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-md bg-[#1e2432] flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={13} className="text-[#4f8cff]" />
      </div>
      <div className="max-w-[82%] text-[13px] leading-relaxed text-[#dcdce6] whitespace-pre-wrap">
        {msg.content}
      </div>
    </div>
  )
}

export default AgentPage
