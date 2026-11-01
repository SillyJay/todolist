import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, X } from 'lucide-react'
import Avatar from './Avatar'
import AvatarCrop from './AvatarCrop'
import TermsDialog from './TermsDialog'
import {
  authBindLocal,
  authCreateInvite,
  authRecoveryLogin,
  emailSendCode,
  resetByCode,
  authRecoveryRotate,
  authRecoveryStatus,
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
export default function AccountDialog({ open, onClose, account, onChanged }: Props): React.JSX.Element | null {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [forgotMode, setForgotMode] = useState<'code' | 'email'>('code')
  const [emailCode, setEmailCode] = useState('')
  const [codeMsg, setCodeMsg] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoverySet, setRecoverySet] = useState<boolean | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
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
        try {
        await authBindLocal()
      } catch {
        /* 绑定失败不阻塞登录 */
      }
      const p = await authGetProfile()
        if (p.ok) {
          setName(p.display_name || '')
          setAvatar(p.avatar || '')
        }
        const st = await authRecoveryStatus()
        setRecoverySet(Boolean(st.ok && st.recovery_set))
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

  const pickAvatar = (file: File): void => {
    setCropFile(file)
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

            {mode === 'login' && !forgot && (
              <button className="terms-link" onClick={() => setForgot(true)}>
                忘记密码？
              </button>
            )}

            {forgot && (
              <div className="account-forgot">
                <div className="inline-actions">
                  <button
                    className={`chip${forgotMode === 'code' ? ' active' : ''}`}
                    onClick={() => setForgotMode('code')}
                  >
                    用恢复码
                  </button>
                  <button
                    className={`chip${forgotMode === 'email' ? ' active' : ''}`}
                    onClick={() => setForgotMode('email')}
                  >
                    用邮箱验证码
                  </button>
                </div>

                {forgotMode === 'code' ? (
                  <div className="account-tip">用邮箱 + 恢复码重设密码</div>
                ) : (
                  <div className="account-tip">给注册邮箱发一个 6 位验证码（需要先配好 SMTP）</div>
                )}
                {forgotMode === 'code' ? (
                  <input
                    className="input"
                    placeholder="恢复码（形如 XXXX-XXXX-…）"
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
                  />
                ) : (
                  <div className="inline-actions">
                    <input
                      className="input"
                      placeholder="6 位验证码"
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      style={{ maxWidth: 140 }}
                    />
                    <button
                      className="btn btn-ghost sm"
                      onClick={async () => {
                        const r = await emailSendCode(email.trim())
                        setCodeMsg(r.ok ? '验证码已发送' : r.message || '发送失败')
                      }}
                    >
                      发送验证码
                    </button>
                  </div>
                )}
                {codeMsg && <div className="account-tip">{codeMsg}</div>}
                <input
                  className="input"
                  type="password"
                  placeholder="新密码（至少 6 位）"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <div className="inline-actions">
                  <button
                    className="btn btn-secondary sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setMsg('')
                      try {
                        const r =
                          forgotMode === 'code'
                            ? await authRecoveryLogin(email.trim(), recoveryInput.trim(), newPassword)
                            : await resetByCode(email.trim(), emailCode, newPassword)
                        if (!r.ok || !r.token) {
                          setMsg(r.message || '恢复失败')
                          return
                        }
                        setAccountToken(r.token)
                        const p2 = await authGetProfile()
                        onChanged({
                          email: p2.email || r.email || email.trim(),
                          display_name: p2.display_name || '',
                          avatar: p2.avatar || ''
                        })
                        setRecoveryCode(r.new_recovery || '')
                        setForgot(false)
                        setMsg('密码已重设，并生成了新的恢复码（请保存）')
                      } catch (e) {
                        setMsg(String(e).replace(/^Error:\s*/, ''))
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    重设密码并登录
                  </button>
                  <button className="btn btn-ghost sm" onClick={() => setForgot(false)}>
                    返回登录
                  </button>
                </div>
              </div>
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

            <div className="account-recovery">
              <div className="account-tip">
                恢复码用于忘记密码时找回账号，只显示这一次，请保存到安全的地方。
              </div>
              <div className="inline-actions">
                <button
                  className="btn btn-ghost sm"
                  onClick={async () => {
                    const r = await authRecoveryRotate()
                    if (r.ok && r.recovery) {
                      setRecoveryCode(r.recovery)
                      setRecoverySet(true)
                      toast('已生成新的恢复码')
                    } else {
                      toast(r.message || '生成失败')
                    }
                  }}
                >
                  {recoverySet === false ? '生成恢复码' : '重置恢复码'}
                </button>
                {recoveryCode && (
                  <>
                    <code className="account-invite-code">{recoveryCode}</code>
                    <button
                      className="btn btn-ghost sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(recoveryCode)
                        toast('已复制')
                      }}
                    >
                      复制
                    </button>
                  </>
                )}
              </div>
            </div>

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
      {cropFile && (
        <AvatarCrop
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(data) => {
            setAvatar(data)
            setCropFile(null)
          }}
        />
      )}
      <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
    </div>,
    document.body
  )
}
