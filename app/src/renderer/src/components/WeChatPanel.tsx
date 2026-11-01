import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  Loader2,
  Play,
  Square,
  Download,
  MessageSquare,
  Send,
  FolderOpen
} from 'lucide-react'
import {
  wechatStatus,
  wechatSaveGroups,
  wechatStart,
  wechatStop,
  wechatSimulate,
  wechatInstall,
  wechatInit,
  wechatLaunch,
  wechatGroups,
  wechatUpdateCheck,
  putSettings,
  type WeChatStatus
} from '../lib/api'

/** 微信监听面板（规格 §5 模块 3） */
export default function WeChatPanel(): React.JSX.Element {
  const [st, setSt] = useState<WeChatStatus | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // 「指定目录」弹窗（window.prompt 在 Electron 里不可用）
  const [dirOpen, setDirOpen] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [dirMsg, setDirMsg] = useState('')
  const [testText, setTestText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [allGroups, setAllGroups] = useState<{ name: string; unread: number; last_message: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [groupsMsg, setGroupsMsg] = useState('')
  const [manualGroup, setManualGroup] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')
  const [testResult, setTestResult] = useState('')
  const timer = useRef<number | null>(null)

  const reload = useCallback(async () => {
    try {
      const s = await wechatStatus()
      setSt(s)
      setSelected((prev) => (prev.length ? prev : s.config_groups))

      // 启动时后端已自动检查过更新，这里直接展示结果，不用再联网
      // 注意：自动检查失败不打扰用户（网络常被墙），只有手动点「检查更新」才报错
      const u = s.update
      if (u?.has_update) {
        setUpdateMsg(`启动检查：有新提交 ${u.current} → ${u.latest}，见下方更新命令`)
      } else if (u?.checked_at && !u.error) {
        setUpdateMsg(
          `启动检查 ${u.checked_at.slice(5, 16).replace('T', ' ')} · 已是最新（${u.current}）`
        )
      }
    } catch (e) {
      setMsg(String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true)
    try {
      const r = await wechatGroups()
      setAllGroups(r.groups)
      setGroupsMsg(r.message ?? '')
    } catch (e) {
      setMsg(String(e))
    } finally {
      setLoadingGroups(false)
    }
  }, [])

  /** 手动添加群名：不依赖 wechat-cli，直接进入监听选择列表 */
  const addManualGroup = useCallback(() => {
    const name = manualGroup.trim()
    if (!name) return
    setSelected((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setAllGroups((prev) =>
      prev.some((g) => g.name === name)
        ? prev
        : [...prev, { name, username: '', unread: 0, last_message: '' }]
    )
    setManualGroup('')
    setGroupsMsg('')
  }, [manualGroup])

  // 运行中每 10 秒刷新一次状态；窗口不可见时暂停，回到前台立刻补一次
  useEffect(() => {
    if (st?.listener.state !== 'running') return
    const tick = (): void => {
      if (document.visibilityState === 'visible') void reload()
    }
    timer.current = window.setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [st?.listener.state, reload])

  const start = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await wechatStart()
      setMsg(r.message)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await wechatStop()
      setMsg(r.message)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const env = st?.env
  const listener = st?.listener
  const canRun = env?.installed && env?.wechat_running
  // 密钥没就绪时，监听一定起不来：不要留下一个「点了没反应」的按钮
  const keysReady = !!env?.initialized

  return (
    <div className="wx-stack">
      {/* 环境检测 */}
      <div className="wx-card">
        <EnvRow
          ok={!!env?.installed}
          label="wechat-cli"
          detail={env?.installed ? `${env.version || '已安装'} · ${env.path}` : '未安装'}
        />
        <EnvRow
          ok={!!env?.initialized}
          label="数据库密钥"
          detail={env?.initialized ? '已提取' : '未提取（启动时自动尝试）'}
        />
        <EnvRow ok={!!env?.wechat_running} label="微信进程" detail={env?.wechat_running ? '已运行' : '未启动'} />
        <EnvRow
          ok={!!env?.admin}
          label="管理员权限"
          detail={env?.admin ? '是' : '否（提取密钥需要以管理员身份运行）'}
        />
        <EnvRow
          ok={!!env?.db_dir}
          label="数据目录"
          detail={env?.db_dir ? env.db_dir : '未找到（点下方「指定目录」手动选）'}
        />
        <EnvRow
          ok={!!env?.wechat_version}
          label="微信版本"
          detail={
            env?.wechat_version
              ? `${env.wechat_version}${env.wechat_version.startsWith('4.1') ? '（比 wechat-cli 支持的新，可能读不到密钥）' : ''}`
              : '未检测到安装路径'
          }
        />
        <EnvRow
          ok={listener?.state === 'running'}
          label="监听状态"
          detail={
            listener?.state === 'running'
              ? `运行中（已收 ${listener.received} 条）`
              : listener?.state === 'offline'
                ? '已停止'
                : '未配置'
          }
        />
        {listener?.state === 'running' && (
          <EnvRow
            ok
            label="轮询节奏"
            detail={`每 ${listener.interval || 30} 秒检查一次${
              listener.last_poll ? ` · 上次 ${listener.last_poll}` : ''
            }`}
          />
        )}
        {!!listener?.backfilled?.length && (
          <EnvRow
            ok
            label="已回补"
            detail={`${listener.backfilled.length} 个群：${listener.backfilled.slice(0, 2).join('、')}${
              listener.backfilled.length > 2 ? '…' : ''
            }`}
          />
        )}
      </div>

      {/* 安装位置 + 一键安装 */}
      <div className="wx-card">
        <div className="wx-kv">
          <span className="k">运行文件</span>
          <span className="v" title={env?.path || ''}>
            {env?.path || '未安装'}
          </span>
          <span className="wx-badge">{env?.path?.startsWith('C:') ? 'C 盘' : 'D 盘'}</span>
        </div>
        {st?.install.manifest?.size != null && (
          <div className="wx-kv" style={{ marginTop: 6 }}>
            <span className="k">组件大小</span>
            <span className="v">
              {(st.install.manifest.size / 1024 / 1024).toFixed(1)} MB
              {st.install.manifest.installed_at ? ` · 安装于 ${st.install.manifest.installed_at.slice(0, 16).replace('T', ' ')}` : ''}
            </span>
          </div>
        )}

        {env?.installed ? (
          <div className="wx-kv" style={{ marginTop: 8, alignItems: 'center' }}>
            <span className="k">组件版本</span>
            <span className="v">{env?.version || '未知'}</span>
            <button
              className="wx-link"
              disabled={checking}
              onClick={async () => {
                setChecking(true)
                setUpdateMsg('')
                try {
                  const r = await wechatUpdateCheck()
                  if (r.error) setUpdateMsg(`检查失败：${r.error}`)
                  else if (r.has_update)
                    setUpdateMsg(
                      `有新提交：${r.current} → ${r.latest}，手动更新：${r.apply_command}`
                    )
                  else setUpdateMsg(`已是最新（${r.current}）`)
                } catch (e) {
                  setUpdateMsg(String(e))
                } finally {
                  setChecking(false)
                }
              }}
            >
              {checking ? '检查中…' : '检查更新'}
            </button>
          </div>
        ) : (
          <div className="inline-actions" style={{ marginTop: 10 }}>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="下载地址或本地 zip/exe 路径"
              className="input"
              style={{ flex: 1, minWidth: 200, height: 33, fontSize: 12.5 }}
            />
            <button
              onClick={async () => {
                if (!sourceUrl.trim()) return
                setBusy(true)
                setMsg('正在安装…')
                try {
                  const r = await wechatInstall(sourceUrl.trim())
                  setMsg(r.ok ? `安装完成：${r.exe}` : r.message)
                  await reload()
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy || !sourceUrl.trim()}
              className="btn btn-primary sm"
            >
              {busy ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
              一键安装
            </button>
          </div>
        )}

        {updateMsg && (
          <div className="wx-hint" style={{ marginTop: 7, lineHeight: 1.6 }}>
            {updateMsg}
          </div>
        )}
      </div>

      {/* 群配置：勾选 */}
      <div>
        <div className="wx-label-row">
          <span className="wx-hint">
            监听的群（已选 {selected.length} 个，不选则监听全部）
          </span>
          <div className="inline-actions" style={{ gap: 10 }}>
            <button
              onClick={() => void loadGroups()}
              disabled={loadingGroups}
              className="wx-link"
            >
              {loadingGroups ? '读取中…' : '读取群列表'}
            </button>
            <button
              onClick={async () => {
                setBusy(true)
                try {
                  await wechatSaveGroups(selected)
                  setMsg(`已保存 ${selected.length} 个群`)
                  await reload()
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="wx-link"
            >
              保存选择
            </button>
          </div>
        </div>

        {allGroups.length === 0 ? (
          <>
            <div
              className="wx-hint"
              style={{ padding: '4px 0', lineHeight: 1.6, color: groupsMsg ? 'var(--warn)' : undefined }}
            >
              {groupsMsg || '还没读取群列表。点右上「读取群列表」，会从微信会话里列出所有群。'}
            </div>
            <div className="inline-actions" style={{ gap: 6, marginTop: 6 }}>
              <input
                value={manualGroup}
                onChange={(e) => setManualGroup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addManualGroup()
                }}
                placeholder="手动输入群名，回车添加（不依赖组件）"
                className="input"
                style={{ height: 33, fontSize: 12.5, flex: 1 }}
              />
              <button
                onClick={addManualGroup}
                disabled={!manualGroup.trim()}
                className="wx-link"
                style={{ opacity: manualGroup.trim() ? 1 : 0.45 }}
              >
                添加
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索群名"
              className="input"
              style={{ height: 33, fontSize: 12.5, marginBottom: 8 }}
            />
            <div className="wx-group-list">
              {allGroups
                .filter((g) => !search || g.name.includes(search))
                .map((g) => {
                  const checked = selected.includes(g.name)
                  return (
                    <button
                      key={g.name}
                      onClick={() =>
                        setSelected((prev) =>
                          prev.includes(g.name) ? prev.filter((x) => x !== g.name) : [...prev, g.name]
                        )
                      }
                      className={`wx-group${checked ? ' on' : ''}`}
                    >
                      <span className={`wx-check${checked ? ' on' : ''}`}>
                        {checked && <Check size={10} strokeWidth={3} />}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="wx-group-name">{g.name}</span>
                        {g.last_message && <span className="wx-group-sub">{g.last_message}</span>}
                      </span>
                      {g.unread > 0 && (
                        <span className="wx-unread">{g.unread > 99 ? '99+' : g.unread}</span>
                      )}
                    </button>
                  )
                })}
            </div>
          </>
        )}
      </div>

      {/* 启停 */}
      <div className="inline-actions">
        {!env?.wechat_running && (
          <button
            onClick={async () => {
              setBusy(true)
              setMsg('正在启动微信…')
              try {
                const r = await wechatLaunch()
                setMsg(r.message)
                await new Promise((res) => setTimeout(res, 4000))
                await reload()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="btn btn-secondary sm"
          >
            唤起微信
          </button>
        )}
        {listener?.state === 'running' ? (
          <button onClick={() => void stop()} disabled={busy} className="btn btn-danger sm">
            {busy ? <Loader2 size={13} className="spin" /> : <Square size={13} />}
            停止监听
          </button>
        ) : (
          <button
            onClick={() => void start()}
            disabled={busy || !canRun || !keysReady}
            className="btn btn-primary sm"
            title={
              !canRun
                ? '需要 wechat-cli 且微信已启动'
                : !keysReady
                  ? '密钥未就绪，可点「初始化」重试'
                  : ''
            }
          >
            {busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            开始监听
          </button>
        )}
        <button
          onClick={async () => {
            setBusy(true)
            setMsg('正在提取密钥（约 2 秒）…')
            try {
              const r = await wechatInit()
              setMsg(r.message)
              await reload()
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy || !env?.wechat_running}
          className="btn btn-secondary sm"
          title="从微信进程只读提取数据库密钥（约 2 秒）；正常情况下启动时已自动完成"
        >
          初始化
        </button>
        <button
          onClick={() => {
            setDirInput(env?.db_dir || '')
            setDirMsg('')
            setDirOpen(true)
          }}
          disabled={busy}
          className="btn btn-ghost sm"
          title="自动探测不到时，手动指定微信数据目录"
        >
          指定目录
        </button>
        <button onClick={() => void reload()} className="btn btn-ghost sm">
          重新检测
        </button>
      </div>

      {listener?.last_error && (
        <div className="status-note" style={{ color: 'var(--danger)', borderColor: 'color-mix(in oklch,var(--danger) 30%,transparent)' }}>
          <AlertCircle size={13} />
          <span style={{ wordBreak: 'break-all' }}>{listener.last_error}</span>
        </div>
      )}
      {msg && <div className="text-[12.5px] break-all text-[var(--muted)]">{msg}</div>}


      {/* 最近消息 */}
      {!!listener?.recent?.length && (
        <div>
          <div className="wx-block-title">
            <MessageSquare size={12} /> 最近捕获
          </div>
          <div className="wx-recent">
            {[...listener.recent].reverse().map((m, i) => (
              <div key={i} className="wx-recent-row">
                <div className="wx-recent-meta">
                  <span>{m.group || '未知群'}</span>
                  <span>·</span>
                  <span>{m.sender}</span>
                  {m.keyword_hit && <span style={{ marginLeft: 'auto', color: 'var(--ok)' }}>命中关键词</span>}
                </div>
                <div className="wx-recent-text">{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 链路自测：只在开发模式显示，普通用户看不到这个调试入口 */}
      {import.meta.env.DEV && (
      <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 16 }}>
        <div className="wx-hint" style={{ marginBottom: 8 }}>
          链路自测（不需要 wechat-cli，验证「过滤 → 提取 → 入库」）
        </div>
        <div className="inline-actions" style={{ flexWrap: 'nowrap' }}>
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="模拟一条群消息，如：【数据结构】实验四请于下周三23:59前提交"
            className="input"
            style={{ flex: 1, minWidth: 0, height: 33, fontSize: 12.5 }}
          />
          <button
            onClick={async () => {
              if (!testText.trim()) return
              const r = await wechatSimulate(testText)
              setTestResult(
                r.matched
                  ? r.created
                    ? `已生成任务：${r.title}${r.ddl ? `（截止 ${r.ddl.slice(0, 16).replace('T', ' ')}）` : ''}`
                    : '该消息已处理过（去重生效）'
                  : r.message || '未命中关键词，已忽略'
              )
            }}
            className="btn btn-secondary sm"
          >
            <Send size={12} /> 投递
          </button>
        </div>
        {testResult && <div className="wx-hint" style={{ marginTop: 8 }}>{testResult}</div>}
      </div>
      )}
{/* 指定目录弹窗：Electron 不支持 window.prompt，改用应用内弹窗 */}
      {dirOpen && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDirOpen(false)
          }}
        >
          <div className="dialog" role="dialog" aria-modal="true" aria-label="指定微信数据目录">
            <div className="dialog-head">
              <div>
                <div className="dialog-title">指定微信数据目录</div>
                <div className="dialog-sub">
                  选到 wxid_ 开头的那一层（文件夹里应有 db_storage）。不知道在哪：微信 → 设置 → 文件管理 → 文件保存位置
                </div>
              </div>
              <button className="icon-btn" onClick={() => setDirOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="dialog-body setting-stack">
              <div className="inline-actions" style={{ gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 200 }}
                  value={dirInput}
                  placeholder="D:\Documents\xwechat_files\wxid_xxx"
                  onChange={(e) => setDirInput(e.target.value)}
                  autoFocus
                />
                <button
                  className="btn btn-ghost sm"
                  onClick={async () => {
                    try {
                      const picked = await window.api?.pickDirectory?.('选择微信数据目录（wxid_ 那一层）')
                      if (picked) {
                        setDirInput(picked)
                        setDirMsg('')
                      }
                    } catch (e) {
                      setDirMsg(String(e))
                    }
                  }}
                >
                  <FolderOpen size={13} /> 浏览…
                </button>
              </div>
              {dirMsg && <div className="wx-hint" style={{ color: 'var(--danger)' }}>{dirMsg}</div>}
              <div className="inline-actions">
                <button className="btn btn-ghost sm" onClick={() => setDirOpen(false)}>
                  取消
                </button>
                <button
                  className="btn btn-secondary sm"
                  disabled={busy || !dirInput.trim()}
                  onClick={async () => {
                    const path = dirInput.trim()
                    setBusy(true)
                    setDirMsg('')
                    try {
                      await putSettings({ wechat_db_dir: path })
                      const next = await wechatStatus()
                      if (next.env?.db_dir) {
                        setDirOpen(false)
                        setMsg(`已指定数据目录：${next.env.db_dir}`)
                      } else {
                        setDirMsg('这个路径里没找到 db_storage，请确认选的是 wxid_ 那一层')
                      }
                      await reload()
                    } catch (e) {
                      setDirMsg(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? <Loader2 size={13} className="spin" /> : null}
                  保存并使用
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EnvRow({
  ok,
  label,
  detail
}: {
  ok: boolean
  label: string
  detail: string
}): React.JSX.Element {
  return (
    <div className="wx-env-row">
      {ok ? (
        <Check size={12} style={{ color: 'var(--ok)', flex: 'none' }} />
      ) : (
        <AlertCircle size={12} className="files-icon" />
      )}
      <span className="wx-env-label">{label}</span>
      <span className="wx-env-detail">{detail}</span>
    </div>
  )
}
