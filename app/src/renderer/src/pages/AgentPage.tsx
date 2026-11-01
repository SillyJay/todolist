import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Wrench,
  Sparkles
} from 'lucide-react'
import {
  aiModelCatalog,
  aiSetActive,
  aiThinking,
  aiSetThinking,
  aiStatus,
  chatStream,
  type AiCatalogGroup,
  type AiStatus
} from '../lib/api'
import { dayLabel, ensurePlan, subscribePlan, type PlanState } from '../lib/planStore'

interface Msg {
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  name?: string
  /** 正在流式输出中（显示光标） */
  streaming?: boolean
}

const THINK_OPTIONS = ['auto', 'off', 'low', 'medium', 'high'] as const
const THINK_LABEL: Record<string, string> = {
  auto: '自动',
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高'
}

const SUGGESTIONS = ['这周有什么要交的？', '今天有什么课？', '帮我导出日历', '下周的作业有哪些']

/** Agent 对话页（规格 §7.3）：SSE + Function Calling + 启动预取的两日计划 */
function AgentPage(): React.JSX.Element {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 两日计划由 planStore 预取（App 启动时已开始），这里只订阅
  const [plan, setPlan] = useState<PlanState>({ text: '', error: '', busy: false, day: '' })
  // 输入框左下角的模型选择
  const [catalog, setCatalog] = useState<AiCatalogGroup[]>([])
  const [modelName, setModelName] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  // 思考强度：auto/off/low/medium/high（右下角）
  const [think, setThink] = useState('auto')
  const [thinkOpen, setThinkOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => subscribePlan(setPlan), [])

  // 下拉：点外部或 Esc 关闭，Esc 后焦点回到触发按钮
  useEffect(() => {
    if (!modelOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!modelRef.current?.contains(e.target as Node)) setModelOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setModelOpen(false)
        modelBtnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [modelOpen])

  useEffect(() => {
    void aiStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, model: null, base_url: null }))
  }, [])

  // 载入模型目录：已配置的服务商 + 各自模型（多供应商，对齐 DSH）
  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const st = await aiStatus()
      setModelName(st.model || 'auto')
      setStatus(st)
      const cat = await aiModelCatalog()
      setCatalog(cat.items)
      try {
        const th = await aiThinking()
        setThink(th.level || 'auto')
      } catch {
        /* 忽略 */
      }
    } catch {
      /* 后端未就绪：下拉只显示当前模型 */
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  // 兜底：启动时若后端还没就绪，进入本页再补一次
  useEffect(() => {
    if (status?.configured) void ensurePlan()
  }, [status?.configured])

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

    let acc = ''
    let started = false
    try {
      await chatStream(q, history, (e) => {
        if (e.type === 'tool') {
          setMessages((prev) => [...prev, { role: 'tool', content: '', name: e.name }])
        } else if (e.type === 'delta') {
          acc += e.content || ''
          if (!started) {
            started = true
            setMessages((prev) => [...prev, { role: 'assistant', content: acc, streaming: true }])
          } else {
            setMessages((prev) => {
              const next = [...prev]
              const i = next.length - 1
              next[i] = { ...next[i], content: acc }
              return next
            })
          }
        } else if (e.type === 'message') {
          const final = e.content || acc
          if (started) {
            setMessages((prev) => {
              const next = [...prev]
              const i = next.length - 1
              next[i] = { ...next[i], content: final, streaming: false }
              return next
            })
          } else if (final) {
            setMessages((prev) => [...prev, { role: 'assistant', content: final }])
          }
        } else if (e.type === 'error') {
          setMessages((prev) => [...prev, { role: 'error', content: e.message || '调用失败' }])
        }
      })
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'error', content: String(e) }])
    } finally {
      setBusy(false)
    }
  }

  const chooseModel = async (pid: string, m: string): Promise<void> => {
    setModelName(m)
    setModelOpen(false)
    try {
      await aiSetActive(pid, m)
      await loadCatalog()
    } catch {
      /* 失败不打断输入 */
    }
  }

  const configured = status?.configured

  return (
    <div className="agent-page">
      {!configured && (
        <div className="status-note" style={{ marginBottom: 14 }}>
          <AlertCircle size={14} />
          <span>
            尚未配置 AI API Key，对话不可用。到「设置 → AI 模型」填入智谱 GLM 的 Key 即可（有免费额度）。
          </span>
        </div>
      )}

      <div className="agent-card">
        <div ref={scrollRef} className="agent-scroll">
          {/* 启动时预取的「今天 / 明天」艾森豪威尔矩阵计划 */}
          <section className="plan-card">
            <div className="plan-head">
              <div>
                <div className="rail-kicker">Eisenhower matrix</div>
                <div className="plan-title">今天与明天 · 该做什么</div>
                <div className="plan-sub">
                  {dayLabel(0)} → {dayLabel(1)}
                </div>
              </div>
              <button
                className="mini-btn"
                onClick={() => void ensurePlan(true)}
                disabled={!configured || plan.busy}
                title="重新生成"
              >
                <RefreshCw size={13} className={plan.busy ? 'spin' : undefined} />
              </button>
            </div>

            {plan.error && <div className="plan-note error">{plan.error}</div>}
            {!plan.error && plan.busy && !plan.text && (
              <div className="plan-note">
                <Loader2 size={12} className="spin" /> 正在按艾森豪威尔矩阵整理…
              </div>
            )}
            {!plan.error && !configured && !plan.text && (
              <div className="plan-note">配置 API Key 后，打开软件会自动生成两日计划。</div>
            )}
            {plan.text && <PlanBlock text={plan.text} />}
          </section>

          {messages.length === 0 && (
            <div className="agent-empty">
              <div className="empty-orb">
                <Bot size={20} strokeWidth={1.7} />
              </div>
              <h3>有什么可以帮你？</h3>

              <div className="suggest-grid">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    disabled={!configured}
                    className="suggest"
                  >
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
            <div className="msg-tool">
              <Loader2 size={13} className="spin" /> 思考中…
            </div>
          )}
        </div>

        <div className="ds-chat-bottom">
          <div className="ds-composer">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                const el = e.target
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 160) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder={configured ? '给ToDoList发消息…' : '请先在设置里配置 API Key'}
              disabled={!configured}
            />

            <div className="ds-composer-bar">
              <div className="ds-model-wrap" ref={modelRef}>
                <button
                  ref={modelBtnRef}
                  type="button"
                  className={`ds-model${modelOpen ? ' open' : ''}`}
                  onClick={() => setModelOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={modelOpen}
                  aria-label="选择模型"
                  title="选择模型"
                >
                  <span className="ds-model-name">{modelName || 'auto'}</span>
                  <ChevronDown size={13} className="ds-model-caret" aria-hidden="true" />
                </button>

                <div
                  className={`model-menu${modelOpen ? ' open' : ''}`}
                  role="listbox"
                  aria-label="选择模型"
                  aria-hidden={!modelOpen}
                >
                  <div className="model-menu-inner">
                    <div className="model-menu-list">
                      {catalog.length === 0 && (
                        <div className="model-menu-label">还没配置服务商</div>
                      )}
                      {catalog.map((g) => (
                        <div key={g.id} className="model-menu-group">
                          <div className="model-menu-label">
                            {g.name}
                            {g.active && <span className="model-menu-current">当前</span>}
                          </div>
                          {g.models.map((m) => {
                            const active = g.active && m === modelName
                            return (
                              <button
                                key={`${g.id}:${m}`}
                                type="button"
                                role="option"
                                aria-selected={active}
                                tabIndex={modelOpen ? 0 : -1}
                                className={`model-option${active ? ' active' : ''}`}
                                onClick={() => void chooseModel(g.id, m)}
                              >
                                <span className="model-option-name">{m}</span>
                                {active && (
                                  <Check
                                    size={13}
                                    strokeWidth={2.4}
                                    className="model-option-check"
                                    aria-hidden="true"
                                  />
                                )}
                              </button>
                            )
                          })}
                          {g.models.length === 0 && (
                            <div className="model-menu-label">（这个服务商还没填模型）</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="ds-think-wrap">
                <button
                  type="button"
                  className={`ds-think${think !== 'auto' ? ' on' : ''}`}
                  onClick={() => setThinkOpen((v) => !v)}
                  title="思考强度（越高越慢但更稳）"
                  aria-haspopup="listbox"
                  aria-expanded={thinkOpen}
                >
                  <Sparkles size={12} />
                  {THINK_LABEL[think] || '自动'}
                  <ChevronDown size={11} />
                </button>
                {thinkOpen && (
                  <div className="ds-think-menu" role="listbox" aria-label="思考强度">
                    {THINK_OPTIONS.map((lv) => (
                      <button
                        key={lv}
                        type="button"
                        role="option"
                        aria-selected={think === lv}
                        className={`model-option${think === lv ? ' active' : ''}`}
                        onClick={() => {
                          setThink(lv)
                          setThinkOpen(false)
                          void aiSetThinking(lv)
                        }}
                      >
                        <span className="model-option-name">{THINK_LABEL[lv]}</span>
                        {think === lv && <Check size={13} className="model-option-check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="ds-send"
                onClick={() => void send()}
                disabled={!configured || busy || !input.trim()}
                title="发送"
                aria-label="发送"
              >
                <ArrowUp size={17} strokeWidth={2.6} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 两日计划：把「Q1 紧急且重要：…」这类文字标签换成彩色圆点，与日历图例一致 */
const Q_TAG: { re: RegExp; cls: string }[] = [
  { re: /^(?:[-•·]\s*)?(?:Q1|紧急且重要)\s*[：:]?\s*/, cls: 'q1' },
  { re: /^(?:[-•·]\s*)?(?:Q2|重要不紧急)\s*[：:]?\s*/, cls: 'q2' },
  { re: /^(?:[-•·]\s*)?(?:Q3|紧急不重要)\s*[：:]?\s*/, cls: 'q3' },
  { re: /^(?:[-•·]\s*)?(?:Q4|不紧急不重要)\s*[：:]?\s*/, cls: 'q4' }
]

function PlanBlock({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  return (
    <div className="plan-body">
      {lines.map((raw, i) => {
        const line = raw.trim()
        if (!line) return null

        // 【今天】/【明天】小节标题
        const sec = line.match(/^【(.+?)】$/)
        if (sec) {
          return (
            <div key={i} className="plan-sec">
              {sec[1]}
            </div>
          )
        }

        let body = line
        let cls = ''
        for (const t of Q_TAG) {
          const m = body.match(t.re)
          if (m) {
            cls = t.cls
            body = body.slice(m[0].length)
            break
          }
        }
        if (!cls) body = body.replace(/^[-•·]\s*/, '')

        return (
          <div key={i} className={`plan-line${cls ? ' ' + cls : ''}`}>
            <span className={`plan-dot${cls ? ' ' + cls : ''}`} aria-hidden="true" />
            <span className="plan-line-text">{body || '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

function MessageRow({ msg }: { msg: Msg }): React.JSX.Element {
  if (msg.role === 'user') {
    return (
      <div className="msg-user-row">
        <div className="msg-user">{msg.content}</div>
      </div>
    )
  }

  if (msg.role === 'tool') {
    return (
      <div className="msg-tool">
        <Wrench size={12} /> 调用工具 · {msg.name}
      </div>
    )
  }

  if (msg.role === 'error') {
    return (
      <div className="status-note">
        <AlertCircle size={14} />
        <span style={{ wordBreak: 'break-all' }}>{msg.content}</span>
      </div>
    )
  }

  return (
    <div className="msg-assistant">
      <div className="msg-avatar">
        <Bot size={14} strokeWidth={1.8} />
      </div>
      <div className="msg-text">
        {msg.content}
        {msg.streaming && <span className="stream-cursor" aria-hidden="true" />}
      </div>
    </div>
  )
}

export default AgentPage
