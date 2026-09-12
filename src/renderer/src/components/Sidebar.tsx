import { useMemo, useState } from 'react'
import type { CatalogEntry, Difficulty, Problem } from '../../../shared/types'

export type CategoryKey = 'all' | 'local' | 'daily' | string

interface Item {
  slug: string
  host?: string
  key: string
  title: string
  titleCn?: string
  difficulty: Difficulty
  loaded: boolean
}

interface Props {
  problems: Problem[]
  collections: CatalogEntry[]
  activeId: string | null
  busy: boolean
  category: CategoryKey
  onCategoryChange: (c: CategoryKey) => void
  onSelectSlug: (slug: string, host?: string) => void
  onAddDaily: () => void
  onAddList: () => void
  onAddLocal: () => void
  onImport: () => void
  onOpenSettings: () => void
  onRemoveProblem: (id: string) => void
  onRemoveCollection: (id: string) => void
  onOpenFetch: () => void
}

const diffClass: Record<Difficulty, string> = {
  easy: 'diff-badge diff-easy',
  medium: 'diff-badge diff-medium',
  hard: 'diff-badge diff-hard'
}
const diffText: Record<Difficulty, string> = { easy: '简单', medium: '中等', hard: '困难' }

export default function Sidebar({
  problems, collections, activeId, busy, category: cat, onCategoryChange: setCat,
  onSelectSlug, onAddDaily, onAddList, onAddLocal, onImport, onOpenSettings,
  onRemoveProblem, onRemoveCollection, onOpenFetch
}: Props) {
  const [q, setQ] = useState('')

  const daily = collections.filter((c) => c.kind === 'daily')
  const lists = collections.filter((c) => c.kind === 'list')

  const bySlug = useMemo(() => {
    const m = new Map<string, Problem>()
    for (const p of problems) m.set(p.slug, p)
    return m
  }, [problems])

  const localCount = problems.filter((p) => p.source !== 'leetcode').length

  const itemsFor = useMemo((): Item[] => {
    const matchQ = (s: string) => {
      const t = q.trim().toLowerCase()
      return !t || s.toLowerCase().includes(t)
    }
    let out: Item[] = []
    if (cat === 'all') {
      for (const p of problems) {
        if (!matchQ(p.title + ' ' + p.slug)) continue
        out.push({ slug: p.slug, host: undefined, key: p.id, title: p.title, titleCn: p.titleCn, difficulty: p.difficulty, loaded: true })
      }
    } else if (cat === 'local') {
      for (const p of problems) {
        if (p.source === 'leetcode') continue
        if (!matchQ(p.title + ' ' + p.slug)) continue
        out.push({ slug: p.slug, host: undefined, key: p.id, title: p.title, difficulty: p.difficulty, loaded: true })
      }
    } else {
      const col = collections.find((c) => c.id === cat)
      if (col) {
        for (const it of col.items) {
          if (!matchQ((it.titleCn || it.title) + ' ' + it.slug)) continue
          const stored = bySlug.get(it.slug)
          out.push({
            slug: it.slug,
            host: col.host,
            key: stored ? stored.id : 'cat:' + col.id + ':' + it.slug,
            title: stored?.title ?? it.titleCn ?? it.title,
            titleCn: it.titleCn,
            difficulty: stored?.difficulty ?? it.difficulty,
            loaded: !!stored
          })
        }
      }
    }
    return out
  }, [cat, problems, collections, q, bySlug])

  const cats: { key: CategoryKey; label: string; count: number; isDaily?: boolean; removable?: boolean }[] = [
    { key: 'all', label: '全部题目', count: problems.length },
    { key: 'local', label: '本地', count: localCount },
    ...daily.map((c) => ({ key: c.id, label: `每日一题${c.date ? ` ${c.date}` : ''}`, count: c.items.length, isDaily: true, removable: true })),
    ...lists.map((c) => ({ key: c.id, label: c.title, count: c.items.length, removable: true }))
  ]

  const catLabel = (k: string) => {
    if (k === 'all') return '全部题目'
    if (k === 'local') return '本地题目'
    return collections.find((c) => c.id === k)?.title || '题目'
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="logo">LC</div>
        <div>
          <div className="brand-name">LeetCode Studio</div>
          <div className="brand-sub">本地刷题 · 多语言调试</div>
        </div>
      </div>

      <div className="sidebar-search">
        <input placeholder="搜索当前分类…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="side-actions">
        <button className="btn sm" onClick={onAddDaily} disabled={busy} title="拉取今日每日一题">
          📅 每日一题
        </button>
        <button className="btn sm" onClick={onAddList} disabled={busy} title="拉取题单（热题100/200 等）">
          📋 拉取题单
        </button>
      </div>

      <div className="cat-head">分类（{cats.length}）</div>
      <div className="cat-row">
        {cats.map((c) => (
          <span key={c.key}
            className={`cat-chip ${cat === c.key ? 'active' : ''} ${c.isDaily ? 'daily' : ''}`}
            onClick={() => setCat(c.key)}
            title={c.label}>
            <span className="cat-label">{c.label}</span>
            <span className="cnt">{c.count}</span>
            {c.removable && (
              <span className="x" title="删除该分类"
                onClick={(e) => { e.stopPropagation(); if (confirm(`删除分类「${c.label}」？题目不会删除。`)) onRemoveCollection(c.key) }}>✕</span>
            )}
          </span>
        ))}
      </div>
      <div className="cat-now">
        <span className="dot" />
        当前分类：<b>{catLabel(String(cat))}</b>
        <span style={{ marginLeft: 'auto' }}>{itemsFor.length} 题</span>
      </div>

      <div className="problem-list">
        {busy && <div className="loader" style={{ padding: '14px' }}>加载中…</div>}
        {!busy && itemsFor.length === 0 && (
          <div className="empty-state" style={{ padding: '24px 12px' }}>
            <div className="big">暂无题目</div>
            <div style={{ fontSize: 12 }}>分类「{catLabel(String(cat))}」为空</div>
          </div>
        )}
        {itemsFor.map((it) => (
          <div key={it.key}
            className={`problem-item ${activeId === it.key && !it.key.startsWith('cat:') ? 'active' : ''}`}
            onClick={() => onSelectSlug(it.slug, it.host)}
            onContextMenu={(e) => {
              if (!it.loaded) return
              e.preventDefault()
              const p = bySlug.get(it.slug)
              if (p && confirm(`删除题目「${p.title}」？`)) onRemoveProblem(p.id)
            }}>
            <span className="problem-num">{it.key.startsWith('cat:') ? '·' : it.key}</span>
            <span className="problem-title" title={it.title}>
              {it.title}
              {it.titleCn && it.titleCn !== it.title && <small>{it.titleCn}</small>}
              {!it.loaded && <small style={{ color: 'var(--text-faint)' }}>未缓存 · 点击加载</small>}
            </span>
            <span className={diffClass[it.difficulty]}>{diffText[it.difficulty]}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <span className="foot-count">{itemsFor.length} 题</span>
        <span className="spacer" />
        <button className="foot-btn" title="新增本地题目" onClick={onAddLocal}>＋</button>
        <button className="foot-btn" title="从剪贴板导入题目（JSON）" onClick={onImport}>📥</button>
        <button className="foot-btn" title="按题号/标题搜索并导入题目" onClick={onOpenFetch}>🔎</button>
        <button className="foot-btn" title="设置（工具链 / 运行时限）" onClick={onOpenSettings}>⚙</button>
      </div>
    </aside>
  )
}
