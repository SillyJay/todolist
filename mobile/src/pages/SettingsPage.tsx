import { useRef, useState } from 'react'
import { putProfile } from '../lib/api'
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
  server: string
  onServer: (v: string) => void
  onUnpair: () => void
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
  server,
  onServer,
  onUnpair,
  account,
  onAccount
}: Props): React.JSX.Element {
  const [addr, setAddr] = useState(server)
  const [name, setName] = useState(account?.display_name || '')
  const [avatar, setAvatar] = useState(account?.avatar || '')
  const [saving, setSaving] = useState(false)
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

  const applyServer = (): void => {
    const v = addr.trim().replace(/\/+$/, '')
    if (v) onServer(v)
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
            <button className="setting-action" disabled={saving} onClick={() => void saveProfile()}>
              {saving ? '保存中' : '保存'}
            </button>
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
          <div className="group-head">
            <div className="avatar">{account?.avatar ? <img src={account.avatar} alt="" /> : <span className="avatar-default"><IconUser /></span>}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 550 }}>{account?.email || "未绑定账号"}</div>
              <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 2 }}>
                {account?.email ? "已登录 · 换手机用同一邮箱登录" : "绑定后可在换手机时找回数据"}
              </div>
            </div>
            <IconChevron className="chev-r" />
          </div>
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
            <div className="srow" style={{ gap: 10 }}>
              <span className="lead">
                <IconCloud />
              </span>
              <span className="label">服务器</span>
              <input
                className="server-input"
                value={addr}
                placeholder="http://192.168.1.10:8765"
                onChange={(e) => setAddr(e.target.value)}
                onBlur={applyServer}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyServer()
                }}
              />
            </div>
            <button className="srow" style={{ width: '100%' }} onClick={onSync}>
              <span className="lead">
                <IconInfo />
              </span>
              <span className="label">立即同步</span>
              <IconChevron className="chev-r" />
            </button>
            <div className="srow">
              <span className="lead">
                <IconUser />
              </span>
              <span className="label">已配对设备</span>
              <span className="val">本机</span>
              <IconChevron className="chev-r" />
            </div>
            <button className="srow" style={{ width: "100%" }} onClick={onUnpair}>
              <span className="lead">
                <IconInfo />
              </span>
              <span className="label">解除配对</span>
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
            <div className="srow">
              <span className="lead">
                <IconInfo />
              </span>
              <span className="label">关于</span>
              <span className="val">{version}</span>
              <IconChevron className="chev-r" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
