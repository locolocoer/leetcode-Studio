import { useCallback, useEffect, useRef, useState } from 'react'
import type { DebugSnapshot, DebugVar } from '../../../shared/types'

interface Props {
  snapshot: DebugSnapshot | null
  placeholder?: boolean
  onStep: () => void
  onOver: () => void
  onResume: () => void
  onStop: () => void
  programOutput: string
}

const statusLabel: Record<string, string> = {
  idle: '待调试',
  starting: '正在启动',
  running: '运行中',
  paused: '已暂停',
  step: '单步',
  finished: '调试结束',
  error: '错误'
}

function PlaceholderNotice() {
  return (
    <div style={{
      background: 'var(--amber-soft)', border: '1px solid rgba(226,185,59,0.4)', color: 'var(--amber)',
      borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12.5, lineHeight: 1.7, marginBottom: 12
    }}>
      ⚠️ 当前函数体还是占位符 <code style={{ fontFamily: 'var(--mono)' }}>pass</code>，没有可执行的语句——所以单步会立刻结束、变量也不会变化。<br />
      请先写出真实实现（多行语句），再调试。内置示例题会自动载入一份可运行的参考实现。
    </div>
  )
}

/** 变量树：点箭头展开子节点（容器元素 / 对象字段 / 链表 next …） */
function VarTree({ vars, stopKey }: { vars: DebugVar[]; stopKey: string }) {
  // ref -> 子节点；展开状态在同一个「停顿点」内保留（单步后重新拉取，值保持最新）
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [kids, setKids] = useState<Record<string, DebugVar[]>>({})
  const [empty, setEmpty] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const load = useCallback(async (ref: string) => {
    setLoading((s) => new Set(s).add(ref))
    try {
      const list = await window.api.debug.children(ref)
      setKids((k) => ({ ...k, [ref]: list }))
      // 展开后确实没有子节点 → 收掉箭头，避免误导
      setEmpty((s) => {
        const n = new Set(s)
        if (list.length) n.delete(ref)
        else n.add(ref)
        return n
      })
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading((s) => { const n = new Set(s); n.delete(ref); return n })
    }
  }, [])

  // 每次停顿：清空缓存与「空节点」标记，并把已展开的节点重新拉一遍（值随单步刷新）
  useEffect(() => {
    setKids({})
    setEmpty(new Set())
    setErr(null)
    for (const ref of expandedRef.current) void load(ref)
  }, [stopKey, load])

  const toggle = (v: DebugVar) => {
    if (!v.expandable || !v.ref) return
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(v.ref)) n.delete(v.ref)
      else { n.add(v.ref); void load(v.ref) }
      return n
    })
  }

  const renderNode = (v: DebugVar, depth: number): JSX.Element => {
    const isOpen = expanded.has(v.ref)
    const childList = kids[v.ref]
    const canExpand = !!v.expandable && !!v.ref && !empty.has(v.ref)
    return (
      <div key={v.ref + '@' + depth}>
        <div className="vrow" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(v)}>
          <span className={`vcaret ${canExpand ? '' : 'empty'} ${isOpen ? 'open' : ''}`}>
            {canExpand ? '▶' : ''}
          </span>
          <span className="vname">{v.name}</span>
          <span className="vval">{v.value || (isOpen && loading.has(v.ref) ? '加载中…' : '')}</span>
        </div>
        {isOpen && childList && childList.map((c) => renderNode(c, depth + 1))}
        {isOpen && !childList && loading.has(v.ref) && (
          <div className="vrow" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
            <span className="vcaret empty" />
            <span className="vval">加载中…</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="debug-locals">
      {!vars.length && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 10px' }}>（暂无局部变量）</div>
      )}
      {vars.map((v) => renderNode(v, 0))}
      {err && <div className="error-text" style={{ padding: '4px 10px' }}>{err}</div>}
    </div>
  )
}

export default function DebugPanel({ snapshot, placeholder, onStep, onOver, onResume, onStop, programOutput }: Props) {
  if (!snapshot || snapshot.status === 'idle') {
    return (
      <div className="pane-empty">
        <div className="ico">🐞</div>
        <div className="big">逐步调试</div>
        <div className="sub">
          在编辑器里按 <b>F9</b>（或点行号）加断点 → 点左侧「🐞 逐步调试」。<br />
          命中后会高亮<b>即将执行</b>的那一行，右侧实时显示变量值。
        </div>
        <div className="sub" style={{ color: 'var(--text-faint)' }}>
          支持 Python（原生跟踪）· C / C++（gdb）· Java（jdb），工具链已内置。
        </div>
        {placeholder && <div style={{ alignSelf: 'stretch', marginTop: 12, textAlign: 'left' }}><PlaceholderNotice /></div>}
      </div>
    )
  }

  const paused = snapshot.status === 'paused'
  const frame = snapshot.frame
  const vars: DebugVar[] = frame?.vars?.length
    ? frame.vars
    : Object.entries(frame?.locals || {}).map(([name, value]) => ({ name, value, ref: '', expandable: false }))
  const stepCount = snapshot.events.filter((e) => e.kind === 'line' || e.kind === 'breakpoint').length

  return (
    <div>
      {placeholder && <PlaceholderNotice />}
      <div className="debug-controls">
        <button className="btn sm primary" onClick={onResume} disabled={!paused} title="运行到下一个断点或程序结束">
          ▶ 继续
        </button>
        <button className="btn sm" onClick={onStep} disabled={!paused} title="执行当前行并停到下一行（步进）">
          ⏭ 单步
        </button>
        <button className="btn sm" onClick={onOver} disabled={!paused} title="执行完当前函数调用，停到下一行（步过）">
          ↷ 步过
        </button>
        <button className="btn sm ghost" onClick={onStop} disabled={snapshot.status === 'finished' || snapshot.status === 'error'} title="结束调试">
          ⏹ 停止
        </button>
      </div>

      <div className="debug-status">
        <span style={{ color: paused ? 'var(--amber)' : snapshot.status === 'error' ? 'var(--red)' : 'var(--text)' }}>
          {statusLabel[snapshot.status]}
        </span>
        {snapshot.pausedAt && <span>暂停于第 {snapshot.pausedAt} 行</span>}
        {frame && <span>函数 {frame.name}()</span>}
        <span>已停 {stepCount} 次</span>
      </div>

      {snapshot.status === 'finished' && (
        <div style={{ fontSize: 12.5, color: 'var(--green)', marginBottom: 10 }}>
          ✓ 程序已运行结束，最终结果见下方「程序输出」。
        </div>
      )}
      {snapshot.status === 'error' && snapshot.error && (
        <div className="error-text" style={{ marginBottom: 10 }}>{snapshot.error}</div>
      )}

      <div className="section-label" style={{ marginTop: 0 }}>
        <span>局部变量</span>
        {frame && <span className="mini">{frame.name}()</span>}
        <span className="rule" />
        {frame?.vars?.length ? <span className="mini">点 ▶ 展开</span> : null}
      </div>
      <VarTree vars={vars} stopKey={`${frame?.name || ''}:${snapshot.pausedAt || 0}:${stepCount}`} />

      <div className="section-label">程序输出</div>
      <pre className="debug-output">{programOutput || '（无输出）'}</pre>
    </div>
  )
}
