import { useState } from 'react'

interface Props {
  defaultHost: string
  onClose: () => void
  onSuccess: (host: string, username: string) => void
}

export default function LoginModal({ defaultHost, onClose, onSuccess }: Props) {
  const [host, setHost] = useState(defaultHost || 'leetcode.com')
  const [mode, setMode] = useState<'window' | 'cookie'>('window')
  const [cookieText, setCookieText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const openWindow = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.lc.openLogin(host)
      if (r.ok) onSuccess(host, r.username || '')
      else setErr(r.error || '登录未完成')
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const importCookies = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.lc.importCookies(host, cookieText)
      if (r.ok && r.loggedIn) onSuccess(host, r.username || '')
      else setErr(r.error || '导入失败')
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
          <h2>登录 LeetCode</h2>
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body">
          <div className="setting-row">
            <label>站点</label>
            <select value={host} onChange={(e) => setHost(e.target.value)} disabled={busy}>
              <option value="leetcode.com">leetcode.com（国际站）</option>
              <option value="leetcode.cn">leetcode.cn（中国站）</option>
            </select>
          </div>

          <div className="debug-status" style={{ marginBottom: 10, fontSize: 12 }}>
            <span>⚠️ 说明：LeetCode 登录页受 Cloudflare 人机验证保护，无法用密码接口自动登录，请用下面两种方式：</span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className={`btn sm ${mode === 'window' ? 'primary' : ''}`} onClick={() => setMode('window')}>
              ① 内置登录窗口（推荐）
            </button>
            <button className={`btn sm ${mode === 'cookie' ? 'primary' : ''}`} onClick={() => setMode('cookie')}>
              ② 导入浏览器 Cookie
            </button>
          </div>

          {mode === 'window' ? (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 12 }}>
                将打开一个登录窗口，请在其中完成登录（支持账号密码、Google/GitHub 等，无需在此输入密码）。
                登录成功后应用会自动保存会话，关闭窗口即可。
              </div>
              <button className="btn primary" onClick={openWindow} disabled={busy}>
                {busy ? '等待登录…' : '打开登录窗口'}
              </button>
              {busy && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>请在弹出窗口中登录…</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 8 }}>
                1. 在浏览器（Chrome/Edge）登录 <b>{host}</b><br />
                2. 打开开发者工具（F12）→ Console 执行 <code style={{ fontFamily: 'var(--mono)', background: 'var(--bg-3)', padding: '0 4px' }}>document.cookie</code> 复制整段内容粘贴到下面
              </div>
              <textarea
                rows={4}
                className="io-editor"
                placeholder="粘贴 LEETCODE_SESSION=...; csrftoken=...; 整段 Cookie"
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                disabled={busy}
              />
              <button className="btn primary" onClick={importCookies} disabled={busy || !cookieText.trim()}>
                {busy ? '导入中…' : '导入并验证'}
              </button>
            </div>
          )}

          {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.6, marginTop: 10 }}>
            登录会话仅保存在本机（不会保存密码）。会话过期后在浏览器重新登录再导入即可。
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
        </div>
      </div>
    </div>
  )
}
