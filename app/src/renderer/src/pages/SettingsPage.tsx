import { useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CalendarDays,
  Check,
  Cookie,
  FolderOpen,
  GraduationCap,
  Loader2,
  LogIn,
  LogOut,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Sparkles
} from 'lucide-react'
import WeChatPanel from '../components/WeChatPanel'
import AiProvidersSection from '../components/AiProvidersSection'
import { toast } from '../components/Toast'
import {
  getSettings,
  cachedSettings,
  putSettings,
  adaptersStatus,
  wechatStatus,
  chaoxingLogin,
  chaoxingImportCookie,
  chaoxingLogout,
  xiaoyaLogout,
  chaoxingRefresh,
  chaoxingSyncNotices,
  wechatAiClassify,
  wechatDigestBackfill,
  refreshStatus,
  aiStatus,
  type AiStatus,
  workspaceInfo,
  openWorkspace,
  wechatUpdateCheck,
  wechatReanalyze,
  cloudStatus,
  getSmtpConfig,
  saveSmtpConfig,
  testSmtp,
  emailStatus,
  cloudConfig,
  cloudNow,
  type CloudStatus,
  type WorkspaceInfo
} from '../lib/api'
import {
  DEFAULT_SECTIONS,
  KEY_AUTO_TIME,
  KEY_SECTIONS,
  parseSections,
  type SectionTime
} from '../lib/schedule'
import { withViewTransition } from '../lib/viewTransition'

type Tab = 'general' | 'runtime' | 'ai' | 'calendar' | 'sync' | 'wechat' | 'platforms'

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'general', label: '常规', icon: Settings2 },
  { key: 'runtime', label: '运行状态', icon: Activity },
  { key: 'ai', label: 'AI 模型', icon: Sparkles },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'sync', label: '同步频率', icon: RefreshCw },
  { key: 'wechat', label: '微信监听', icon: MessageSquare },
  { key: 'platforms', label: '学习平台', icon: GraduationCap }
]

interface Runtime {
  chaoxing: boolean
  xiaoya: boolean
  chaoxingAccount?: string
  xiaoyaAccount?: string
  wechat: 'running' | 'offline' | 'not_configured'
  ai: boolean
}

