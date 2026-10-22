import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Eye,
  ExternalLink,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileVideo,
  FileArchive,
  File as FileIcon,
  AlertCircle
} from 'lucide-react'
import {
  workspaceInfo,
  openWorkspace,
  openPath,
  revealPath,
  deleteWorkspaceFile,
  deleteWorkspaceTaskDir,
  type WorkspaceInfo,
  type WorkspaceFile
} from '../lib/api'
import FilePreview from '../components/FilePreview'

/** 文件页：工作区目录树（平台/课程/任务/文件）+ 预览 + 回收站删除。 */

type FileRow = WorkspaceFile & { platform: string; course: string; task: string; taskRel: string }

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fileIcon(ext: string): React.JSX.Element {
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext))
    return <FileImage size={13} className="shrink-0 text-[#7db4ff]" />
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext))
    return <FileSpreadsheet size={13} className="shrink-0 text-[#7ee2b8]" />
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext))
    return <FileVideo size={13} className="shrink-0 text-[#c09ae0]" />
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return <FileArchive size={13} className="shrink-0 text-[#e0b080]" />
  if (['doc', 'docx', 'pdf', 'ppt', 'pptx', 'txt', 'md'].includes(ext))
    return <FileText size={13} className="shrink-0 text-[#9aa8c0]" />
  return <FileIcon size={13} className="shrink-0 text-[#6b6b7a]" />
}

