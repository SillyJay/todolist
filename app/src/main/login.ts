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
  domains: string[] // Cookie 域白名单（支持后缀匹配）
  importPath: string // 后端导入接口
  title: string
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

const PLATFORMS: Record<string, PlatformConf> = {
  xiaoya: {
    // 实测（2026-10）：小雅真实登录入口在 fifedu.com，旧 iflytek.com 会跳空白页
    url: 'https://xiaoya.fifedu.com/jx-auth/oauth2/login?redirect_url=https%3A%2F%2Fxiaoya.fifedu.com%2FhomePage%3Fislogin%3Dtrue',
    domains: ['fifedu.com', 'iflytek.com', 'gdei.edu.cn'],
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

    // 部分 SSO 会拦 Electron 默认 UA，伪装成普通 Chrome
    win.webContents.setUserAgent(CHROME_UA)

    win.loadURL(conf.url).catch((e) => log(`[login] load failed: ${e}`))

    // 注入一个悬浮提示（不改动页面其他内容），点一下即可关闭窗口完成导入
    win.webContents.on('did-finish-load', () => {
      const js = `
        (() => {
          if (document.getElementById('__ca_login_tip')) return;
          const d = document.createElement('div');
          d.id = '__ca_login_tip';
          d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
            'background:#4f8cff;color:#fff;font:13px/1.5 "Microsoft YaHei",sans-serif;' +
            'padding:10px 14px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);cursor:pointer;';
          d.textContent = '登录完成后点这里（导入登录信息）';
          d.onclick = () => window.close();
          document.body.appendChild(d);
        })();
      `
      win.webContents.executeJavaScript(js).catch(() => undefined)
    })

    let settled = false
    win.on('closed', async () => {
      if (settled) return
      settled = true
      try {
        const ses = session.fromPartition(PARTITION)
        const all = await ses.cookies.get({})
        // 动态补一个当前页面主域后缀，覆盖 SSO 跳转到的新域名
        const lastHost = (() => {
          try {
            return new URL(win.webContents.getURL()).hostname
          } catch {
            return ''
          }
        })()
        const hostSuffix = lastHost.split('.').slice(-2).join('.')

        const matched = all.filter((c) => {
          const domain = (c.domain ?? '').replace(/^\./, '')
          return (
            conf.domains.some((d) => domain.endsWith(d)) ||
            (hostSuffix && domain.endsWith(hostSuffix))
          )
        })
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
