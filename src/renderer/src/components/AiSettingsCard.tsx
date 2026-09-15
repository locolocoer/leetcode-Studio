import { useState } from 'react'
import type { Settings } from '../../../shared/types'

interface Props {
  settings: Settings
  onSave: (s: Settings) => void
}

const PRESETS: { name: string; baseUrl: string; model: string; note: string }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', note: '国内可直连，性价比高' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: '需要能访问 OpenAI' },
  { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', note: '国内可直连' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: '国内可直连' },
  { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', note: '无需 Key，先 ollama serve' }
]

/** 设置面板里的「AI 助手」卡片 */
export default function AiSettingsCard({ settings, onSave }: Props) {
  const [baseUrl, setBaseUrl] = useState(settings.aiBaseUrl || 'https://api.deepseek.com')
  const [model, setModel] = useState(settings.aiModel || 'deepseek-chat')
  const [key, setKey] = useState(settings.aiApiKey || '')
  const [noAnswer, setNoAnswer] = useState(settings.aiNoAnswer !== false)
  const [autoHarness, setAutoHarness] = useState(settings.autoHarness !== false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [clearMsg, setClearMsg] = useState('')

  const save = () => {
    onSave({ ...settings, aiBaseUrl: baseUrl.trim(), aiModel: model.trim(), aiApiKey: key.trim(), aiNoAnswer: noAnswer, autoHarness })
  }

  const test = async () => {
    setTesting(true)
    setTestMsg(null)
    // 先落盘再自检，保证主进程用的是当前填写的配置
    onSave({ ...settings, aiBaseUrl: baseUrl.trim(), aiModel: model.trim(), aiApiKey: key.trim(), aiNoAnswer: noAnswer, autoHarness })
    const r = await window.api.ai.test()
    setTestMsg({ ok: r.ok, text: r.message })
    setTesting(false)
  }

  return (
    <div className="setting-card">
      <h3>AI 做题助手</h3>
      <div className="desc">
        接入任意 OpenAI 兼容接口（DeepSeek / OpenAI / Moonshot / 智谱 / 本地 Ollama）。
        Key 只保存在本机设置文件里，请求由主进程直连，不经过任何第三方中转。
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button key={p.name} className={`btn xs ${baseUrl === p.baseUrl ? 'primary' : 'ghost'}`}
            title={p.note}
            onClick={() => { setBaseUrl(p.baseUrl); setModel(p.model); setTestMsg(null) }}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="setting-row">
        <label>Base URL</label>
        <input type="text" placeholder="https://api.deepseek.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </div>
      <div className="setting-row">
        <label>模型</label>
        <input type="text" placeholder="deepseek-chat" value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <div className="setting-row">
        <label>API Key</label>
        <input type="text" placeholder="sk-…（本地 Ollama 可留空）" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div className="setting-row">
        <label>严格模式</label>
        <label className="toggle">
          <input type="checkbox" checked={noAnswer} onChange={(e) => setNoAnswer(e.target.checked)} />
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
            绝不给出完整题解：只给分级提示与错误定位（推荐开启）
          </span>
        </label>
      </div>
      <div className="setting-row">
        <label>判题模板</label>
        <label className="toggle">
          <input type="checkbox" checked={autoHarness} onChange={(e) => setAutoHarness(e.target.checked)} />
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
            遇到没见过的题型时，让 AI 生成判题模板
          </span>
        </label>
      </div>
      {autoHarness && (
        <div className="setting-row">
          <label />
          <button
            className="btn sm ghost"
            onClick={async () => { await window.api.ai.clearHarness(); setClearMsg('已清空，下次运行会重新生成') }}
          >
            重置判题模板
          </button>
          {clearMsg && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{clearMsg}</span>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={test} disabled={testing}>{testing ? '测试中…' : '保存并测试连接'}</button>
        <button className="btn sm ghost" onClick={save}>仅保存</button>
        {testMsg && (
          <span style={{ fontSize: 12.5, color: testMsg.ok ? 'var(--green)' : 'var(--red)' }}>
            {testMsg.ok ? '✓ ' : '✗ '}{testMsg.text}
          </span>
        )}
      </div>
    </div>
  )
}
