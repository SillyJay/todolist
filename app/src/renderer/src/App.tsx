import { useEffect, useState } from 'react'
import { health, adaptersStatus, getBaseUrl, type AdaptersStatus } from './lib/api'

/**
 * Phase 0 自检页：验证 Electron → Python 子进程 → FastAPI 链路连通。
 * Phase 1 将替换为三栏布局 + 任务列表。
 */
function App(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [status, setStatus] = useState<'checking' | 'ok' | 'fail'>('checking')
  const [adapters, setAdapters] = useState<AdaptersStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const base = await getBaseUrl()
        if (cancelled) return
        setBaseUrl(base)
        const h = await health()
        if (cancelled) return
        setStatus(h.status === 'ok' ? 'ok' : 'fail')
        setAdapters(await adaptersStatus())
      } catch (e) {
        if (cancelled) return
        setStatus('fail')
        setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, "Microsoft YaHei", sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>校园信息管理助手 · Phase 0 自检</h1>
      <p style={{ marginTop: 8, color: '#888' }}>后端地址：{baseUrl || '等待主进程注入…'}</p>

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: status === 'ok' ? '#22c55e' : status === 'fail' ? '#ef4444' : '#f59e0b'
          }}
        />
        <span>
          后端健康检查：{status === 'checking' ? '检查中…' : status === 'ok' ? '连通 ✓' : '失败 ✗'}
        </span>
      </div>
      {error && <pre style={{ marginTop: 12, color: '#ef4444', fontSize: 12 }}>{error}</pre>}

      {adapters && (
        <ul style={{ marginTop: 24, lineHeight: 2, fontSize: 14 }}>
          <li>学习通：{adapters.chaoxing.logged_in ? '已登录' : '未登录'}</li>
          <li>讯飞小雅：{adapters.xiaoya.logged_in ? '已登录' : '未登录'}</li>
          <li>微信群监听：{adapters.wechat.state}</li>
        </ul>
      )}
    </div>
  )
}

export default App
