import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
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
  AlertCircle,
  Filter,
  X,
  Check
} from 'lucide-react'
import {
  workspaceInfo,
  openWorkspace,
  openPath,
  revealPath,
  deleteWorkspaceFile,
  deleteWorkspaceTaskDir,
  getSettings,
  putSettings,
  listTasks,
  scheduleAll,
  adaptersStatus,
  type WorkspaceInfo,
  type WorkspaceFile
} from '../lib/api'
import FilePreview from '../components/FilePreview'
import { toast } from '../components/Toast'
import { readViewCache, writeViewCache } from '../lib/viewCache'

/** 文件页：工作区目录树（平台/课程/任务/文件）+ 预览 + 回收站删除。 */

type FileRow = WorkspaceFile & { platform: string; course: string; task: string; taskRel: string }

interface FilesSnapshot {
  info: WorkspaceInfo
  expanded: string[]
}

const FILES_VIEW_KEY = 'files:snapshot'

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fileIcon(ext: string): React.JSX.Element {
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext))
    return <FileImage size={14} className="files-icon" />
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext))
    return <FileSpreadsheet size={14} className="files-icon" />
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext))
    return <FileVideo size={14} className="files-icon" />
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return <FileArchive size={14} className="files-icon" />
  if (['doc', 'docx', 'pdf', 'ppt', 'pptx', 'txt', 'md'].includes(ext))
    return <FileText size={14} className="files-icon" />
  return <FileIcon size={14} className="files-icon" />
}

