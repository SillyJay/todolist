/**
 * Windows 托盘常驻（规格模块 1）
 * 菜单：打开主界面 / 今日待办数 / 退出
 * TODO Phase 1：今日待办数从后端 /api/tasks?status=pending 拉取
 */
import { Tray, Menu, BrowserWindow, nativeImage, app } from 'electron'
import { join } from 'path'

let tray: Tray | null = null

export function createTray(mainWindow: BrowserWindow, onQuit?: () => void): void {
  const icon = nativeImage.createFromPath(
    join(app.getAppPath(), 'resources', 'icon.png')
  ).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('ToDoList')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    { label: '今日待办: -', enabled: false }, // TODO Phase 1: 动态更新
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        // 走正常退出流程（会触发 before-quit 停掉后端子进程）；
        // app.exit(0) 会跳过这些钩子，可能留下孤儿进程。
        if (onQuit) onQuit()
        else app.exit(0)
      }
    }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    mainWindow.show()
    mainWindow.focus()
  })
}
