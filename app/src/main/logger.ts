/**
 * 主进程文件日志（排查启动崩溃用）
 * 写入 %APPDATA%/CampusAssistant/main.log，便于用户在 GUI 无输出时提供现场。
 */
import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

let logFile: string | null = null

export function initLogger(): string {
  try {
    const dir = join(app.getPath('appData'), 'CampusAssistant')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
    log('=== main process start ===')
    log(`electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}`)
    log(`platform=${process.platform} arch=${process.arch}`)

    process.on('uncaughtException', (err) => {
      log(`[uncaughtException] ${err?.stack ?? err}`)
    })
    process.on('unhandledRejection', (reason) => {
      log(`[unhandledRejection] ${String(reason)}`)
    })
    return logFile
  } catch (e) {
    return String(e)
  }
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  console.log(msg)
  if (logFile) {
    try {
      appendFileSync(logFile, line, 'utf8')
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  }
}
