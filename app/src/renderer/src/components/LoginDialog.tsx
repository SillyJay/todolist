import { useEffect, useRef, useState } from 'react'
import {
  X,
  LogIn,
  Cookie,
  RefreshCw,
  Check,
  AlertCircle,
  GraduationCap,
  Sparkles,
  Loader2,
  CalendarDays
} from 'lucide-react'
import {
  adaptersStatus,
  chaoxingLogin,
  chaoxingImportCookie,
  chaoxingRefresh,
  chaoxingRefreshSchedule,
  refreshStatus,
  xiaoyaImportCookie,
  xiaoyaLogin,
  type AdaptersStatus,
  type RefreshStatus
} from '../lib/api'

type Platform = 'chaoxing' | 'xiaoya'

interface Props {
  onClose: () => void
  onChanged?: () => void
}

/** 应用内登录界面（学习通 / 讯飞小雅） */
export default function LoginDialog({ onClose, onChanged }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Platform>('chaoxing')
  const [status, setStatus] = useState<AdaptersStatus | null>(null)

  const reloadStatus = async (): Promise<void> => {
    try {
      setStatus(await adaptersStatus())
      onChanged?.()
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void reloadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-h-[86vh] overflow-y-auto rounded-xl border border-[#2e2e38] bg-[#17171c] shadow-2xl">
        <header className="flex items-center justify-between px-4 h-11 border-b border-[#26262f]">
          <span className="text-[13px] text-[#e0e0e8]">账号登录</span>
          <button onClick={onClose} className="text-[#7a7a88] hover:text-[#e0e0e8]">
            <X size={15} />
          </button>
        </header>

        <div className="flex px-4 pt-3 gap-1">
          <TabBtn
            active={tab === 'chaoxing'}
            onClick={() => setTab('chaoxing')}
            icon={<GraduationCap size={13} />}
            label="学习通"
            loggedIn={status?.chaoxing.logged_in}
          />
          <TabBtn
            active={tab === 'xiaoya'}
            onClick={() => setTab('xiaoya')}
            icon={<Sparkles size={13} />}
            label="讯飞小雅"
            loggedIn={status?.xiaoya.logged_in}
          />
        </div>

        <div className="p-4 pt-3">
          {tab === 'chaoxing' ? (
            <ChaoxingPanel loggedIn={!!status?.chaoxing.logged_in} onChanged={reloadStatus} />
          ) : (
            <XiaoyaPanel loggedIn={!!status?.xiaoya.logged_in} onChanged={reloadStatus} />
          )}
        </div>
      </div>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
  loggedIn
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  loggedIn?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] transition-colors ${
        active ? 'bg-[#242430] text-[#e8e8ec]' : 'text-[#8a8a98] hover:text-[#c0c0cc]'
      }`}
    >
      {icon}
      {label}
      <span className={`w-1.5 h-1.5 rounded-full ${loggedIn ? 'bg-[#22c55e]' : 'bg-[#4a4a58]'}`} />
    </button>
  )
}

function ChaoxingPanel({
  loggedIn,
  onChanged
}: {
  loggedIn: boolean
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cookieMode, setCookieMode] = useState(false)
  const [cookieText, setCookieText] = useState('')
  const [progress, setProgress] = useState<RefreshStatus | null>(null)
  const timer = useRef<number | null>(null)

  const poll = async (): Promise<void> => {
    const s = await refreshStatus()
    setProgress(s)
    if (s.running) {
      timer.current = window.setTimeout(() => void poll(), 1500)
    } else {
      timer.current = null
      await onChanged()
    }
  }

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const doLogin = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await chaoxingLogin(username, password)
      setMsg({ ok: r.ok, text: r.message })
      if (r.ok) {
        setPassword('')
        await onChanged()
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const doCookie = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await chaoxingImportCookie(cookieText)
      setMsg({ ok: r.ok, text: r.message })
      if (r.ok) {
        setCookieText('')
        await onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  const doRefresh = async (): Promise<void> => {
    setMsg(null)
    const r = await chaoxingRefresh()
    if (!r.ok) {
      setMsg({ ok: false, text: r.message || '刷新失败' })
      return
    }
    setProgress({ running: true, done: 0, total: 0, current: '启动中…', created: 0, updated: 0, error: '' })
    void poll()
  }

  return (
    <div className="space-y-3">
      {loggedIn ? (
        <>
          <div className="flex items-center gap-2 text-[12px] text-[#7ee2b8]">
            <Check size={13} /> 学习通已登录
          </div>

          <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void doRefresh()}
            disabled={progress?.running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1c1c22] border border-[#2e2e38] text-[12px] text-[#b0b0be] hover:border-[#4f8cff] disabled:opacity-50"
          >
            {progress?.running ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            同步作业（约 2 分钟）
          </button>

          <button
            onClick={async () => {
              setMsg(null)
              const r = await chaoxingRefreshSchedule()
              setMsg({ ok: !!r.ok, text: r.message || (r.ok ? '课表已同步' : '课表同步失败') })
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1c1c22] border border-[#2e2e38] text-[12px] text-[#b0b0be] hover:border-[#4f8cff]"
          >
            <CalendarDays size={13} />
            同步课表（约 1 秒）
          </button>
          </div>

          {progress && (
            <div className="text-[11.5px] text-[#8a8a98]">
              {progress.running ? (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span>
                      正在抓取 {progress.done}/{progress.total || '?'} 门课
                    </span>
                    <span className="text-[#5c5c6a]">{progress.current}</span>
                  </div>
                  <div className="h-1 rounded bg-[#24242c] overflow-hidden">
                    <div
                      className="h-full bg-[#4f8cff] transition-all"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%`
                      }}
                    />
                  </div>
                </>
              ) : progress.error ? (
                <span className="text-[#ff9aa2]">同步失败：{progress.error}</span>
              ) : (
                <span>
                  同步完成：新增 {progress.created} 条，更新 {progress.updated} 条
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="手机号 / 学号"
              className="w-full px-3 py-2 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[13px] outline-none focus:border-[#4f8cff] placeholder:text-[#4a4a58]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doLogin()}
              placeholder="密码"
              className="w-full px-3 py-2 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[13px] outline-none focus:border-[#4f8cff] placeholder:text-[#4a4a58]"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void doLogin()}
              disabled={busy || !username || !password}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#4f8cff] text-white text-[12px] disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
              登录
            </button>
            <button
              onClick={() => setCookieMode((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#2e2e38] text-[12px] text-[#9a9aa8] hover:text-[#e0e0e8]"
            >
              <Cookie size={13} /> 用 Cookie 登录
            </button>
          </div>

          {cookieMode && (
            <div className="space-y-2">
              <div className="text-[11px] text-[#6b6b7a] leading-relaxed">
                浏览器登录 i.chaoxing.com → F12 → Application → Cookies，
                复制整行（形如 <code className="text-[#9a9aa8]">_uid=...; _d=...; uf=...</code>）
              </div>
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                rows={3}
                placeholder="_uid=...; _d=...; uf=..."
                className="w-full px-2.5 py-2 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[11.5px] outline-none focus:border-[#4f8cff] resize-none placeholder:text-[#3d3d48]"
              />
              <button
                onClick={() => void doCookie()}
                disabled={busy || !cookieText.trim()}
                className="px-3 py-1.5 rounded-md bg-[#242430] text-[12px] text-[#d0d0da] disabled:opacity-40"
              >
                导入 Cookie
              </button>
            </div>
          )}
        </>
      )}

      {msg && (
        <div
          className={`flex items-start gap-1.5 text-[11.5px] ${
            msg.ok ? 'text-[#7ee2b8]' : 'text-[#ff9aa2]'
          }`}
        >
          {msg.ok ? <Check size={12} className="mt-0.5" /> : <AlertCircle size={12} className="mt-0.5" />}
          <span className="break-all">{msg.text}</span>
        </div>
      )}
    </div>
  )
}

