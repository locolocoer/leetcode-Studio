import { useEffect, useRef, useState } from 'react'
import type { FetchedProblemListEntry, Problem } from '../../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (p: Problem) => void
  /** 题面语言：切换后列表要按新语言重新取（中文用 titleCn） */
  contentLang?: 'zh' | 'en'
}

const diffClass: Record<string, string> = {
  easy: 'diff-badge diff-easy',
  medium: 'diff-badge diff-medium',
  hard: 'diff-badge diff-hard'
}
const diffText: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

export default function FetchModal({ open, onClose, onAdd, contentLang = 'zh' }: Props) {
  const [list, setList] = useState<FetchedProblemListEntry[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const loadedLangRef = useRef<string | null>(null)

  const loadList = async () => {
    setLoading(true)
    setError(null)
    try {
      const l = await window.api.fetch.list()
      setList(l)
      loadedLangRef.current = contentLang
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // 首次打开、或题面语言变了 → 重新取列表（中文标题来自 leetcode.cn）
    if (open && loadedLangRef.current !== contentLang) loadList()
  }, [open, contentLang])

  if (!open) return null

  const filtered = list.filter((p) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return p.title.toLowerCase().includes(s) || (p.titleEn || '').toLowerCase().includes(s) ||
      p.slug.toLowerCase().includes(s) || String((p as any).frontendId || '').includes(s)
  })

  const addProblem = async (entry: FetchedProblemListEntry) => {
    setLoadingSlug(entry.slug)
    setError(null)
    try {
      const p = await window.api.fetch.detail(entry.slug)
      onAdd(p)
      setAdded((s) => new Set(s).add(entry.slug))
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoadingSlug(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>从 LeetCode 拉取题目</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="sol-host">
              {contentLang === 'en' ? 'English（leetcode.com）' : '中文（leetcode.cn）'}
              {list.length ? ` · 共 ${list.length} 题` : ''}
            </span>
            <button className="btn ghost sm" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <input placeholder="搜索题目名称 / 题号…（中英文都能搜）" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <button className="btn sm" onClick={loadList} disabled={loading}>{loading ? '加载中…' : '刷新'}</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 10 }}>
            列表跟随顶栏的题面语言；切换语言后再打开这里会自动换成对应语言的题目名。
            {loading && list.length === 0 ? ' 首次加载中文题目列表需要几秒，之后会用本地缓存。' : ''}
          </div>
          {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
          {loading && list.length === 0 ? (
            <div className="loader">正在加载题目列表…</div>
          ) : (
            <div className="fetch-list">
              {filtered.length === 0 && <div className="loader">无匹配题目</div>}
              {filtered.slice(0, 200).map((p) => (
                <div key={p.slug} className="fetch-row" onClick={() => addProblem(p)}>
                  <span className="num">{p.frontendId || '·'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title} {p.paidOnly && <span style={{ color: 'var(--amber)' }}>🔒</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={diffClass[p.difficulty]}>{diffText[p.difficulty]}</span>
                    {added.has(p.slug) && <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>}
                    {loadingSlug === p.slug && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>…</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
