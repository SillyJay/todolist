import { useEffect, useState } from 'react'
import { Save, Check, Eye, EyeOff, FolderOpen, KeyRound, RefreshCw, LogIn, Cookie } from 'lucide-react'
import WeChatPanel from '../components/WeChatPanel'
import {
  getSettings,
  putSettings,
  adaptersStatus,
  chaoxingLogin,
  chaoxingImportCookie,
  chaoxingRefresh,
  refreshStatus,
  aiStatus,
  setAiKey,
  testAi,
  workspaceInfo,
  openWorkspace,
  type WorkspaceInfo
} from '../lib/api'

/** 设置页（规格 §7.5）：Phase 1 先做 AI Key / 工作区 / 轮询间隔 / 主题。 */
function SettingsPage(): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({})
  const [ai, setAi] = useState<{ configured: boolean; model: string | null } | null>(null)
  const [aiMsg, setAiMsg] = useState('')
  const [ws, setWs] = useState<WorkspaceInfo | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        setValues(s)
        setAi(await aiStatus())
        setWs(await workspaceInfo())
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const save = async (patch: Record<string, string>): Promise<void> => {
    await putSettings(patch)
    setValues((v) => ({ ...v, ...patch }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <div className="text-[13px] text-[var(--faint)]">加载中…</div>

  return (
    <div className="max-w-2xl space-y-6">
      <Section
        title="AI 模型"
        desc="默认智谱 GLM-4.5-Flash（免费）。API Key 存在系统密钥环，不落明文。"
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound size={14} className="absolute left-2.5 top-2.5 text-[var(--faint)]" />
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={ai?.configured ? '已配置（••••••••），输入可覆盖' : '粘贴 API Key'}
              className="w-full pl-8 pr-9 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[13px] outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-2 text-[var(--faint)] hover:text-[var(--faint)]"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={async () => {
              if (!apiKey) return
              await setAiKey(apiKey)
              setApiKey('')
              setAi(await aiStatus())
        setWs(await workspaceInfo())
              setAiMsg('已保存到系统凭据管理器')
            }}
            disabled={!apiKey}
            className="flex items-center gap-1 px-3 py-2 rounded-md bg-[var(--accent)] text-white text-[12px] disabled:opacity-40"
          >
            <Save size={13} /> 保存
          </button>
          <button
            onClick={async () => {
              setAiMsg('测试中…')
              const r = await testAi()
              setAiMsg(r.message)
            }}
            className="px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--muted)] hover:border-[var(--accent)]"
          >
            测试连接
          </button>
        </div>
        <div className="mt-2 text-[11.5px] text-[var(--faint)]">
          状态：{ai?.configured ? `已配置 · ${ai.model}` : '未配置'} · Key 存于 Windows 凭据管理器，不落明文
        </div>
        {aiMsg && <div className="mt-1 text-[11.5px] text-[var(--ok)]">{aiMsg}</div>}
      </Section>

      <Section
        title="工作区"
        desc="下载的附件按「平台 / 课程 / 任务」自动分类，重名不覆盖、只增不删。默认跟随助手目录，不占 C 盘。"
      >
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[12px] min-w-0">
            <FolderOpen size={14} className="text-[var(--faint)] shrink-0" />
            <span className="text-[var(--faint)] truncate" title={ws?.root || ''}>
              {ws?.root || '加载中…'}
            </span>
          </div>
          <button
            onClick={() => void openWorkspace()}
            className="px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--muted)] hover:border-[var(--accent)]"
          >
            打开
          </button>
          <button
            onClick={() => {
              const dir = window.prompt(
                '输入工作区目录绝对路径（留空恢复默认：助手目录/workspace）',
                values.workspace_dir || ''
              )
              if (dir !== null) void save({ workspace_dir: dir })
            }}
            className="px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--muted)] hover:border-[var(--accent)]"
          >
            修改
          </button>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem('ca_guide_done')
            location.reload()
          }}
          className="mt-2 text-[11px] text-[var(--faint)] hover:text-[var(--accent-strong)]"
        >
          重新观看新手引导
        </button>
      </Section>

      <Section title="同步频率" desc="学习通作业轮询间隔（课表不参与轮询）。">
        <div className="flex gap-2">
          {['15', '30', '60', '120'].map((m) => (
            <button
              key={m}
              onClick={() => void save({ poll_interval_min: m })}
              className={`px-3 py-1.5 rounded-md text-[12px] border transition-colors ${
                (values.poll_interval_min || '30') === m
                  ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-strong)]'
                  : 'bg-[var(--surface)] border-[var(--border)] text-[var(--faint)] hover:border-[var(--border)]'
              }`}
            >
              {m} 分钟
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="微信监听"
        desc="监听指定微信群，自动从「作业/截止/提交」类消息里提取任务。微信侧只读，不发消息。"
      >
        <WeChatPanel />
      </Section>

      <ChaoxingSection />

      {saved && (
        <div className="fixed bottom-12 right-6 flex items-center gap-1.5 px-3 py-2 rounded-md bg-[color-mix(in_oklch,var(--ok)_16%,transparent)] text-[var(--ok)] text-[12px] shadow-lg">
          <Check size={13} /> 已保存
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  desc,
  children
}: {
  title: string
  desc: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h2 className="text-[13.5px] font-medium text-[var(--fg)]">{title}</h2>
      <p className="text-[11.5px] text-[var(--faint)] mt-1 mb-3 leading-relaxed">{desc}</p>
      {children}
    </section>
  )
}

/** 学习通登录区块（规格 §7.2）：账号登录 / Cookie 导入 / 立即刷新 */
function ChaoxingSection(): React.JSX.Element {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await adaptersStatus()
        setLoggedIn(s.chaoxing.logged_in)
      } catch {
        setLoggedIn(false)
      }
    })()
  }, [])

  const doLogin = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await chaoxingLogin(username, password)
      setMsg(r.message)
      if (r.ok) setLoggedIn(true)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  const doCookie = async (): Promise<void> => {
    const raw = window.prompt('粘贴浏览器 Cookie（需包含 _uid 与 _d）')
    if (!raw) return
    setBusy(true)
    try {
      const r = await chaoxingImportCookie(raw)
      setMsg(r.message)
      if (r.ok) setLoggedIn(true)
    } finally {
      setBusy(false)
    }
  }

  const doRefresh = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await chaoxingRefresh()
      if (!r.ok) {
        setMsg(r.message || '刷新失败')
        return
      }
      setMsg('已开始后台同步（约 2 分钟），可关闭此页；完成后任务列表会自动更新')
      // 轮询到结束，避免用户以为没反应
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 2000))
        const s = await refreshStatus()
        if (!s.running) {
          setMsg(
            s.error
              ? `同步失败：${s.error}`
              : `同步完成：新增 ${s.created} 条，更新 ${s.updated} 条`
          )
          break
        }
        setMsg(`同步中：${s.done}/${s.total} 门课 · ${s.current}`)
      }
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="学习通" desc="账号登录后自动同步课程作业；遇到验证码可用 Cookie 导入兜底。">
      <div className="flex items-center gap-2 mb-3 text-[12px]">
        <span
          className={`w-1.5 h-1.5 rounded-full ${loggedIn ? 'bg-[var(--ok)]' : 'bg-[var(--faint)]'}`}
        />
        <span className="text-[var(--faint)]">{loggedIn ? '已登录' : '未登录'}</span>
      </div>

      {!loggedIn && (
        <div className="space-y-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="手机号 / 学号"
            className="w-full px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[13px] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doLogin()}
              placeholder="密码"
              className="flex-1 px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[13px] outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => void doLogin()}
              disabled={busy || !username || !password}
              className="flex items-center gap-1 px-3 py-2 rounded-md bg-[var(--accent)] text-white text-[12px] disabled:opacity-40"
            >
              <LogIn size={13} /> 登录
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          onClick={() => void doCookie()}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--muted)] hover:border-[var(--accent)] disabled:opacity-40"
        >
          <Cookie size={13} /> 导入 Cookie
        </button>
        <button
          onClick={() => void doRefresh()}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--muted)] hover:border-[var(--accent)] disabled:opacity-40"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> 立即刷新作业
        </button>
      </div>

      {msg && <div className="mt-2 text-[11.5px] text-[var(--faint)] break-all">{msg}</div>}
    </Section>
  )
}

export default SettingsPage
