import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Language, Problem, SolutionDetail, SolutionItem, SolutionOrderBy } from '../../../shared/types'
import { renderMarkdown } from '../markdown'

interface Props {
  problem: Problem
  /** 当前刷题语言：多语言代码块默认选中对应的 tab */
  language?: Language
  onClose: () => void
}

const PAGE = 20

function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 头像：图挂了就用昵称首字生成一个彩色圆（离线也能看） */
function Avatar({ url, name, size = 40 }: { url?: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const text = (name || '?').trim().slice(0, 1).toUpperCase()
  const hue = useMemo(() => {
    let h = 0
    for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) % 360
    return h
  }, [name])
  if (!url || broken) {
    return (
      <span
        className="sol-avatar sol-avatar-fallback"
        style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 55% 42%)` }}
      >
        {text}
      </span>
    )
  }
  return (
    <img
      className="sol-avatar"
      src={url}
      alt={name}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}

export default function SolutionModal({ problem, language, onClose }: Props) {
  const [orderBy, setOrderBy] = useState<SolutionOrderBy>('DEFAULT')
  const [items, setItems] = useState<SolutionItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<SolutionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  // 内置示例题也带真实 slug，同样能查题解；只有本地新建/导入的题没有
  const remote = !!problem.slug && !/^(local|imp)-/.test(problem.slug)

  const loadList = useCallback(async (order: SolutionOrderBy, skip: number) => {
    setLoading(true)
    setErr(null)
    try {
      const r = await window.api.solutions.list(problem.slug, { first: PAGE, skip, orderBy: order })
      setTotal(r.total)
      setItems((prev) => (skip === 0 ? r.items : [...prev, ...r.items]))
      if (skip === 0) setActiveSlug(r.items[0]?.slug ?? null)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [problem.slug])

  useEffect(() => {
    if (!remote) return
    setItems([])
    setTotal(0)
    setDetail(null)
    setActiveSlug(null)
    loadList(orderBy, 0)
  }, [orderBy, remote, loadList])

  useEffect(() => {
    if (!activeSlug) return
    let cancelled = false
    setDetailLoading(true)
    setDetailErr(null)
    window.api.solutions
      .detail(activeSlug, problem.slug)
      .then((d: SolutionDetail) => { if (!cancelled) setDetail(d) })
      .catch((e: any) => { if (!cancelled) { setDetail(null); setDetailErr(String(e?.message || e)) } })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [activeSlug, problem.slug])

  const html = useMemo(
    () => (detail ? renderMarkdown(detail.content, language) : ''),
    [detail, language]
  )

  // 正文里的链接用系统浏览器打开；代码块「复制」按钮；多语言代码的 tab 切换
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const tab = target.closest('.md-tab') as HTMLElement | null
      if (tab) {
        const group = tab.closest('.md-tabs')
        const idx = tab.getAttribute('data-tab')
        if (group && idx != null) {
          group.querySelectorAll('.md-tab').forEach((t) => t.classList.toggle('active', t === tab))
          group.querySelectorAll('.md-tabpanel').forEach((p) => {
            p.classList.toggle('active', p.getAttribute('data-panel') === idx)
          })
        }
        return
      }
      const btn = target.closest('.md-copy') as HTMLElement | null
      if (btn) {
        const code = btn.getAttribute('data-copy') || ''
        try { navigator.clipboard.writeText(code) } catch { /* ignore */ }
        setCopied(btn.getAttribute('data-key'))
        setTimeout(() => setCopied(null), 1200)
        return
      }
      const a = target.closest('a') as HTMLAnchorElement | null
      if (a) {
        e.preventDefault()
        const href = a.getAttribute('href') || ''
        if (/^https?:\/\//i.test(href)) window.api.app.openExternal(href)
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [html])

  const active = items.find((s) => s.slug === activeSlug) || null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sol-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📖 题解 · {problem.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="sol-host">题解来自 leetcode.cn</span>
            {problem.link && (
              <button className="link-btn" onClick={() => window.api.app.openExternal(problem.link!)}>
                打开题目页 →
              </button>
            )}
            <button className="btn ghost sm" onClick={onClose}>✕</button>
          </div>
        </div>

        {!remote ? (
          <div className="modal-body">
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              本地/导入的题目没有关联的 LeetCode 题解。请先从 LeetCode 拉取题目（左侧「拉取题目」）。
            </div>
          </div>
        ) : (
          <div className="sol-body">
            <div className="sol-list">
              <div className="sol-toolbar">
                <button className={`btn sm ${orderBy === 'DEFAULT' ? 'primary' : ''}`} onClick={() => setOrderBy('DEFAULT')}>
                  默认排序
                </button>
                <button className={`btn sm ${orderBy === 'MOST_UPVOTE' ? 'primary' : ''}`} onClick={() => setOrderBy('MOST_UPVOTE')}>
                  最高赞
                </button>
                <span className="sol-count">共 {total} 篇</span>
              </div>

              <div className="sol-items">
                {items.map((s) => (
                  <div
                    key={s.slug}
                    className={`sol-item ${s.slug === activeSlug ? 'active' : ''}`}
                    onClick={() => setActiveSlug(s.slug)}>
                    <div className="sol-item-title">{s.title}</div>
                    <div className="sol-item-meta">
                      <Avatar url={s.authorAvatar} name={s.authorName || s.author} size={18} />
                      <span className="sol-author">{s.authorName || s.author}</span>
                      <span>👍 {s.upvoteCount}</span>
                      {s.createdAt && <span>{fmtDate(s.createdAt)}</span>}
                    </div>
                    {s.summary && <div className="sol-item-sum">{s.summary}</div>}
                  </div>
                ))}
                {loading && <div className="sol-tip">加载中…</div>}
                {!loading && !items.length && !err && <div className="sol-tip">这个题目还没有题解</div>}
                {err && <div className="error-text">{err}</div>}
                {items.length < total && (
                  <button className="btn ghost sm" style={{ width: '100%', marginTop: 6 }} disabled={loading}
                    onClick={() => loadList(orderBy, items.length)}>
                    {loading ? '加载中…' : `加载更多（${items.length}/${total}）`}
                  </button>
                )}
              </div>
            </div>

            <div className="sol-detail">
              {detailLoading && <div className="sol-tip">正在加载题解内容…</div>}
              {detailErr && <div className="error-text">{detailErr}</div>}
              {!detailLoading && !detailErr && detail && (
                <>
                  <div className="sol-detail-head">
                    <h3>{detail.title}</h3>
                    <div className="sol-author-row">
                      <Avatar url={detail.authorAvatar} name={detail.authorName || detail.author} size={38} />
                      <div className="sol-author-info">
                        <div className="sol-author-name">
                          {detail.authorName || detail.author}
                          {detail.authorSlug && (
                            <button
                              className="link-btn"
                              style={{ marginLeft: 8, fontSize: 12 }}
                              onClick={() => window.api.app.openExternal(`https://leetcode.cn/u/${detail.authorSlug}/`)}>
                              主页 ↗
                            </button>
                          )}
                        </div>
                        <div className="sol-detail-meta">
                          <span>@{detail.author}</span>
                          <span>👍 {detail.upvoteCount}</span>
                          {detail.createdAt && <span>{fmtDate(detail.createdAt)}</span>}
                          <button className="link-btn" onClick={() => window.api.app.openExternal(detail.link)}>
                            在浏览器中查看 →
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="md-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
                </>
              )}
              {!detailLoading && !detailErr && !detail && !activeSlug && (
                <div className="sol-tip">← 从左侧选择一篇题解</div>
              )}
              {copied !== null && <div className="sol-copied">已复制代码</div>}
            </div>
          </div>
        )}

        <div className="modal-foot">
          <span style={{ marginRight: 'auto', color: 'var(--text-faint)', fontSize: 12 }}>
            {active ? `当前：${active.title} · ${active.authorName || active.author}` : ''}
          </span>
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
