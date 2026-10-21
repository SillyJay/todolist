import { useEffect, useState } from 'react'
import MainLayout from './layouts/MainLayout'
import LoginDialog from './components/LoginDialog'
import type { PageKey } from './lib/ui'
import { getSettings, putSettings } from './lib/api'

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>('tasks')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [loginOpen, setLoginOpen] = useState(false)

  // 读取主题设置
  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        if (s.theme === 'light') setTheme('light')
      } catch {
        /* 后端未就绪时用默认值 */
      }
    })()
  }, [])

  // 应用主题到 body
  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light')
    void putSettings({ theme }).catch(() => undefined)
  }, [theme])

  return (
    <>
      <MainLayout
        page={page}
        onPageChange={setPage}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenLogin={() => setLoginOpen(true)}
      />
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </>
  )
}

export default App
