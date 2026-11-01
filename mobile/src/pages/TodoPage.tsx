import { useState } from 'react'
import type { Task } from '../lib/types'
import { IconCheck, IconChevronDown, IconMore, IconSearch } from '../components/Icons'
import { hoursLeft, parseYmd, relativeDay } from '../lib/date'

interface Props {
  tasks: Task[]
  onToggle: (id: string) => void
}

/** 单行任务（正常列表和章节分组共用） */
function TaskRow({
  t,
  onToggle
}: {
  t: Task
  onToggle: (id: string) => void
}): React.JSX.Element {
  const due = t.due || ''
  const hot = !!due && !t.done && hoursLeft(due) <= 24
  return (
    <div className={`row${t.done ? ' done' : ''}`}>
      <button
        className={`check${t.done ? ' on' : ''}`}
        onClick={() => onToggle(t.id)}
        aria-label={t.done ? '标记未完成' : '标记完成'}
      >
        <IconCheck />
      </button>
      <div className="row-text">
        {t.display || t.title}
        <div className="row-meta">
          {due ? relativeDay(parseYmd(due.slice(0, 10))) : '无截止时间'}
          {/* 章节类的标题里已经带了课程名，副标题就不重复了 */}
          {t.course && t.kind !== 'chapter' ? ` · ${t.course}` : ''}
        </div>
      </div>
      <div className="row-right">
        {due && <span className={hot ? 'due-hot' : ''}>{due.slice(11, 16)}</span>}
      </div>
    </div>
  )
}

/** Tab 1：To do（MinimaList 的勾选列表） */
export default function TodoPage({ tasks, onToggle }: Props): React.JSX.Element {
  const [showChapters, setShowChapters] = useState(false)

  const byDue = (a: Task, b: Task): number => {
    if (a.done !== b.done) return a.done ? 1 : -1
    // 没有截止时间的排在后面
    if (!a.due && b.due) return 1
    if (a.due && !b.due) return -1
    return (a.due || '').localeCompare(b.due || '')
  }

  // 纯章节类（第六章、实验1…）折叠起来，主列表只放真正的任务
  const main = tasks.filter((t) => t.kind !== 'chapter').sort(byDue)
  const chapters = tasks.filter((t) => t.kind === 'chapter').sort(byDue)
  const chaptersUndone = chapters.filter((t) => !t.done).length

  return (
    <div className="screen">
      <div className="nav">
        <span className="nav-title">
          To do
          <IconChevronDown className="chev" />
        </span>
        <span className="nav-actions">
          <button className="icon-btn" aria-label="搜索">
            <IconSearch />
          </button>
          <button className="icon-btn" aria-label="更多">
            <IconMore />
          </button>
        </span>
      </div>

      <div className="list">
        {main.map((t) => (
          <TaskRow key={t.id} t={t} onToggle={onToggle} />
        ))}

        {main.length === 0 && chapters.length === 0 && (
          <div className="empty">还没有任务，点右下角 + 添加</div>
        )}

        {/* C：课内章节折叠区 */}
        {chapters.length > 0 && (
          <div className="chapter-block">
            <button className="chapter-head" onClick={() => setShowChapters((v) => !v)}>
              <span className="chapter-title">课内章节</span>
              <span className="chapter-count">
                {chapters.length}
                {chaptersUndone > 0 ? ` · 未完成 ${chaptersUndone}` : ''}
              </span>
              <IconChevronDown className={`chapter-chev${showChapters ? ' open' : ''}`} />
            </button>
            {showChapters && (
              <div className="chapter-body">
                {chapters.map((t) => (
                  <TaskRow key={t.id} t={t} onToggle={onToggle} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
