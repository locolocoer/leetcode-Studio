import type { DebugSnapshot } from '../../../shared/types'

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
  const locals = frame?.locals || {}
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

      {/* 变量面板：最常见调试面板放在最显眼处 */}
      <div className="section-label" style={{ marginTop: 0 }}>
        <span>局部变量</span>
        {frame && <span className="mini">{frame.name}()</span>}
        <span className="rule" />
      </div>
      <div className="debug-locals">
        {Object.keys(locals).length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 10px' }}>
            {snapshot.status === 'finished' ? '（程序已结束）' : '（暂无局部变量，暂停后出现）'}
          </div>
        )}
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {Object.entries(locals).map(([k, v]) => (
            <div key={k} className="kv">
              <span className="k">{k}</span>
              <span className="v" style={{ color: 'var(--text)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-label">程序输出</div>
      <pre className="debug-output">{programOutput || '（无输出）'}</pre>
    </div>
  )
}
