import { useState } from 'react'
import { Bot, Sparkles, Wrench } from 'lucide-react'

/** Agent 对话页（规格 §7.3）。Phase 2 接 SSE + Function Calling。 */
function AgentPage(): React.JSX.Element {
  const [input, setInput] = useState('')

  return (
    <div className="max-w-3xl h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
        <div className="w-10 h-10 rounded-xl bg-[#1e2432] flex items-center justify-center mb-4">
          <Bot size={20} className="text-[#4f8cff]" strokeWidth={1.8} />
        </div>
        <div className="text-[14px] text-[#c8c8d4]">还没接入 AI</div>
        <div className="text-[12px] text-[#6b6b7a] mt-2 max-w-sm leading-relaxed">
          Phase 2 会接入 GLM-4.5-Flash：支持自然语言查询任务、自动提取 DDL、导出日历等工具调用。
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 w-full max-w-md">
          {[
            { icon: Sparkles, text: '这周有什么要交的？' },
            { icon: Wrench, text: '把这条通知存成任务' },
            { icon: Sparkles, text: '今天有什么课？' },
            { icon: Wrench, text: '导出这周的日历' }
          ].map((s) => (
            <div
              key={s.text}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a20] border border-[#26262f] text-[12px] text-[#6b6b7a]"
            >
              <s.icon size={13} />
              {s.text}
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 mb-2 flex items-end gap-2 p-2 rounded-lg bg-[#1a1a20] border border-[#26262f]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={1}
          placeholder="向 Agent 提问（Phase 2 开放）"
          className="flex-1 bg-transparent text-[13px] placeholder:text-[#5c5c6a] outline-none resize-none py-1"
        />
        <button
          disabled
          className="px-3 py-1.5 rounded-md bg-[#242430] text-[#5c5c6a] text-[12px] cursor-not-allowed"
        >
          发送
        </button>
      </div>
    </div>
  )
}

export default AgentPage
