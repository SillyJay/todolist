import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, X } from 'lucide-react'
import Avatar from './Avatar'
import TermsDialog from './TermsDialog'
import {
  authCreateInvite,
  authGetProfile,
  authLogin,
  authLogout,
  authPutProfile,
  authRegister,
  getAccountToken,
  setAccountToken
} from '../lib/api'
import { toast } from './Toast'

export interface AccountInfo {
  email: string
  display_name: string
  avatar: string
}

interface Props {
  open: boolean
  onClose: () => void
  account: AccountInfo | null
  onChanged: (a: AccountInfo | null) => void
}

/** 把用户选的图片压成 256px 的 dataURL，避免头像太大 */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('无法处理图片'))
        return
      }
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

export default function AccountDialog({ open, onClose, account, onChanged }: Props): React.JSX.Element | null {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setMsg('')
    if (getAccountToken()) {
      void (async () => {
        const p = await authGetProfile()
        if (p.ok) {
          setName(p.display_name || '')
          setAvatar(p.avatar || '')
        }
      })()
    }
  }, [open])

  if (!open) return null

  const logged = Boolean(account?.email)

  const doAuth = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      if (mode === 'register' && !agreed) {
        setMsg('请先阅读并勾选《使用协议与免责声明》')
        return
      }
      const r =
        mode === 'login'
          ? await authLogin(email.trim(), password)
          : await authRegister(email.trim(), password, invite.trim(), true)
      if (!r.ok || !r.token) {
        setMsg(r.message || '失败')
        return
      }
      setAccountToken(r.token)
      const p = await authGetProfile()
      const info: AccountInfo = {
        email: p.email || r.email || email.trim(),
        display_name: p.display_name || '',
        avatar: p.avatar || ''
      }
      setName(info.display_name)
      setAvatar(info.avatar)
      onChanged(info)
      setMsg('登录成功')
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const doSaveProfile = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await authPutProfile({ display_name: name, avatar })
      if (!r.ok) {
        setMsg(r.message || '保存失败')
        return
      }
      const info: AccountInfo = {
        email: account?.email || email,
        display_name: r.display_name || '',
        avatar: r.avatar || ''
      }
      onChanged(info)
      toast('已保存')
    } finally {
      setBusy(false)
    }
  }

  const pickAvatar = async (file: File): Promise<void> => {
    try {
      const data = await shrink(file)
      setAvatar(data)
    } catch (e) {
      toast(String(e))
    }
  }

  return createPortal(
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog account-dialog">
        <div className="dialog-head">
          <div className="dialog-title">{logged ? '我的账号' : mode === 'login' ? '登录' : '注册'}</div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        {!logged ? (
          <div className="dialog-body setting-stack">
            <div className="inline-actions">
              <button
                className={`chip${mode === 'login' ? ' active' : ''}`}
                onClick={() => setMode('login')}
              >
                登录
              </button>
              <button
                className={`chip${mode === 'register' ? ' active' : ''}`}
                onClick={() => setMode('register')}
              >
                注册（需要邀请码）
              </button>
            </div>

            <input
              className="input"
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder="密码（至少 6 位）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && (
              <input
                className="input"
                placeholder="邀请码（设置 → 同步频率 里生成）"
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase())}
              />
            )}

            {mode === 'register' && (
              <label className="terms-agree">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  我已阅读并同意
                  <button
                    type="button"
                    className="terms-link"
                    onClick={() => setTermsOpen(true)}
                  >
                    《使用协议与免责声明》
                  </button>
                </span>
              </label>
            )}

            {msg && <div className="status-note"><span>{msg}</span></div>}

            <div className="inline-actions">
              <button className="btn btn-primary sm" disabled={busy} onClick={() => void doAuth()}>
                {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-body setting-stack">
            <div className="account-head">
              <button
                className="account-avatar-lg"
                onClick={() => fileRef.current?.click()}
                title="点击更换头像"
              >
                <Avatar src={avatar} size={avatar ? 64 : 38} />
              </button>
              <div>
                <div className="account-email">{account?.email}</div>
                <div className="account-tip">点头像更换，桌面和手机同步</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pickAvatar(f)
                  e.target.value = ''
                }}
              />
            </div>

            <input
              className="input"
              placeholder="昵称"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <div className="account-invite">
              <div className="account-invite-title">邀请同学</div>
              <div className="account-tip">
                他们在这台电脑或自己电脑上点右上角「账号 → 注册」，填入这个邀请码即可。
              </div>
              <div className="inline-actions">
                <button
                  className="btn btn-secondary sm"
                  onClick={async () => {
                    const r = await authCreateInvite('', 7)
                    if (r.ok && r.code) {
                      setInvite(r.code)
                      toast('已生成，7 天内有效')
                    } else {
                      toast(r.message || '生成失败')
                    }
                  }}
                >
                  生成邀请码
                </button>
                {invite && (
                  <>
                    <span className="account-invite-code">{invite}</span>
                    <button
                      className="btn btn-ghost sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(invite)
                        toast('已复制')
                      }}
                    >
                      复制
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="inline-actions">
              <button className="btn btn-primary sm" disabled={busy} onClick={() => void doSaveProfile()}>
                保存
              </button>
              <button
                className="btn btn-ghost sm"
                onClick={async () => {
                  await authLogout()
                  setAccountToken('')
                  onChanged(null)
                  onClose()
                }}
              >
                <LogOut size={13} /> 退出登录
              </button>
            </div>
          </div>
        )}
      </div>
      <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
    </div>,
    document.body
  )
}
