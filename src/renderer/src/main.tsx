import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import * as monaco from 'monaco-editor'
// @ts-ignore
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// 生产环境收紧内容安全策略：即使题面/题解里的远程 HTML 没被消毒干净，
// 内联事件处理器（onerror/onload）与 javascript: 协议也会被浏览器拒之门外。
// 开发模式跳过（Vite HMR / react-refresh 需要内联脚本）。
if (import.meta.env.PROD) {
  const meta = document.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "media-src 'self' data: https:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'"
  ].join('; ')
  document.head.appendChild(meta)
}

// Vite worker wiring for Monaco.
;(self as any).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
export { monaco }
