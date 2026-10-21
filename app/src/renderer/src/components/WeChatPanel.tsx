import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  Loader2,
  Play,
  Square,
  Download,
  MessageSquare,
  Send
} from 'lucide-react'
import {
  wechatStatus,
  wechatSaveGroups,
  wechatStart,
  wechatStop,
  wechatSimulate,
  wechatInstall,
  wechatUninstall,
  type WeChatStatus
} from '../lib/api'

/** 微信监听面板（规格 §5 模块 3） */
export default function WeChatPanel(): React.JSX.Element {
  const [st, setSt] = useState<WeChatStatus | null>(null)
  const [groups, setGroups] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [testText, setTestText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [testResult, setTestResult] = useState('')
  const timer = useRef<number | null>(null)

  const reload = useCallback(async () => {
    try {
      const s = await wechatStatus()
      setSt(s)
      setGroups((g) => (g === '' ? s.config_groups.join(', ') : g))
    } catch (e) {
      setMsg(String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 运行中每 5 秒刷新一次状态
  useEffect(() => {
    if (st?.listener.state !== 'running') return
    timer.current = window.setInterval(() => void reload(), 5000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [st?.listener.state, reload])

  const saveGroups = async (): Promise<void> => {
    setBusy(true)
    try {
      const list = groups.split(/[,，\n]/).map((g) => g.trim()).filter(Boolean)
      await wechatSaveGroups(list)
      setMsg(`已保存 ${list.length} 个群`)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await wechatStart()
      setMsg(r.message)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await wechatStop()
      setMsg(r.message)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const env = st?.env
  const listener = st?.listener
  const canRun = env?.installed && env?.wechat_running

  return (
    <div className="space-y-3">
      {/* 环境检测 */}
      <div className="rounded-lg border border-[#26262f] bg-[#1a1a20] p-2.5 space-y-1.5">
        <EnvRow ok={!!env?.installed} label="wechat-cli" detail={env?.path || '未安装'} />
        <EnvRow ok={!!env?.wechat_running} label="微信进程" detail={env?.wechat_running ? '已运行' : '未启动'} />
        <EnvRow
          ok={listener?.state === 'running'}
          label="监听状态"
          detail={
            listener?.state === 'running'
              ? `运行中（已收 ${listener.received} 条）`
              : listener?.state === 'offline'
                ? '已停止'
                : '未配置'
          }
        />
      </div>

      {/* 安装位置 + 一键安装 */}
      <div className="rounded-lg border border-[#26262f] bg-[#1a1a20] p-2.5 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[#5c5c6a] w-20 shrink-0">安装目录</span>
          <span className="text-[#9a9aa8] truncate" title={st?.install.active}>
            {st?.install.active || '—'}
          </span>
          <span
            className={`ml-auto shrink-0 px-1 py-0.5 rounded text-[10px] ${
              st?.install.active?.startsWith('C:')
                ? 'bg-[#2a2218] text-[#e0b080]'
                : 'bg-[#16302a] text-[#7ee2b8]'
            }`}
          >
            {st?.install.active?.startsWith('C:') ? 'C 盘（回落）' : 'D 盘（优先）'}
          </span>
        </div>
        {st?.install.manifest?.size != null && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[#5c5c6a] w-20 shrink-0">组件大小</span>
            <span className="text-[#9a9aa8]">
              {(st.install.manifest.size / 1024 / 1024).toFixed(1)} MB
              {st.install.manifest.installed_at ? ` · 安装于 ${st.install.manifest.installed_at.slice(0, 16).replace('T', ' ')}` : ''}
            </span>
          </div>
        )}

        {!env?.installed ? (
          <div className="flex gap-2 pt-1">
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="下载地址或本地 zip/exe 路径"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-[#16161a] border border-[#2e2e38] text-[11.5px] outline-none focus:border-[#4f8cff] placeholder:text-[#3d3d48]"
            />
            <button
              onClick={async () => {
                if (!sourceUrl.trim()) return
                setBusy(true)
                setMsg('正在安装…')
                try {
                  const r = await wechatInstall(sourceUrl.trim())
                  setMsg(r.ok ? `安装完成：${r.exe}` : r.message)
                  await reload()
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy || !sourceUrl.trim()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#4f8cff] text-white text-[11.5px] disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              一键安装
            </button>
          </div>
        ) : (
          <button
            onClick={async () => {
              setBusy(true)
              try {
                const r = await wechatUninstall()
                setMsg(`已卸载（${r.removed.length} 个目录）`)
                await reload()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="text-[11px] text-[#8a8a98] hover:text-[#ff9aa2]"
          >
            卸载组件
          </button>
        )}
      </div>

      {/* 群配置 */}
      <div>
        <div className="text-[11px] text-[#5c5c6a] mb-1">监听的群（逗号分隔，留空=全部群）</div>
        <div className="flex gap-2">
          <input
            value={groups}
            onChange={(e) => setGroups(e.target.value)}
            placeholder="软件工程2班, 高数答疑群"
            className="flex-1 px-3 py-2 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[12.5px] outline-none focus:border-[#4f8cff] placeholder:text-[#3d3d48]"
          />
          <button
            onClick={() => void saveGroups()}
            disabled={busy}
            className="px-3 py-2 rounded-md bg-[#1c1c22] border border-[#2e2e38] text-[12px] text-[#b0b0be] hover:border-[#4f8cff] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>

      {/* 启停 */}
      <div className="flex items-center gap-2">
        {listener?.state === 'running' ? (
          <button
            onClick={() => void stop()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2a1a1c] text-[#ff9aa2] text-[12px] disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
            停止监听
          </button>
        ) : (
          <button
            onClick={() => void start()}
            disabled={busy || !canRun}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#4f8cff] text-white text-[12px] disabled:opacity-40"
            title={canRun ? '' : '需要 wechat-cli 且微信已启动'}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            开始监听
          </button>
        )}
        <button
          onClick={() => void reload()}
          className="px-2.5 py-1.5 rounded-md border border-[#2e2e38] text-[11.5px] text-[#8a8a98] hover:text-[#e0e0e8]"
        >
          重新检测
        </button>
      </div>

      {listener?.last_error && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-[#ff9aa2]">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-all">{listener.last_error}</span>
        </div>
      )}
      {msg && <div className="text-[11.5px] text-[#7ee2b8]">{msg}</div>}

      {/* 最近消息 */}
      {!!listener?.recent?.length && (
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#5c5c6a] mb-1">
            <MessageSquare size={11} /> 最近捕获
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-[#26262f] divide-y divide-[#22222a]">
            {[...listener.recent].reverse().map((m, i) => (
              <div key={i} className="px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10.5px] text-[#5c5c6a]">
                  <span className="text-[#8a8a98]">{m.group || '未知群'}</span>
                  <span>·</span>
                  <span>{m.sender}</span>
                  {m.keyword_hit && (
                    <span className="ml-auto text-[#7ee2b8]">命中关键词</span>
                  )}
                </div>
                <div className="text-[11.5px] text-[#c0c0cc] truncate">{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 链路自测 */}
      <div className="pt-2 border-t border-[#26262f]">
        <div className="text-[11px] text-[#5c5c6a] mb-1">
          链路自测（不需要 wechat-cli，验证「过滤 → 提取 → 入库」）
        </div>
        <div className="flex gap-2">
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="模拟一条群消息，如：【数据结构】实验四请于下周三23:59前提交"
            className="flex-1 px-2.5 py-1.5 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[11.5px] outline-none focus:border-[#4f8cff] placeholder:text-[#3d3d48]"
          />
          <button
            onClick={async () => {
              if (!testText.trim()) return
              const r = await wechatSimulate(testText)
              setTestResult(
                r.matched
                  ? r.created
                    ? `已生成任务：${r.title}${r.ddl ? `（截止 ${r.ddl.slice(0, 16).replace('T', ' ')}）` : ''}`
                    : '该消息已处理过（去重生效）'
                  : r.message || '未命中关键词，已忽略'
              )
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#242430] text-[12px] text-[#d0d0da]"
          >
            <Send size={12} /> 投递
          </button>
        </div>
        {testResult && <div className="mt-1.5 text-[11px] text-[#7ee2b8]">{testResult}</div>}
      </div>
    </div>
  )
}

function EnvRow({
  ok,
  label,
  detail
}: {
  ok: boolean
  label: string
  detail: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      {ok ? (
        <Check size={12} className="text-[#7ee2b8] shrink-0" />
      ) : (
        <AlertCircle size={12} className="text-[#8a8a98] shrink-0" />
      )}
      <span className="text-[#8a8a98] w-20 shrink-0">{label}</span>
      <span className={`truncate ${ok ? 'text-[#c0c0cc]' : 'text-[#6b6b7a]'}`}>{detail}</span>
    </div>
  )
}
