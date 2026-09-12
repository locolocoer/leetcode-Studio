import { useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '../../../shared/types'

/** 设置面板里的「关于 / 更新」卡片：检查更新、显示进度、重启安装 */
export default function UpdateCard() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.app.info().then(setInfo).catch(() => {})
    const off = window.api.updater.onStatus((s) => {
      setStatus(s)
      if (s.state !== 'checking' && s.state !== 'downloading') setBusy(false)
    })
    return off
  }, [])

  const check = async () => {
    setBusy(true)
    setStatus({ state: 'checking' })
    await window.api.updater.check()
    setBusy(false)
  }

  const text = (() => {
    switch (status.state) {
      case 'checking': return '正在检查更新…'
      case 'available': return `发现新版本 v${status.version}，正在后台下载…`
      case 'downloading': return `下载中 ${status.percent ?? 0}%`
      case 'downloaded': return `新版本 v${status.version} 已就绪，重启即可安装`
      case 'not-available': return '已是最新版本'
      case 'dev': return '开发模式不检查更新（打包安装版才生效）'
      case 'error': return `检查更新失败：${status.message || '未知错误'}`
      default: return ''
    }
  })()

  const tone = status.state === 'error' ? 'var(--red)'
    : status.state === 'downloaded' ? 'var(--green)'
    : status.state === 'available' || status.state === 'downloading' ? 'var(--accent-2)'
    : 'var(--text-dim)'

  return (
    <div className="setting-card">
      <h3>关于与更新</h3>
      <div className="desc">
        {info ? `LeetCode Studio v${info.version}${info.commit && info.commit !== 'unknown' ? ` (${info.commit})` : ''}` : '正在读取版本…'}
        {info && (
          <span style={{ color: 'var(--text-faint)' }}>
            {' '}· Electron {info.electron} · Chromium {info.chrome} · Node {info.node}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={check} disabled={busy}>
          {busy ? '检查中…' : '检查更新'}
        </button>
        {status.state === 'downloaded' && (
          <button className="btn sm primary" onClick={() => window.api.updater.install()}>
            重启并安装
          </button>
        )}
        {(status.state === 'available' || status.state === 'downloading') && (
          <span style={{ fontSize: 12.5, color: tone }}>{text}</span>
        )}
      </div>
      {text && status.state !== 'available' && status.state !== 'downloading' && (
        <div style={{ fontSize: 12.5, color: tone, marginTop: 8 }}>{text}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.7 }}>
        更新源：优先阿里云 OSS，失败自动回退 GitHub Release。新版本会自动后台下载，安装包重启后生效。
      </div>
    </div>
  )
}
