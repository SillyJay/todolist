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
  wechatInit,
  wechatLaunch,
  wechatGroups,
  type WeChatStatus
} from '../lib/api'

/** 微信监听面板（规格 §5 模块 3） */
export default function WeChatPanel(): React.JSX.Element {
  const [st, setSt] = useState<WeChatStatus | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [testText, setTestText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [initOutput, setInitOutput] = useState('')
  const [allGroups, setAllGroups] = useState<{ name: string; unread: number; last_message: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [testResult, setTestResult] = useState('')
  const timer = useRef<number | null>(null)

  const reload = useCallback(async () => {
    try {
      const s = await wechatStatus()
      setSt(s)
      setSelected((prev) => (prev.length ? prev : s.config_groups))
    } catch (e) {
      setMsg(String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true)
    try {
      const r = await wechatGroups()
      setAllGroups(r.groups)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setLoadingGroups(false)
    }
  }, [])

  // 运行中每 5 秒刷新一次状态
  useEffect(() => {
    if (st?.listener.state !== 'running') return
    timer.current = window.setInterval(() => void reload(), 5000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [st?.listener.state, reload])

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
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 space-y-1.5">
        <EnvRow
          ok={!!env?.installed}
          label="wechat-cli"
          detail={env?.installed ? `${env.version || '已安装'} · ${env.path}` : '未安装'}
        />
        <EnvRow
          ok={!!env?.initialized}
          label="数据库密钥"
          detail={env?.initialized ? '已提取' : '未初始化（点下方「初始化」）'}
        />
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
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[var(--faint)] w-20 shrink-0">运行文件</span>
          <span className="text-[var(--faint)] truncate" title={env?.path || ''}>
            {env?.path || '未安装'}
          </span>
          <span
            className={`ml-auto shrink-0 px-1 py-0.5 rounded text-[10px] ${
              env?.path?.startsWith('C:')
                ? 'bg-[color-mix(in_oklch,var(--warn)_14%,transparent)] text-[var(--warn)]'
                : 'bg-[color-mix(in_oklch,var(--ok)_16%,transparent)] text-[var(--ok)]'
            }`}
          >
            {env?.path?.startsWith('C:') ? 'C 盘' : 'D 盘'}
          </span>
        </div>
        {st?.install.manifest?.size != null && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--faint)] w-20 shrink-0">组件大小</span>
            <span className="text-[var(--faint)]">
              {(st.install.manifest.size / 1024 / 1024).toFixed(1)} MB
              {st.install.manifest.installed_at ? ` · 安装于 ${st.install.manifest.installed_at.slice(0, 16).replace('T', ' ')}` : ''}
            </span>
          </div>
        )}

        {env?.installed ? (
          <div className="text-[10.5px] text-[var(--faint)] pt-1">
            由应用自带 Python 环境安装（pip），随应用一起管理
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="下载地址或本地 zip/exe 路径"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11.5px] outline-none focus:border-[var(--accent)] placeholder:text-[var(--faint)]"
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
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--accent)] text-white text-[11.5px] disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              一键安装
            </button>
          </div>
        )}
      </div>

      {/* 群配置：勾选 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-[var(--faint)]">
            监听的群（已选 {selected.length} 个，不选则监听全部）
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadGroups()}
              disabled={loadingGroups || !env?.initialized}
              className="text-[10.5px] text-[var(--faint)] hover:text-[var(--accent-strong)] disabled:opacity-40"
            >
              {loadingGroups ? '读取中…' : '读取群列表'}
            </button>
            <button
              onClick={async () => {
                setBusy(true)
                try {
                  await wechatSaveGroups(selected)
                  setMsg(`已保存 ${selected.length} 个群`)
                  await reload()
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="text-[10.5px] text-[var(--accent-strong)] hover:text-[var(--accent-strong)] disabled:opacity-40"
            >
              保存选择
            </button>
          </div>
        </div>

        {allGroups.length === 0 ? (
          <div className="text-[11px] text-[var(--faint)] py-1.5">
            还没读取群列表。点右上「读取群列表」，会从微信会话里列出所有群。
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索群名"
              className="w-full mb-1.5 px-2.5 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11.5px] outline-none focus:border-[var(--accent)] placeholder:text-[var(--faint)]"
            />
            <div className="max-h-44 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border-soft)]">
              {allGroups
                .filter((g) => !search || g.name.includes(search))
                .map((g) => {
                  const checked = selected.includes(g.name)
                  return (
                    <button
                      key={g.name}
                      onClick={() =>
                        setSelected((prev) =>
                          prev.includes(g.name) ? prev.filter((x) => x !== g.name) : [...prev, g.name]
                        )
                      }
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-2)] ${
                        checked ? 'bg-[var(--accent-soft)]' : ''
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${
                          checked ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--faint)]'
                        }`}
                      >
                        {checked && <Check size={9} className="text-white" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11.5px] text-[var(--muted)] truncate">{g.name}</span>
                        {g.last_message && (
                          <span className="block text-[10px] text-[var(--faint)] truncate">
                            {g.last_message}
                          </span>
                        )}
                      </span>
                      {g.unread > 0 && (
                        <span className="text-[9.5px] px-1 rounded bg-[color-mix(in_oklch,var(--violet)_16%,transparent)] text-[var(--violet)] shrink-0">
                          {g.unread > 99 ? '99+' : g.unread}
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          </>
        )}
      </div>

      {/* 启停 */}
      <div className="flex items-center gap-2">
        {!env?.wechat_running && (
          <button
            onClick={async () => {
              setBusy(true)
              setMsg('正在启动微信…')
              try {
                const r = await wechatLaunch()
                setMsg(r.message)
                await new Promise((res) => setTimeout(res, 4000))
                await reload()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--surface-3)] text-[11.5px] text-[var(--fg)] disabled:opacity-40"
          >
            唤起微信
          </button>
        )}
        {listener?.state === 'running' ? (
          <button
            onClick={() => void stop()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[color-mix(in_oklch,var(--danger)_14%,transparent)] text-[var(--danger)] text-[12px] disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
            停止监听
          </button>
        ) : (
          <button
            onClick={() => void start()}
            disabled={busy || !canRun}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)] text-white text-[12px] disabled:opacity-40"
            title={canRun ? '' : '需要 wechat-cli 且微信已启动'}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            开始监听
          </button>
        )}
        <button
          onClick={async () => {
            setBusy(true)
            setMsg('初始化中（需要微信在运行，可能需要管理员权限）…')
            try {
              const r = await wechatInit()
              setMsg(r.message)
              if (r.output) setInitOutput(r.output)
              await reload()
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy || !env?.wechat_running}
          className="px-2.5 py-1.5 rounded-md bg-[var(--surface-3)] text-[11.5px] text-[var(--fg)] disabled:opacity-40"
          title="从微信进程内存提取数据库密钥，只需执行一次"
        >
          初始化
        </button>
        <button
          onClick={() => void reload()}
          className="px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[11.5px] text-[var(--faint)] hover:text-[var(--fg)]"
        >
          重新检测
        </button>
      </div>

      {listener?.last_error && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-[var(--danger)]">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-all">{listener.last_error}</span>
        </div>
      )}
      {msg && <div className="text-[11.5px] text-[var(--ok)] break-all">{msg}</div>}
      {initOutput && (
        <pre className="max-h-28 overflow-y-auto rounded-md bg-[var(--bg-deep)] border border-[var(--border)] p-2 text-[10.5px] text-[var(--faint)] whitespace-pre-wrap break-all">
          {initOutput}
        </pre>
      )}

      {/* 最近消息 */}
      {!!listener?.recent?.length && (
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--faint)] mb-1">
            <MessageSquare size={11} /> 最近捕获
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border-soft)]">
            {[...listener.recent].reverse().map((m, i) => (
              <div key={i} className="px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--faint)]">
                  <span className="text-[var(--faint)]">{m.group || '未知群'}</span>
                  <span>·</span>
                  <span>{m.sender}</span>
                  {m.keyword_hit && (
                    <span className="ml-auto text-[var(--ok)]">命中关键词</span>
                  )}
                </div>
                <div className="text-[11.5px] text-[var(--muted)] truncate">{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 链路自测 */}
      <div className="pt-2 border-t border-[var(--border)]">
        <div className="text-[11px] text-[var(--faint)] mb-1">
          链路自测（不需要 wechat-cli，验证「过滤 → 提取 → 入库」）
        </div>
        <div className="flex gap-2">
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="模拟一条群消息，如：【数据结构】实验四请于下周三23:59前提交"
            className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11.5px] outline-none focus:border-[var(--accent)] placeholder:text-[var(--faint)]"
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
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--surface-3)] text-[12px] text-[var(--fg)]"
          >
            <Send size={12} /> 投递
          </button>
        </div>
        {testResult && <div className="mt-1.5 text-[11px] text-[var(--ok)]">{testResult}</div>}
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
        <Check size={12} className="text-[var(--ok)] shrink-0" />
      ) : (
        <AlertCircle size={12} className="text-[var(--faint)] shrink-0" />
      )}
      <span className="text-[var(--faint)] w-20 shrink-0">{label}</span>
      <span className={`truncate ${ok ? 'text-[var(--muted)]' : 'text-[var(--faint)]'}`}>{detail}</span>
    </div>
  )
}
