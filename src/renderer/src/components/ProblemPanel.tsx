import { useState } from 'react'
import type { Problem, TestCase } from '../../../shared/types'

interface Props {
  problem: Problem
  tests: TestCase[]
  onTestsChange: (t: TestCase[]) => void
  onRun: () => void
  onDebug: () => void
  onSolutions: () => void
  running: boolean
  lang: string
}

function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
}

function newId(): string {
  return 'c' + Math.random().toString(36).slice(2, 8)
}

export default function ProblemPanel({ problem, tests, onTestsChange, onRun, onDebug, onSolutions, running, lang }: Props) {
  // 默认展开第一组，其余收起——用例多的时候不要占满整屏
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [tests[0]?.id || '']: true }))
  const [allOpen, setAllOpen] = useState(false)

  const update = (id: string, patch: Partial<TestCase>) => {
    onTestsChange(tests.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const addTest = () => {
    const empty: TestCase = problem.judgeType === 'class'
      ? { id: newId(), input: ['[]', '[[]]'], expected: '[null]' }
      : { id: newId(), input: problem.params.map((p) => p.type.includes('[]') ? '[]' : '0'), expected: problem.returnType.includes('[]') ? '[]' : '0' }
    onTestsChange([...tests, empty])
    setOpen((o) => ({ ...o, [empty.id]: true }))
  }

  const removeTest = (id: string) => onTestsChange(tests.filter((t) => t.id !== id))

  const toggleAll = () => {
    const next = !allOpen
    setAllOpen(next)
    const o: Record<string, boolean> = {}
    for (const t of tests) o[t.id] = next
    setOpen(o)
  }

  return (
    <>
      <div className="left-scroll">
        <h2 className="desc-title">{problem.title}</h2>
        <div className="desc-meta">
          <span className={`diff-badge diff-${problem.difficulty}`}>
            {problem.difficulty === 'easy' ? '简单' : problem.difficulty === 'medium' ? '中等' : '困难'}
          </span>
          {problem.judgeType === 'class' && <span className="tag">设计题</span>}
          {problem.tags.slice(0, 5).map((t, i) => <span key={i} className="tag">{t}</span>)}
          {problem.source === 'leetcode' || /^[a-z0-9-]+$/.test(problem.slug) ? (
            <button className="link-btn" onClick={onSolutions} title="查看 leetcode.cn 上的题解">📖 题解</button>
          ) : null}
          {problem.link && (
            <button className="link-btn" onClick={() => window.api.app.openExternal(problem.link!)}>
              官方页面 ↗
            </button>
          )}
        </div>

        <div className="problem-desc">
          <div className="problem-content" dangerouslySetInnerHTML={{ __html: sanitize(problem.content) }} />

          <div className="section-label">
            <span>测试用例</span>
            <span className="mini">{tests.length} 组</span>
            <span className="rule" />
            {tests.length > 1 && (
              <button className="link-btn" onClick={toggleAll}>
                {allOpen ? '全部收起' : '全部展开'}
              </button>
            )}
          </div>
          <div className="test-list">
            {tests.map((t, i) => {
              const isOpen = !!open[t.id]
              return (
                <div key={t.id} className={`test-card ${isOpen ? 'open' : ''}`}>
                  <div className="t-head" onClick={() => setOpen((o) => ({ ...o, [t.id]: !isOpen }))}>
                    <span className="caret">▶</span>
                    <span className="t-title">
                      用例 {i + 1}
                      {t.isExample && <span className="ex">示例</span>}
                    </span>
                    <button className="t-del" title="删除该用例"
                      onClick={(e) => { e.stopPropagation(); removeTest(t.id) }}>✕</button>
                  </div>
                  {isOpen && (
                    <div className="t-body">
                      <div className="io">
                        <b>Input</b>
                        <textarea
                          className="io-editor"
                          rows={problem.judgeType === 'class' ? 3 : Math.max(1, t.input.length)}
                          value={t.input.join('\n')}
                          onChange={(e) => update(t.id, { input: (e.target.value.split('\n')) })}
                        />
                        <b>Expected</b>
                        <input
                          type="text"
                          className="io-input"
                          value={t.expected}
                          onChange={(e) => update(t.id, { expected: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="test-actions">
              <button className="btn ghost xs" onClick={addTest}>＋ 添加用例</button>
            </div>
          </div>
        </div>
      </div>

      <div className="left-foot">
        <button className="btn primary" onClick={onRun} disabled={running} style={{ flex: 1 }}>
          {running ? '运行中…' : '▶ 运行所有用例'}
        </button>
        <button className="btn" onClick={onDebug} title="从第 1 组用例开始逐步调试">🐞 逐步调试</button>
      </div>
      {lang === 'c' && problem.judgeType === 'class' && (
        <div className="error-text" style={{ padding: '0 18px 10px' }}>C 语言暂不支持 class 类型题目。</div>
      )}
    </>
  )
}
