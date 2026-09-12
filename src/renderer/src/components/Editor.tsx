import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import type { Problem } from '../../../shared/types'
import { registerCompletions, setCompletionProblem } from '../completion'

export function monacoLangFor(lang: string): string {
  switch (lang) {
    case 'python': return 'python'
    case 'java': return 'java'
    case 'cpp': return 'cpp'
    case 'c': return 'c'
    default: return 'plaintext'
  }
}

export interface EditorHandle {
  setBreakpoints: (lines: number[]) => void
  toggleAtLine: (line: number) => void
  getCursorLine: () => number
}

interface EditorProps {
  value: string
  language: string
  problem?: Problem | null
  onChange: (v: string) => void
  breakpoints?: number[]
  currentLine?: number | null
  onToggleBreakpoint?: (line: number) => void
  onCursorChange?: (line: number) => void
  onReady?: (handle: EditorHandle) => void
}

// 命中判断：鼠标落在行号/行装饰/装订线(含红点列)区域都视为"在这行切断点"
function isGutterTarget(e: monaco.editor.IEditorMouseEvent): boolean {
  const t = e.target.type
  const gutter = [
    monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
    monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
    monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
    monaco.editor.MouseTargetType.GUTTER_VIEW_ZONE
  ]
  if (gutter.includes(t)) return true
  // DOM 兜底：一些主题/版本把行号命中报成其它类型
  const el: HTMLElement | null = (e.target as any)?.element
  if (el && el.className) {
    const cls = String(el.className)
    if (/line-numbers|glyph-margin|line-decorations|margin-view|codicon/.test(cls)) return true
  }
  return false
}

export default function Editor({
  value,
  language,
  problem = null,
  onChange,
  breakpoints = [],
  currentLine = null,
  onToggleBreakpoint,
  onCursorChange,
  onReady
}: EditorProps) {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<string[]>([])
  const currentDecoRef = useRef<string[]>([])
  const suppressChange = useRef(false)
  const cursorLineRef = useRef(1)

  // keep latest callbacks without re-registering listeners
  const cbRef = useRef({ onChange, onToggleBreakpoint, onCursorChange, onReady })
  cbRef.current = { onChange, onToggleBreakpoint, onCursorChange, onReady }

  const applyBreakpoints = (lines: number[]) => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, lines.map((l) => ({
      range: new monaco.Range(l, 1, l, 1),
      options: {
        isWholeLine: true,
        className: 'bp-line',
        glyphMarginClassName: 'codicon codicon-debug-breakpoint',
        overviewRuler: { color: '#f04438', position: monaco.editor.OverviewRulerLane.Left }
      }
    })))
  }
  const applyRef = useRef(applyBreakpoints)
  applyRef.current = applyBreakpoints

  useEffect(() => {
    if (!container.current) return
    // 注册补全 / 签名提示 / 悬停（幂等，只注册一次）
    registerCompletions(monaco)
    const editor = monaco.editor.create(container.current, {
      value,
      language: monacoLangFor(language),
      theme: 'vs-dark',
      glyphMargin: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 12, bottom: 12 },
      scrollbar: { verticalScrollbarSize: 10 },
      renderWhitespace: 'none',
      smoothScrolling: true,
      guides: { indentation: false, bracketPairs: true },
      tabSize: 4,
      wordWrap: 'off',
      // ---- 代码补全相关 ----
      quickSuggestions: { other: true, comments: false, strings: false },
      quickSuggestionsDelay: 60,
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: 'currentDocument',
      tabCompletion: 'on',
      acceptSuggestionOnEnter: 'on',
      acceptSuggestionOnCommitCharacter: true,
      snippetSuggestions: 'inline',
      suggestSelection: 'first',
      fixedOverflowWidgets: true,
      parameterHints: { enabled: true, cycle: true },
      suggest: {
        showMethods: true,
        showFunctions: true,
        showFields: true,
        showVariables: true,
        showClasses: true,
        showKeywords: true,
        showSnippets: true,
        showWords: true,
        insertMode: 'replace',
        preview: true
      }
    })
    editorRef.current = editor

    const h: EditorHandle = {
      setBreakpoints: (lines) => applyRef.current(lines),
      toggleAtLine: (line) => cbRef.current.onToggleBreakpoint?.(line),
      getCursorLine: () => cursorLineRef.current
    }
    onReady?.(h)

    // 便于开发时用 CDP 检查补全效果（生产构建不暴露）
    if (import.meta.env.DEV) {
      ;(window as any).__lcEditor = editor
      ;(window as any).__lcMonaco = monaco
    }

    editor.onDidChangeModelContent(() => {
      if (suppressChange.current) return
      // 用 ref 调用“最新”的回调，避免闭包陈旧导致输入丢失
      cbRef.current.onChange?.(editor.getValue())
    })

    // 点击行号/装订线加断点
    editor.onMouseDown((e: monaco.editor.IEditorMouseEvent) => {
      if (!cbRef.current.onToggleBreakpoint) return
      if (!isGutterTarget(e)) return
      const line = e.target.position?.lineNumber
      if (line) cbRef.current.onToggleBreakpoint(line)
    })

    // 光标行跟踪（编辑器头部“切换断点”按钮使用）
    editor.onDidChangeCursorPosition((e) => {
      cursorLineRef.current = e.position.lineNumber
      cbRef.current.onCursorChange?.(e.position.lineNumber)
    })
    cursorLineRef.current = editor.getPosition()?.lineNumber || 1
    cbRef.current.onCursorChange?.(cursorLineRef.current)

    // F9 / Ctrl+F8：在当前光标行切换断点（即使行号点击失效也一定有办法加）
    editor.addCommand(monaco.KeyCode.F9, () => {
      const l = editor.getPosition()?.lineNumber
      if (l) cbRef.current.onToggleBreakpoint?.(l)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F8, () => {
      const l = editor.getPosition()?.lineNumber
      if (l) cbRef.current.onToggleBreakpoint?.(l)
    })

    return () => {
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // 补全/签名提示需要知道当前题目（参数名、方法签名）
  useEffect(() => {
    setCompletionProblem(problem || null)
  }, [problem])

  // keep external value in sync
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.getValue() !== value) {
      suppressChange.current = true
      editor.setValue(value)
      suppressChange.current = false
    }
  }, [value])

  useEffect(() => {
    applyBreakpoints(breakpoints)
  }, [breakpoints])

  // 调试暂停的当前行：高亮并滚动到可见
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    if (currentLine && currentLine >= 1 && currentLine <= model.getLineCount()) {
      currentDecoRef.current = editor.deltaDecorations(currentDecoRef.current, [{
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: {
          isWholeLine: true,
          className: 'dbg-current',
          linesDecorationsClassName: 'dbg-current-gutter',
          glyphMarginClassName: 'dbg-current-glyph'
        }
      }])
      editor.revealLineInCenterIfOutsideViewport(currentLine)
    } else {
      currentDecoRef.current = editor.deltaDecorations(currentDecoRef.current, [])
    }
  }, [currentLine])

  return <div ref={container} style={{ height: '100%', width: '100%' }} />
}
