import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiContext, AiMessage, AiMode, Problem, RunResult, DebugSnapshot, Language } from '../../../shared/types'
import { renderMarkdown } from '../markdown'

interface Props {
  problem: Problem | null
  language: Language
  code: string
  result: RunResult | null
  debugSnap: DebugSnapshot | null
  noAnswer: boolean
  history: AiMessage[]
  onHistory: (m: AiMessage[]) => void
  onOpenSettings: () => void
}

const LEVEL_LABEL = ['还没提示过', '已给 1 个提示', '已给 2 个提示', '已给 3 个提示', '已给 4 个提示', '已给 5 个提示（最高级）']

export default function AiPanel({
  problem, language, code, result, debugSnap, noAnswer, history, onHistory, onOpenSettings
}: Props) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [hintLevel, setHintLevel] = useState(0)
  const [useCode, setUseCode] = useState(true)
  const [useResult, setUseResult] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef('')

  // 用 ref 读取最新历史与回调，避免 useEffect 闭包陈旧
  const historyRef = useRef(history)
  historyRef.current = history
  const onHistoryRef = useRef(onHistory)
  onHistoryRef.current = onHistory
  // 流式回复期间若切换了题目，丢弃这次回复，避免串到另一题的历史里
  const problemIdRef = useRef<string | undefined>(problem?.id)
  problemIdRef.current = problem?.id
  const pendingForRef = useRef<string | undefined>(undefined)

  // 订阅流式输出
  useEffect(() => {
    const offDelta = window.api.ai.onDelta((t) => {
      streamingRef.current += t
      setStreaming(streamingRef.current)
    })
    const offDone = window.api.ai.onDone((full) => {
      const text = full || streamingRef.current
      streamingRef.current = ''
      setStreaming('')
      setBusy(false)
      if (pendingForRef.current !== problemIdRef.current) return
      if (text.trim()) onHistoryRef.current([...historyRef.current, { role: 'assistant', content: text }])
    })
    const offErr = window.api.ai.onError((m) => {
      streamingRef.current = ''
      setStreaming('')
      setBusy(false)
      setErr(m)
    })
    return () => { offDelta(); offDone(); offErr() }
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, streaming])

  const context = useMemo((): AiContext => {
    const p = problem
    const sig = p?.starters?.[language]
    return {
      problemTitle: p?.title,
      problemContent: p?.content,
      signature: sig,
      language,
      code: useCode ? code : undefined,
      runResult: useResult && result
        ? [
            `通过 ${result.cases.filter((c) => c.passed).length}/${result.cases.length}`,
            result.compileFailed ? `编译失败：\n${(result.compileOutput || '').slice(0, 800)}` : '',
            result.error ? `错误：${result.error}` : '',
            ...result.cases.filter((c) => !c.passed).slice(0, 3).map((c, i) =>
              `失败用例${i + 1}：输入 ${c.input.join(' / ')}｜期望 ${c.expected}｜实际 ${c.actual}${c.error ? `｜报错 ${c.error.slice(0, 200)}` : ''}`)
          ].filter(Boolean).join('\n')
        : undefined,
      debugState: debugSnap?.status === 'paused' && debugSnap.frame
        ? `暂停在第 ${debugSnap.pausedAt} 行，函数 ${debugSnap.frame.name}()，变量：` +
          Object.entries(debugSnap.frame.locals).map(([k, v]) => `${k}=${v}`).join('，')
        : undefined
    }
  }, [problem, language, code, result, debugSnap, useCode, useResult])

  const send = (mode: AiMode, text?: string) => {
    if (busy) return
    const typed = text?.trim() || ''
    if (mode === 'chat' && !typed) return
    setErr(null)
    // 快捷动作也作为一条用户消息写进对话，便于回看与让模型知道本轮诉求
    const ask = typed || (mode === 'hint'
      ? `给我第 ${Math.min(hintLevel + 1, 5)} 级提示，不要直接给答案。`
      : mode === 'debug'
        ? '帮我看看我的代码/思路哪里有问题，先别直接给正确写法。'
        : '请针对当前题目和我的代码，提一个问题引导我继续思考。')
    const nextHistory: AiMessage[] = [...history, { role: 'user', content: ask }]
    onHistory(nextHistory)
    pendingForRef.current = problem?.id
    streamingRef.current = ''
    setStreaming('')
    setBusy(true)
    window.api.ai.chat({
      context,
      history: nextHistory,
      input: undefined,
      mode,
      hintLevel,
      noAnswer
    }).catch((e: any) => { setBusy(false); setErr(String(e?.message || e)) })
    if (mode === 'hint') setHintLevel((l) => Math.min(l + 1, 5))
  }

  const stop = () => { window.api.ai.abort(); setBusy(false) }
  const clear = () => { onHistory([]); setHintLevel(0); setErr(null); setStreaming(''); streamingRef.current = '' }

  return (
    <div className="ai-panel">
      <div className="ai-toolbar">
        <button className="btn sm primary" disabled={busy || !problem} onClick={() => send('hint')} title="每次只给高一级的提示，绝不直接给答案">
          💡 {hintLevel === 0 ? '给我一个提示' : '再来一级提示'}
        </button>
        <button className="btn sm" disabled={busy || !problem} onClick={() => send('debug')} title="根据你的代码和失败用例，指出问题所在（不直接重写）">
          🔍 帮我看看哪错了
        </button>
        <button className="btn sm ghost" disabled={busy || !problem} onClick={() => send('chat', '先用一两句话复述这道题到底要我做什么，再问我一个最关键的问题。')}>
          复述题意
        </button>
        {busy
          ? <button className="btn sm ghost" onClick={stop}>⏹ 停止</button>
          : <button className="btn sm ghost" disabled={!history.length} onClick={clear}>清空</button>}
        <span className="ai-level">{LEVEL_LABEL[Math.min(hintLevel, 5)]}</span>
      </div>

      <div className="ai-ctx">
        <label className="toggle"><input type="checkbox" checked={useCode} onChange={(e) => setUseCode(e.target.checked)} />带上我的代码</label>
        <label className="toggle"><input type="checkbox" checked={useResult} onChange={(e) => setUseResult(e.target.checked)} />带上运行结果</label>
        {debugSnap?.status === 'paused' && <span className="ai-chip">含调试变量（第 {debugSnap.pausedAt} 行）</span>}
        {!noAnswer && <span className="ai-chip warn">严格模式已关闭</span>}
      </div>

      <div className="ai-log" ref={logRef}>
        {!history.length && !streaming && (
          <div className="pane-empty" style={{ height: 'auto', padding: '18px 8px' }}>
            <div className="ico">🤖</div>
            <div className="big">卡住的时候问我，但我不会直接给答案</div>
            <div className="sub">
              我会先判断你卡在哪一步，再一级一级给提示；你写了代码之后，可以直接让我帮你看哪里错了。
            </div>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            <div className="ai-role">{m.role === 'user' ? '我' : '助教'}</div>
            {m.role === 'assistant'
              ? <div className="md-body ai-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
              : <div className="ai-text">{m.content}</div>}
          </div>
        ))}
        {streaming && (
          <div className="ai-msg assistant">
            <div className="ai-role">助教</div>
            <div className="md-body ai-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming) }} />
          </div>
        )}
        {busy && !streaming && <div className="ai-typing">正在思考…</div>}
        {err && <div className="error-text">{err}<button className="link-btn" style={{ marginLeft: 8 }} onClick={onOpenSettings}>去设置</button></div>}
      </div>

      <div className="ai-input">
        <textarea
          rows={2}
          placeholder="描述你的思路或卡住的地方（Enter 发送，Shift+Enter 换行）"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              const t = input
              setInput('')
              send('chat', t)
            }
          }}
        />
        <button className="btn primary sm" disabled={busy || !input.trim()} onClick={() => { const t = input; setInput(''); send('chat', t) }}>
          发送
        </button>
      </div>
    </div>
  )
}
