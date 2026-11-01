import { useRef, useState } from 'react'
import { checkLatestRelease, putProfile } from '../lib/api'
import {
  IconBell,
  IconChevron,
  IconCloud,
  IconInfo,
  IconMoon,
  IconUser
} from '../components/Icons'

export type ThemeMode = 'system' | 'light' | 'dark'

interface Props {
  theme: ThemeMode
  onTheme: (m: ThemeMode) => void
  notifications: boolean
  onNotifications: (v: boolean) => void
  lastSync: string
  onSync: () => void
  version: string
  /** 已排队的本地提醒条数 */
  reminders: number
  /** 退出登录（清 token，回到登录页） */
  onLogout?: () => void
  /** 未登录时跳去登录 */
  onLogin?: () => void
  account?: { email: string; display_name: string; avatar: string } | null
  onAccount?: (a: { email: string; display_name: string; avatar: string } | null) => void
}

const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色'
}

/** Tab 5：设置（分组卡片，对齐 MinimaList） */
export default function SettingsPage({
  theme,
  onTheme,
  notifications,
  onNotifications,
  lastSync,
  onSync,
  version,
  reminders,
  onLogout,
  onLogin,
  account,
  onAccount
}: Props): React.JSX.Element {
  const [name, setName] = useState(account?.display_name || '')
  const [avatar, setAvatar] = useState(account?.avatar || '')
  const [saving, setSaving] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  /** 选图 → 压到 256px → dataURL */
  const pickAvatar = (file: File): void => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        setAvatar(canvas.toDataURL('image/jpeg', 0.85))
      }
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  const saveProfile = async (): Promise<void> => {
    setSaving(true)
    try {
      const r = await putProfile({ display_name: name, avatar })
      if (r.ok) {
        onAccount?.({
          email: r.email || account?.email || '',
          display_name: r.display_name || '',
          avatar: r.avatar || ''
        })
      }
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="screen">
      <div className="nav">
        <span className="nav-title">设置</span>
      </div>

      <div className="settings-body">
        <div className="group account-card">
          <div className="account-row">
            <button
              className="account-avatar"
              onClick={() => fileRef.current?.click()}
              aria-label="更换头像"
            >
              {avatar ? <img src={avatar} alt="" /> : <span className="avatar-default"><IconUser /></span>}
            </button>
            <div className="account-main">
              <div className="account-mail">{account?.email || '未登录'}</div>
              <input
                className="account-name"
                placeholder="昵称"
                maxLength={24}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {account?.email ? (
              <div className="account-actions">
                <button className="setting-action" disabled={saving} onClick={() => void saveProfile()}>
                  {saving ? '保存中' : '保存'}
                </button>
                <button className="account-logout" onClick={() => onLogout?.()}>
                  退出
                </button>
              </div>
            ) : (
              <button className="setting-action" onClick={() => onLogin?.()}>
                登录
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pickAvatar(f)
              e.target.value = ''
            }}
          />
        </div>


        <div className="group">
          <div className="group-rows">
            <div className="srow">
              <span className="lead">
                <IconMoon />
              </span>
              <span className="label">外观</span>
              <span className="val">{THEME_LABEL[theme]}</span>
              <IconChevron className="chev-r" />
            </div>
            <div className="srow" style={{ gap: 8 }}>
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  className={`chip${theme === m ? ' on' : ''}`}
                  onClick={() => onTheme(m)}
                >
                  {THEME_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="group">
          <div className="group-rows">
            <div className="srow">
              <span className="lead">
                <IconCloud />
              </span>
              <span className="label">同步</span>
              <span className="val">{lastSync}</span>
              <IconChevron className="chev-r" />
            </div>
            <button className="srow" style={{ width: '100%' }} onClick={onSync}>
              <span className="lead">
                <IconCloud />
              </span>
              <span className="label">立即同步</span>
              <IconChevron className="chev-r" />
            </button>
          </div>
        </div>

        <div className="group">
          <div className="group-rows">
            <div className="srow">
              <span className="lead">
                <IconBell />
              </span>
              <span className="label">到期提醒{reminders > 0 ? `（已排 ${reminders} 条）` : ""}</span>
              <button
                className={`switch${notifications ? ' on' : ''}`}
                onClick={() => onNotifications(!notifications)}
                aria-label="到期提醒"
              />
            </div>
            <div
              className="srow"
              onClick={async () => {
                setUpdateMsg('检查中…')
                const r = await checkLatestRelease()
                if (!r.ok) {
                  setUpdateMsg(r.message || '检查失败')
                  return
                }
                if (r.latest && r.latest !== version) {
                  setUpdateMsg(`发现新版本 ${r.latest}`)
                  if (r.url) window.open(r.url, '_blank')
                } else {
                  setUpdateMsg(`已是最新版本 ${version}`)
                }
              }}
            >
              <span className="lead">
                <IconInfo />
              </span>
              <span className="label">检查更新</span>
              <span className="val">{updateMsg || version}</span>
              <IconChevron className="chev-r" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