function FilesPage(): React.JSX.Element {
  // 回到文件页先画上次的树（含展开状态），再静默刷新，避免整棵树从「读取工作区」重来
  const [info, setInfo] = useState<WorkspaceInfo | null>(
    () => readViewCache<FilesSnapshot>(FILES_VIEW_KEY)?.info ?? null
  )
  const [loading, setLoading] = useState(
    () => readViewCache<FilesSnapshot>(FILES_VIEW_KEY) === undefined
  )
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(readViewCache<FilesSnapshot>(FILES_VIEW_KEY)?.expanded ?? [])
  )
  const expandedRef = useRef(expanded)
  useEffect(() => {
    expandedRef.current = expanded
  }, [expanded])
  const [preview, setPreview] = useState<WorkspaceFile | null>(null)
  const [busy, setBusy] = useState(false)

  // 需要获取文件的课程（空 = 全部）；存 settings.file_watch_courses
  const [watch, setWatch] = useState<string[] | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  // 课程清单不只来自工作区目录：还要并上课表与任务里出现过的课程
  const [extraCourses, setExtraCourses] = useState<
    { key: string; platform: string; name: string }[]
  >([])
  const [chaoxingLogged, setChaoxingLogged] = useState(true)

  const reload = useCallback(async () => {
    setErr('')
    try {
      const d = await workspaceInfo()
      setInfo(d)
      // 首次加载默认展开平台和课程层；已有展开状态（含缓存恢复）则保留
      let next = expandedRef.current
      if (next.size === 0) {
        next = new Set<string>()
        for (const p of d.tree) {
          next.add(`p:${p.platform}`)
          for (const c of p.courses) {
            next.add(`c:${p.platform}/${c.name}`)
            // 文件不多时连任务层一起展开，省一次点击
            for (const t of c.tasks) next.add(`t:${p.platform}/${c.name}/${t.name}`)
          }
        }
        setExpanded(next)
        expandedRef.current = next
      }
      writeViewCache<FilesSnapshot>(FILES_VIEW_KEY, { info: d, expanded: [...next] })
    } catch (e) {
      setErr(String(e).slice(0, 160))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()

    // 课表 + 任务里的课程（工作区里没目录也算）
    void (async () => {
      const out: { key: string; platform: string; name: string }[] = []
      try {
        const sch = await scheduleAll()
        for (const c of sch.items) {
          const name = (c.course_abbr || c.course_name || '').trim()
          if (name) out.push({ key: 'chaoxing/' + name, platform: 'chaoxing', name })
        }
      } catch {
        /* 忽略 */
      }
      try {
        const t = await listTasks({})
        for (const task of t.items) {
          const name = (task.course_abbr || task.course_name || '').trim()
          if (name) out.push({ key: task.platform + '/' + name, platform: task.platform, name })
        }
      } catch {
        /* 忽略 */
      }
      setExtraCourses(out)
    })()

    void adaptersStatus()
      .then((s) => setChaoxingLogged(s.chaoxing.logged_in))
      .catch(() => setChaoxingLogged(true))

    void (async () => {
      try {
        const s = await getSettings()
        const raw = s.file_watch_courses
        setWatch(raw ? (JSON.parse(raw) as string[]) : [])
      } catch {
        setWatch([])
      }
    })()
  }, [reload])

  /** 按「监听课程」过滤后的树；watch 为空表示全部课程 */
  const tree = useMemo(() => {
    if (!info) return []
    if (!watch || watch.length === 0) return info.tree
    const keep = new Set(watch)
    return info.tree
      .map((p) => {
        const courses = p.courses.filter((c) => keep.has(`${p.platform}/${c.name}`))
        return {
          ...p,
          courses,
          count: courses.reduce((s, c) => s + c.count, 0),
          size: courses.reduce((s, c) => s + c.size, 0)
        }
      })
      .filter((p) => p.courses.length > 0)
  }, [info, watch])

  const allCourses = useMemo(() => {
    const map = new Map<string, { key: string; platform: string; name: string }>()
    for (const p of info?.tree ?? []) {
      for (const c of p.courses) {
        map.set(`${p.platform}/${c.name}`, {
          key: `${p.platform}/${c.name}`,
          platform: p.platform,
          name: c.name
        })
      }
    }
    // 工作区没有目录的课程（还没下过文件）也要能选
    for (const c of extraCourses) {
      if (!map.has(c.key)) map.set(c.key, c)
    }
    return Array.from(map.values())
  }, [info, extraCourses])

  const flat = useMemo<FileRow[]>(() => {
    if (!info) return []
    const out: FileRow[] = []
    for (const p of tree) {
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
  }, [info, tree])

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
      toast('已移到回收站')
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
      toast('任务目录已移到回收站')
    } catch (e) {
      setErr(String(e).slice(0, 160))
    } finally {
      setBusy(false)
    }
  }

  const renderFileRow = (f: FileRow, showPath: boolean): React.JSX.Element => (
    <div key={f.rel} className="files-row" onClick={() => setPreview(f)} title={f.rel}>
      <span style={{ width: 14, flex: 'none' }} />
      {fileIcon(f.ext)}
      <span className="files-name">{f.name}</span>
      {showPath && (
        <span className="files-path">
          {f.platform} / {f.course} / {f.task}
        </span>
      )}
      <span className="files-size">{human(f.size)}</span>
      <span className="files-date">{f.mtime.slice(5)}</span>
      <span className="files-actions">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setPreview(f)
          }}
          className="att-btn"
          title="预览"
        >
          <Eye size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void openPath(f.rel)
          }}
          className="att-btn"
          title="用系统程序打开"
        >
          <ExternalLink size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void revealPath(f.rel)
          }}
          className="att-btn"
          title="在文件夹中显示"
        >
          <FolderOpen size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void doDeleteFile(f)
          }}
          className="att-btn danger"
          title="移到回收站"
        >
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  )

  const chevron = (key: string): React.JSX.Element =>
    expanded.has(key) ? (
      <ChevronDown size={13} className="files-icon" />
    ) : (
      <ChevronRight size={13} className="files-icon" />
    )

  return (
    <div className="files-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1 className="page-title">文件</h1>
          <p className="page-sub">
            {total.count} 个文件 · {human(total.size)} · 按「平台 / 课程 / 任务」归档
          </p>
        </div>
        <div className="page-actions">
          <button
            onClick={() => setFilterOpen(true)}
            className="btn btn-secondary sm"
            title="选择要获取文件的课程"
          >
            <Filter size={13} /> 筛选
            {watch && watch.length > 0 && <span className="filter-count-badge">{watch.length}</span>}
          </button>
          <button
            onClick={() => void reload()}
            disabled={loading || busy}
            className="btn btn-secondary sm"
            title="刷新"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> 刷新
          </button>
          <button onClick={() => void openWorkspace()} className="btn btn-secondary sm">
            <FolderOpen size={13} /> 打开文件夹
          </button>
        </div>
      </header>

      <div className="files-toolbar">
        <div className="files-search">
          <Search size={13} className="files-search-icon" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文件 / 课程 / 任务"
            className="input"
          />
        </div>
        {info && (
          <span className="files-root" title={info.root}>
            {info.root}
          </span>
        )}
      </div>

      {err && (
        <div className="status-note" style={{ marginBottom: 12, color: 'var(--danger)', borderColor: 'color-mix(in oklch,var(--danger) 30%,transparent)' }}>
          <AlertCircle size={13} />
          <span>{err}</span>
        </div>
      )}

      <div className="files-tree">
        {loading ? (
          <div className="files-empty">
            <Loader2 size={17} className="spin" />
            <span>读取工作区…</span>
          </div>
        ) : q.trim() ? (
          results.length === 0 ? (
            <div className="files-empty">
              <span>没有匹配「{q}」的文件</span>
            </div>
          ) : (
            <div>
              <div className="files-group-label">{results.length} 个结果</div>
              {results.map((f) => renderFileRow(f, true))}
            </div>
          )
        ) : !info || flat.length === 0 ? (
          <div className="files-empty">
            <div className="empty-orb">
              <Folder size={18} strokeWidth={1.7} />
            </div>
            <div style={{ fontSize: 14, color: 'var(--fg)' }}>工作区还是空的</div>
            <p style={{ maxWidth: 380, fontSize: 12.5, lineHeight: 1.65, color: 'var(--muted)' }}>
              去任务页选中一个学习通或小雅的任务，点附件区的「全部下载」，
              文件会按「平台 / 课程 / 任务」自动归档到这里。
            </p>
          </div>
        ) : (
          tree.map((p) => {
            const pKey = `p:${p.platform}`
            const pOpen = expanded.has(pKey)
            return (
              <div key={pKey} className="files-group">
                <button onClick={() => toggle(pKey)} className="files-group-row">
                  {chevron(pKey)}
                  <Folder size={14} className="files-icon" />
                  <span className="files-group-name">{p.platform}</span>
                  <span className="files-group-meta">
                    {p.count} 个文件 · {human(p.size)}
                  </span>
                </button>

                {pOpen && (
                  <div className="tree-children">
                    {p.courses.map((c) => {
                    const cKey = `c:${p.platform}/${c.name}`
                    const cOpen = expanded.has(cKey)
                    return (
                      <div key={cKey} className="files-indent">
                        <button onClick={() => toggle(cKey)} className="files-group-row">
                          {chevron(cKey)}
                          <Folder size={13} className="files-icon" />
                          <span className="files-group-name sub">{c.name}</span>
                          <span className="files-group-meta">
                            {c.count} 个 · {human(c.size)}
                          </span>
                        </button>

                        {cOpen && (
                          <div className="tree-children">
                            {c.tasks.map((t) => {
                            const tKey = `t:${p.platform}/${c.name}/${t.name}`
                            const tOpen = expanded.has(tKey)
                            const firstFile = t.files[0]
                            const taskRel = firstFile
                              ? firstFile.rel.split('/').slice(0, 3).join('/')
                              : `${p.platform}/${c.name}/${t.name}`
                            return (
                              <div key={tKey} className="files-indent">
                                <div className="files-task-row">
                                  <button onClick={() => toggle(tKey)} className="files-task-btn">
                                    {chevron(tKey)}
                                    <Folder size={13} className="files-icon" />
                                    <span className="files-task-name">{t.name}</span>
                                    <span className="files-group-meta">{t.count}</span>
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
                                      className="att-btn danger files-task-del"
                                      title="删除整个任务目录"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>

                                {tOpen && (
                                  <div className="tree-children">
                                    {t.files.map((f) =>
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
                                )}
                              </div>
                            )
                          })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="page-foot-note">程序不会自动删除文件；本页的删除会先进回收站，可恢复。</div>

      {filterOpen && (
        <CourseFilterDialog
          all={allCourses}
          value={watch}
          loggedIn={chaoxingLogged}
          onClose={() => setFilterOpen(false)}
          onSave={async (next) => {
            try {
              await putSettings({ file_watch_courses: JSON.stringify(next) })
              setWatch(next)
              toast(next.length ? `已设置 ${next.length} 门课程需要获取文件` : '已恢复：全部课程')
              setFilterOpen(false)
            } catch (e) {
              toast(`保存失败：${String(e)}`)
            }
          }}
        />
      )}

      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

/** 课程筛选小窗：勾选哪些课程需要监听并获取文件 */
function CourseFilterDialog({
  all,
  value,
  loggedIn,
  onClose,
  onSave
}: {
  all: { key: string; platform: string; name: string }[]
  value: string[] | null
  loggedIn: boolean
  onClose: () => void
  onSave: (next: string[]) => void | Promise<void>
}): React.JSX.Element {
  // value 为空数组 = 全部课程
  const [picked, setPicked] = useState<string[]>(value && value.length ? value : [])
  const [allMode, setAllMode] = useState(!value || value.length === 0)

  const byPlatform = useMemo(() => {
    const m: Record<string, { key: string; name: string }[]> = {}
    for (const c of all) (m[c.platform] ||= []).push({ key: c.key, name: c.name })
    return m
  }, [all])

  const toggle = (key: string): void => {
    setAllMode(false)
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  return createPortal(
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="课程筛选">
        <div className="dialog-head">
          <div>
            <div className="dialog-title">获取哪些课程的文件</div>
            <div className="dialog-sub">
              只对勾选的课程监听并拉取附件；不勾的课程会从本页隐藏，也不再获取新文件。
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="inline-actions" style={{ gap: 8, marginBottom: 10 }}>
            <button
              className="chip"
              aria-pressed={allMode}
              onClick={() => {
                setAllMode(true)
                setPicked([])
              }}
            >
              <Check size={11} /> 全部课程
            </button>
            <button
              className="chip"
              aria-pressed={!allMode && picked.length === 0}
              onClick={() => {
                setAllMode(false)
                setPicked([])
              }}
            >
              一门也不获取
            </button>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 'auto' }}>
              {allMode ? '当前：全部' : `当前：${picked.length} 门`}
            </span>
          </div>

          {!loggedIn && (
            <div className="status-note" style={{ marginBottom: 10 }}>
              <AlertCircle size={13} />
              <span>
                学习通未登录：这里只能列出已同步过的课程，可能不完整。到「设置 → 学习通」重新登录后可拿到全部课程。
              </span>
            </div>
          )}

          {all.length === 0 ? (
            <div className="rail-empty">工作区里还没有课程，先同步一次作业或课表。</div>
          ) : (
            <div className="course-filter-list">
              {Object.entries(byPlatform).map(([platform, courses]) => (
                <div key={platform} style={{ marginBottom: 8 }}>
                  <div className="side-label" style={{ margin: '6px 0 4px' }}>
                    <span>{platform}</span>
                  </div>
                  {courses.map((c) => {
                    const on = allMode || picked.includes(c.key)
                    return (
                      <button
                        key={c.key}
                        className="filter-item"
                        aria-pressed={on}
                        onClick={() => toggle(c.key)}
                      >
                        <span className="filter-box" aria-hidden="true">
                          <Check size={10} strokeWidth={3} />
                        </span>
                        <span>{c.name}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <span className="left">{allMode ? '全部课程' : `${picked.length} 门已选`}</span>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void onSave(allMode ? [] : picked)}>
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default FilesPage
