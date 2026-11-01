import { useMemo, useState } from 'react'
import type { Msg } from '../lib/types'
import { IconChevronDown, IconMore, IconSearch } from '../components/Icons'

// 分类：key 用来过滤（后端返回的是英文 key），label 用来显示
const CATS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'competition', label: '比赛竞赛' },
  { key: 'homework', label: '作业考试' },
  { key: 'lecture', label: '讲座活动' },
  { key: 'admin', label: '通知安排' },
  { key: 'recruit', label: '招募招新' }
]

const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map((c) => [c.key, c.label]))

function dateLabel(at: string): string {
  const [d] = at.split(' ')
  const [y, m, day] = d.split('-')
  const month = new Date(Number(y), Number(m) - 1, Number(day)).toLocaleString('en-US', {
    month: 'short'
  })
  return `${Number(day)} ${month} ${y}`
}

function timeLabel(at: string): string {
  const t = at.split(' ')[1] || ''
  const [h, mi] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(mi).padStart(2, '0')} ${suffix}`
}

/** Tab 4：消息（AI 摘要流，按日期分组） */
interface Props {
  messages: Msg[]
  /** 未化简的消息数（只提示有没有） */
  pending?: number
  /** 忽略一条消息（写回后端） */
  onIgnore: (m: Msg) => void
  /** 把一条消息转成任务 */
  onToTask: (m: Msg) => void
}

export default function MessagesPage({ messages, pending = 0, onIgnore, onToTask }: Props): React.JSX.Element {
  const [cat, setCat] = useState('all')
  const [picked, setPicked] = useState<Msg | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  const list = useMemo(() => {
    const filtered = cat === 'all' ? messages : messages.filter((m) => m.category === cat)
    // 增量同步是「合并」进来的，新消息会追加到末尾，这里统一按时间倒序
    return [...filtered].sort((a, b) => b.at.localeCompare(a.at))
  }, [cat, messages])

  const groups = useMemo(() => {
    const map = new Map<string, Msg[]>()
    for (const m of list) {
      const key = m.at.slice(0, 10)
      const arr = map.get(key) || []
      arr.push(m)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [list])

  return (
    <div className="screen">
      <div className="nav">
        <button className="nav-title" onClick={() => setFilterOpen((v) => !v)}>
          {CAT_LABEL[cat] || '全部'}
          <IconChevronDown className="chev" />
        </button>
        <span className="nav-actions">
          {pending > 0 && (
            <span className="pending-hint" title={`还有 ${pending} 条等待 AI 化简`}>
              未化简 {pending}
            </span>
          )}
          <button className="icon-btn" aria-label="搜索">
            <IconSearch />
          </button>
          <button className="icon-btn" aria-label="更多">
            <IconMore />
          </button>
        </span>
      </div>

      {filterOpen && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 20px 8px' }}>
          {CATS.map((c) => (
            <button
              key={c.key}
              className={`chip${cat === c.key ? ' on' : ''}`}
              onClick={() => {
                setCat(c.key)
                setFilterOpen(false)
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="list">
        {groups.map(([day, items]) => (
          <div key={day}>
            <div className="group-date">{dateLabel(day)}</div>
            {items.map((m) => (
              <button
                key={m.id}
                className="row"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setPicked(m)}
              >
                <div className="row-text">
                  {m.importance === 'high' && <span className="imp-dot" title="重要" />}
                  {m.digest || '（原文较长，点开查看）'}
                  {!m.simplified && <span className="msg-tag">未简化</span>}
                  <div className="row-meta">{timeLabel(m.at)}</div>
                  <div className="row-meta" style={{ marginTop: 2 }}>{m.group}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
        {list.length === 0 && <div className="empty">这个分类下还没有消息</div>}
      </div>

      {picked && (
        <>
          <div className="sheet-mask" onClick={() => setPicked(null)} />
          <div className="sheet">
            <div className="sheet-grab" />
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span className="chip on">{CAT_LABEL[picked.category] || picked.category}</span>
              <span className="chip">{picked.group}</span>
            </div>
            <h3 style={{ fontSize: 18, lineHeight: 1.5 }}>
              {picked.digest || '（未简化）'}
              {!picked.simplified && <span className="msg-tag">未简化</span>}
            </h3>
            <div className="msg-orig-title">
              原文
              <span className="msg-orig-meta">{timeLabel(picked.at)} · {picked.group}</span>
            </div>
            <div className="msg-orig">{picked.text || '（没有原文）'}</div>
            <div className="sheet-actions">
              <button
                className="btn-plain"
                onClick={() => {
                  onIgnore(picked)
                  setPicked(null)
                }}
              >
                忽略
              </button>
              <button
                className="btn-solid"
                onClick={() => {
                  onToTask(picked)
                  setPicked(null)
                }}
              >
                转为任务
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
