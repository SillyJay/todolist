import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 暴露给渲染进程的安全 API
const api = {
  getBackendBaseUrl: (): Promise<string> => ipcRenderer.invoke('backend:getBaseUrl'),
  openLogin: (platform: 'xiaoya' | 'chaoxing'): Promise<{ ok: boolean; message: string; count?: number }> =>
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
