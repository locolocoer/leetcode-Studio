import { useState } from 'react'
import type { Language, Settings, ToolchainStatus } from '../../../shared/types'
import UpdateCard from './UpdateCard'

interface Props {
  settings: Settings
  toolchains: Record<Language, ToolchainStatus>
  onSave: (s: Settings) => void
  onDetect: (s?: Settings) => void
}

const LANGS: { key: Language; name: string; hint: string }[] = [
  { key: 'python', name: 'Python', hint: '解释器路径（python.exe）' },
  { key: 'java', name: 'Java', hint: 'javac / java 目录或 javac 路径' },
  { key: 'cpp', name: 'C++', hint: 'g++ / gpp.exe 路径' },
  { key: 'c', name: 'C', hint: 'gcc / clang 路径' }
]

export default function SettingsPanel({ settings, toolchains, onSave, onDetect }: Props) {
  const [pathDrafts, setPathDrafts] = useState<Partial<Record<Language, string>>>({ ...settings.toolpaths })
  const [saved, setSaved] = useState(false)

  const save = () => {
    onSave({ ...settings, toolpaths: pathDrafts })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <div className="setting-card">
        <h3>工具链检测</h3>
        <div className="desc">用于编译/运行 Java、C、C++ 与 Python。应用会自动检测系统 PATH 与应用内置目录。</div>
        {LANGS.map((l) => {
          const tc = toolchains[l.key]
          return (
            <div key={l.key} className="tc-status-row">
              <span className="name">{l.name}</span>
              <div className="info">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="tc-dot" style={{ background: tc.available ? 'var(--green)' : 'var(--red)' }} />
                  <span style={{ color: tc.available ? 'var(--green)' : 'var(--red)' }}>
                    {tc.available ? '可用' : '不可用'}
                  </span>
                  <span style={{ color: 'var(--text-faint)' }}>
                    · {tc.source === 'bundled' ? '内置' : tc.source === 'system' ? '系统' : '未找到'}
                  </span>
                </span>
                <div style={{ color: 'var(--text-dim)', marginTop: 3 }}>{tc.version || ''}</div>
                <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{tc.compilerPath || tc.runnerPath || tc.error || ''}</div>
              </div>
            </div>
          )
        })}
        <button className="btn sm" onClick={() => onDetect(settings)}>重新检测</button>
      </div>

      <div className="setting-card">
        <h3>自定义工具链路径</h3>
        <div className="desc">留空则自动检测。可指向应用内置工具链目录或系统安装位置。</div>
        {LANGS.map((l) => (
          <div key={l.key} className="setting-row">
            <label>{l.name}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder={l.hint}
                value={pathDrafts[l.key] || ''}
                onChange={(e) => setPathDrafts((d) => ({ ...d, [l.key]: e.target.value }))}
              />
              <button className="btn sm" style={{ whiteSpace: 'nowrap' }}
                onClick={async () => {
                  const p = await window.api.toolchains.pick(l.key)
                  if (p) setPathDrafts((d) => ({ ...d, [l.key]: p }))
                }}>
                浏览…
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="setting-card">
        <h3>运行设置</h3>
        <div className="setting-row">
          <label>题面语言</label>
          <select
            value={settings.contentLang || 'zh'}
            onChange={(e) => onSave({ ...settings, contentLang: e.target.value as 'zh' | 'en' })}>
            <option value="zh">中文（leetcode.cn 题面/标题）</option>
            <option value="en">English（leetcode.com 题面/标题）</option>
          </select>
        </div>
        <div className="setting-row">
          <label>单测超时</label>
          <input
            type="number"
            value={settings.timeLimitMs}
            min={500}
            max={20000}
            onChange={(e) => onSave({ ...settings, timeLimitMs: Number(e.target.value) || 4000 })}
          />
        </div>
        <div className="setting-row">
          <label>主题</label>
          <select value={settings.theme} onChange={(e) => onSave({ ...settings, theme: e.target.value as any })}>
            <option value="dark">暗色</option>
            <option value="light">亮色</option>
          </select>
        </div>
      </div>

      <button className="btn primary" onClick={save}>{saved ? '✓ 已保存' : '保存设置'}</button>

      <div style={{ height: 14 }} />
      <UpdateCard />
    </div>
  )
}
