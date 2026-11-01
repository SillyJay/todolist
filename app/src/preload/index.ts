import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 暴露给渲染进程的安全 API
const api = {
  getBackendBaseUrl: (): Promise<string> => ipcRenderer.invoke('backend:getBaseUrl'),
  /** 主题变化时通知主进程，用于下次启动时的窗口底色（消除浅色模式闪黑） */
  setTheme: (theme: 'dark' | 'light'): void => ipcRenderer.send('theme:set', theme),
  /** 本机密钥（请求后端时带在 X-Admin-Token 头里） */
  getAdminToken: (): Promise<string> => ipcRenderer.invoke('app:getAdminToken'),
  /** 局域网 IP（手机配对二维码用） */
  getLanIp: (): Promise<string> => ipcRenderer.invoke('app:getLanIp'),
  /** 应用版本号（设置页「常规」里显示） */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  /** 开机自启状态：app=桌面端，tunnel=访问隧道 */
  getAutostart: (): Promise<{ app: boolean; tunnel: boolean; tunnelAvailable: boolean }> =>
    ipcRenderer.invoke('app:getAutostart'),
  setAutostart: (
    kind: 'app' | 'tunnel',
    enabled: boolean
  ): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('app:setAutostart', kind, enabled),
  openAutostartFolder: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:openAutostartFolder'),
  /** 关闭窗口行为：ask / tray / quit */
  getCloseAction: (): Promise<'ask' | 'tray' | 'quit'> => ipcRenderer.invoke('app:getCloseAction'),
  setCloseAction: (action: 'ask' | 'tray' | 'quit'): Promise<'ask' | 'tray' | 'quit'> =>
    ipcRenderer.invoke('app:setCloseAction', action),
  /** 打开系统目录选择框；取消返回空字符串 */
  pickDirectory: (title?: string): Promise<string> =>
    ipcRenderer.invoke('dialog:pickDirectory', title),
  /** 主进程请求弹「关闭确认」框；返回取消订阅函数 */
  onCloseRequest: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:close-request', handler)
    return () => ipcRenderer.removeListener('app:close-request', handler)
  },
  /** 硬件加速：enabled=用户设置，active=本次启动实际状态，forcedByEnv=被环境变量强制关闭 */
  getGpu: (): Promise<{ enabled: boolean; active: boolean; forcedByEnv: boolean }> =>
    ipcRenderer.invoke('app:getGpu'),
  setGpu: (enabled: boolean): Promise<{ restartRequired: boolean }> =>
    ipcRenderer.invoke('app:setGpu', enabled),
  /** 立即重启应用（硬件加速开关需要重启才生效） */
  relaunch: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:relaunch'),
  /** 回传用户选择：tray / quit / cancel */
  respondClose: (action: 'tray' | 'quit' | 'cancel', remember: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:closeResponse', action, remember),
  openLogin: (
    platform: 'xiaoya' | 'chaoxing'
  ): Promise<{ ok: boolean; message: string; count?: number }> =>
    ipcRenderer.invoke('login:open', platform)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
