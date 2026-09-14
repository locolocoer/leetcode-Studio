import { useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '../../../shared/types'

interface Props {
  /** 由 App 订阅并传入，保证切到设置页时能看到最近一次检查结果 */
  status: UpdateStatus
}

/** 设置面板里的「关于 / 更新」卡片：检查更新、显示进度、重启安装 */
export default function UpdateCard({ status }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.app.info().then(setInfo).catch(() => {})
  }, [])

  useEffect(() => {
    if (status.state !== 'checking' && status.state !== 'downloading') setBusy(false)
  }, [status.state])

  const check = async () => {
    setBusy(true)
    await window.api.updater.check()
    setBusy(false)
  }

  const text = (() => {
    switch (status.state) {
      case 'checking': return '正在检查更新…'
      case 'available': return `发现新版本 v${status.version}，正在后台下载…`
      case 'downloading': return `下载中 ${status.percent ?? 0}%`
      case 'downloaded': return `新版本 v${status.version} 已就绪，重启即可安装`
      case 'not-available': return '已是最新版本 ✓'
      case 'dev': return '开发模式不检查更新（安装版打包后才生效）'
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
        {info
          ? `LeetCode Studio v${info.version}${info.commit && info.commit !== 'unknown' ? ` (${info.commit})` : ''}`
          : '正在读取版本…'}
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
        {text && (
          <span style={{ fontSize: 12.5, color: tone }}>
            {text}
            {status.state === 'downloading' && (
              <span className="update-progress"><i style={{ width: `${status.percent ?? 0}%` }} /></span>
            )}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.7 }}>
        更新源：GitHub Releases（如配置了镜像会优先走镜像，失败自动回退）。新版本会自动后台下载，重启应用后生效。
        日志：<code>%APPDATA%\leetcode-studio\.runtime\updater.log</code>
      </div>
    </div>
  )
}
