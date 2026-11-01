import { flushSync } from 'react-dom'

export type VtDir = 'up' | 'down' | 'left' | 'right'
export type VtScope = 'page' | 'calendar' | 'settings'

const TARGET: Record<VtScope, string> = {
  page: '.page-scroll',
  calendar: '.cal-body',
  settings: '.settings-content'
}

const INCOMING: Record<VtScope, string> = {
  page: '.page-stage',
  calendar: '.cal-body',
  settings: '.settings-content'
}

const OUT_MS = 280
const IN_MS = 430
const LOCK_MS = 580
const EASE_OUT = 'cubic-bezier(.32,.72,0,1)'
const EASE_IN = 'cubic-bezier(.16,1,.3,1)'

/** 位移向量：整块内容走满，才看得出「板块在移动」而不是文字淡入 */
const OUT_VEC: Record<VtDir, [number, number]> = {
  up: [0, -88],
  down: [0, 88],
  left: [-104, 0],
  right: [104, 0]
}

const IN_VEC: Record<VtDir, [number, number]> = {
  up: [0, 92],
  down: [0, -92],
  left: [108, 0],
  right: [-108, 0]
}

let seq = 0
let ghost: HTMLElement | null = null
let ghostMount: HTMLElement | null = null
let ghostAnimation: Animation | null = null
let unlockTimer = 0

function keyframes(dir: VtDir, kind: 'out' | 'in'): Keyframe[] {
  const [x, y] = kind === 'out' ? OUT_VEC[dir] : IN_VEC[dir]
  if (kind === 'out') {
    return [
      { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
      {
        opacity: 0.94,
        transform: `translate3d(${x * 0.5}px,${y * 0.5}px,0) scale(.996)`,
        offset: 0.42
      },
      { opacity: 0, transform: `translate3d(${x}px,${y}px,0) scale(.988)` }
    ]
  }
  return [
    { opacity: 0, transform: `translate3d(${x}px,${y}px,0) scale(.988)` },
    {
      opacity: 1,
      transform: `translate3d(${x * 0.14}px,${y * 0.14}px,0) scale(1)`,
      offset: 0.52
    },
    { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
  ]
}

/** 快照只负责被看，不参与交互，也不该被引导高亮或测试选择器命中 */
function scrub(node: HTMLElement): void {
  node.removeAttribute('id')
  node.removeAttribute('data-guide')
  node.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  node.querySelectorAll('[data-guide]').forEach((el) => el.removeAttribute('data-guide'))
}

/**
 * 节点数超过这个量就不做「克隆整页」的过场了：
 * 复制几千个节点 + 一次大位移动画，在低端机和软件渲染下反而是卡顿来源。
 */
const GHOST_NODE_LIMIT = 1200

function makeGhost(host: HTMLElement, scope: VtScope): HTMLElement | null {
  if (host.querySelectorAll('*').length > GHOST_NODE_LIMIT) return null
  // 挂进主面板而不是 body：面板自带 overflow:hidden，快照会被裁在内容区内，
  // AI 面板折叠/展开时也不会盖到旁边的栏
  const mount = (host.closest('.main-panel') as HTMLElement | null) ?? document.body
  const rect = host.getBoundingClientRect()
  const base = mount.getBoundingClientRect()
  const node = host.cloneNode(true) as HTMLElement
  scrub(node)
  node.classList.add('swap-ghost')
  node.dataset.scope = scope
  node.setAttribute('aria-hidden', 'true')
  node.inert = true
  node.style.left = `${Math.round(rect.left - base.left - mount.clientLeft)}px`
  node.style.top = `${Math.round(rect.top - base.top - mount.clientTop)}px`
  node.style.width = `${Math.round(rect.width)}px`
  node.style.height = `${Math.round(Math.min(rect.height, window.innerHeight))}px`
  // 快照不显示滚动条，但原容器为滚动条预留了宽度；把这段补进右内边距，内容才不会横向跳一下
  const cs = window.getComputedStyle(host)
  const gutter = Math.max(0, host.offsetWidth - host.clientWidth)
  if (gutter > 0) node.style.paddingRight = `${parseFloat(cs.paddingRight || '0') + gutter}px`
  ghostMount = mount
  return node
}

function release(keepGhost = false): void {
  if (!keepGhost) {
    ghostAnimation?.cancel()
    ghostAnimation = null
    ghost?.remove()
    ghost = null
    ghostMount = null
  }
  // 注意：这里**故意不移除** .vt-in。
  // 移除会让 CSS 入场动画（pageSwap / blockEnter）重新生效并从 0 帧再播一遍，
  // 表现就是「打开页面后过一会儿整块闪一下」。
  // 下一次切页是全新元素（React key），会重新带上这个类，不会累积。
  if (unlockTimer) {
    window.clearTimeout(unlockTimer)
    unlockTimer = 0
  }
}

/**
 * 带方向的整块过场。
 *
 * 先把当前容器克隆成一层快照，再在同一帧里切换真实内容：
 * 旧层朝离开方向滑出（带投影，读得出一整块板在移动），新内容从进入方向滑入。
 * 动画走 Web Animations API，不依赖 View Transitions、也不受 CSS 类名切换影响。
 * 后一次切换会立即收掉上一次的层，快速连点也不会互相叠加。
 * 系统要求减少动效时降级为极短交叉淡入、不做位移。
 */
export function withViewTransition(scope: VtScope, dir: VtDir, update: () => void): void {
  const host = document.querySelector<HTMLElement>(TARGET[scope])
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  if (!host) {
    update()
    return
  }

  const mine = ++seq
  release()

  const scrollTop = host.scrollTop
  const node = makeGhost(host, scope)
  if (!node) {
    // 页面太重：跳过位移动画，直接切内容（避免为了好看反而卡一下）
    update()
    return
  }
  ghostMount?.appendChild(node)
  // 挂上 DOM 再有布局，滚到原来的位置，快照才和用户看到的画面一致
  if (scrollTop > 0) node.scrollTop = scrollTop
  ghost = node

  ghostAnimation = node.animate(
    reduced ? [{ opacity: 1 }, { opacity: 0 }] : keyframes(dir, 'out'),
    {
      duration: reduced ? 140 : OUT_MS,
      easing: reduced ? 'linear' : EASE_OUT,
      fill: 'forwards'
    }
  )
  ghostAnimation.finished.then(
    () => {
      if (mine !== seq) return
      ghost?.remove()
      ghost = null
      ghostAnimation = null
    },
    () => undefined
  )

  try {
    flushSync(update)
  } catch {
    update()
  }

  const target = document.querySelector<HTMLElement>(INCOMING[scope])
  if (target) {
    // 新元素挂载时自带的 CSS 入场动画会让位移叠加变糊，这段过场交给 WAAPI 独奏
    target.classList.add('vt-in')
    target.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : keyframes(dir, 'in'), {
      duration: reduced ? 180 : IN_MS,
      easing: reduced ? 'linear' : EASE_IN
    })
  }

  // 兜底：窗口隐藏时 WAAPI 回调可能延迟，快照与类名必须按时释放
  unlockTimer = window.setTimeout(() => {
    if (mine !== seq) return
    release()
  }, LOCK_MS)
}
