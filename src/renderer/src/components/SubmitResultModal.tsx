import type { SubmitVerdict } from '../../../shared/types'

interface Props {
  verdict: SubmitVerdict | null
  submitting: boolean
  onClose: () => void
}

export default function SubmitResultModal({ verdict, submitting, onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={() => !submitting && onClose()}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{submitting ? '正在提交评测…' : '提交结果'}</h2>
          <button className="btn ghost sm" onClick={onClose} disabled={submitting}>✕</button>
        </div>
        <div className="modal-body">
          {submitting && <div className="loader">LeetCode 评测中（通常 3-15 秒），请稍候…</div>}
          {!submitting && verdict && (
            <div>
              <div className="debug-status" style={{ marginBottom: 14 }}>
                {verdict.accepted ? (
                  <span style={{ color: 'var(--green)', fontSize: 15 }}>✅ {verdict.status}</span>
                ) : (
                  <span style={{ color: 'var(--red)', fontSize: 15 }}>❌ {verdict.status}</span>
                )}
              </div>
              {verdict.error && <div className="error-text" style={{ marginBottom: 10 }}>{verdict.error}</div>}
              {verdict.accepted && (
                <div className="kv" style={{ display: 'flex', gap: 24, marginBottom: 10 }}>
                  <span>耗时：<b style={{ color: 'var(--text)' }}>{verdict.runtime} ms</b></span>
                  <span>内存：<b style={{ color: 'var(--text)' }}>{verdict.memory} MB</b></span>
                  {verdict.totalCases != null && <span>用例：<b style={{ color: 'var(--text)' }}>{verdict.passedCases}/{verdict.totalCases}</b></span>}
                </div>
              )}
              {!verdict.accepted && (
                <>
                  {verdict.passedCases != null && verdict.totalCases != null && (
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
                      已通过 {verdict.passedCases} / {verdict.totalCases} 组用例
                    </div>
                  )}
                  {verdict.lastTestcase && (
                    <div className="result-row">
                      <div className="r-head"><span className="r-status fail">输入</span></div>
                      <div className="r-val r-err" style={{ whiteSpace: 'pre-wrap' }}>{verdict.lastTestcase}</div>
                    </div>
                  )}
                  {verdict.expectedOutput != null && (
                    <div className="result-row">
                      <div className="r-head"><span className="r-status fail">期望输出</span></div>
                      <div className="r-val r-expected" style={{ whiteSpace: 'pre-wrap' }}>{verdict.expectedOutput}</div>
                    </div>
                  )}
                  {verdict.actualOutput != null && (
                    <div className="result-row">
                      <div className="r-head"><span className="r-status fail">实际输出</span></div>
                      <div className="r-val r-actual" style={{ whiteSpace: 'pre-wrap' }}>{verdict.actualOutput}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