function XiaoyaPanel({
  loggedIn,
  onChanged
}: {
  loggedIn: boolean
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [cookieText, setCookieText] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const doCookie = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await xiaoyaImportCookie(cookieText)
      setMsg({ ok: r.ok, text: r.message })
      if (r.ok) {
        setCookieText('')
        await onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  const doLogin = async (): Promise<void> => {
    const r = await xiaoyaLogin('', '')
    setMsg({ ok: r.ok, text: r.message })
  }

  return (
    <div className="space-y-3">
      <div className="text-[11.5px] text-[#6b6b7a] leading-relaxed">
        小雅登录需要短信验证，暂不支持账号密码直登。请在浏览器登录
        <span className="text-[#9a9aa8]"> xiaoya.iflytek.com </span>
        后导入 Cookie，程序据此读取作业列表（只读，不会代交作业）。
      </div>

      {loggedIn && (
        <div className="flex items-center gap-2 text-[12px] text-[#7ee2b8]">
          <Check size={13} /> Cookie 已配置
        </div>
      )}

      <textarea
        value={cookieText}
        onChange={(e) => setCookieText(e.target.value)}
        rows={3}
        placeholder="粘贴 xiaoya.iflytek.com 的 Cookie"
        className="w-full px-2.5 py-2 rounded-md bg-[#1a1a20] border border-[#2e2e38] text-[11.5px] outline-none focus:border-[#4f8cff] resize-none placeholder:text-[#3d3d48]"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={() => void doCookie()}
          disabled={busy || !cookieText.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#4f8cff] text-white text-[12px] disabled:opacity-40"
        >
          <Cookie size={13} /> 导入 Cookie
        </button>
        <button
          onClick={() => void doLogin()}
          className="px-3 py-1.5 rounded-md border border-[#2e2e38] text-[12px] text-[#8a8a98] hover:text-[#e0e0e8]"
        >
          账密登录（暂不可用）
        </button>
      </div>

      {msg && (
        <div className={`text-[11.5px] ${msg.ok ? 'text-[#7ee2b8]' : 'text-[#ffb08a]'}`}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