function FilesPage(): React.JSX.Element {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<WorkspaceFile | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setErr('')
    try {
      const d = await workspaceInfo()
      setInfo(d)
      setExpanded((prev) => {
        if (prev.size > 0) return prev
        // 首次加载默认展开平台和课程层
        const next = new Set<string>()
        for (const p of d.tree) {
          next.add(`p:${p.platform}`)
          for (const c of p.courses) {
            next.add(`c:${p.platform}/${c.name}`)
            // 文件不多时连任务层一起展开，省一次点击
            for (const t of c.tasks) next.add(`t:${p.platform}/${c.name}/${t.name}`)
          }
        }
        return next
      })
    } catch (e) {
      setErr(String(e).slice(0, 160))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const flat = useMemo<FileRow[]>(() => {
    if (!info) return []
    const out: FileRow[] = []
    for (const p of info.tree) {
      for (const c of p.courses) {
        for (const t of c.tasks) {
          const taskRel = t.files[0]
            ? t.files[0].rel.split('/').slice(0, 3).join('/')
            : `${p.platform}/${c.name}/${t.name}`
          for (const f of t.files) {
            out.push({ ...f, platform: p.platform, course: c.name, task: t.name, taskRel })
          }
        }
      }
    }
    return out
  }, [info])

  const total = useMemo(
    () => ({ count: flat.length, size: flat.reduce((s, f) => s + f.size, 0) }),
    [flat]
  )

  const results = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return []
    return flat.filter((f) =>
      [f.name, f.course, f.task, f.platform].some((x) => x.toLowerCase().includes(kw))
    )
  }, [flat, q])

  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const doDeleteFile = async (f: WorkspaceFile): Promise<void> => {
    if (!window.confirm(`把「${f.name}」移到回收站？\n\n可在 Windows 回收站里恢复。`)) return
    setBusy(true)
    try {
      await deleteWorkspaceFile(f.rel)
      if (preview?.rel === f.rel) setPreview(null)
      await reload()
    } catch (e) {
      setErr(String(e).slice(0, 160))
    } finally {
      setBusy(false)
    }
  }

  const doDeleteTask = async (row: FileRow): Promise<void> => {
    const n = flat.filter((f) => f.taskRel === row.taskRel).length
    if (
      !window.confirm(
        `把整个任务目录移到回收站？\n\n${row.platform} / ${row.course} / ${row.task}\n共 ${n} 个文件，可在回收站恢复。`
      )
    )
      return
    setBusy(true)
    try {
      await deleteWorkspaceTaskDir(row.taskRel)
      await reload()
    } catch (e) {
      setErr(String(e).slice(0, 160))
    } finally {
      setBusy(false)
    }
  }

  const renderFileRow = (f: FileRow, showPath: boolean): React.JSX.Element => (
    <div
      key={f.rel}
      className="group flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-[#1c1c22] cursor-pointer"
      onClick={() => setPreview(f)}
      title={f.rel}
    >
      <span className="w-4" />
      {fileIcon(f.ext)}
      <span className="min-w-0 flex-1 text-[12px] text-[#c0c0cc] truncate">{f.name}</span>
      {showPath && (
        <span className="shrink-0 max-w-[36%] text-[10px] text-[#4a4a58] truncate">
          {f.platform} / {f.course} / {f.task}
        </span>
      )}
      <span className="shrink-0 w-16 text-right text-[10px] text-[#4a4a58]">{human(f.size)}</span>
      <span className="hidden md:block shrink-0 w-24 text-right text-[10px] text-[#3d3d48]">
        {f.mtime.slice(5)}
      </span>
      <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setPreview(f)
          }}
          className="p-1 rounded text-[#6b6b7a] hover:bg-[#24242c] hover:text-[#7db4ff]"
          title="预览"
        >
          <Eye size={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void openPath(f.rel)
          }}
          className="p-1 rounded text-[#6b6b7a] hover:bg-[#24242c] hover:text-[#7ee2b8]"
          title="用系统程序打开"
        >
          <ExternalLink size={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void revealPath(f.rel)
          }}
          className="p-1 rounded text-[#6b6b7a] hover:bg-[#24242c] hover:text-[#c0c0cc]"
          title="在文件夹中显示"
        >
          <FolderOpen size={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void doDeleteFile(f)
          }}
          className="p-1 rounded text-[#6b6b7a] hover:bg-[#2a1f24] hover:text-[#e08a9a]"
          title="移到回收站"
        >
          <Trash2 size={11} />
        </button>
      </span>
    </div>
  )

  const chevron = (key: string): React.JSX.Element =>
    expanded.has(key) ? (
      <ChevronDown size={13} className="shrink-0 text-[#5c5c6a]" />
    ) : (
      <ChevronRight size={13} className="shrink-0 text-[#5c5c6a]" />
    )

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-2 pb-3">
        <div className="flex items-center gap-1.5 text-[12px] text-[#9a9aa8]">
          <HardDrive size={14} className="text-[#4f8cff]" />
          工作区
        </div>
        <span className="text-[11px] text-[#5c5c6a]">
          {total.count} 个文件 · {human(total.size)}
        </span>

        <div className="relative ml-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#4a4a58]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文件 / 课程 / 任务"
            className="w-56 pl-7 pr-2 py-1.5 rounded-md bg-[#16161a] border border-[#2e2e38] text-[11.5px] text-[#d0d0da] outline-none focus:border-[#4f8cff] placeholder:text-[#3d3d48]"
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void reload()}
            disabled={loading || busy}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#2e2e38] text-[11.5px] text-[#8a8a98] hover:text-[#e0e0e8] hover:border-[#3e3e4a] disabled:opacity-40"
            title="刷新"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
          <button
            onClick={() => void openWorkspace()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#1c1c22] border border-[#2e2e38] text-[11.5px] text-[#b0b0be] hover:border-[#4f8cff]"
          >
            <FolderOpen size={12} /> 打开文件夹
          </button>
        </div>
      </div>

      {err && (
        <div className="shrink-0 mb-2 flex items-start gap-1.5 px-3 py-2 rounded-md bg-[#2a1f24] border border-[#3d2a30] text-[11.5px] text-[#e0a0b0]">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {info && (
        <div className="shrink-0 mb-2 text-[10.5px] text-[#4a4a58] truncate" title={info.root}>
          {info.root}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[#24242c] bg-[#131317] p-1.5">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[#5c5c6a]">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-[12px]">读取工作区…</span>
          </div>
        ) : q.trim() ? (
          results.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-[#4a4a58]">
              没有匹配「{q}」的文件
            </div>
          ) : (
            <div>
              <div className="px-2 py-1 text-[10.5px] text-[#4a4a58]">{results.length} 个结果</div>
              {results.map((f) => renderFileRow(f, true))}
            </div>
          )
        ) : !info || flat.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
            <Folder size={20} className="text-[#3a3a46]" />
            <div className="text-[12.5px] text-[#8a8a98]">工作区还是空的</div>
            <div className="max-w-sm text-[11px] leading-relaxed text-[#5c5c6a]">
              去任务页选中一个学习通或小雅的任务，点附件区的「全部下载」，
              文件会按「平台 / 课程 / 任务」自动归档到这里。
            </div>
          </div>
        ) : (
          info.tree.map((p) => {
            const pKey = `p:${p.platform}`
            const pOpen = expanded.has(pKey)
            return (
              <div key={pKey} className="mb-0.5">
                <button
                  onClick={() => toggle(pKey)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#1c1c22]"
                >
                  {chevron(pKey)}
                  <Folder size={13} className="shrink-0 text-[#7db4ff]" />
                  <span className="text-[12.5px] text-[#dcdce6]">{p.platform}</span>
                  <span className="text-[10.5px] text-[#4a4a58]">
                    {p.count} 个文件 · {human(p.size)}
                  </span>
                </button>

                {pOpen &&
                  p.courses.map((c) => {
                    const cKey = `c:${p.platform}/${c.name}`
                    const cOpen = expanded.has(cKey)
                    return (
                      <div key={cKey} className="ml-4">
                        <button
                          onClick={() => toggle(cKey)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#1c1c22]"
                        >
                          {chevron(cKey)}
                          <Folder size={12} className="shrink-0 text-[#6b8fb8]" />
                          <span className="min-w-0 flex-1 truncate text-left text-[12px] text-[#c0c0cc]">
                            {c.name}
                          </span>
                          <span className="shrink-0 text-[10px] text-[#4a4a58]">
                            {c.count} 个 · {human(c.size)}
                          </span>
                        </button>

                        {cOpen &&
                          c.tasks.map((t) => {
                            const tKey = `t:${p.platform}/${c.name}/${t.name}`
                            const tOpen = expanded.has(tKey)
                            const firstFile = t.files[0]
                            const taskRel = firstFile
                              ? firstFile.rel.split('/').slice(0, 3).join('/')
                              : `${p.platform}/${c.name}/${t.name}`
                            return (
                              <div key={tKey} className="ml-4">
                                <div className="group flex items-center rounded-md hover:bg-[#1c1c22]">
                                  <button
                                    onClick={() => toggle(tKey)}
                                    className="min-w-0 flex-1 flex items-center gap-1.5 px-2 py-1"
                                  >
                                    {chevron(tKey)}
                                    <Folder size={12} className="shrink-0 text-[#5c5c6a]" />
                                    <span className="truncate text-[11.5px] text-[#9a9aa8]">
                                      {t.name}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-[#3d3d48]">
                                      {t.count}
                                    </span>
                                  </button>
                                  {firstFile && (
                                    <button
                                      onClick={() =>
                                        void doDeleteTask({
                                          ...firstFile,
                                          platform: p.platform,
                                          course: c.name,
                                          task: t.name,
                                          taskRel
                                        })
                                      }
                                      className="mr-1 rounded p-1 text-[#6b6b7a] opacity-0 hover:text-[#e08a9a] group-hover:opacity-100"
                                      title="删除整个任务目录"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>

                                {tOpen &&
                                  t.files.map((f) =>
                                    renderFileRow(
                                      {
                                        ...f,
                                        platform: p.platform,
                                        course: c.name,
                                        task: t.name,
                                        taskRel
                                      },
                                      false
                                    )
                                  )}
                              </div>
                            )
                          })}
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 pt-2 text-[10.5px] text-[#3d3d48]">
        程序不会自动删除文件；本页的删除会先进回收站，可恢复。
      </div>

      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

export default FilesPage
