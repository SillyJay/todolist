import { execFileSync } from 'child_process'
import { app, shell, BrowserWindow, ipcMain, dialog, Notification as ElectronNotification } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startBackend, stopBackend, getBackendPort, getAdminToken } from './backend'
import { createTray } from './tray'
import { initLogger, log } from './logger'
import { startNotificationWatcher, stopNotificationWatcher } from './notify'
import { openLoginWindow } from './login'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// GPU 策略：
// 默认开硬件加速（关掉它会让动画/滚动/弹窗模糊全走软件渲染，笔记本上明显卡）。
// 但虚拟机或远程桌面里 GPU 子进程可能起不来（error_code=18 白屏），所以留了两个出口：
//   1) 设置 → 常规 → 硬件加速 开关（需重启生效）
//   2) 环境变量 CA_SOFTWARE_RENDER=1（优先级最高，排查时用）
// 注意：disableHardwareAcceleration 必须在 app ready 之前调用，所以这里同步读配置。
function gpuPrefFile(): string {
  return join(app.getPath('userData'), 'gpu-pref.json')
}

function readGpuPref(): boolean {
  try {
    const raw = readFileSync(gpuPrefFile(), 'utf-8').replace(/^\uFEFF/, '')
    return JSON.parse(raw).hardwareAcceleration !== false
  } catch {
    return true // 没有配置文件 = 默认开
  }
}

function writeGpuPref(enabled: boolean): void {
  try {
    writeFileSync(
      gpuPrefFile(),
      JSON.stringify({ hardwareAcceleration: enabled }),
      'utf-8'
    )
  } catch {
    /* 写不进去就下次仍按默认 */
  }
}

const FORCE_SOFTWARE_RENDER = process.env['CA_SOFTWARE_RENDER'] === '1'

// GPU 子进程在某些环境（虚拟机/远程桌面/受限权限）会启动失败，
// Chromium 报 error_code=18 后直接 FATAL 退出，用户看到的就是「双击没反应」。
// 这里记录崩溃时间，下次启动自动退回软件渲染；10 分钟内有效，避免永久关掉加速。
function gpuCrashFlag(): string {
  return join(app.getPath('userData'), 'gpu-crashed.flag')
}

function gpuCrashedRecently(): boolean {
  try {
    const t = Number(readFileSync(gpuCrashFlag(), 'utf-8'))
    return Number.isFinite(t) && Date.now() - t < 10 * 60 * 1000
  } catch {
    return false
  }
}

function bootAttemptFile(): string {
  return join(app.getPath('userData'), 'boot-attempt.flag')
}

function bootOkFile(): string {
  return join(app.getPath('userData'), 'boot-ok.flag')
}

