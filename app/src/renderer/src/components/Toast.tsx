import { useEffect, useState } from 'react'
import { Check, Info } from 'lucide-react'

type Kind = 'success' | 'info' | 'error'
interface ToastItem {
  id: number
  msg: string
  kind: Kind
}

let seq = 0
let items: ToastItem[] = []
const listeners = new Set<(list: ToastItem[]) => void>()

function emit(): void {
  listeners.forEach((fn) => fn(items))
}

/** 轻量提示：任意组件/模块都可调用，无需 provider */
export function toast(msg: string, kind: Kind = 'success'): void {
  const id = ++seq
  items = [...items, { id, msg, kind }].slice(-4)
  emit()
  window.setTimeout(() => {
    items = items.filter((i) => i.id !== id)
    emit()
  }, 2800)
}

export default function ToastHost(): React.JSX.Element {
  const [list, setList] = useState<ToastItem[]>(items)

  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])

  return (
    <div className="toast-stack" aria-live="polite">
      {list.map((t) => (
        <div className="toast" key={t.id} data-kind={t.kind}>
          {t.kind === 'info' ? (
            <Info size={13} className="icon" />
          ) : (
            <Check size={13} className="icon" />
          )}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
