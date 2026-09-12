import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import * as monaco from 'monaco-editor'
// @ts-ignore
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

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
