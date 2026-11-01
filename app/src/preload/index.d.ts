import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  /** 本机密钥 */
  getAdminToken: () => Promise<string>
  getAutostart: () => Promise<{ app: boolean; tunnel: boolean; tunnelAvailable: boolean }>
  setAutostart: (kind: 'app' | 'tunnel', enabled: boolean) => Promise<{ ok: boolean; message?: string }>
  openAutostartFolder: () => Promise<{ ok: boolean }>
  /** 局域网 IPv4（手机配对二维码用） */
  getLanIp: () => Promise<string>
  getBackendBaseUrl: () => Promise<string>
  setTheme: (theme: 'dark' | 'light') => void
  getVersion: () => Promise<string>
  getCloseAction: () => Promise<'ask' | 'tray' | 'quit'>
  setCloseAction: (action: 'ask' | 'tray' | 'quit') => Promise<'ask' | 'tray' | 'quit'>
  onCloseRequest: (cb: () => void) => () => void
  pickDirectory: (title?: string) => Promise<string>
  getGpu: () => Promise<{ enabled: boolean; active: boolean; forcedByEnv: boolean }>
  setGpu: (enabled: boolean) => Promise<{ restartRequired: boolean }>
  relaunch: () => Promise<{ ok: boolean }>
  respondClose: (action: 'tray' | 'quit' | 'cancel', remember: boolean) => Promise<{ ok: boolean }>
  openLogin: (
    platform: 'xiaoya' | 'chaoxing'
  ) => Promise<{ ok: boolean; message: string; count?: number }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
