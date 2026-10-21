import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  getBackendBaseUrl: () => Promise<string>
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
