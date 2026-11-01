// 生成 ToDoList 的应用图标与启动图（用 sharp 把 SVG 转 PNG）
// 用法：node tools/dev/make-icon.mjs

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// sharp 的入口是 CJS，从 mobile 目录解析
const sharp = require('../../mobile/node_modules/sharp/dist/index.cjs')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const assets = join(root, 'mobile', 'assets')

const BLACK = '#000000'
const WHITE = '#ffffff'
const BLUE = '#2F6BFF' // 备用：以后想加点缀再用

/** 图标主体：圆角方块 + 对勾 + 右上角蓝点 */
function iconSvg({ size = 1024, background = BLACK, checkOnly = false } = {}) {
  // 对勾坐标（以 1024 为基准）
  const stroke = checkOnly ? 96 : 104
  const points = '212,556 400,742 812,300'
  const bg = checkOnly
    ? ''
    : `<rect x="0" y="0" width="1024" height="1024" rx="226" fill="${background}"/>`
  const dot = ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${bg}
  <polyline points="${points}" fill="none" stroke="${WHITE}" stroke-width="${stroke}"
    stroke-linecap="round" stroke-linejoin="round"/>
  ${dot}
</svg>`
}

/** 启动图：纯色背景 + 居中图标 */
function splashSvg(bg, fg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  <rect width="2732" height="2732" fill="${bg}"/>
  <g transform="translate(1366 1366) scale(0.62) translate(-512 -512)">
    <rect x="0" y="0" width="1024" height="1024" rx="226" fill="${fg}"/>
    <polyline points="212,556 400,742 812,300" fill="none" stroke="${bg}" stroke-width="104"
      stroke-linecap="round" stroke-linejoin="round"/>

  </g>
</svg>`
}

async function render(svg, file, size) {
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
  await writeFile(file, buf)
  console.log(`  ${file.replace(root + '\\', '')}  ${Math.round(buf.length / 1024)} KB`)
}

async function main() {
  await mkdir(assets, { recursive: true })
  console.log('生成图标资源：')

  await render(iconSvg(), join(assets, 'icon-only.png'), 1024)
  await render(iconSvg(), join(assets, 'icon.png'), 1024)
  await render(iconSvg({ checkOnly: true }), join(assets, 'icon-foreground.png'), 1024)

  // 背景层：纯黑
  const bgBuf = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: BLACK }
  })
    .png()
    .toBuffer()
  await writeFile(join(assets, 'icon-background.png'), bgBuf)
  console.log(`  mobile/assets/icon-background.png  ${Math.round(bgBuf.length / 1024)} KB`)

  await render(splashSvg(WHITE, BLACK), join(assets, 'splash.png'), 2732)
  await render(splashSvg(BLACK, WHITE), join(assets, 'splash-dark.png'), 2732)

  console.log('完成')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
