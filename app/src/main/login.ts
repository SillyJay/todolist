/**
 * 内置浏览器登录（规格 §14.2）
 *
 * 思路：开一个真实 BrowserWindow 加载平台登录页，用户手动完成验证码/扫码，
 * 关闭窗口时读取该 session 的 Cookie，POST 给 Python 后端持久化。
 * 相比让用户 F12 复制 Cookie，体验好得多，也天然支持验证码场景。
 */
import { BrowserWindow, session } from 'electron'
import { log } from './logger'

interface PlatformConf {
  url: string
  domains: string[] // Cookie 域白名单
  importPath: string // 后端导入接口
  title: string
}

const PLATFORMS: Record<string, PlatformConf> = {
  xiaoya: {
    url: 'https://xiaoya.iflytek.com',
    domains: ['iflytek.com'],
    importPath: '/adapters/xiaoya/import-cookie',
    title: '登录讯飞小雅'
  },
  chaoxing: {
    url: 'https://i.chaoxing.com',
    domains: ['chaoxing.com'],
    importPath: '/adapters/chaoxing/import-cookie',
    title: '登录学习通'
  }
}

const PARTITION = 'persist:platform-login'

export async function openLoginWindow(
  platform: keyof typeof PLATFORMS,
  parent: BrowserWindow | null,
  baseUrl: string
): Promise<{ ok: boolean; message: string; count?: number }> {
  const conf = PLATFORMS[platform]
  if (!conf) return { ok: false, message: `未知平台：${platform}` }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 780,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      title: `${conf.title}（登录完成后直接关闭此窗口）`,
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    win.loadURL(conf.url).catch((e) => log(`[login] load failed: ${e}`))

    let settled = false
    win.on('closed', async () => {
      if (settled) return
      settled = true
      try {
        const ses = session.fromPartition(PARTITION)
        const all = await ses.cookies.get({})
        const matched = all.filter((c) =>
          conf.domains.some((d) => (c.domain ?? '').includes(d))
        )
        if (matched.length === 0) {
          resolve({ ok: false, message: '没有读取到登录 Cookie，请确认已登录成功' })
          return
        }

        const cookieStr = matched.map((c) => `${c.name}=${c.value}`).join('; ')
        const res = await fetch(`${baseUrl}${conf.importPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookie: cookieStr })
        })
        const data = (await res.json()) as { ok?: boolean; message?: string }
        log(`[login] ${platform} import: ${JSON.stringify(data)}`)
        resolve({
          ok: Boolean(data.ok),
          message: data.message || (data.ok ? '登录信息已导入' : '导入失败'),
          count: matched.length
        })
      } catch (e) {
        log(`[login] import error: ${e}`)
        resolve({ ok: false, message: `导入失败：${String(e)}` })
      }
    })
  })
}
