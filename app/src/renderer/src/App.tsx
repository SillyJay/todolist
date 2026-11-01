import { useEffect, useState } from 'react'
import MainLayout from './layouts/MainLayout'
import LoginDialog from './components/LoginDialog'
import GuideTour from './components/GuideTour'
import ToastHost from './components/Toast'
import ClosePrompt from './components/ClosePrompt'
import AccountDialog, { type AccountInfo } from './components/AccountDialog'
import { authGetProfile, getAccountToken } from './lib/api'
import type { PageKey } from './lib/ui'
import { aiStatus, getSettings, putSettings } from './lib/api'
import { ensurePlan } from './lib/planStore'

const THEME_KEY = 'ca_theme'

/** 首帧主题：优先用本地缓存（同步读到，不等后端），避免重开软件先黑一屏 */
function readCachedTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>('tasks')
  const [theme, setTheme] = useState<'dark' | 'light'>(readCachedTheme)
  const [loginOpen, setLoginOpen] = useState(false)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [guideReplay, setGuideReplay] = useState(0)

  // 设置里点「重新查看新手引导」时触发：清掉标记并重放
  useEffect(() => {
    const handler = (): void => {
      try {
        localStorage.removeItem('ca_guide_done')
      } catch {
        /* ignore */
      }
      setGuideReplay((n) => n + 1)
    }
    window.addEventListener('ca:guide-replay', handler)
    return () => window.removeEventListener('ca:guide-replay', handler)
  }, [])

  // 后端是主题的最终来源，但只在本地没有缓存时才采用（否则会和首帧打架）
  useEffect(() => {
    if (!getAccountToken()) return
    void (async () => {
      try {
        const p = await authGetProfile()
        if (p.ok && p.email) {
          setAccount({ email: p.email, display_name: p.display_name || '', avatar: p.avatar || '' })
        }
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const cached = (() => {
          try {
            return localStorage.getItem(THEME_KEY)
          } catch {
            return null
          }
        })()
        const s = await getSettings()
        if (!cached && s.theme === 'light') setTheme('light')
      } catch {
        /* 后端未就绪时用本地缓存 */
      }
    })()
  }, [])

  // 应用主题：本地缓存 + DOM 类名 + 主进程窗口底色（三处都要，否则仍会闪）
  useEffect(() => {
    const light = theme === 'light'
    document.documentElement.classList.toggle('light', light)
    document.body.classList.toggle('light', light)
    // theme-boot.js 为首帧写死了内联底色/配色，进入 React 后交还给样式表，
    // 否则从亮色切回暗色时内联的浅底会一直压在上面
    document.documentElement.style.removeProperty('background')
    document.body.style.removeProperty('background')
    document.documentElement.style.colorScheme = light ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* 隐私模式忽略 */
    }
    window.api?.setTheme?.(theme)
    void putSettings({ theme }).catch(() => undefined)
  }, [theme])

  // 启动即预取「今天与明天做什么」，避免切到对话页还要等
  useEffect(() => {
    void (async () => {
      try {
        const st = await aiStatus()
        if (st.configured) await ensurePlan()
      } catch {
        /* 后端未就绪，等用户进对话页再试 */
      }
    })()
  }, [])

  return (
    <>
      <MainLayout
        page={page}
        onPageChange={setPage}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenLogin={() => setAccountOpen(true)}
        account={account}
      />
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
      <AccountDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        account={account}
        onChanged={setAccount}
      />
      <GuideTour key={guideReplay} force={guideReplay > 0} />
      <ToastHost />
      <ClosePrompt />
    </>
  )
}

export default App
