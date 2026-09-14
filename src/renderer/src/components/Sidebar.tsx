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
  /** 提交通过（√） */
  solved?: boolean
  /** 本地全过但还没提交通过 */
  localPass?: boolean
  solvedLang?: string
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
  /** 清除某个题单/分类的刷题记录 */
  onClearRecords: (entry: CatalogEntry) => void
  /** 清除全部刷题记录 */
  onClearAllRecords: () => void
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
  onRemoveProblem, onRemoveCollection, onOpenFetch, onClearRecords, onClearAllRecords
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
    const rec = (p: Problem) => ({ solved: !!p.solvedAt, localPass: !p.solvedAt && !!p.localPassAt, solvedLang: p.solvedLang })
    if (cat === 'all') {
      for (const p of problems) {
        if (!matchQ(p.title + ' ' + p.slug)) continue
        out.push({ slug: p.slug, host: undefined, key: p.id, title: p.title, titleCn: p.titleCn, difficulty: p.difficulty, loaded: true, ...rec(p) })
      }
    } else if (cat === 'local') {
      for (const p of problems) {
        if (p.source === 'leetcode') continue
        if (!matchQ(p.title + ' ' + p.slug)) continue
        out.push({ slug: p.slug, host: undefined, key: p.id, title: p.title, difficulty: p.difficulty, loaded: true, ...rec(p) })
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
            loaded: !!stored,
            ...(stored ? rec(stored) : {})
          })
        }
      }
    }
    return out
  }, [cat, problems, collections, q, bySlug])

  // 各分类的完成情况（只统计已缓存的题，题单里没拉下来的不算）
  const progressOf = (key: string): { solved: number; total: number } => {
    if (key === 'all') {
      return { solved: problems.filter((p) => p.solvedAt).length, total: problems.length }
    }
    if (key === 'local') {
      const local = problems.filter((p) => p.source !== 'leetcode')
      return { solved: local.filter((p) => p.solvedAt).length, total: local.length }
    }
    const col = collections.find((c) => c.id === key)
    if (!col) return { solved: 0, total: 0 }
    let solved = 0
    for (const it of col.items) {
      const p = bySlug.get(it.slug)
      if (p?.solvedAt) solved++
    }
    return { solved, total: col.items.length }
  }

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
        {cats.map((c) => {
          const pg = progressOf(c.key)
          return (
            <span key={c.key}
              className={`cat-chip ${cat === c.key ? 'active' : ''} ${c.isDaily ? 'daily' : ''}`}
              onClick={() => setCat(c.key)}
              title={`${c.label}：${pg.total} 题，已通过 ${pg.solved} 题`}>
              <span className="cat-label">{c.label}</span>
              <span className="cnt">
                {c.count}
                {pg.solved > 0 && <b className="cat-solved">✓{pg.solved}</b>}
              </span>
              {c.removable && (
                <span className="x" title="删除该分类"
                  onClick={(e) => { e.stopPropagation(); if (confirm(`删除分类「${c.label}」？题目不会删除。`)) onRemoveCollection(c.key) }}>✕</span>
              )}
            </span>
          )
        })}
      </div>
      {(() => {
        const pg = progressOf(String(cat))
        const col = collections.find((c) => c.id === String(cat))
        const hasRecords = problems.some((p) => p.solvedAt || p.localPassAt)
        const pct = pg.total ? Math.round((pg.solved / pg.total) * 100) : 0
        return (
          <div className="cat-now">
            <div className="cat-now-top">
              <span className="dot" />
              <span className="cat-now-text" title={`当前分类：${catLabel(String(cat))}`}>
                当前分类：<b>{catLabel(String(cat))}</b>
              </span>
            </div>
            <div className="cat-now-bottom">
              {pg.solved > 0 ? (
                <>
                  <span className="cat-bar" title={`已通过 ${pg.solved} / ${pg.total} 题`}>
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span className="cat-now-progress">✓ {pg.solved}/{pg.total}</span>
                </>
              ) : (
                <span className="cat-now-progress">{pg.total} 题</span>
              )}
              {(col || hasRecords) && (
                <button className="cat-clear"
                  title={col
                    ? `清除「${col.title}」的刷题记录，重新开始刷（代码与用例保留）`
                    : '清除全部题目的刷题记录（代码与用例保留）'}
                  onClick={() => (col ? onClearRecords(col) : onClearAllRecords())}>
                  清除记录
                </button>
              )}
            </div>
          </div>
        )
      })()}

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
            className={`problem-item ${activeId === it.key && !it.key.startsWith('cat:') ? 'active' : ''} ${it.solved ? 'solved' : ''}`}
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
            {/* 始终占一列，保证难度标签位置稳定 */}
            {it.solved ? (
              <span className="solved-mark" title={`提交通过${it.solvedLang ? `（${it.solvedLang}）` : ''}`}>✓</span>
            ) : it.localPass ? (
              <span className="local-mark" title="本地用例已全过（还没提交通过）">·</span>
            ) : (
              <span className="solved-mark empty" />
            )}
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
