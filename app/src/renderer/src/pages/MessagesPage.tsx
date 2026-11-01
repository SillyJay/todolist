import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  BellOff,
  Check,
  Inbox,
  Loader2,
  RefreshCw,
  Undo2,
  Maximize2,
  X
} from 'lucide-react'
import {
  wechatFeed,
  wechatReclassify,
  wechatDigestOne,
  wechatDigestAllPending,
  wechatFeedGroups,
  wechatFeedSummary,
  wechatIgnore,
  wechatMarkRead,
  wechatMessageToTask,
  type WeChatFeedItem,
  type WeChatFeedSummary
} from '../lib/api'
import { readViewCache, writeViewCache } from '../lib/viewCache'
import { toast } from '../components/Toast'

/** 分类配色（与 ui.css 里的 .msg-badge.* 对应） */
const CATEGORY_TONE: Record<string, string> = {
  competition: 'comp',
  homework: 'hw',
  lecture: 'lec',
  admin: 'adm',
  recruit: 'rec',
  file: 'file',
  chitchat: 'chat',
  misc: 'misc'
}

function relativeTime(text: string): string {
  if (!text) return ''
  const m = text.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return text
  const now = new Date()
  const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]))
  const diff = (now.getTime() - d.getTime()) / 60000
  if (diff < 1) return '刚刚'
  if (diff < 60) return `${Math.round(diff)} 分钟前`
  if (diff < 1440) return `${Math.round(diff / 60)} 小时前`
  return text
}

interface MessagesSnapshot {
  items: WeChatFeedItem[]
  summary: WeChatFeedSummary | null
  groups: { name: string; count: number }[]
}

const msgViewKey = (s: {
  category: string
  group: string
  onlyRelevant: boolean
  onlyUnread: boolean
  showIgnored: boolean
  q: string
}): string =>
  `messages:${s.category}|${s.group}|${+s.onlyRelevant}${+s.onlyUnread}${+s.showIgnored}|${s.q.trim()}`

const DEFAULT_MSG_KEY = msgViewKey({
  category: 'all',
  group: '',
  onlyRelevant: false,
  onlyUnread: false,
  showIgnored: false,
  q: ''
})

