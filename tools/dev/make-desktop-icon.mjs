// 生成桌面端使用的图标（build/icon.png 给 electron-builder，resources/icon.png 给窗口/托盘）
// 用法：node tools/dev/make-desktop-icon.mjs

import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('../../mobile/node_modules/sharp/dist/index.cjs')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const appDir = join(root, 'app')

// 与手机端同款：黑底圆角 + 白色对勾
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="0" y="0" width="1024" height="1024" rx="226" fill="#000000"/>
  <polyline points="212,556 400,742 812,300" fill="none" stroke="#ffffff" stroke-width="104"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

async function main() {
  await mkdir(join(appDir, 'build'), { recursive: true })
  await mkdir(join(appDir, 'resources'), { recursive: true })

  for (const [file, size] of [
    [join(appDir, 'build', 'icon.png'), 1024],
    [join(appDir, 'resources', 'icon.png'), 512]
  ]) {
    const buf = await sharp(Buffer.from(svg(size))).resize(size, size).png().toBuffer()
    await writeFile(file, buf)
    console.log(`  ${file.replace(root + '\\', '')}  ${Math.round(buf.length / 1024)} KB`)
  }

  // 旧的 ico/icns 会被 electron-builder 优先使用，删掉让它从 png 生成
  for (const stale of ['icon.ico', 'icon.icns']) {
    await rm(join(appDir, 'build', stale), { force: true })
  }
  console.log('已删除旧的 icon.ico / icon.icns')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
