import { useState } from 'react'
import { authLogin, authRegister, getBase, isNative, setBase, setToken } from '../lib/api'
import { TERMS, TERMS_VERSION } from '../lib/terms'

interface Props {
  onDone: () => void
}

function deviceName(): string {
  return isNative() ? '手机 App' : '网页'
}

export default function LoginScreen({ onDone }: Props): React.JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [server, setServer] = useState(getBase() || 'https://todo.sillyjay.top')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    setError('')
    if (!email.includes('@')) {
      setError('请输入邮箱')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    if (mode === 'register' && invite.trim().length < 6) {
      setError('请输入邀请码')
      return
    }
    if (mode === 'register' && !agreed) {
      setError('请先阅读并勾选《使用协议与免责声明》')
      return
    }
    setBusy(true)
    try {
      if (server.trim()) setBase(server.trim())
      const r =
        mode === 'login'
          ? await authLogin(email.trim(), password, deviceName())
          : await authRegister(email.trim(), password, invite.trim(), deviceName(), true)
      if (!r.ok || !r.token) {
        setError(r.message || '登录失败')
        return
      }
      setToken(r.token)
      onDone()
    } catch (e) {
      setError(`连不上服务器：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen pair-screen">
      <div className="pair-head">
        <div className="pair-logo">✓</div>
        <h1 className="pair-title">{mode === 'login' ? '登录 ToDoList' : '注册 ToDoList'}</h1>
        <p className="pair-sub">
          {mode === 'login' ? '用邮箱和密码登录，换手机也能找回数据' : '需要电脑端生成的邀请码'}
        </p>
      </div>

      <div className="pair-modes">
        <button
          className={`pair-mode${mode === 'login' ? ' active' : ''}`}
          onClick={() => setMode('login')}
        >
          登录
        </button>
        <button
          className={`pair-mode${mode === 'register' ? ' active' : ''}`}
          onClick={() => setMode('register')}
        >
          注册
        </button>
      </div>

      <div className="pair-body">
        <label className="pair-label">邮箱</label>
        <input
          className="pair-input"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="pair-label">密码</label>
        <input
          className="pair-input"
          type="password"
          placeholder="至少 6 位"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {mode === 'register' && (
          <>
            <label className="pair-label">邀请码</label>
            <input
              className="pair-input"
              placeholder="8 位，电脑端「设置 → 账号」生成"
              value={invite}
              onChange={(e) => setInvite(e.target.value.toUpperCase())}
            />
          </>
        )}

        {showAdvanced && (
          <>
            <label className="pair-label">服务器地址</label>
            <input
              className="pair-input"
              placeholder="https://..."
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
          </>
        )}

        {mode === 'register' && (
          <label className="terms-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              我已阅读并同意
              <button type="button" className="terms-link" onClick={() => setTermsOpen(true)}>
                《使用协议与免责声明》
              </button>
            </span>
          </label>
        )}

        {error && <div className="pair-error">{error}</div>}

        <button className="pair-link" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '收起高级设置' : '高级设置'}
        </button>

        <button className="pair-btn" disabled={busy} onClick={() => void submit()}>
          {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </div>

      {termsOpen && (
        <div className="terms-sheet" onClick={() => setTermsOpen(false)}>
          <div className="terms-panel" onClick={(e) => e.stopPropagation()}>
            <div className="terms-title">使用协议与免责声明</div>
            <div className="terms-scroll">
              {TERMS.map((t) => (
                <p key={t.slice(0, 12)}>{t}</p>
              ))}
              <p className="terms-ver">版本 {TERMS_VERSION}</p>
            </div>
            <button className="pair-btn" onClick={() => setTermsOpen(false)}>
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
