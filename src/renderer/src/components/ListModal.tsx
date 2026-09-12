import { useState } from 'react'
import type { CatalogEntry } from '../../../shared/types'

interface Props {
  defaultHost: string
  onClose: () => void
  onAdd: (entry: CatalogEntry) => void
}

const PRESETS: { id: string; name: string }[] = [
  { id: 'HqYkJzEr', name: 'LeetCode 热题 HOT 100（题单）' },
  { id: '0HsMc930', name: 'LeetCode-200 题（题单）' }
]

export default function ListModal({ defaultHost, onClose, onAdd }: Props) {
  const [host, setHost] = useState(defaultHost || 'leetcode.cn')
  const [value, setValue] = useState(PRESETS[0].id)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<{ count: number; name: string } | null>(null)

  const normalize = (s: string) => {
    const m = s.trim().match(/(?:problem-list\/)?([A-Za-z0-9_-]+)\/?$/)
    return m ? m[1] : s.trim()
  }

  const fetchList = async () => {
    const id = normalize(value)
    if (!id) { setErr('请输入题单 ID 或完整链接'); return }
    setBusy(true)
    setErr(null)
    setOk(null)
    try {
      const name = title.trim() || PRESETS.find((p) => p.id === id)?.name || undefined
      const entry = await window.api.fetch.listProblems(id, host, name)
      setOk({ count: entry.items.length, name: entry.title })
      onAdd(entry)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>拉取 LeetCode 题单</h2>
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body">
          <div className="setting-row">
            <label>站点</label>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
              leetcode.cn（题单接口仅该站支持；标题为中文，点开题目按你的「题面语言」设置加载）
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 8 }}>
            常用题单：
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {PRESETS.map((p) => (
              <button key={p.id} className={`btn sm ${value === p.id ? 'primary' : ''}`} disabled={busy}
                onClick={() => setValue(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          <input
            placeholder="或粘贴题单链接，例如 https://leetcode.cn/problem-list/HqYkJzEr/"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            style={{ marginBottom: 10 }}
          />
          <input
            placeholder="自定义名称（可选）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
          {ok && (
            <div style={{ color: 'var(--green)', fontSize: 13, marginTop: 8 }}>
              ✓ 已拉取「{ok.name}」共 {ok.count} 题（点击题目可在线加载题面与代码）
            </div>
          )}
          {err && <div className="error-text" style={{ marginTop: 8 }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>关闭</button>
          <button className="btn primary" onClick={fetchList} disabled={busy}>
            {busy ? '拉取中…' : '拉取'}
          </button>
        </div>
      </div>
    </div>
  )
}
