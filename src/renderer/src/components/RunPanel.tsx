import type { RunResult } from '../../../shared/types'

interface Props {
  result: RunResult | null
  running: boolean
  /** 运行过程中的提示（如「AI 正在生成判题模板」） */
  note?: string | null
}

function AiHarnessBadge({ result }: { result: RunResult }) {
  const info = result.aiHarness
  if (!info) return null
  return (
    <div
      className="ai-harness-badge"
      title="本地判题模板不适配这道题时，会用 AI 生成一份驱动模板；只有通过本题全部用例才会采用，并按题目缓存起来"
    >
      {info.used ? '🤖 使用了 AI 生成的判题模板' : '🤖 已尝试 AI 生成判题模板（未采用）'}
      {info.note ? <span style={{ opacity: 0.75 }}> · {info.note}</span> : null}
    </div>
  )
}

export default function RunPanel({ result, running, note }: Props) {
  if (running) {
    return (
      <div className="loader">
        {note || '正在编译并运行…'}
      </div>
    )
  }
  if (!result) {
    return (
      <div className="pane-empty">
        <div className="ico">▶</div>
        <div className="big">还没有运行结果</div>
        <div className="sub">点左侧「▶ 运行所有用例」，会编译并逐组比对期望输出；本地跑题不消耗 LeetCode 提交次数。</div>
      </div>
    )
  }
  if (result.compileFailed) {
    return (
      <div>
        <AiHarnessBadge result={result} />
        <div className="error-text" style={{ marginBottom: 12, fontSize: 14 }}>编译失败</div>
        <pre className="debug-output" style={{ maxHeight: 500 }}>{result.compileOutput || '无输出'}</pre>
      </div>
    )
  }
  if (result.error) {
    return (
      <div>
        <AiHarnessBadge result={result} />
        <div className="error-text">{result.error}</div>
      </div>
    )
  }
  const passed = result.cases.filter((c) => c.passed).length
  const allPass = passed === result.cases.length
  return (
    <div>
      <AiHarnessBadge result={result} />
      <div className="debug-status">
        <span style={{ color: allPass ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
          {allPass ? '✓ ' : '✗ '}{passed} / {result.cases.length} 通过
        </span>
        {result.timedOut && <span style={{ color: 'var(--amber)' }}>存在超时</span>}
        {result.totalTimeMs != null && <span style={{ color: 'var(--text-faint)' }}>总耗时 {result.totalTimeMs} ms</span>}
      </div>
      {result.cases.map((c, i) => (
        <div key={c.id} className={`result-row ${c.passed ? 'pass-row' : 'fail-row'}`}>
          <div className="r-head">
            <span className="t-title">用例 {i + 1}</span>
            <span className={`r-status ${c.passed ? 'pass' : 'fail'}`}>
              {c.passed ? '✓ 通过' : '✗ 失败'}
            </span>
          </div>
          <div className="r-val" style={{ marginBottom: 3 }}>
            <span className="r-expected">期望：</span>{c.expected}
          </div>
          <div className="r-val">
            <span className="r-actual">实际：</span>{c.actual}
          </div>
          {c.error && <div className="r-err" style={{ marginTop: 4 }}>{c.error}</div>}
        </div>
      ))}
    </div>
  )
}
