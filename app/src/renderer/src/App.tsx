import { useEffect, useState } from 'react'
import { health, adaptersStatus, getBaseUrl, type AdaptersStatus } from './lib/api'

/**
 * Phase 0 自检页：验证 Electron → Python 子进程 → FastAPI 链路连通。
 * Phase 1 将替换为三栏布局 + 任务列表。
 */
function App(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('(未获取)')
  const [healthState, setHealthState] = useState<'checking' | 'ok' | 'fail'>('checking')
  const [adapters, setAdapters] = useState<AdaptersStatus | null>(null)
  const [steps, setSteps] = useState<string[]>([])

  useEffect(() => {
    const add = (s: string): void => {
      console.log('[selfcheck]', s)
      setSteps((prev) => [...prev, s])
    }

    ;(async () => {
      // 步骤 1：从主进程取后端地址
      try {
        const base = await getBaseUrl()
        setBaseUrl(base)
        add(`① 后端地址：${base} ✓`)
      } catch (e) {
        add(`① 获取后端地址失败：${String(e)} ✗`)
        setHealthState('fail')
        return
      }

      // 步骤 2：健康检查（带 3 次重试）
      let healthOk = false
      for (let i = 0; i < 3; i++) {
        try {
          const h = await health()
          if (h.status === 'ok') {
            healthOk = true
            add(`② 健康检查：${JSON.stringify(h)} ✓`)
            break
          }
          add(`② 健康检查返回异常：${JSON.stringify(h)} ✗`)
        } catch (e) {
          add(`② 健康检查失败（第 ${i + 1} 次）：${String(e)}`)
          await new Promise((r) => setTimeout(r, 800))
        }
      }
      setHealthState(healthOk ? 'ok' : 'fail')
      if (!healthOk) return

      // 步骤 3：平台状态
      try {
        const a = await adaptersStatus()
        setAdapters(a)
        add('③ 平台状态获取成功 ✓')
      } catch (e) {
        add(`③ 平台状态获取失败：${String(e)} ✗`)
      }
    })()
  }, [])

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, "Microsoft YaHei", sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>校园信息管理助手 · Phase 0 自检</h1>
      <p style={{ marginTop: 8, color: '#888' }}>后端地址：{baseUrl}</p>
      <p style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
        预加载桥接：window.api={typeof window.api} / window.electron={typeof window.electron} /
        origin={window.location.origin}
      </p>

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background:
              healthState === 'ok' ? '#22c55e' : healthState === 'fail' ? '#ef4444' : '#f59e0b'
          }}
        />
        <span>
          后端健康检查：
          {healthState === 'checking' ? '检查中…' : healthState === 'ok' ? '连通 ✓' : '失败 ✗'}
        </span>
      </div>

      <ul style={{ marginTop: 20, lineHeight: 1.9, fontSize: 13, color: '#bbb' }}>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      {adapters && (
        <ul style={{ marginTop: 20, lineHeight: 2, fontSize: 14 }}>
          <li>学习通：{adapters.chaoxing?.logged_in ? '已登录' : '未登录'}</li>
          <li>讯飞小雅：{adapters.xiaoya?.logged_in ? '已登录' : '未登录'}</li>
          <li>微信群监听：{adapters.wechat?.state}</li>
        </ul>
      )}
    </div>
  )
}

export default App
