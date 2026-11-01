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
  CalendarDays,
  Globe
} from 'lucide-react'
import {
  adaptersStatus,
  chaoxingLogin,
  chaoxingImportCookie,
  chaoxingRefresh,
  chaoxingRefreshSchedule,
  refreshStatus,
  xiaoyaImportCookie,
  xiaoyaRefresh,
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
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: 'min(540px, calc(100vw - 24px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <div className="dialog-title">账号登录</div>
            <div className="dialog-sub">登录后同步作业与课表，全程只读，不会代交作业</div>
          </div>
          <button onClick={onClose} className="icon-btn" title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="segment" style={{ marginBottom: 16 }}>
            <TabBtn
              active={tab === 'chaoxing'}
              onClick={() => setTab('chaoxing')}
              icon={<GraduationCap size={14} />}
              label="学习通"
              loggedIn={status?.chaoxing.logged_in}
            />
            <TabBtn
              active={tab === 'xiaoya'}
              onClick={() => setTab('xiaoya')}
              icon={<Sparkles size={14} />}
              label="讯飞小雅"
              loggedIn={status?.xiaoya.logged_in}
            />
          </div>

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
      className={active ? 'active' : ''}
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px' }}
    >
      {icon}
      {label}
      <span className={`status-dot${loggedIn ? ' on' : ''}`} />
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
    <div className="setting-stack">
      {loggedIn ? (
        <>
          <div className="inline-flex items-center gap-2 text-[13px] text-[var(--ok)]">
            <Check size={14} /> 学习通已登录
          </div>

          <div className="inline-actions">
            <button
              onClick={() => void doRefresh()}
              disabled={progress?.running}
              className="btn btn-secondary sm"
            >
              {progress?.running ? (
                <Loader2 size={13} className="spin" />
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
              className="btn btn-secondary sm"
            >
              <CalendarDays size={13} />
              同步课表（约 1 秒）
            </button>
          </div>

          {progress && (
            <div className="text-[12px] text-[var(--muted)]">
              {progress.running ? (
                <>
                  <div className="flex items-center justify-between mb-1.5 gap-3">
                    <span>
                      正在抓取 {progress.done}/{progress.total || '?'} 门课
                    </span>
                    <span className="text-[var(--faint)] truncate">{progress.current}</span>
                  </div>
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%`
                      }}
                    />
                  </div>
                </>
              ) : progress.error ? (
                <span style={{ color: 'var(--danger)' }}>同步失败：{progress.error}</span>
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
          <div className="setting-stack" style={{ gap: 9 }}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="手机号 / 学号"
              className="input"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doLogin()}
              placeholder="密码"
              className="input"
            />
          </div>

          <div className="inline-actions">
            <button
              onClick={() => void doLogin()}
              disabled={busy || !username || !password}
              className="btn btn-primary sm"
            >
              {busy ? <Loader2 size={13} className="spin" /> : <LogIn size={13} />}
              登录
            </button>
            <button
              onClick={async () => {
                setBusy(true)
                setMsg(null)
                try {
                  const r = await window.api.openLogin('chaoxing')
                  setMsg({ ok: r.ok, text: r.message })
                  if (r.ok) await onChanged()
                } finally {
                  setBusy(false)
                }
              }}
              className="btn btn-secondary sm"
              title="遇到验证码时用这个：弹出浏览器窗口，登录完关闭即可"
            >
              <Globe size={13} /> 验证码？内置浏览器登录
            </button>
            <button
              onClick={() => setCookieMode((v) => !v)}
              className="btn btn-ghost sm"
            >
              <Cookie size={13} /> 手动 Cookie
            </button>
          </div>

          {cookieMode && (
            <div className="setting-stack" style={{ gap: 9 }}>
              <div className="text-[12px] leading-relaxed text-[var(--faint)]">
                浏览器登录 i.chaoxing.com → F12 → Application → Cookies，
                复制整行（形如 <code>_uid=...; _d=...; uf=...</code>）
              </div>
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                rows={3}
                placeholder="_uid=...; _d=...; uf=..."
                className="input"
                style={{ resize: 'none', fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div className="inline-actions">
                <button
                  onClick={() => void doCookie()}
                  disabled={busy || !cookieText.trim()}
                  className="btn btn-secondary sm"
                >
                  导入 Cookie
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {msg && (
        <div
          className="flex items-start gap-2 text-[12px]"
          style={{ color: msg.ok ? 'var(--ok)' : 'var(--danger)' }}
        >
          {msg.ok ? <Check size={13} className="mt-0.5" /> : <AlertCircle size={13} className="mt-0.5" />}
          <span style={{ wordBreak: 'break-all' }}>{msg.text}</span>
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

  return (
    <div className="setting-stack">
      <div className="text-[12.5px] leading-relaxed text-[var(--muted)]">
        小雅登录需要短信/图形验证，用内置浏览器最省事：点下面按钮 →
        弹出登录页 → 正常登录 → <span className="text-[var(--fg)]">关闭窗口</span>
        → 程序自动读取 Cookie。全程只读，不会代交作业。
      </div>

      <div className="inline-actions">
        <button
          onClick={async () => {
            setBusy(true)
            setMsg(null)
            try {
              const r = await window.api.openLogin('xiaoya')
              setMsg({ ok: r.ok, text: r.message })
              if (r.ok) await onChanged()
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
          className="btn btn-primary sm"
        >
          <Globe size={13} /> 用内置浏览器登录
        </button>
      </div>

      {loggedIn && (
        <div className="inline-actions">
          <div className="inline-flex items-center gap-2 text-[13px] text-[var(--ok)]">
            <Check size={14} /> 已登录
          </div>
          <button
            onClick={async () => {
              setBusy(true)
              setMsg(null)
              try {
                const r = await xiaoyaRefresh()
                setMsg({
                  ok: !!r.ok,
                  text: r.ok
                    ? `同步完成：新增 ${r.created} 条，更新 ${r.updated} 条（共 ${r.total} 条任务）`
                    : r.message || '同步失败'
                })
                if (r.ok) await onChanged()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="btn btn-secondary sm"
          >
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            同步作业（约 3 秒）
          </button>
        </div>
      )}

      <textarea
        value={cookieText}
        onChange={(e) => setCookieText(e.target.value)}
        rows={3}
        placeholder="粘贴 xiaoya.iflytek.com 的 Cookie"
        className="input"
        style={{ resize: 'none', fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />

      <div className="inline-actions">
        <button
          onClick={() => void doCookie()}
          disabled={busy || !cookieText.trim()}
          className="btn btn-secondary sm"
        >
          <Cookie size={13} /> 手动粘贴 Cookie
        </button>
      </div>

      {msg && (
        <div
          className="text-[12px]"
          style={{ color: msg.ok ? 'var(--ok)' : 'var(--warn)', wordBreak: 'break-all' }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