/** 设置页（规格 §7.5）：运行状态 / AI Key / 工作区 / 轮询间隔 / 微信 / 学习通。 */
function SettingsPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('general')
  const [values, setValues] = useState<Record<string, string>>({})
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [ws, setWs] = useState<WorkspaceInfo | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  // 服务商 / 模型选择
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [aiClassifyMsg, setAiClassifyMsg] = useState('')
  const [cloud, setCloud] = useState<CloudStatus | null>(null)
  const [cloudUrl, setCloudUrl] = useState('')
  const [cloudMsg, setCloudMsg] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')
  const [smtp, setSmtp] = useState({ host: '', port: '465', user: '', sender: '', ssl: '1' })
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpMsg, setSmtpMsg] = useState('')
  const [autoStart, setAutoStart] = useState<{
    app: boolean
    tunnel: boolean
    tunnelAvailable: boolean
  } | null>(null)
  const [autoMsg, setAutoMsg] = useState('')
  const [digestBackfillMsg, setDigestBackfillMsg] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const doDigestBackfill = async (): Promise<void> => {
    setDigestBackfillMsg('正在排队…')
    try {
      const r = await wechatDigestBackfill(200)
      setDigestBackfillMsg(`已排队 ${r.queued} 条，剩余未化简 ${r.pending} 条`)
    } catch (e) {
      setDigestBackfillMsg(String(e).replace(/^Error:\s*/, ''))
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const st = await window.api?.getAutostart?.()
        if (st) setAutoStart(st)
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await getSmtpConfig()
        if (cfg.ok) setSmtp({ host: cfg.host, port: cfg.port, user: cfg.user, sender: cfg.sender, ssl: cfg.ssl })
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const st = await cloudStatus()
        setCloud(st)
        setCloudUrl(st.url || '')
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  const saveCloud = async (body: { enabled?: boolean; url?: string }): Promise<void> => {
    await cloudConfig(body)
    const st = await cloudStatus()
    setCloud(st)
    setCloudMsg(st.ready ? '已开启' : st.message)
  }

  const toggleAutostartAll = async (): Promise<void> => {
    if (!autoStart) return
    const next = !(autoStart.app && autoStart.tunnel)
    setAutoMsg('')
    try {
      const r1 = await window.api?.setAutostart?.('app', next)
      if (r1 && !r1.ok) {
        setAutoMsg('设置失败')
        return
      }
      if (autoStart.tunnelAvailable) {
        const r2 = await window.api?.setAutostart?.('tunnel', next)
        if (r2 && !r2.ok) {
          setAutoMsg('已开启应用自启，但后台连接未能设置')
        }
      }
      const st = await window.api?.getAutostart?.()
      if (st) setAutoStart(st)
    } catch {
      setAutoMsg('设置失败')
    }
  }

  const doAiClassify = async (): Promise<void> => {
    setAiBusy(true)
    setAiClassifyMsg('正在让 AI 判定…')
    try {
      const r = await wechatAiClassify(60)
      setAiClassifyMsg(
        r.ok ? `本轮 ${r.done ?? 0} 条，剩余 ${r.pending ?? 0} 条` : r.message || '失败'
      )
    } catch (e) {
      setAiClassifyMsg(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setAiBusy(false)
    }
  }
  // ---- 常规页 ----
  const [appVersion, setAppVersion] = useState('')
  const [cliVersion, setCliVersion] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profileClass, setProfileClass] = useState('')
  const [profileOrgs, setProfileOrgs] = useState('')
  const [compMsg, setCompMsg] = useState('')
  // 关闭窗口行为：ask / tray / quit（存在主进程，不占后端设置）
  const [closeAction, setCloseAction] = useState<'ask' | 'tray' | 'quit'>('ask')
  // 硬件加速（主进程设置，改动需重启生效）
  const [gpu, setGpu] = useState<{ enabled: boolean; active: boolean; forcedByEnv: boolean } | null>(null)
  const [gpuRestart, setGpuRestart] = useState(false)
  // 日历：显示农历（默认开）
  const [lunarOn, setLunarOn] = useState(true)
  const [checking, setChecking] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)

  /** 把一份设置对象填进表单（本地缓存与后端结果共用） */
  const applySettings = (s: Record<string, string>): void => {
    setValues(s)
    setProfileName(s.profile_name || '')
    setProfileClass(s.profile_class || '')
    setProfileOrgs(s.profile_orgs || '')
    setLunarOn(s.calendar_lunar !== 'off')
  }

  /** 手动刷新连接状态（运行状态页的「刷新状态」按钮） */
  const refreshRuntime = async (): Promise<void> => {
    const [adapters, wechat, aiS] = await Promise.allSettled([
      adaptersStatus(),
      wechatStatus(),
      aiStatus()
    ])
    setRuntime({
      chaoxing: adapters.status === 'fulfilled' ? adapters.value.chaoxing.logged_in : false,
      xiaoya: adapters.status === 'fulfilled' ? adapters.value.xiaoya.logged_in : false,
      chaoxingAccount: adapters.status === 'fulfilled' ? adapters.value.chaoxing.account : '',
      xiaoyaAccount: adapters.status === 'fulfilled' ? adapters.value.xiaoya.account : '',
      wechat:
        wechat.status === 'fulfilled' ? wechat.value.listener.state : ('not_configured' as const),
      ai: aiS.status === 'fulfilled' ? aiS.value.configured : false
    })
    if (wechat.status === 'fulfilled') {
      setCliVersion(wechat.value.env?.version || '')
    }
    if (aiS.status === 'fulfilled') setAi(aiS.value)
  }

  useEffect(() => {
    // 1) 先用本地缓存瞬间渲染表单，不等后端
    const cached = cachedSettings()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 用本地缓存铺首帧，避免表单先空后跳
    if (Object.keys(cached).length) applySettings(cached)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 缓存命中即可立即结束骨架态
    setLoading(false)
    void window.api
      ?.getVersion?.()
      .then((v) => setAppVersion(v))
      .catch(() => undefined)
    void window.api
      ?.getGpu?.()
      .then((g) => setGpu(g))
      .catch(() => undefined)
    void window.api
      ?.getCloseAction?.()
      .then((v) => setCloseAction(v))
      .catch(() => undefined)

    // 2) 其余数据并行拉取：谁先回来谁先显示，互不阻塞
    void (async () => {
      const [st, _cache, ws, adapters, wechat] = await Promise.allSettled([
        getSettings(),
        Promise.resolve(null),
        workspaceInfo(false),
        adaptersStatus(),
        wechatStatus()
      ])
      if (st.status === 'fulfilled') applySettings(st.value)

      if (ws.status === 'fulfilled') setWs(ws.value)
      if (wechat.status === 'fulfilled') {
        setCliVersion(wechat.value.env?.version || '')
      }
      setRuntime({
        chaoxing: adapters.status === 'fulfilled' ? adapters.value.chaoxing.logged_in : false,
        xiaoya: adapters.status === 'fulfilled' ? adapters.value.xiaoya.logged_in : false,
        chaoxingAccount: adapters.status === 'fulfilled' ? adapters.value.chaoxing.account : '',
        xiaoyaAccount: adapters.status === 'fulfilled' ? adapters.value.xiaoya.account : '',
        wechat:
          wechat.status === 'fulfilled'
            ? wechat.value.listener.state
            : ('not_configured' as const),
        ai: false
      })
      void _cache
    })()

    // 3) AI 状态单独一条链路（它内部可能要读密钥，慢一点但不挡别的）
    void (async () => {
      try {
        const st = await aiStatus()
        setAi(st)
        setRuntime((r) => (r ? { ...r, ai: st.configured } : r))
      } catch {
        /* 后端未就绪时忽略 */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 「运行状态」页自动刷新：之前只在打开设置时读一次，之后一直是旧状态
  useEffect(() => {
    if (tab !== 'runtime') return
    const tick = (): void => {
      if (document.visibilityState === 'visible') void refreshRuntime()
    }
    tick()
    const timer = window.setInterval(tick, 5000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const save = async (patch: Record<string, string>): Promise<void> => {
    await putSettings(patch)
    setValues((v) => ({ ...v, ...patch }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const wechatText =
    runtime?.wechat === 'running'
      ? '监听中'
      : runtime?.wechat === 'offline'
        ? '未启动'
        : '未配置'

  return (
    <div>
      <header className="settings-head">
        <div className="eyebrow">Preferences</div>
        <h1 className="page-title">设置</h1>
        <p className="page-sub">连接状态、模型与同步节奏。所有密钥保存在系统凭据管理器，不落明文。</p>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="设置分区">
          <div className="settings-nav-label">分区</div>
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                className={`settings-nav-btn${tab === t.key ? ' active' : ''}`}
                onClick={() => {
                  if (t.key === tab) return
                  const from = TABS.findIndex((x) => x.key === tab)
                  const to = TABS.findIndex((x) => x.key === t.key)
                  withViewTransition('settings', to > from ? 'left' : 'right', () => setTab(t.key))
                }}
                aria-current={tab === t.key ? 'page' : undefined}
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{t.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="settings-content" key={tab}>
          {loading ? (
            <section className="settings-section">
              <h2>加载中…</h2>
              <p className="desc">正在读取本地配置。</p>
            </section>
          ) : (
            <>
              {tab === 'general' && (
                <>
                  <section className="settings-section">
                    <h2>我的信息</h2>
                    <p className="desc">
                      用来判断群消息「跟我有没有关系」：命中姓名/班级/组织会提高相关度，只存在本机。
                    </p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">姓名</div>
                        <div className="setting-hint">群消息里出现你的名字时会标为相关</div>
                        <div className="setting-control">
                          <input
                            className="input"
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            placeholder="如：张三"
                          />
                        </div>
                      </div>
                      <div className="setting-row">
                        <div className="setting-label">班级</div>
                        <div className="setting-hint">如：25软件工程B班</div>
                        <div className="setting-control">
                          <input
                            className="input"
                            value={profileClass}
                            onChange={(e) => setProfileClass(e.target.value)}
                            placeholder="如：25软件工程B班"
                          />
                        </div>
                      </div>
                      <div className="setting-row">
                        <div className="setting-label">组织 / 社团</div>
                        <div className="setting-hint">多个用逗号分隔，如：学生会,计算机协会</div>
                        <div className="setting-control">
                          <input
                            className="input"
                            value={profileOrgs}
                            onChange={(e) => setProfileOrgs(e.target.value)}
                            placeholder="学生会,计算机协会"
                          />
                        </div>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="btn btn-secondary sm"
                          onClick={() =>
                            void save({
                              profile_name: profileName.trim(),
                              profile_class: profileClass.trim(),
                              profile_orgs: profileOrgs.trim()
                            })
                          }
                        >
                          <Save size={13} /> 保存
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>工作区</h2>
                    <p className="desc">
                      助手整理资料用的文件夹。只会在里面新建文件，不会删你已有的东西。
                    </p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">位置</div>
                        <div className="setting-hint" title={ws?.root || ''}>
                          {ws?.root || '未配置'}
                        </div>
                        <div className="setting-control">
                          <button className="btn btn-ghost sm" onClick={() => void openWorkspace()}>
                            <FolderOpen size={13} /> 打开目录
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>关闭窗口</h2>
                    <p className="desc">
                      点右上角 × 时的行为。最小化到托盘后程序仍在后台运行，DDL 提醒和微信监听都不会中断。
                    </p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">行为</div>
                        <div className="setting-hint">选「每次询问」时，弹窗里可勾选不再询问</div>
                        <div className="setting-control">
                          <select
                            className="input"
                            value={closeAction}
                            onChange={(e) => {
                              const v = e.target.value as 'ask' | 'tray' | 'quit'
                              setCloseAction(v)
                              void window.api?.setCloseAction?.(v)
                            }}
                          >
                            <option value="ask">每次询问</option>
                            <option value="tray">最小化到托盘</option>
                            <option value="quit">直接退出</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>到期提醒</h2>
                    <p className="desc">
                      截止前 1 小时提醒一次。可以设置免打扰时段，这段时间内不发通知（夜里不会被吵醒）。
                    </p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">免打扰</div>
                        <div className="setting-hint">
                          {values.dnd_enabled === '1'
                            ? `已开启 ${values.dnd_start || '23:00'} – ${values.dnd_end || '07:00'}`
                            : '未开启'}
                        </div>
                        <div className="setting-control">
                          <button
                            className="switch"
                            role="switch"
                            aria-checked={values.dnd_enabled === '1'}
                            onClick={() =>
                              void save({ dnd_enabled: values.dnd_enabled === '1' ? '0' : '1' })
                            }
                          />
                        </div>
                      </div>
                      {values.dnd_enabled === '1' && (
                        <div className="inline-actions">
                          <label className="setting-hint">开始</label>
                          <input
                            className="input"
                            type="time"
                            value={values.dnd_start || '23:00'}
                            onChange={(e) => void save({ dnd_start: e.target.value })}
                            style={{ maxWidth: 130 }}
                          />
                          <label className="setting-hint">结束</label>
                          <input
                            className="input"
                            type="time"
                            value={values.dnd_end || '07:00'}
                            onChange={(e) => void save({ dnd_end: e.target.value })}
                            style={{ maxWidth: 130 }}
                          />
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>新手引导</h2>
                    <p className="desc">
                      第一次使用时的 5 步指引：账号登录 → 学习平台 → AI → 文本导入 → 课表。
                    </p>
                    <div className="body">
                      <div className="inline-actions">
                        <button
                          className="btn btn-secondary sm"
                          onClick={() => {
                            window.dispatchEvent(new Event('ca:guide-replay'))
                            toast('正在重新显示引导')
                          }}
                        >
                          重新查看新手引导
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>开机自启</h2>
                    <p className="desc">
                      开机后在后台自动运行，手机随时能连上。关掉后需要手动打开应用才会同步。
                    </p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">开机自启</div>
                        <div className="setting-hint">
                          {!autoStart ? '检测中…' : autoStart.app && autoStart.tunnel ? '已开启' : '未开启'}
                        </div>
                        <div className="setting-control">
                          <button
                            className="switch"
                            role="switch"
                            aria-checked={!!(autoStart?.app && autoStart?.tunnel)}
                            disabled={!autoStart}
                            onClick={() => void toggleAutostartAll()}
                          />
                        </div>
                      </div>
                      {autoMsg && (
                        <div className="status-note">
                          <span>{autoMsg}</span>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>性能</h2>
                    <p className="desc">
                      硬件加速让滚动、动画、弹窗更流畅。个别虚拟机或远程桌面环境开启后可能出现白屏，那时可以关掉。
                    </p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">硬件加速</div>
                        <div className="setting-hint">
                          {gpu?.forcedByEnv
                            ? '已被环境变量 CA_SOFTWARE_RENDER=1 强制关闭，开关无效'
                            : gpuRestart
                              ? '已修改，重启后生效'
                              : gpu?.active
                                ? '当前已启用（默认）'
                                : '当前已关闭（软件渲染）'}
                        </div>
                        <div className="setting-control">
                          <button
                            className="switch"
                            role="switch"
                            aria-checked={!!gpu?.enabled}
                            disabled={!gpu || gpu.forcedByEnv}
                            onClick={async () => {
                              if (!gpu) return
                              const next = !gpu.enabled
                              setGpu({ ...gpu, enabled: next })
                              const r = await window.api?.setGpu?.(next)
                              setGpuRestart(!!r?.restartRequired)
                            }}
                          />
                        </div>
                      </div>
                      {gpuRestart && (
                        <div className="inline-actions">
                          <button
                            className="btn btn-secondary sm"
                            onClick={() => void window.api?.relaunch?.()}
                          >
                            立即重启生效
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>邮件（找回密码）</h2>
                    <p className="desc">
                      配好 SMTP 后，忘记密码可以用邮箱验证码找回。QQ 邮箱：smtp.qq.com / 465 / 授权码。
                    </p>
                    <div className="body setting-stack">
                      <div className="inline-actions">
                        <input
                          className="input"
                          placeholder="SMTP 主机"
                          value={smtp.host}
                          onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                          style={{ maxWidth: 200 }}
                        />
                        <input
                          className="input"
                          placeholder="端口"
                          value={smtp.port}
                          onChange={(e) => setSmtp({ ...smtp, port: e.target.value })}
                          style={{ maxWidth: 90 }}
                        />
                      </div>
                      <div className="inline-actions">
                        <input
                          className="input"
                          placeholder="发件邮箱"
                          value={smtp.user}
                          onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                          style={{ maxWidth: 220 }}
                        />
                        <input
                          className="input"
                          type="password"
                          placeholder="授权码（留空表示不修改）"
                          value={smtpPass}
                          onChange={(e) => setSmtpPass(e.target.value)}
                          style={{ maxWidth: 220 }}
                        />
                      </div>
                      <div className="inline-actions">
                        <button
                          className="btn btn-secondary sm"
                          onClick={async () => {
                            const r = await saveSmtpConfig({
                              host: smtp.host,
                              port: Number(smtp.port) || 465,
                              user: smtp.user,
                              password: smtpPass || undefined,
                              sender: smtp.sender || smtp.user,
                              ssl: smtp.ssl === '1'
                            })
                            setSmtpMsg(r.ok ? '已保存' : r.message || '保存失败')
                            setSmtpPass('')
                          }}
                        >
                          保存
                        </button>
                        <button
                          className="btn btn-ghost sm"
                          onClick={async () => {
                            setSmtpMsg('测试中…')
                            const r = await testSmtp()
                            setSmtpMsg(r.message)
                          }}
                        >
                          发送测试邮件
                        </button>
                        <button
                          className="btn btn-ghost sm"
                          onClick={async () => {
                            const st = await emailStatus()
                            setSmtpMsg(st.configured ? 'SMTP 已配置' : 'SMTP 未配置')
                          }}
                        >
                          检查状态
                        </button>
                      </div>
                      {smtpMsg && (
                        <div className="status-note">
                          <span>{smtpMsg}</span>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>版本更新</h2>
                    <p className="desc">从 GitHub 检查是否有新版本。</p>
                    <div className="body setting-stack">
                      <div className="inline-actions">
                        <button
                          className="btn btn-secondary sm"
                          onClick={async () => {
                            setUpdateMsg('检查中…')
                            const r = await window.api?.checkUpdate?.()
                            if (!r || !r.ok) {
                              setUpdateMsg(r?.message || '检查失败')
                              return
                            }
                            if (r.newer) {
                              setUpdateMsg(`发现新版本 ${r.latest}（当前 ${r.current}），正在下载…`)
                              const d = await window.api?.downloadUpdate?.()
                              if (d?.ok && d.path) {
                                setUpdateMsg(`已下载到 ${d.path}`)
                                await window.api?.showInFolder?.(d.path)
                              } else {
                                setUpdateMsg(d?.message || '下载失败，可点「打开下载页」手动下载')
                              }
                            } else {
                              setUpdateMsg(`已是最新版本 ${r.current}`)
                            }
                          }}
                        >
                          检查更新
                        </button>
                      </div>
                      {updateMsg && (
                        <div className="status-note">
                          <span>{updateMsg}</span>
                          <button
                            className="btn btn-ghost sm"
                            onClick={() =>
                              void window.api?.openExternal?.(
                                'https://github.com/SillyJay/todolist/releases/latest'
                              )
                            }
                          >
                            打开下载页
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>组件与版本</h2>
                    <p className="desc">本程序版本，以及内置的微信读取组件版本。</p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">程序版本</div>
                        <div className="setting-hint">{appVersion || '未知'}</div>
                      </div>
                      <div className="setting-row">
                        <div className="setting-label">微信组件</div>
                        <div className="setting-hint">{cliVersion || '未检测到'}</div>
                        <div className="setting-control">
                          <button
                            className="btn btn-ghost sm"
                            disabled={checking}
                            onClick={async () => {
                              setChecking(true)
                              try {
                                const r = await wechatUpdateCheck()
                                setCompMsg(
                                  r.error
                                    ? `检查失败：${r.error}`
                                    : `当前 ${r.current || '?'}，最新 ${r.latest || '?'}`
                                )
                              } finally {
                                setChecking(false)
                              }
                            }}
                          >
                            {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                            检查更新
                          </button>
                        </div>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="btn btn-ghost sm"
                          disabled={reanalyzing}
                          onClick={async () => {
                            setReanalyzing(true)
                            try {
                              const r = await wechatReanalyze()
                              setCompMsg(`已重新分类 ${r.updated ?? 0} 条历史消息`)
                            } finally {
                              setReanalyzing(false)
                            }
                          }}
                        >
                          {reanalyzing ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
                          重新分类历史消息
                        </button>
                      </div>
                      {compMsg && <div className="wx-hint">{compMsg}</div>}
                    </div>
                  </section>
                </>
              )}

              {tab === 'runtime' && (

                <section className="settings-section">
                  <h2>运行状态</h2>
                  <p className="desc">
                    工作区位置与各平台连接情况。状态来自本地后端，仅在本机读取。
                  </p>
                  <div className="body">
                    <div className="status-grid">
                      <div className="status-cell">
                        <div className="k">
                          <FolderOpen size={12} /> 工作区
                        </div>
                        <div className="v">
                          <span className="path" title={ws?.root || ''}>
                            {ws?.root || '未配置'}
                          </span>
                        </div>
                      </div>
                      <div className="status-cell">
                        <div className="k">同步间隔</div>
                        <div className="v">
                          <span className="mono">{values.poll_interval_min || '30'} 分钟</span>
                        </div>
                      </div>
                      <StatusCell
                        label="学习通"
                        on={runtime?.chaoxing}
                        onText={
                          runtime?.chaoxingAccount ? `已登录 · ${runtime.chaoxingAccount}` : '已登录'
                        }
                        offText="未登录"
                      />
                      <StatusCell
                        label="小雅"
                        on={runtime?.xiaoya}
                        onText={runtime?.xiaoyaAccount ? `已登录 · ${runtime.xiaoyaAccount}` : '已登录'}
                        offText="未登录"
                      />
                      <div className="status-cell">
                        <div className="k">微信群</div>
                        <div className="v">
                          <span
                            className={`status-dot${runtime?.wechat === 'running' ? ' on' : runtime?.wechat === 'offline' ? ' wait' : ''}`}
                          />
                          {wechatText}
                        </div>
                      </div>
                      <StatusCell
                        label="AI 模型"
                        on={runtime?.ai}
                        onText={ai?.model || '已连接'}
                        offText="未配置"
                      />
                    </div>

                    <div className="inline-actions" style={{ marginTop: 14 }}>
                      <button className="btn btn-secondary sm" onClick={() => void openWorkspace()}>
                        <FolderOpen size={14} strokeWidth={1.8} /> 打开工作区
                      </button>
                      <button className="btn btn-ghost sm" onClick={() => void refreshRuntime()}>
                        <RefreshCw size={14} strokeWidth={1.8} /> 刷新状态
                      </button>
                    </div>

                    <div className="status-note" style={{ marginTop: 14 }}>
                      <AlertCircle size={14} />
                      <span>任务与附件都存放在工作区；重名文件只增不删，不会覆盖既有内容。</span>
                    </div>
                  </div>
                </section>
              )}

              {tab === 'ai' && (
                <>
                  <AiProvidersSection />
                  <section className="settings-section">
                    <h2>消息分类（AI）</h2>
                    <p className="desc">
                      关键词规则只做预筛，最终由模型判断「这条要不要打扰我」。分错了可以在消息详情里直接改，模型会记住这个例子。
                    </p>
                    <div className="body">
                      <div className="inline-actions">
                        <button
                          className="btn btn-secondary sm"
                          onClick={() => void doDigestBackfill()}
                        >
                          补化简未处理消息
                        </button>
                        <button
                          className="btn btn-secondary sm"
                          onClick={() => void doAiClassify()}
                          disabled={aiBusy}
                        >
                          让 AI 判定未分类消息
                        </button>
                      </div>
                      {digestBackfillMsg && (
                        <div className="status-note">
                          <span>{digestBackfillMsg}</span>
                        </div>
                      )}
                      {aiClassifyMsg && (
                        <div className="status-note">
                          <span>{aiClassifyMsg}</span>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}

              {tab === 'calendar' && (
                <>
                  <section className="settings-section">
                    <h2>日历显示</h2>
                    <p className="desc">控制日历里显示哪些附加信息。所有设置立即生效，不需要重启。</p>
                    <div className="body setting-stack">
                      <div className="setting-row">
                        <div className="setting-label">显示农历</div>
                        <div className="setting-hint">
                          月视图格子里显示农历日期，周/日视图标题旁也会显示（如「九月十七」）
                        </div>
                        <div className="setting-control">
                          <button
                            className="switch"
                            role="switch"
                            aria-checked={lunarOn}
                            onClick={() => {
                              const next = !lunarOn
                              setLunarOn(next)
                              void save({ calendar_lunar: next ? 'on' : 'off' })
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2>课表时间</h2>
                    <p className="desc">
                      超星返回的作息时间常与学校实际不符。相关配置在「学习通」分区里（自动获取 / 手动配置每节课时间）。
                    </p>
                  </section>
                </>
              )}

              {tab === 'sync' && (
                <>
                <section className="settings-section">
                  <h2>云端同步</h2>
                  <p className="desc">
                    把本机采集到的任务推到服务器，手机端和别的设备就能看到；手机建的日程也会同步回来。
                  </p>
                  <div className="body setting-stack">
                    <div className="setting-row">
                      <div className="setting-label">开启同步</div>
                      <div className="setting-hint">
                        {!cloud ? '检测中…' : cloud.enabled ? (cloud.ready ? '已开启' : cloud.message) : '未开启'}
                      </div>
                      <div className="setting-control">
                        <button
                          className="switch"
                          role="switch"
                          aria-checked={!!cloud?.enabled}
                          disabled={!cloud}
                          onClick={() => void saveCloud({ enabled: !cloud?.enabled })}
                        />
                      </div>
                    </div>
                    <div className="inline-actions">
                      <input
                        className="input"
                        placeholder="服务器地址，如 https://todo.example.com"
                        value={cloudUrl}
                        onChange={(e) => setCloudUrl(e.target.value)}
                        style={{ maxWidth: 320 }}
                      />
                      <button className="btn btn-secondary sm" onClick={() => void saveCloud({ url: cloudUrl })}>
                        保存地址
                      </button>
                      <button
                        className="btn btn-ghost sm"
                        onClick={async () => {
                          setCloudMsg('同步中…')
                          try {
                            const r = await cloudNow()
                            setCloudMsg(
                              r.ok
                                ? `已推送 ${r.push?.pushed ?? 0} 条，拉回 ${r.pull?.pulled ?? 0} 条`
                                : r.push?.message || '同步失败'
                            )
                          } catch (e) {
                            setCloudMsg(String(e).replace(/^Error:\s*/, ''))
                          }
                        }}
                      >
                        立即同步
                      </button>
                    </div>
                    {cloudMsg && (
                      <div className="status-note">
                        <span>{cloudMsg}</span>
                      </div>
                    )}
                  </div>
                </section>

                <section className="settings-section">
                  <h2>同步频率</h2>
                  <p className="desc">学习通作业轮询间隔（课表不参与轮询）。间隔越短越及时，但请求更频繁。</p>
                  <div className="body">
                    <div className="pill-row">
                      {['15', '30', '60', '120'].map((m) => (
                        <button
                          key={m}
                          className="pill"
                          aria-pressed={(values.poll_interval_min || '30') === m}
                          onClick={() => void save({ poll_interval_min: m })}
                        >
                          {m} 分钟
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
                </>
              )}

              {tab === 'wechat' && <WeChatSection />}

              {tab === 'platforms' && (
                <>
                  <ChaoxingSection />
                  <XiaoyaSection />
                  <ScheduleTimeSection />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {saved && (
        <div className="toast-stack">
          <div className="toast">
            <Check size={13} className="icon" /> 已保存
          </div>
        </div>
      )}
    </div>
  )
}

function StatusCell({
  label,
  on,
  onText,
  offText
}: {
  label: string
  on?: boolean
  onText: string
  offText: string
}): React.JSX.Element {
  return (
    <div className="status-cell">
      <div className="k">{label}</div>
      <div className="v">
        <span className={`status-dot${on ? ' on' : ''}`} />
        {on ? onText : offText}
      </div>
    </div>
  )
}

function WeChatSection(): React.JSX.Element {
  return (
    <section className="settings-section">
      <h2>微信监听</h2>
      <p className="desc">
        监听指定微信群，自动从「作业 / 截止 / 提交」类消息里提取任务。微信侧只读，不发消息。
      </p>
      <div className="body">
        <WeChatPanel />
      </div>
    </section>
  )
}

/** 讯飞小雅登录区块（与学习通并列在「学习平台」里） */
function XiaoyaSection(): React.JSX.Element {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [account, setAccount] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const a = await adaptersStatus()
      setLoggedIn(a.xiaoya.logged_in)
      setAccount(a.xiaoya.account || '')
    } catch {
      setLoggedIn(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const doLogin = async (): Promise<void> => {
    setBusy(true)
    setMsg('请在弹出的窗口里完成登录…')
    try {
      const r = await window.api?.openLogin?.('xiaoya')
      if (r && !r.ok) setMsg(r.message || '登录失败')
      else setMsg('登录成功')
      await refresh()
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const doLogout = async (): Promise<void> => {
    setBusy(true)
    try {
      await xiaoyaLogout()
      setMsg('已退出')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <h2>讯飞小雅</h2>
      <p className="desc">
        用小雅账号同步课程资料与作业。登录态只存在本机，不会上传。
      </p>
      <div className="body setting-stack">
        <div className="setting-row">
          <div className="setting-label">状态</div>
          <div className="setting-hint">
            {loggedIn === null ? '检测中…' : loggedIn ? `已登录${account ? ` · ${account}` : ''}` : '未登录'}
          </div>
          <div className="setting-control">
            {loggedIn ? (
              <button className="btn btn-ghost sm" disabled={busy} onClick={() => void doLogout()}>
                退出登录
              </button>
            ) : (
              <button className="btn btn-secondary sm" disabled={busy} onClick={() => void doLogin()}>
                用内置浏览器登录
              </button>
            )}
          </div>
        </div>
        {msg && (
          <div className="status-note">
            <span>{msg}</span>
          </div>
        )}
      </div>
    </section>
  )
}

/** 学习通登录区块（规格 §7.2）：账号登录 / Cookie 导入 / 立即刷新 */
function ChaoxingSection(): React.JSX.Element {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [account, setAccount] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await adaptersStatus()
        setLoggedIn(s.chaoxing.logged_in)
        setAccount(s.chaoxing.account || '')
      } catch {
        setLoggedIn(false)
      }
    })()
  }, [])

  const doLogin = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await chaoxingLogin(username, password)
      setMsg(r.message)
      if (r.ok) {
        setLoggedIn(true)
        setAccount(username)
      }
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  const doCookie = async (): Promise<void> => {
    const raw = window.prompt('粘贴浏览器 Cookie（需包含 _uid 与 _d）')
    if (!raw) return
    setBusy(true)
    try {
      const r = await chaoxingImportCookie(raw)
      setMsg(r.message)
      if (r.ok) {
        setLoggedIn(true)
        // Cookie 导入没有用户名，重新拉一次状态，由后端解析账号标识
        try {
          const st = await adaptersStatus()
          setAccount(st.chaoxing.account || '')
        } catch {
          /* 忽略 */
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const doLogout = async (): Promise<void> => {
    if (!window.confirm('确定退出学习通登录？\n\n只会清除本机保存的 Cookie，不会影响你的超星账号。')) return
    setBusy(true)
    setMsg('')
    try {
      const r = await chaoxingLogout()
      setMsg(r.message)
      if (r.ok) {
        setLoggedIn(false)
        setAccount('')
        setPassword('')
      }
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const doSyncNotices = async (): Promise<void> => {
    setBusy(true)
    setMsg('正在读取收件箱…')
    try {
      const r = await chaoxingSyncNotices()
      if (!r.ok) {
        setMsg(r.message || '同步失败')
        return
      }
      const parts = [`新增 ${r.created ?? 0} 条`, `跳过重复 ${r.skipped ?? 0} 条`]
      if (r.notice_error) parts.push(`通知接口：${r.notice_error}`)
      setMsg(parts.join(' · '))
    } catch (e) {
      setMsg(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  const doRefresh = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await chaoxingRefresh()
      if (!r.ok) {
        setMsg(r.message || '刷新失败')
        return
      }
      setMsg('已开始后台同步（约 2 分钟），可关闭此页；完成后任务列表会自动更新')
      // 轮询到结束，避免用户以为没反应
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 2000))
        const s = await refreshStatus()
        if (!s.running) {
          setMsg(
            s.error
              ? `同步失败：${s.error}`
              : `同步完成：新增 ${s.created} 条，更新 ${s.updated} 条`
          )
          break
        }
        setMsg(`同步中：${s.done}/${s.total} 门课 · ${s.current}`)
      }
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <h2>学习通</h2>
      <p className="desc">账号登录后自动同步课程作业；遇到验证码可用 Cookie 导入兜底。</p>
      <div className="body setting-stack">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span className={`status-dot${loggedIn ? ' on' : ''}`} />
          <span style={{ color: 'var(--muted)' }}>
            {loggedIn ? (account ? `已登录 · ${account}` : '已登录') : '未登录'}
          </span>
        </div>

        {!loggedIn && (
          <div className="setting-stack">
            <div className="field">
              <label className="field-label">账号</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="手机号 / 学号"
              />
            </div>
            <div className="field">
              <label className="field-label">密码</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doLogin()}
                placeholder="密码"
              />
            </div>
            <div className="inline-actions">
              <button
                className="btn btn-primary sm"
                onClick={() => void doLogin()}
                disabled={busy || !username || !password}
              >
                <LogIn size={14} strokeWidth={1.8} /> 登录
              </button>
            </div>
          </div>
        )}

        <div className="inline-actions">
          <button className="btn btn-secondary sm" onClick={() => void doCookie()} disabled={busy}>
            <Cookie size={14} strokeWidth={1.8} /> 导入 Cookie
          </button>
          <button className="btn btn-secondary sm" onClick={() => void doRefresh()} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} strokeWidth={1.8} />}
            立即刷新作业
          </button>
          {loggedIn && (
            <button className="btn btn-secondary sm" onClick={() => void doSyncNotices()} disabled={busy}>
              同步考试与收件箱
            </button>
          )}
          {loggedIn && (
            <button className="btn btn-ghost sm" onClick={() => void doLogout()} disabled={busy}>
              <LogOut size={14} strokeWidth={1.8} /> 退出登录
            </button>
          )}
        </div>

        {msg && (
          <div className="status-note">
            <AlertCircle size={14} />
            <span style={{ wordBreak: 'break-all' }}>{msg}</span>
          </div>
        )}
      </div>
    </section>
  )
}


/** 课表时间：是否自动获取超星时间 + 手动配置每节课时间 */
function ScheduleTimeSection(): React.JSX.Element {
  const [autoTime, setAutoTime] = useState(false)
  const [sections, setSections] = useState<SectionTime[]>(DEFAULT_SECTIONS)
  const [custom, setCustom] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings()
        setAutoTime(s[KEY_AUTO_TIME] === 'on')
        const parsed = parseSections(s[KEY_SECTIONS])
        setCustom(!!parsed)
        if (parsed) setSections(parsed)
      } catch {
        /* 忽略 */
      }
    })()
  }, [])

  const save = async (next: { auto?: boolean; list?: SectionTime[] }): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const patch: Record<string, string> = {}
      if (next.auto !== undefined) patch[KEY_AUTO_TIME] = next.auto ? 'on' : 'off'
      if (next.list) patch[KEY_SECTIONS] = JSON.stringify(next.list)
      await putSettings(patch)
      setMsg('已保存')
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <h2>课表时间</h2>
      <p className="desc">
        超星返回的上课时间经常和学校实际作息对不上。可以开启「自动获取超星课表时间」，
        或手动配置每节课的起止时间（手动配置优先用于显示）。
      </p>

      <div className="body setting-stack">
        <div className="setting-row">
          <div className="setting-label">
            <b>自动获取超星课表时间</b>
            <div className="setting-hint">
              关闭时周视图只显示「第几节」，日视图使用下面配置的时间
            </div>
          </div>
          <button
            className="switch"
            role="switch"
            aria-checked={autoTime}
            disabled={busy}
            onClick={async () => {
              const next = !autoTime
              setAutoTime(next)
              await save({ auto: next })
            }}
          />
        </div>

        <div className="setting-row" style={{ alignItems: 'flex-start' }}>
          <div className="setting-label" style={{ flex: 1 }}>
            <b>每节课时间</b>
            <div className="setting-hint">按学校作息表填写；留空则使用默认值</div>

            <div className="section-time-grid">
              {sections.map((s, i) => (
                <div key={s.no} className="section-time-row">
                  <span className="mono">第 {s.no} 节</span>
                  <input
                    type="time"
                    className="input"
                    value={s.start}
                    onChange={(e) => {
                      const next = sections.map((x, j) =>
                        j === i ? { ...x, start: e.target.value } : x
                      )
                      setSections(next)
                    }}
                  />
                  <span className="mono">—</span>
                  <input
                    type="time"
                    className="input"
                    value={s.end}
                    onChange={(e) => {
                      const next = sections.map((x, j) =>
                        j === i ? { ...x, end: e.target.value } : x
                      )
                      setSections(next)
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="inline-actions" style={{ marginTop: 10 }}>
              <button
                className="btn btn-primary sm"
                disabled={busy}
                onClick={async () => {
                  setCustom(true)
                  await save({ list: sections })
                }}
              >
                保存节次时间
              </button>
              <button
                className="btn btn-ghost sm"
                disabled={busy}
                onClick={async () => {
                  setSections(DEFAULT_SECTIONS)
                  setCustom(false)
                  await putSettings({ [KEY_SECTIONS]: '' })
                  setMsg('已恢复默认时间')
                }}
              >
                恢复默认
              </button>
              {custom && <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>已自定义</span>}
            </div>
          </div>
        </div>

        {msg && (
          <div className="status-note">
            <Check size={14} />
            <span>{msg}</span>
          </div>
        )}
      </div>
    </section>
  )
}
export default SettingsPage
