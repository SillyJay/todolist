/**
 * Python 后端子进程生命周期管理（规格模块 1 / §2.1）
 * - 启动时拉起；端口冲突自动顺延（8765→8766…）
 * - 每 30s 健康检查 GET /health；崩溃自动重启（最多 3 次）
 * - 退出时 terminate
 */
import { spawn, ChildProcess } from 'child_process'
import { createServer } from 'net'
import { join } from 'path'
import { app } from 'electron'
import { log } from './logger'

const BASE_PORT = 8765
const HEALTH_INTERVAL_MS = 30_000
const MAX_RESTART = 3

let child: ChildProcess | null = null
let currentPort = BASE_PORT
let restartCount = 0
let healthTimer: NodeJS.Timeout | null = null
let quitting = false

/** 探测可用端口：从 8765 起顺延 */
function findFreePort(port: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(findFreePort(port + 1)))
    srv.once('listening', () => srv.close(() => resolve(port)))
    srv.listen(port, '127.0.0.1')
  })
}

/** 后端启动命令：开发期跑 venv python + server/main.py；打包后跑 PyInstaller exe */
function backendCommand(port: number): { cmd: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    const exe = join(process.resourcesPath, 'backend', 'campus-assistant-server.exe')
    return { cmd: exe, args: ['--port', String(port)], cwd: process.resourcesPath }
  }
  // 开发环境：候选 Python 解释器（优先级从上到下）
  const serverDir = join(app.getAppPath(), '..', 'server')
  const candidates = [
    process.env.BACKEND_PYTHON,
    join(serverDir, '.venv', 'Scripts', 'python.exe'),
    // 托管运行时环境（本机 D:\HOMEWORK 上 venv 启动异常的规避方案）
    join(process.env.USERPROFILE ?? '', '.workbuddy', 'binaries', 'python', 'envs', 'campus-assistant', 'Scripts', 'python.exe')
  ].filter(Boolean) as string[]
  const cmd = candidates.find((p) => require('fs').existsSync(p)) ?? 'python'
  return { cmd, args: [join(serverDir, 'main.py'), '--port', String(port)], cwd: serverDir }
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${currentPort}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

export async function startBackend(): Promise<number> {
  currentPort = await findFreePort(BASE_PORT)
  const { cmd, args, cwd } = backendCommand(currentPort)
  log(`[backend] starting: ${cmd} ${args.join(' ')}`)
  child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (d) => log(`[backend:out] ${String(d).trim()}`))
  child.stderr?.on('data', (d) => log(`[backend:err] ${String(d).trim()}`))
  child.on('exit', (code) => {
    log(`[backend] exited code=${code}`)
    if (!quitting && restartCount < MAX_RESTART) {
      restartCount++
      log(`[backend] restarting (${restartCount}/${MAX_RESTART})...`)
      startBackend()
    } else if (!quitting) {
      log('[backend] restart limit reached, please check logs')
    }
  })

  // 等待健康（最多 15s）
  for (let i = 0; i < 30; i++) {
    if (await checkHealth()) {
      restartCount = 0
      startHealthCheck()
      log(`[backend] healthy on port ${currentPort}`)
      return currentPort
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  log('[backend] health check timeout')
  return currentPort
}

function startHealthCheck(): void {
  if (healthTimer) clearInterval(healthTimer)
  healthTimer = setInterval(async () => {
    const ok = await checkHealth()
    if (!ok) log('[backend] health check failed')
  }, HEALTH_INTERVAL_MS)
}

export function stopBackend(): void {
  quitting = true
  if (healthTimer) clearInterval(healthTimer)
  if (child && !child.killed) {
    child.kill()
    child = null
  }
}

export function getBackendPort(): number {
  return currentPort
}
