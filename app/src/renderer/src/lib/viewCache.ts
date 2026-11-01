/**
 * 页面级「上次看到的画面」缓存。
 *
 * 切页时页面组件会被卸载重挂，如果每次都从 loading 空态开始，用户看到的
 * 是一下白/一下空再出内容 —— 这就是最明显的闪动来源。这里把上一份渲染数据
 * 留在内存里，重挂时先画旧内容，再静默拉新数据覆盖，等下一次真实变化再更新。
 *
 * 只存内存、不落盘；条目数有上限，避免长时间使用后无限增长。
 */
const LIMIT = 40

const buckets = new Map<string, unknown>()

export function readViewCache<T>(key: string): T | undefined {
  return buckets.get(key) as T | undefined
}

export function writeViewCache<T>(key: string, value: T): void {
  // 重新写入时挪到队尾，保证常用的快照不被淘汰
  buckets.delete(key)
  buckets.set(key, value)
  while (buckets.size > LIMIT) {
    const oldest = buckets.keys().next().value
    if (oldest === undefined) break
    buckets.delete(oldest)
  }
}
