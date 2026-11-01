import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Download, Loader2, Trash2 } from 'lucide-react'
import {
  aiDeleteProvider,
  aiModels,
  aiProviders,
  aiSaveProvider,
  aiSetActive,
  aiStatus,
  type AiProvider
} from '../lib/api'
import { toast } from './Toast'

type Draft = {
  base_url: string
  key: string
  /** 从服务商拉到的全部模型 */
  fetched: string[]
  /** 用户勾选、要在对话框里出现的模型 */
  enabled: string[]
  /** 拉取不到时的兜底：手动输入 */
  manual: string
  source: string
}

/**
 * 多供应商配置（对齐 DSH）：
 * - 每家单独保存 Key / 地址
 * - 「获取模型列表」拉回全部模型，由用户**勾选**要用的
 * - 对话框左下角只会列出勾选过的模型
 */
export default function AiProvidersSection(): React.JSX.Element {
  const [items, setItems] = useState<AiProvider[]>([])
  const [current, setCurrent] = useState('')
  const [openId, setOpenId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, st] = await Promise.all([aiProviders(), aiStatus()])
      setItems(list.items)
      setCurrent(st.provider || '')
    } catch (e) {
      setMsg(String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const draftOf = (p: AiProvider): Draft =>
    drafts[p.id] || {
      base_url: p.base_url || '',
      key: '',
      fetched: p.models || [],
      enabled: p.enabled_models || p.models || [],
      manual: '',
      source: ''
    }

  const patch = (p: AiProvider, part: Partial<Draft>): void => {
    setDrafts((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] || draftOf(p)), ...part } }))
  }

  const fetchModels = async (p: AiProvider): Promise<void> => {
    const d = draftOf(p)
    setBusy(p.id)
    setMsg('')
    try {
      const r = await aiModels(p.id, d.key.trim() || undefined, d.base_url.trim() || undefined)
      if (r.models.length) {
        patch(p, {
          fetched: r.models,
          // 保留用户已勾选的，新模型默认不勾
          enabled: d.enabled.filter((m) => r.models.includes(m)),
          source: r.source
        })
        toast(`拉到 ${r.models.length} 个模型，勾选要用的`)
      } else {
        setMsg(`没取到模型列表${r.error ? `：${r.error}` : ''}，可以手动填`)
      }
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy('')
    }
  }

  const toggleModel = (p: AiProvider, m: string): void => {
    const d = draftOf(p)
    const has = d.enabled.includes(m)
    patch(p, { enabled: has ? d.enabled.filter((x) => x !== m) : [...d.enabled, m] })
  }

  const save = async (p: AiProvider): Promise<void> => {
    const d = draftOf(p)
    const manual = d.manual
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const all = [...new Set([...d.fetched, ...manual])]
    const enabled = d.enabled.length ? d.enabled : all.slice(0, 1)
    if (!enabled.length) {
      setMsg('至少勾选一个模型')
      return
    }
    setBusy(p.id)
    setMsg('')
    try {
      await aiSaveProvider(p.id, {
        api_key: d.key.trim() ? d.key.trim() : undefined,
        base_url: d.base_url.trim(),
        models: all,
        enabled_models: enabled
      })
      setDrafts((prev) => ({ ...prev, [p.id]: { ...d, key: '', manual: '' } }))
      await load()
      toast(`${p.name} 已保存`)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy('')
    }
  }

  const activate = async (p: AiProvider): Promise<void> => {
    setBusy(p.id)
    try {
      await aiSetActive(p.id)
      await load()
      toast(`已切换到 ${p.name}`)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy('')
    }
  }

  const remove = async (p: AiProvider): Promise<void> => {
    if (!window.confirm(`清除 ${p.name} 的 API Key 和模型选择？`)) return
    setBusy(p.id)
    try {
      await aiDeleteProvider(p.id)
      await load()
      toast(`${p.name} 已清除`)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="settings-section">
      <h2>AI 模型</h2>
      <p className="desc">
        可以同时保存多个服务商。填好 Key 后点「获取模型列表」，勾选你想在对话里用的模型；
        对话框左下角只会出现勾选过的。Key 存系统密钥环，不落明文。
      </p>

      <div className="body setting-stack">
        {items.map((p) => {
          const open = openId === p.id
          const d = draftOf(p)
          const isCurrent = current === p.id
          return (
            <div key={p.id} className={`provider-card${isCurrent ? ' current' : ''}`}>
              <button
                type="button"
                className="provider-head"
                onClick={() => setOpenId(open ? '' : p.id)}
                aria-expanded={open}
              >
                <span className="provider-name">
                  {p.name}
                  {p.recommended && <span className="provider-tag">推荐</span>}
                </span>
                <span className={`provider-state${p.configured ? ' ok' : ''}`}>
                  {isCurrent ? (
                    <>
                      <Check size={12} strokeWidth={2.6} /> 当前使用
                    </>
                  ) : p.configured ? (
                    '已配置'
                  ) : (
                    '未配置'
                  )}
                </span>
                <ChevronDown size={14} className={`provider-caret${open ? ' open' : ''}`} />
              </button>

              {open && (
                <div className="provider-body">
                  {p.note && <div className="wx-hint">{p.note}</div>}

                  <label className="form-label">接口地址</label>
                  <input
                    className="input full"
                    value={d.base_url}
                    placeholder={p.base_url || 'https://…/v1'}
                    onChange={(e) => patch(p, { base_url: e.target.value })}
                  />

                  <label className="form-label">
                    API Key {p.configured && <span className="wx-hint">（已保存，留空则不改）</span>}
                  </label>
                  <input
                    className="input full"
                    type="password"
                    value={d.key}
                    placeholder={p.configured ? '••••••••（已保存）' : '粘贴 API Key'}
                    onChange={(e) => patch(p, { key: e.target.value })}
                  />

                  <div className="inline-actions">
                    <button
                      className="btn btn-secondary sm"
                      disabled={busy === p.id}
                      onClick={() => void fetchModels(p)}
                    >
                      {busy === p.id ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                      获取模型列表
                    </button>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 160 }}
                      value={d.manual}
                      placeholder="拉不到就手动填，逗号分隔"
                      onChange={(e) => patch(p, { manual: e.target.value })}
                    />
                  </div>

                  {d.fetched.length > 0 && (
                    <div className="model-pick">
                      <div className="model-pick-head">
                        勾选要用的模型（{d.enabled.length}/{d.fetched.length}）
                        <button
                          className="btn btn-ghost sm"
                          onClick={() => patch(p, { enabled: d.fetched })}
                        >
                          全选
                        </button>
                        <button className="btn btn-ghost sm" onClick={() => patch(p, { enabled: [] })}>
                          清空
                        </button>
                      </div>
                      <div className="model-pick-list">
                        {d.fetched.map((m) => {
                          const on = d.enabled.includes(m)
                          return (
                            <label key={m} className={`model-pick-item${on ? ' on' : ''}`}>
                              <input type="checkbox" checked={on} onChange={() => toggleModel(p, m)} />
                              <span>{m}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="inline-actions">
                    <button
                      className="btn btn-secondary sm"
                      disabled={busy === p.id}
                      onClick={() => void save(p)}
                    >
                      保存
                    </button>
                    <button
                      className="btn btn-ghost sm"
                      disabled={busy === p.id || isCurrent || !p.configured}
                      onClick={() => void activate(p)}
                      title={!p.configured ? '先保存 API Key' : ''}
                    >
                      设为当前
                    </button>
                    <button
                      className="btn btn-ghost sm"
                      disabled={busy === p.id}
                      onClick={() => void remove(p)}
                    >
                      <Trash2 size={13} /> 清除
                    </button>
                    {p.key_url && (
                      <a className="wx-hint" href={p.key_url} target="_blank" rel="noreferrer">
                        获取 Key
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {msg && (
          <div className="wx-hint" style={{ color: 'var(--danger)' }}>
            {msg}
          </div>
        )}
      </div>
    </section>
  )
}