// 上次启动写了 attempt 但没写 ok → 说明启动过程中挂了（GPU FATAL 常常来不及触发事件）
function readNumFile(path: string): number | null {
  try {
    const v = Number(readFileSync(path, 'utf-8'))
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function lastBootFailed(): boolean {
  const attempted = readNumFile(bootAttemptFile())
  if (attempted === null) return false
  const ok = readNumFile(bootOkFile())
  // ok 文件不存在也算失败（不再因为读不到而 catch 成 false）
  return ok === null || ok < attempted
}

const LAST_BOOT_FAILED = lastBootFailed()
const GPU_CRASHED = gpuCrashedRecently() || LAST_BOOT_FAILED
if (LAST_BOOT_FAILED) {
  // 上次启动挂过：把「硬件加速」设置直接关掉并记下时间。
  // 不再尝试「隔一会儿再开」——那会导致每次启动都赌一把，用户看到的是随机打不开。
  try {
    writeFileSync(gpuCrashFlag(), String(Date.now()), 'utf-8')
    writeGpuPref(false)
  } catch {
    /* ignore */
  }
}
const GPU_ENABLED_AT_BOOT = readGpuPref() && !FORCE_SOFTWARE_RENDER && !GPU_CRASHED
if (!GPU_ENABLED_AT_BOOT) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
  // 注意：不要加 disable-software-rasterizer —— 关掉 GPU 后又关掉软件光栅化，
  // 结果是没有可用的渲染后端，窗口会直接起不来（实测进程退出）。
}

// 日志尽量早初始化，捕获「启动即崩」的场景（写入 %APPDATA%/CampusAssistant/main.log）
const LOG_FILE = initLogger()
log(`log file: ${LOG_FILE}`)
log(`argv: ${process.argv.join(' ')}`)

/**
 * 单实例锁。
 *
 * 两个实例会抢同一个 userData 目录（Cache / GPUCache / Session Storage），
 * 后启动的那个会刷一串：
 *   Unable to move the cache: 拒绝访问 (0x5)
 *   Unable to create cache / Gpu Cache Creation failed
 * 并且两个后端会抢同一个端口。
 *
 * 需要同时开「桌面安装版 + dev 版」做对比时，设 CA_MULTI_INSTANCE=1。
 */
const ALLOW_MULTI_INSTANCE = process.env['CA_MULTI_INSTANCE'] === '1'
if (!ALLOW_MULTI_INSTANCE && !app.requestSingleInstanceLock()) {
  log('另一个实例已在运行，本实例退出')
  console.log('[app] 检测到已有一个 CampusAssistant 在运行（可能是桌面安装版），本次启动已退出。')
  console.log('[app] 如需同时开 dev 版和安装版对比：set CA_MULTI_INSTANCE=1 && npm run dev')
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

/** 上次的主题（主进程侧持久化，用于在窗口创建前决定底色） */
function themeFile(): string {
  return join(app.getPath('userData'), 'theme.json')
}

function readTheme(): 'dark' | 'light' {
  try {
    const raw = readFileSync(themeFile(), 'utf-8')
    return JSON.parse(raw).theme === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function writeTheme(theme: 'dark' | 'light'): void {
  try {
    writeFileSync(themeFile(), JSON.stringify({ theme }), 'utf-8')
  } catch {
    /* 写不进去就算了，下次仍按缓存 */
  }
}

const WINDOW_BG = { dark: '#1a1c22', light: '#f7f8fa' } as const

/** 点右上角 × 时的行为：ask=每次询问 / tray=最小化到托盘 / quit=直接退出 */
type CloseAction = 'ask' | 'tray' | 'quit'

function closePrefFile(): string {
  return join(app.getPath('userData'), 'window-pref.json')
}

function readCloseAction(): CloseAction {
  try {
    // 文件可能被外部工具写成带 BOM 的 UTF-8，JSON.parse 会因为 BOM 直接抛错，
    // 那样「记住选择」就永远不生效，所以先去掉 BOM。
    const raw = readFileSync(closePrefFile(), 'utf-8').replace(/^\uFEFF/, '')
    const v = JSON.parse(raw).closeAction
    return v === 'tray' || v === 'quit' ? v : 'ask'
  } catch {
    return 'ask'
  }
}

function writeCloseAction(action: CloseAction): void {
  try {
    writeFileSync(closePrefFile(), JSON.stringify({ closeAction: action }), 'utf-8')
  } catch {
    /* 写不进去就下次继续询问 */
  }
}

let closePromptPending = false

/**
 * 点 × 时让渲染进程弹「应用内」对话框。
 * 不用 dialog.showMessageBox：原生框的字体/配色和界面不统一。
 */
function askCloseAction(): void {
  if (!mainWindow || closePromptPending) return
  closePromptPending = true
  mainWindow.webContents.send('app:close-request')
}

/** 渲染进程回传用户选择 */
function handleCloseResponse(action: 'tray' | 'quit' | 'cancel', remember: boolean): void {
  closePromptPending = false
  if (action === 'cancel') return
  if (remember) writeCloseAction(action)
  if (action === 'tray') {
    mainWindow?.hide()
    return
  }
  isQuitting = true
  // 同理：先销毁窗口再退出，避免 close 事件把退出流程拖住
  mainWindow?.destroy()
  app.quit()
}

/** 托盘菜单「退出」调用：走正常退出流程（会触发 before-quit 停后端） */
function quitApp(): void {
  isQuitting = true
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '',
    show: false,
    // 底色跟随上次主题：浅色模式重开时不会先黑一屏
    backgroundColor: WINDOW_BG[readTheme()],
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 不显示窗口标题：阻止页面 <title> 覆盖，并清空标题栏文字
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault()
    mainWindow?.setTitle('')
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 渲染进程日志转发到主进程日志文件，便于无 DevTools 场景排查。
  // Electron 37 把 console-message 改成了单参数事件对象（旧签名已弃用），
  // 这里两种签名都兼容，避免满屏 deprecation 警告。
  const wc = mainWindow.webContents as unknown as {
    on: (event: 'console-message', listener: (...args: unknown[]) => void) => void
  }
  wc.on('console-message', (...args: unknown[]) => {
    const evt = args[0] as { level?: unknown; message?: unknown } | undefined
    const level = evt?.level ?? args[1] ?? 0
    const message = typeof evt?.message === 'string' ? evt.message : String(args[2] ?? '')
    log(`[renderer:${String(level)}] ${message}`)
  })

  // 点 × 时询问：最小化到托盘 / 直接退出（记住选择后不再问）
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    const pref = readCloseAction()
    log(`close: pref=${pref} file=${closePrefFile()}`)
    if (pref === 'tray') {
      mainWindow?.hide()
      return
    }
    if (pref === 'quit') {
      isQuitting = true
      // close 事件里已经 preventDefault 过，此时直接 app.quit() 会卡住
      // （实测：before-quit 触发、后端已停，但进程不退出）。
      // 先 destroy 掉窗口绕过 close 事件，再退出就干净了。
      mainWindow?.destroy()
      app.quit()
      return
    }
    askCloseAction()
  })

  // 首屏加载完成 = 本次启动是健康的；下次启动就不会误判成崩溃
  mainWindow.webContents.on('did-finish-load', () => {
    try {
      writeFileSync(bootOkFile(), String(Date.now()), 'utf-8')
    } catch {
      /* ignore */
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  createTray(mainWindow, quitApp)
}

async function autoCheckUpdate(): Promise<void> {
  try {
    const res = await fetch('https://api.github.com/repos/SillyJay/todolist/releases/latest', {
      headers: { 'User-Agent': 'ToDoList' }
    })
    if (!res.ok) return
    const data = (await res.json()) as { tag_name?: string }
    const latest = String(data.tag_name || '').replace(/^v/, '')
    const current = app.getVersion()
    if (!latest || latest === current) return
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title: 'ToDoList 有新版本',
        body: `当前 ${current}，最新 ${latest}。设置 → 版本更新 可下载。`
      }).show()
    }
    log(`[update] 发现新版本 ${latest}（当前 ${current}）`)
  } catch {
    /* 静默 */
  }
}

app.whenReady().then(async () => {
  log('app ready')
  try {
    writeFileSync(bootAttemptFile(), String(Date.now()), 'utf-8')
  } catch {
    /* ignore */
  }
  try {
    const st = app.getGPUFeatureStatus()
    log(
      `gpu: software=${!GPU_ENABLED_AT_BOOT} compositing=${st.gpu_compositing || '-'} rasterization=${st.rasterization || '-'}`
    )
  } catch {
    /* 老版本没有该 API */
  }
  electronApp.setAppUserModelId('com.campusassistant.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC 先注册，避免渲染进程抢先请求时拿不到（端口从后端管理器实时读取）
  ipcMain.handle('backend:getPort', () => getBackendPort())
  ipcMain.handle('backend:getBaseUrl', () => `http://127.0.0.1:${getBackendPort()}/api`)
  ipcMain.handle('login:open', async (_e, platform: 'xiaoya' | 'chaoxing') =>
    openLoginWindow(platform, mainWindow, `http://127.0.0.1:${getBackendPort()}/api`)
  )

// ---------------------------------------------------------------- 开机自启
// 便携版每次解压到临时目录，process.execPath 会失效；
// electron-builder 会注入 PORTABLE_EXECUTABLE_FILE，指向用户双击的那个 exe。
function startupDir(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

function realExePath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
}

function tunnelExePath(): string {
  const dev = join(app.getAppPath(), '..', 'tools', 'dev', 'cloudflared.exe')
  if (existsSync(dev)) return dev
  return join(process.resourcesPath, 'cloudflared.exe')
}

function makeShortcut(lnkPath: string, target: string, args: string, wd: string): void {
  const ps = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut(${JSON.stringify(lnkPath)})`,
    `$s.TargetPath = ${JSON.stringify(target)}`,
    `$s.Arguments = ${JSON.stringify(args)}`,
    `$s.WorkingDirectory = ${JSON.stringify(wd)}`,
    '$s.Save()'
  ].join('; ')
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true })
}


  ipcMain.handle('app:getAutostart', () => ({
    app: existsSync(join(startupDir(), 'ToDoList.lnk')),
    tunnel: existsSync(join(startupDir(), 'ToDoList-Tunnel.lnk')),
    tunnelAvailable: existsSync(tunnelExePath())
  }))

  ipcMain.handle('app:setAutostart', (_e, kind: 'app' | 'tunnel', enabled: boolean) => {
    try {
      const dir = startupDir()
      mkdirSync(dir, { recursive: true })
      if (kind === 'app') {
        const lnk = join(dir, 'ToDoList.lnk')
        if (enabled) {
          const exe = realExePath()
          makeShortcut(lnk, exe, '', dirname(exe))
        } else if (existsSync(lnk)) {
          rmSync(lnk, { force: true })
        }
        return { ok: true }
      }

      const lnk = join(dir, 'ToDoList-Tunnel.lnk')
      if (!enabled) {
        if (existsSync(lnk)) rmSync(lnk, { force: true })
        return { ok: true }
      }
      const exe = tunnelExePath()
      if (!existsSync(exe)) {
        return { ok: false, message: '没找到 cloudflared.exe（打包版需把它放进 resources）' }
      }
      const cfg = join(app.getPath('home'), '.cloudflared', 'config.yml')
      makeShortcut(lnk, exe, `tunnel --config "${cfg}" run todo`, dirname(exe))
      return { ok: true }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  })

  ipcMain.handle('app:openAutostartFolder', async () => {
    await shell.openPath(startupDir())
    return { ok: true }
  })



  ipcMain.handle('app:downloadUpdate', async () => {
    try {
      const rel = await fetch('https://api.github.com/repos/SillyJay/todolist/releases/latest', {
        headers: { 'User-Agent': 'ToDoList' }
      })
      if (!rel.ok) return { ok: false, message: `获取版本失败（HTTP ${rel.status}）` }
      const data = (await rel.json()) as {
        assets?: { name?: string; browser_download_url?: string }[]
      }
      const asset = (data.assets || []).find(
        (a) => /portable\.exe$/i.test(a.name || '') || /setup\.exe$/i.test(a.name || '')
      )
      if (!asset?.browser_download_url) return { ok: false, message: '这个版本没有可下载的安装包' }

      const dir = app.getPath('downloads')
      const target = join(dir, asset.name || 'ToDoList-update.exe')
      const res = await fetch(asset.browser_download_url)
      if (!res.ok || !res.body) return { ok: false, message: `下载失败（HTTP ${res.status}）` }
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(target, buf)
      return { ok: true, path: target, name: asset.name, size: buf.length }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  })

  ipcMain.handle('app:showInFolder', async (_e, target: string) => {
    shell.showItemInFolder(target)
    return { ok: true }
  })

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const res = await fetch('https://api.github.com/repos/SillyJay/todolist/releases/latest', {
        headers: { 'User-Agent': 'ToDoList' }
      })
      if (!res.ok) return { ok: false, message: `检查失败（HTTP ${res.status}）` }
      const data = (await res.json()) as { tag_name?: string; html_url?: string; prerelease?: boolean }
      const latest = String(data.tag_name || '').replace(/^v/, '')
      const current = app.getVersion()
      const newer = latest && latest !== current && latest > current
      return {
        ok: true,
        current,
        latest,
        url: data.html_url || '',
        newer: Boolean(newer)
      }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  })

  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (!/^https:\/\//.test(url || '')) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())
  // 渲染进程取本机密钥（隧道场景下用它证明「我是桌面端」）
  ipcMain.handle('app:getAdminToken', () => getAdminToken())
  // 局域网 IP：手机配对二维码里要用它，手机才连得到这台电脑
  ipcMain.handle('app:getLanIp', () => {
    const nets = os.networkInterfaces()
    for (const list of Object.values(nets)) {
      for (const it of list || []) {
        if (it.family === 'IPv4' && !it.internal) return it.address
      }
    }
    return ''
  })
  ipcMain.handle('app:getCloseAction', () => readCloseAction())
  // 选目录（微信数据目录这类必须让用户自己挑的场景）
  ipcMain.handle('dialog:pickDirectory', async (_e, title?: string) => {
    if (!mainWindow) return ''
    const r = await dialog.showOpenDialog(mainWindow, {
      title: title || '选择目录',
      properties: ['openDirectory', 'dontAddToRecent']
    })
    if (r.canceled || !r.filePaths.length) return ''
    return r.filePaths[0]
  })

  ipcMain.handle('app:getGpu', () => ({
    enabled: readGpuPref(),
    active: GPU_ENABLED_AT_BOOT,
    forcedByEnv: FORCE_SOFTWARE_RENDER
  }))
  ipcMain.handle('app:setGpu', (_e, enabled: boolean) => {
    writeGpuPref(Boolean(enabled))
    return { restartRequired: Boolean(enabled) !== GPU_ENABLED_AT_BOOT }
  })
  ipcMain.handle('app:relaunch', () => {
    // 先停后端，避免重启后旧进程占着端口
    isQuitting = true
    try {
      stopBackend()
    } catch {
      /* ignore */
    }
    app.relaunch()
    app.exit(0)
    return { ok: true }
  })
  ipcMain.handle('app:closeResponse', (_e, action: 'tray' | 'quit' | 'cancel', remember: boolean) => {
    handleCloseResponse(action, Boolean(remember))
    return { ok: true }
  })
  ipcMain.handle('app:setCloseAction', (_e, action: CloseAction) => {
    if (action === 'ask' || action === 'tray' || action === 'quit') writeCloseAction(action)
    return readCloseAction()
  })
  // 主题变化：落盘 + 立刻改窗口底色（下次启动就不用先黑一屏）
  ipcMain.on('theme:set', (_e, theme: 'dark' | 'light') => {
    if (theme !== 'light' && theme !== 'dark') return
    writeTheme(theme)
    try {
      mainWindow?.setBackgroundColor(WINDOW_BG[theme])
    } catch {
      /* 窗口已销毁时忽略 */
    }
  })

  // 启动 Python 后端子进程
  // 每次启动生成新的本机密钥（进程内有效，不落盘）
  const adminToken = randomBytes(24).toString('hex')
  const port = await startBackend(adminToken)
  log(`backend port=${port}`)

  createWindow()
  log('window created')

  // DDL 到点提醒（规格模块 1）
  setTimeout(() => void autoCheckUpdate(), 20_000)

  startNotificationWatcher(
    () => mainWindow,
    () => `http://127.0.0.1:${getBackendPort()}/api`
  )

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 托盘常驻：所有窗口关闭时不退出；真正退出走托盘菜单
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 保持托盘运行，不 app.quit()
  }
})

app.on('child-process-gone', (_e, details) => {
  if (details.type === 'GPU' && (details.reason === 'crashed' || details.reason === 'launch-failed')) {
    try {
      writeFileSync(gpuCrashFlag(), String(Date.now()), 'utf-8')
    } catch {
      /* 写不进去就下次再试 */
    }
    log(`GPU 子进程异常（${details.reason}），下次启动将自动改用软件渲染`)
  }
})

app.on('before-quit', () => {
  isQuitting = true
  log(`before-quit: windows=${BrowserWindow.getAllWindows().length}`)
  stopNotificationWatcher()
  stopBackend()
})

app.on('will-quit', () => {
  log('will-quit')
})

app.on('quit', () => {
  log('quit event')
})
