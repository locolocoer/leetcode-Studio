import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import type { HarnessView, Language, Problem, RunResult, TestCase } from '../../../shared/types'

interface Props {
  problem: Problem
  language: Language
  code: string
  tests: TestCase[]
  onClose: () => void
  /** 保存/恢复后通知外层刷新运行结果 */
  onApplied?: (r: RunResult | null) => void
}

const LANG_ID: Record<Language, string> = {
  python: 'python',
  cpp: 'cpp',
  c: 'c',
  java: 'java'
}

const ORIGIN_TEXT: Record<HarnessView['origin'], string> = {
  user: '你自己编辑的模板',
  ai: 'AI 生成并通过验证的模板',
  builtin: '内置的确定性模板'
}

/** 判题模板查看/编辑弹窗：最后一道保障 —— 模板不对时用户可以直接改 */
export default function HarnessModal({ problem, language, code, tests, onClose, onApplied }: Props) {
  const [view, setView] = useState<HarnessView | null>(null)
  const [driver, setDriver] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [showHead, setShowHead] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  /** 上一次「服务器认可」的内容：用它判断是否真的被改过（打开时不该显示未保存） */
  const baselineRef = useRef('')
  const setBaseline = (text: string) => { baselineRef.current = text }

  // 打开时拉取当前生效的模板
  useEffect(() => {
    let alive = true
    void (async () => {
      const v = await window.api.harness.view(problem, language, code)
      if (!alive) return
      setView(v)
      setDriver(v?.driver || '')
      setBaseline(v?.driver || '')
      setDirty(false)
    })()
    return () => { alive = false }
  }, [problem, language, code])

  useEffect(() => {
    if (!hostRef.current) return
    const ed = monaco.editor.create(hostRef.current, {
      value: driver,
      language: LANG_ID[language] || 'cpp',
      theme: 'vs-dark',
      fontSize: 12.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2
    })
    editorRef.current = ed
    const sub = ed.onDidChangeModelContent(() => setDirty(ed.getValue() !== baselineRef.current))
    return () => { sub.dispose(); ed.dispose(); editorRef.current = null }
    // 只在语言变化时重建编辑器；内容由下方 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  useEffect(() => {
    const ed = editorRef.current
    if (ed && ed.getValue() !== driver) ed.setValue(driver)
  }, [driver])

  const run = async (save: boolean) => {
    const text = editorRef.current?.getValue() ?? driver
    if (!/main\s*\(/.test(text) && language !== 'java' && language !== 'python') {
      setMsg({ ok: false, text: '模板里找不到 main()，请先补上' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = save
        ? await window.api.harness.save(problem, language, code, text, tests)
        : await window.api.harness.verify(problem, language, code, text, tests)
      setResult(r)
      const passed = (r.cases || []).filter((c) => c.passed).length
      if (r.compileFailed) {
        setMsg({ ok: false, text: '编译失败，看下面的输出' })
      } else if (r.error) {
        setMsg({ ok: false, text: r.error })
      } else {
        setMsg({ ok: r.ok, text: `${passed} / ${r.cases.length} 用例通过${save ? '，已保存为你的模板' : ''}` })
      }
      if (save) {
        setBaseline(text)
        setDirty(false)
        const v = await window.api.harness.view(problem, language, code)
        setView(v)
        onApplied?.(r)
      }
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await window.api.harness.reset(problem, language)
      const v = await window.api.harness.view(problem, language, code)
      setView(v)
      setDriver(v?.driver || '')
      setBaseline(v?.driver || '')
      setDirty(false)
      setResult(null)
      setMsg({ ok: true, text: '已恢复为内置模板' })
      onApplied?.(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal harness-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <b>判题模板</b>
            <span className="mini" style={{ marginLeft: 8 }}>
              {view ? `${view.file} · ${ORIGIN_TEXT[view.origin]}` : '加载中…'}
              {dirty ? ' · 有未保存修改' : ''}
            </span>
          </div>
          <button className="btn sm ghost" onClick={onClose}>关闭</button>
        </div>

        <div className="harness-tip">
          模板负责「读输入 → 调用你的解法 → 打印结果」。内置模板不适配的题，可以先让 AI 生成（设置里开启），
          也可以<strong>在这里直接改</strong>——改完点「验证并保存」，之后这道题就一直用你这份。
        </div>

        <div ref={hostRef} className="harness-editor" />

        <div className="harness-actions">
          <button className="btn sm primary" onClick={() => run(true)} disabled={busy}>
            {busy ? '运行中…' : '验证并保存'}
          </button>
          <button className="btn sm" onClick={() => run(false)} disabled={busy}>只验证</button>
          <button className="btn sm ghost" onClick={() => { setDriver(view?.driver || ''); setDirty(false) }} disabled={busy}>撤销修改</button>
          <button className="btn sm ghost" onClick={reset} disabled={busy}>恢复内置模板</button>
          <button className="btn sm ghost" onClick={() => setShowHead((s) => !s)}>
            {showHead ? '隐藏固定脚手架' : '查看固定脚手架'}
          </button>
          {msg && (
            <span style={{ fontSize: 12.5, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
              {msg.ok ? '✓ ' : '✗ '}{msg.text}
            </span>
          )}
        </div>

        {showHead && view && (
          <pre className="debug-output" style={{ maxHeight: 200, marginTop: 8 }}>{view.head}</pre>
        )}

        {result && (
          <div style={{ marginTop: 10 }}>
            {result.compileFailed ? (
              <pre className="debug-output" style={{ maxHeight: 220 }}>{result.compileOutput || '编译失败'}</pre>
            ) : (
              (result.cases || []).map((c, i) => (
                <div key={c.id} className={`result-row ${c.passed ? 'pass-row' : 'fail-row'}`}>
                  <div className="r-head">
                    <span className="t-title">用例 {i + 1}</span>
                    <span className={`r-status ${c.passed ? 'pass' : 'fail'}`}>{c.passed ? '✓ 通过' : '✗ 失败'}</span>
                  </div>
                  <div className="r-val"><span className="r-expected">期望：</span>{c.expected}</div>
                  <div className="r-val"><span className="r-actual">实际：</span>{c.actual}</div>
                  {c.error && <div className="r-err" style={{ marginTop: 4 }}>{c.error}</div>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
