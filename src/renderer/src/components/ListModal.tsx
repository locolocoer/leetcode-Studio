import { useEffect, useState } from 'react'
import type { CatalogEntry } from '../../../shared/types'

interface Props {
  defaultHost: string
  onClose: () => void
  onAdd: (entry: CatalogEntry) => void
}

/** 官方题单（收藏夹形式，接口只认 ID） */
const FAVORITES: { id: string; name: string; count: number }[] = [
  { id: 'HqYkJzEr', name: 'LeetCode 热题 HOT 100', count: 99 },
  { id: '0HsMc930', name: 'LeetCode 200 题', count: 200 }
]

type Pick = { kind: 'plan' | 'favorite'; id: string; name: string; count?: number }

export default function ListModal({ defaultHost, onClose, onAdd }: Props) {
  const [value, setValue] = useState(FAVORITES[0].id)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<{ count: number; name: string } | null>(null)
  const [plans, setPlans] = useState<{ slug: string; name: string; count: number }[]>([])
  const [myLists, setMyLists] = useState<{ slug: string; name: string }[]>([])
  const [loadingMine, setLoadingMine] = useState(true)
  const [pick, setPick] = useState<Pick>({ kind: 'favorite', id: FAVORITES[0].id, name: FAVORITES[0].name })

  useEffect(() => {
    void (async () => {
      try {
        const p = await window.api.fetch.studyPlans()
        setPlans(p)
      } catch { /* 忽略 */ }
      try {
        const mine = await window.api.fetch.myLists()
        setMyLists(mine)
      } catch { /* 忽略 */ }
      setLoadingMine(false)
    })()
  }, [])

  // 手动输入时按内容判断是「学习计划」还是「题单」
  const chooseManual = () => {
    const raw = value.trim()
    if (!raw) return
    const planHit = /studyplan\/([A-Za-z0-9_-]+)/.exec(raw)
    if (planHit) {
      const found = plans.find((p) => p.slug === planHit[1])
      setPick({ kind: 'plan', id: planHit[1], name: found?.name || planHit[1] })
      return
    }
    if (/^[a-z0-9-]+$/.test(raw) && plans.some((p) => p.slug === raw)) {
      const found = plans.find((p) => p.slug === raw)!
      setPick({ kind: 'plan', id: raw, name: found.name })
      return
    }
    const m = /(?:problem-list\/)?([A-Za-z0-9_-]+)\/?$/.exec(raw)
    const id = m ? m[1] : raw
    setPick({ kind: 'favorite', id, name: title.trim() || id })
  }

  const pull = async (p: Pick) => {
    const planId = p.kind === 'plan' ? p.id : undefined
    const id = p.id
    if (!id) { setErr('请输入题单 ID 或链接'); return }
    setBusy(true)
    setErr(null)
    setOk(null)
    try {
      const entry = planId
        ? await window.api.fetch.studyPlan(planId)
        : await window.api.fetch.listProblems(id, defaultHost || 'leetcode.cn', title.trim() || p.name || undefined)
      const withTitle = title.trim() && planId ? { ...entry, title: title.trim() } : entry
      setOk({ count: withTitle.items.length, name: withTitle.title })
      onAdd(withTitle)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const pickClass = (active: boolean) => `btn sm ${active ? 'primary' : ''}`

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>拉取 LeetCode 题单 / 学习计划</h2>
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body">
          {/* 我的题单 */}
          <div className="list-section">
            <div className="list-section-head">
              我的题单
              <span className="list-section-hint">
                {loadingMine ? '读取中…' : myLists.length ? `共 ${myLists.length} 个` : '登录 LeetCode 后可在这里看到自己创建的题单'}
              </span>
            </div>
            {myLists.length > 0 && (
              <div className="list-chips">
                {myLists.map((l) => (
                  <button key={l.slug} className={pickClass(pick.kind === 'favorite' && pick.id === l.slug)}
                    disabled={busy} onClick={() => setPick({ kind: 'favorite', id: l.slug, name: l.name })}>
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 学习计划 */}
          <div className="list-section">
            <div className="list-section-head">
              学习计划
              <span className="list-section-hint">力扣官方分阶段题单，带真实名字与题量</span>
            </div>
            <div className="list-chips">
              {plans.map((p) => (
                <button key={p.slug} className={pickClass(pick.kind === 'plan' && pick.id === p.slug)}
                  disabled={busy} onClick={() => setPick({ kind: 'plan', id: p.slug, name: p.name })}>
                  {p.name}
                  <span className="chip-count">{p.count}</span>
                </button>
              ))}
              {!plans.length && <span className="list-section-hint">加载中…</span>}
            </div>
          </div>

          {/* 官方题单 */}
          <div className="list-section">
            <div className="list-section-head">
              官方题单
              <span className="list-section-hint">收藏夹形式的经典题单</span>
            </div>
            <div className="list-chips">
              {FAVORITES.map((f) => (
                <button key={f.id} className={pickClass(pick.kind === 'favorite' && pick.id === f.id && !title)}
                  disabled={busy} onClick={() => setPick({ kind: 'favorite', id: f.id, name: f.name })}>
                  {f.name}
                  <span className="chip-count">{f.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义 */}
          <div className="list-section">
            <div className="list-section-head">
              其它题单 / 自定义
              <span className="list-section-hint">支持粘贴链接：problem-list/xxx 或 studyplan/xxx</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="题单 ID 或链接，例如 https://leetcode.cn/problem-list/HqYkJzEr/"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={chooseManual}
                disabled={busy}
                style={{ flex: 1 }}
              />
              <input
                placeholder="自定义名称（可选）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                style={{ width: 170 }}
              />
            </div>
          </div>

          <div className="list-current">
            将拉取：<b>{title.trim() || pick.name || pick.id}</b>
            {pick.kind === 'plan' ? ' · 学习计划' : ' · 题单'}
          </div>

          {ok && (
            <div style={{ color: 'var(--green)', fontSize: 13, marginTop: 8 }}>
              ✓ 已拉取「{ok.name}」共 {ok.count} 题（点击题目可在线加载题面与代码）
            </div>
          )}
          {err && <div className="error-text" style={{ marginTop: 8 }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>关闭</button>
          <button className="btn primary" onClick={() => pull(pick)} disabled={busy}>
            {busy ? '拉取中…' : '拉取'}
          </button>
        </div>
      </div>
    </div>
  )
}
