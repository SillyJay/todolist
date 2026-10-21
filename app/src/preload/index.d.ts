import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  getBackendBaseUrl: () => Promise<string>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
