import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Download,
  FolderOpen,
  Loader2,
  FileQuestion,
  AlertCircle,
  FileText
} from 'lucide-react'
import { previewUrl, openPath, revealPath, type WorkspaceFile } from '../lib/api'

/** 文件预览弹窗：图片/PDF/文本/视频原生渲染，docx 用 mammoth，xlsx 用 SheetJS。 */

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
const TEXT_EXT = ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yml', 'yaml', 'ini']
const VIDEO_EXT = ['mp4', 'webm']
const SHEET_EXT = ['xlsx', 'xls', 'xlsm']

function kindOf(ext: string): 'image' | 'pdf' | 'text' | 'video' | 'docx' | 'sheet' | 'other' {
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (TEXT_EXT.includes(ext)) return 'text'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (ext === 'docx') return 'docx'
  if (SHEET_EXT.includes(ext)) return 'sheet'
  return 'other'
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function FilePreview({
  file,
  onClose
}: {
  file: WorkspaceFile | null
  onClose: () => void
}): React.JSX.Element | null {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [html, setHtml] = useState('') // docx → HTML
  const [text, setText] = useState('')
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [src, setSrc] = useState('')

  const kind = useMemo(() => (file ? kindOf(file.ext) : 'other'), [file])

  useEffect(() => {
    if (!file) return
    let alive = true
    setLoading(true)
    setError('')
    setHtml('')
    setText('')
    setSheets([])
    setActiveSheet(0)
    setSrc('')

    void (async () => {
      try {
        const url = await previewUrl(file.rel)
        if (!alive) return

        if (kind === 'image' || kind === 'pdf' || kind === 'video') {
          setSrc(url)
        } else if (kind === 'text') {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const body = await res.text()
          if (!alive) return
          // 超过 400KB 只显示前 200KB，防止卡死
          setText(body.length > 400_000 ? body.slice(0, 200_000) + '\n\n…（内容过长，已截断）' : body)
        } else if (kind === 'docx') {
          const mod: any = await import('mammoth')
          // CJS 模块经 Vite 打包后可能被包一层 default
          const mammoth = mod.default ?? mod
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = await res.arrayBuffer()
          const out = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (alive) setHtml(out.value || '<p>（文档内容为空）</p>')
        } else if (kind === 'sheet') {
          const mod: any = await import('xlsx')
          const XLSX = mod.default ?? mod
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = await res.arrayBuffer()
          const wb = XLSX.read(buf, { type: 'array' })
          const parsed = wb.SheetNames.slice(0, 6).map((name) => {
            const sheet = wb.Sheets[name]
            const rows = XLSX.utils.sheet_to_json(sheet, {
              header: 1,
              defval: '',
              blankrows: false,
              raw: false
            }) as string[][]
            return { name, rows: rows.slice(0, 500).map((r) => (r || []).map((c) => String(c ?? ''))) }
          })
          if (alive) setSheets(parsed)
        }
      } catch (e) {
        if (alive) setError(String(e).slice(0, 200))
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [file?.rel, kind])

  // Esc 关闭
  useEffect(() => {
    if (!file) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, onClose])

  if (!file) return null

  const maxRows = sheets[activeSheet]?.rows.length ?? 0

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[85vh] flex flex-col rounded-xl bg-[#15151a] border border-[#2a2a34] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 工具栏 */}
        <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-[#26262f]">
          <FileText size={14} className="text-[#5c5c6a] shrink-0" />
          <span className="text-[12.5px] text-[#d0d0da] truncate" title={file.rel}>
            {file.name}
          </span>
          <span className="shrink-0 text-[10.5px] text-[#4a4a58]">{human(file.size)}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => void openPath(file.rel)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#9a9aa8] hover:bg-[#1f1f27] hover:text-[#e0e0e8]"
              title="用系统程序打开"
            >
              <Download size={12} /> 打开
            </button>
            <button
              onClick={() => void revealPath(file.rel)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#9a9aa8] hover:bg-[#1f1f27] hover:text-[#e0e0e8]"
              title="在文件夹中显示"
            >
              <FolderOpen size={12} /> 定位
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-[#6b6b7a] hover:bg-[#1f1f27] hover:text-[#e0e0e8]"
              title="关闭（Esc）"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-auto bg-[#0f0f13]">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[#6b6b7a]">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-[12px]">正在解析…</span>
            </div>
          )}

          {!loading && error && (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
              <AlertCircle size={20} className="text-[#e0a080]" />
              <div className="text-[12.5px] text-[#c8c8d4]">无法预览</div>
              <div className="text-[11px] text-[#6b6b7a] max-w-md leading-relaxed">{error}</div>
              <button
                onClick={() => void openPath(file.rel)}
                className="mt-2 px-3 py-1.5 rounded-md bg-[#1c1c22] border border-[#2e2e38] text-[11.5px] text-[#b0b0be] hover:border-[#4f8cff]"
              >
                用系统程序打开
              </button>
            </div>
          )}

          {!loading && !error && kind === 'image' && (
            <div className="h-full flex items-center justify-center p-4">
              <img src={src} alt={file.name} className="max-w-full max-h-full object-contain" />
            </div>
          )}

          {!loading && !error && kind === 'pdf' && (
            <iframe src={src} title={file.name} className="w-full h-full border-0 bg-white" />
          )}

          {!loading && !error && kind === 'video' && (
            <div className="h-full flex items-center justify-center p-4">
              <video src={src} controls className="max-w-full max-h-full" />
            </div>
          )}

          {!loading && !error && kind === 'text' && (
            <pre className="p-4 text-[12px] leading-relaxed text-[#c0c0cc] whitespace-pre-wrap break-words font-mono">
              {text}
            </pre>
          )}

          {!loading && !error && kind === 'docx' && (
            <>
              <style>{`
                .ca-docx { background: #fff; color: #1a1a1a; padding: 40px 48px; max-width: 900px; margin: 0 auto; min-height: 100%; }
                .ca-docx p { margin: 0 0 10px; line-height: 1.75; font-size: 14px; }
                .ca-docx h1 { font-size: 24px; font-weight: 700; margin: 20px 0 12px; }
                .ca-docx h2 { font-size: 19px; font-weight: 700; margin: 18px 0 10px; }
                .ca-docx h3 { font-size: 16px; font-weight: 600; margin: 16px 0 8px; }
                .ca-docx ul, .ca-docx ol { margin: 0 0 10px 24px; }
                .ca-docx li { line-height: 1.7; font-size: 14px; }
                .ca-docx table { border-collapse: collapse; width: 100%; margin: 12px 0; }
                .ca-docx td, .ca-docx th { border: 1px solid #d0d0d8; padding: 6px 10px; font-size: 13px; }
                .ca-docx img { max-width: 100%; height: auto; }
                .ca-docx strong { font-weight: 600; }
                .ca-docx a { color: #2563eb; text-decoration: underline; }
              `}</style>
              <div className="ca-docx" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          )}

          {!loading && !error && kind === 'sheet' && (
            <div className="min-h-full">
              {sheets.length > 1 && (
                <div className="sticky top-0 z-10 flex items-center gap-1 px-3 py-2 bg-[#15151a] border-b border-[#26262f]">
                  {sheets.map((s, i) => (
                    <button
                      key={s.name}
                      onClick={() => setActiveSheet(i)}
                      className={`px-2 py-1 rounded text-[11px] ${
                        i === activeSheet
                          ? 'bg-[#242430] text-[#e0e0e8]'
                          : 'text-[#6b6b7a] hover:text-[#c0c0cc]'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              <table className="w-full border-collapse text-[11.5px]">
                <tbody>
                  {(sheets[activeSheet]?.rows ?? []).map((row, ri) => (
                    <tr key={ri} className={ri === 0 ? 'bg-[#1c1c24]' : 'hover:bg-[#17171d]'}>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className={`px-2 py-1 border border-[#24242c] text-[#b8b8c4] whitespace-nowrap ${
                            ri === 0 ? 'font-medium text-[#dcdce6]' : ''
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {maxRows >= 500 && (
                <div className="px-3 py-2 text-[10.5px] text-[#5c5c6a]">
                  只显示前 500 行，完整内容请用系统程序打开
                </div>
              )}
              {maxRows === 0 && (
                <div className="p-6 text-center text-[12px] text-[#5c5c6a]">这个工作表是空的</div>
              )}
            </div>
          )}

          {!loading && !error && kind === 'other' && (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
              <FileQuestion size={20} className="text-[#4a4a58]" />
              <div className="text-[12.5px] text-[#c8c8d4]">
                {['doc', 'xls', 'ppt'].includes(file.ext)
                  ? `老版 Office 格式（.${file.ext}）无法内嵌预览`
                  : ['zip', 'rar', '7z', 'tar', 'gz'].includes(file.ext)
                    ? '压缩包需要解压后查看'
                    : file.ext
                      ? `.${file.ext} 暂不支持预览`
                      : '该文件类型暂不支持预览'}
              </div>
              <div className="max-w-md text-[11px] leading-relaxed text-[#6b6b7a]">
                {['doc', 'xls', 'ppt'].includes(file.ext)
                  ? '浏览器只能解析 .docx / .xlsx / .pptx。点下面的「打开」用 Word 或 WPS 查看，体验也更好。'
                  : ['zip', 'rar', '7z', 'tar', 'gz'].includes(file.ext)
                    ? '点「打开」用解压软件处理，或在文件夹中定位后解压。'
                    : '当前支持：图片、PDF、Word(docx)、Excel(xlsx)、文本、视频。'}
              </div>
              <button
                onClick={() => void openPath(file.rel)}
                className="mt-2 px-3 py-1.5 rounded-md bg-[#1c1c22] border border-[#2e2e38] text-[11.5px] text-[#b0b0be] hover:border-[#4f8cff]"
              >
                用系统程序打开
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default FilePreview