function MessagesPage(): React.JSX.Element {
  const [items, setItems] = useState<WeChatFeedItem[]>(
    () => readViewCache<MessagesSnapshot>(DEFAULT_MSG_KEY)?.items ?? []
  )
  const [summary, setSummary] = useState<WeChatFeedSummary | null>(
    () => readViewCache<MessagesSnapshot>(DEFAULT_MSG_KEY)?.summary ?? null
  )
  const [groups, setGroups] = useState<{ name: string; count: number }[]>(
    () => readViewCache<MessagesSnapshot>(DEFAULT_MSG_KEY)?.groups ?? []
  )
  const reqRef = useRef(0)
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  const [category, setCategory] = useState('all')
  const [group, setGroup] = useState('')
  const [onlyRelevant, setOnlyRelevant] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(
    () => readViewCache<MessagesSnapshot>(DEFAULT_MSG_KEY) === undefined
  )
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  // 详情抽屉：显示这条消息的全部信息（原文 / 摘要 / 分类依据）
  const [detail, setDetail] = useState<WeChatFeedItem | null>(null)

  // 摘要：只把 id 排进后端后台队列（单线程限速），然后轮询列表看结果。
  // 后端只接受 AI 归纳结果，降级文本不算完成，所以这里可以放心地等。

  const load = useCallback(async (): Promise<void> => {
    const req = ++reqRef.current
    setError('')
    // 屏上没有内容时才进入骨架态；已有列表则原地静默替换
    if (itemsRef.current.length === 0) setLoading(true)
    try {
      const [feed, sum, gs] = await Promise.all([
        wechatFeed({
          status: category === 'pending' ? 'pending' : 'ready',
          category: category === 'pending' ? undefined : category,
          group,
          onlyRelevant,
          onlyUnread,
          includeIgnored: showIgnored,
          q
        }),
        wechatFeedSummary(),
        wechatFeedGroups()
      ])
      if (req !== reqRef.current) return
      setItems(feed.items)
      setSummary(sum)
      setGroups(gs.items)

      writeViewCache<MessagesSnapshot>(
        msgViewKey({ category, group, onlyRelevant, onlyUnread, showIgnored, q }),
        { items: feed.items, summary: sum, groups: gs.items }
      )
    } catch (e) {
      if (req === reqRef.current) setError(String(e))
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [category, group, onlyRelevant, onlyUnread, showIgnored, q])

  // 过滤条件变化时保留旧列表静默刷新（输入搜索词不会每个字都闪一下）；
  // 首次进入没有快照时 load() 内部才切到骨架屏。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  // 进入页面即把「当前看到的」标为已读（在「只看未读」筛选下不标，否则列表会瞬间清空）
  useEffect(() => {
    if (onlyUnread || !items.length) return
    const unreadIds = items.filter((i) => !i.is_read).map((i) => i.id)
    if (!unreadIds.length) return
    void wechatMarkRead(unreadIds)
      .then(() => {
        setItems((prev) =>
          prev.map((i) => (unreadIds.includes(i.id) ? { ...i, is_read: true } : i))
        )
        window.dispatchEvent(new Event('ca:wechat-read'))
      })
      .catch(() => undefined)
  }, [items, onlyUnread])

  const profile = summary?.profile
  const hasProfile = Boolean(
    profile && (profile.name || profile.class_name || (profile.orgs && profile.orgs.length))
  )

  const tabs = useMemo(() => {
    const order = summary?.order || []
    const labels = summary?.labels || {}
    const counts = summary?.counts || {}
    return [
      { key: 'all', label: '全部', count: summary?.total ?? 0 },
      { key: 'pending', label: `未处理（${summary?.pending ?? 0}）`, count: summary?.pending ?? 0 },
      ...order.map((k) => ({ key: k, label: labels[k] || k, count: counts[k] ?? 0 }))
    ]
  }, [summary])

  const [polling, setPolling] = useState(false)
  const [pendingLeft, setPendingLeft] = useState(0)

  /** 刷新：有未处理就先排队化简并轮询，否则只重拉列表 */
  const doRefresh = async (): Promise<void> => {
    const left = summary?.pending ?? 0
    if (!left) {
      await load()
      return
    }
    setPolling(true)
    setPendingLeft(left)
    try {
      await wechatDigestAllPending()
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const s = await wechatFeedSummary()
        setSummary(s)
        const remain = s.pending ?? 0
        setPendingLeft(remain)
        if (!remain) break
      }
      await load()
    } finally {
      setPolling(false)
    }
  }

  const toTask = async (item: WeChatFeedItem): Promise<void> => {
    setBusyId(item.id)
    setNotice('')
    try {
      const r = await wechatMessageToTask(item.id)
      setNotice(r.created ? '已转成任务，可在「任务」页看到' : '这条已经是任务了')
      await load()
    } catch (e) {
      setNotice(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusyId(null)
    }
  }

  const toggleIgnore = async (item: WeChatFeedItem): Promise<void> => {
    setBusyId(item.id)
    try {
      await wechatIgnore(item.id, !item.ignored)
      setNotice(item.ignored ? '已恢复显示' : '已忽略，不再出现在列表里')
      await load()
      window.dispatchEvent(new Event('ca:wechat-read'))
    } catch (e) {
      setNotice(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="messages-page">
      <header className="page-head compact">
        <div>
          <h1 className="page-title">消息</h1>
          <p className="page-sub">微信群汇总 · 按相关度排序，可直接转成任务。</p>
        </div>
      </header>

      <div className="task-toolbar">
        <div className="segment">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={category === t.key ? 'active' : ''}
              onClick={() => setCategory(t.key)}
            >
              {t.label}
              <span className="msg-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="right">
          <select
            className="input msg-group-select"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            title="按群筛选"
          >
            <option value="">全部群聊</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}（{g.count}）
              </option>
            ))}
          </select>
          <input
            className="input msg-search"
            placeholder="搜索消息内容"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="chip"
            aria-pressed={onlyUnread}
            onClick={() => setOnlyUnread((v) => !v)}
            title="只看还没读过的消息"
          >
            未读
            {(summary?.unread ?? 0) > 0 && <span className="msg-tab-count">{summary?.unread}</span>}
          </button>
          <button
            className="chip"
            aria-pressed={onlyRelevant}
            onClick={() => setOnlyRelevant((v) => !v)}
            title="只显示跟你有关（提到姓名/班级/组织，或本身是作业比赛）的消息"
          >
            只看与我相关
          </button>
          <button
            className="chip"
            aria-pressed={showIgnored}
            onClick={() => setShowIgnored((v) => !v)}
            title="显示被你忽略的消息"
          >
            已忽略{showIgnored && summary?.ignored ? `（${summary.ignored}）` : ''}
          </button>
          <button className="btn btn-secondary sm" onClick={() => void doRefresh()} disabled={polling}>
            <RefreshCw size={14} strokeWidth={1.9} className={loading || polling ? 'spin' : ''} />
            {polling ? `化简中 ${pendingLeft} 条` : '刷新'}
          </button>
        </div>
      </div>

      {!hasProfile && (
        <div className="status-note" style={{ marginBottom: 12 }}>
          <AlertCircle size={14} />
          <span>
            还没设置「我的信息」。去 <b>设置 → 常规</b> 填上姓名、班级、组织，
            才能判断哪些消息跟你有关（现在会按通用规则排序）。
          </span>
        </div>
      )}

      {notice && (
        <div className="status-note" style={{ marginBottom: 12 }}>
          <Check size={14} />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="status-note" style={{ marginBottom: 12 }}>
          <AlertCircle size={14} />
          <span style={{ wordBreak: 'break-all' }}>{error}</span>
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="skeleton-list msg-skeleton" aria-label="正在读取群消息">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skeleton-row tall" key={i}>
              <span className="sk-box" />
              <span className="sk-lines">
                <span className="sk-line" style={{ width: `${74 - i * 6}%` }} />
                <span className="sk-line sm" style={{ width: '100%' }} />
                <span className="sk-line sm" style={{ width: `${42 + i * 4}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="empty-state">
          <Inbox size={22} strokeWidth={1.6} />
          <h3>没有符合条件的消息</h3>
          <p>
            去 <b>设置 → 微信监听</b> 选择要监听的群并开始监听；
            消息会按「比赛 / 作业 / 讲座 / 通知…」分类显示。闲聊灌水不会出现在这里。
          </p>
        </div>
      )}

      <div
        className="msg-list view-swap"
        key={`${category}:${group}:${onlyUnread ? 1 : 0}:${onlyRelevant ? 1 : 0}:${showIgnored ? 1 : 0}`}
      >
        {items.map((m) => (
          <article key={m.id} className={`msg-card${m.is_read ? '' : ' unread'}`}>
            <div className="msg-card-head">
              <span className={`msg-badge ${CATEGORY_TONE[m.category] || 'misc'}`}>
                {m.category_label}
              </span>
              <span className="msg-group" title={m.group}>
                {m.group}
              </span>
              {m.importance && (
                <span
                  className={`msg-imp imp-${m.importance}`}
                  title={`AI 判定：${m.action || m.importance}`}
                >
                  {m.importance === 'high' ? '重要' : m.importance === 'medium' ? '一般' : '不重要'}
                </span>
              )}
              <span className="msg-time">{relativeTime(m.time)}</span>
              {!m.is_read && <span className="msg-unread-dot" title="未读" />}
              {m.needs_action && <span className="msg-flag">需处理</span>}
              {m.ignored && <span className="msg-flag">已忽略</span>}
              <span
                className={`msg-rel${m.relevance >= 45 ? ' hot' : ''}`}
                title={`相关度 ${m.relevance}`}
              >
                {m.relevance}
              </span>
            </div>
                        <p className="msg-text">
              {m.digest_ready ? m.digest : m.text}
              {!m.digest_ready && <span className="msg-digesting">未化简</span>}
            </p>
            <div className="msg-card-foot">
              {m.sender && <span className="msg-sender">{m.sender}</span>}
              {m.reason && <span className="msg-reason">{m.reason}</span>}
              <div className="msg-actions">
                <button
                  className="btn btn-ghost sm"
                  onClick={() => setDetail(m)}
                  title="查看完整信息"
                >
                  <Maximize2 size={12} />
                  详情
                </button>
                <button
                  className="btn btn-ghost sm"
                  disabled={busyId === m.id}
                  onClick={() => void toggleIgnore(m)}
                  title={m.ignored ? '恢复显示' : '不再显示这条'}
                >
                  {m.ignored ? <Undo2 size={12} /> : <BellOff size={12} />}
                  {m.ignored ? '恢复' : '忽略'}
                </button>
                {!m.digest_ready && (
                  <button
                    className="btn btn-ghost sm"
                    onClick={async () => {
                      await wechatDigestOne(m.id)
                      toast('已排入化简队列')
                      void doRefresh()
                    }}
                  >
                    立即化简
                  </button>
                )}
                {m.is_task ? (
                  <span className="msg-done">
                    <Check size={12} /> 已入库
                  </span>
                ) : (
                  <button
                    className="btn btn-ghost sm"
                    disabled={busyId === m.id}
                    onClick={() => void toTask(m)}
                  >
                    {busyId === m.id ? <Loader2 size={12} className="spin" /> : null}
                    转为任务
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {detail &&
        createPortal(
          <div
            className="overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDetail(null)
            }}
          >
            <div className="dialog wide" role="dialog" aria-modal="true" aria-label="消息详情">
              <div className="dialog-head">
                <div>
                  <div className="dialog-title">{detail.category_label} · {detail.group}</div>
                  <div className="dialog-sub">
                    {[detail.sender, detail.time, detail.classify_src === 'ai' ? 'AI 判定' : detail.classify_src === 'manual' ? '手动纠正' : '规则判定']
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <button className="icon-btn" onClick={() => setDetail(null)} aria-label="关闭">
                  <X size={15} />
                </button>
              </div>
              <div className="dialog-body setting-stack">
                <div>
                  <div className="msg-detail-label">简化</div>
                  <div className="msg-detail-text">{detail.digest || '（还没生成）'}</div>
                </div>
                <div>
                  <div className="msg-detail-label">原文</div>
                  <div className="msg-detail-text">{detail.text}</div>
                </div>
                {detail.reason && (
                  <div>
                    <div className="msg-detail-label">判定依据</div>
                    <div className="msg-detail-text">{detail.reason}</div>
                  </div>
                )}
                <div className="reclass-row">
                  <span className="msg-detail-label">分类不对？</span>
                  <select
                    className="input"
                    value={detail.category}
                    onChange={async (e) => {
                      const r = await wechatReclassify(detail.id, e.target.value)
                      if (r.ok) {
                        toast('已纠正，AI 会记住这个例子')
                        setItems((prev) =>
                          prev.map((x) =>
                            x.id === detail.id
                              ? { ...x, category: r.category || x.category, category_label: r.label || x.category_label }
                              : x
                          )
                        )
                        setDetail(null)
                        void load()
                      }
                    }}
                  >
                    {[
                      ['competition', '比赛竞赛'],
                      ['homework', '作业考试'],
                      ['lecture', '讲座活动'],
                      ['admin', '通知安排'],
                      ['recruit', '招募招新'],
                      ['chitchat', '闲聊灌水'],
                      ['file', '文件资料'],
                      ['misc', '其他']
                    ].map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="inline-actions">
                  <button className="btn btn-secondary sm" onClick={() => void toTask(detail)}>
                    转为任务
                  </button>
                  <button
                    className="btn btn-ghost sm"
                    onClick={() => {
                      void toggleIgnore(detail)
                      setDetail(null)
                    }}
                  >
                    {detail.ignored ? '恢复显示' : '忽略这条'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

export default MessagesPage
