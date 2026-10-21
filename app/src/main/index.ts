import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startBackend, stopBackend, getBackendPort } from './backend'
import { createTray } from './tray'
import { initLogger, log } from './logger'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// 虚拟显示适配器 / 远程桌面环境下 GPU 子进程可能无法启动（error_code=18），
// 表现为进程静默退出。这里彻底关闭 GPU 并把渲染留在主进程内。
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

// 日志尽量早初始化，捕获「启动即崩」的场景（写入 %APPDATA%/CampusAssistant/main.log）
const LOG_FILE = initLogger()
log(`log file: ${LOG_FILE}`)
log(`argv: ${process.argv.join(' ')}`)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '校园信息管理助手',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 渲染进程日志转发到主进程日志文件，便于无 DevTools 场景排查
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    log(`[renderer:${level}] ${message}`)
  })

  // 关闭窗口最小化到托盘，不退出（规格模块 1）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
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

  createTray(mainWindow)
}

app.whenReady().then(async () => {
  log('app ready')
  electronApp.setAppUserModelId('com.campusassistant.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC 先注册，避免渲染进程抢先请求时拿不到（端口从后端管理器实时读取）
  ipcMain.handle('backend:getPort', () => getBackendPort())
  ipcMain.handle('backend:getBaseUrl', () => `http://127.0.0.1:${getBackendPort()}/api`)

  // 启动 Python 后端子进程
  const port = await startBackend()
  log(`backend port=${port}`)

  createWindow()
  log('window created')

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

app.on('before-quit', () => {
  isQuitting = true
  stopBackend()
})
