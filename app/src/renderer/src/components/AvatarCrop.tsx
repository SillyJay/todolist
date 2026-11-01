import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  file: File
  onCancel: () => void
  onDone: (dataUrl: string) => void
}

const BOX = 240 // 预览框边长
const OUT = 256 // 输出边长

/** 简易头像裁剪：拖动移动、滑杆缩放，导出 256×256 JPEG */
export default function AvatarCrop({ file, onCancel, onDone }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setOffset({ x: 0, y: 0 })
      setZoom(1)
      setReady(true)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !ready) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = Math.max(BOX / img.width, BOX / img.height) * zoom
    const w = img.width * scale
    const h = img.height * scale
    const x = (BOX - w) / 2 + offset.x
    const y = (BOX - h) / 2 + offset.y
    ctx.clearRect(0, 0, BOX, BOX)
    ctx.drawImage(img, x, y, w, h)
  }, [zoom, offset, ready])

  const exportImage = (): void => {
    const img = imgRef.current
    if (!img) return
    const out = document.createElement('canvas')
    out.width = OUT
    out.height = OUT
    const ctx = out.getContext('2d')
    if (!ctx) return
    const k = OUT / BOX
    const scale = Math.max(BOX / img.width, BOX / img.height) * zoom * k
    const w = img.width * scale
    const h = img.height * scale
    const x = (OUT - w) / 2 + offset.x * k
    const y = (OUT - h) / 2 + offset.y * k
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, OUT, OUT)
    ctx.drawImage(img, x, y, w, h)
    onDone(out.toDataURL('image/jpeg', 0.88))
  }

  return createPortal(
    <div className="overlay overlay-top">
      <div className="dialog crop-dialog">
        <div className="dialog-head">
          <div className="dialog-title">调整头像</div>
          <button className="icon-btn" onClick={onCancel} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body crop-body">
          <canvas
            ref={canvasRef}
            width={BOX}
            height={BOX}
            className="crop-canvas"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const d = dragRef.current
              if (!d) return
              setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) })
            }}
            onPointerUp={() => {
              dragRef.current = null
            }}
          />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="crop-zoom"
            aria-label="缩放"
          />
          <div className="setting-hint">拖动图片调整位置，滑杆缩放</div>
        </div>
        <div className="dialog-foot">
          <button className="btn btn-ghost sm" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary sm" onClick={exportImage}>
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
