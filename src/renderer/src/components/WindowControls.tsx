import { useEffect, useState } from 'react'

/**
 * 自绘窗口按钮（无边框窗口用）。
 * 图标用 CSS 画，避免不同系统字体下 Unicode 字形不一致。
 */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')

  useEffect(() => {
    window.api.win.isMaximized().then(setMaximized).catch(() => {})
    window.api.win.onMaximizeChange(setMaximized)
  }, [])

  if (isMac) return null // macOS 用系统红绿灯（titleBarStyle: hiddenInset）

  return (
    <div className="win-controls">
      <button className="win-btn" title="最小化" onClick={() => window.api.win.minimize()}>
        <span className="glyph-min" />
      </button>
      <button className="win-btn" title={maximized ? '向下还原' : '最大化'}
        onClick={() => window.api.win.toggleMaximize().then(setMaximized).catch(() => {})}>
        <span className={maximized ? 'glyph-restore' : 'glyph-max'} />
      </button>
      <button className="win-btn close" title="关闭" onClick={() => window.api.win.close()}>
        <span className="glyph-close" />
      </button>
    </div>
  )
}
