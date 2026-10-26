import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { CatalogEntry, Problem, Settings } from '../shared/types'
import { protectSettings, publicSettings, revealSettings, SECRET_PREFIX } from './secrets'

export type StoreEvents = { onChange?: (problems: Problem[]) => void }

export class Store {
  private problemsPath: string
  private settingsPath: string
  private catalogPath: string
  private onChange?: () => void

  constructor(dir: string, onChange?: () => void) {
    mkdirSync(dir, { recursive: true })
    this.problemsPath = join(dir, 'problems.json')
    this.settingsPath = join(dir, 'settings.json')
    this.catalogPath = join(dir, 'catalog.json')
    this.onChange = onChange
  }

  loadProblems(): Problem[] {
    if (!existsSync(this.problemsPath)) return []
    try {
      const arr = JSON.parse(readFileSync(this.problemsPath, 'utf8'))
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }

  saveProblems(problems: Problem[]): void {
    writeFileSync(this.problemsPath, JSON.stringify(problems, null, 2), 'utf8')
    this.onChange?.()
  }

  upsertProblem(problem: Problem): Problem[] {
    const problems = this.loadProblems()
    const idx = problems.findIndex((p) => p.id === problem.id)
    if (idx >= 0) {
      const prev = problems[idx]
      // 刷题记录只增不减：普通写入（改代码、改用例）没带记录时保留原有的，
      // 要清记录请走 clearRecords()。
      problems[idx] = {
        ...problem,
        solvedAt: problem.solvedAt ?? prev.solvedAt,
        solvedLang: problem.solvedLang ?? prev.solvedLang,
        localPassAt: problem.localPassAt ?? prev.localPassAt
      }
    } else {
      problems.push(problem)
    }
    this.saveProblems(problems)
    return problems
  }

  /** 清除刷题记录（按 slug），返回更新后的列表 */
  clearRecords(slugs?: string[]): Problem[] {
    const problems = this.loadProblems()
    const set = slugs && slugs.length ? new Set(slugs) : null
    let n = 0
    const next = problems.map((p) => {
      if (set && !set.has(p.slug)) return p
      if (!p.solvedAt && !p.localPassAt) return p
      n++
      return { ...p, solvedAt: undefined, solvedLang: undefined, localPassAt: undefined }
    })
    if (n) this.saveProblems(next)
    return next
  }

  removeProblem(id: string): Problem[] {
    const problems = this.loadProblems().filter((p) => p.id !== id)
    this.saveProblems(problems)
    return problems
  }

  loadSettings(): Settings {
    const defaults: Settings = {
      toolpaths: {},
      timeLimitMs: 4000,
      theme: 'dark',
      contentLang: 'zh',
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-chat',
      aiNoAnswer: true
    }
    if (!existsSync(this.settingsPath)) return defaults
    try {
      const s = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
      // 密钥落盘是密文，读出来解密成明文，主进程内部照常使用
      return revealSettings({ ...defaults, ...s })
    } catch {
      return defaults
    }
  }

  saveSettings(settings: Settings): void {
    // 去掉「清除密钥 / 是否已配置」这类一次性或派生字段，不落盘
    const { clearApiKey: _ca, clearGithubToken: _cg, hasApiKey: _ha, hasGithubToken: _hg, ...rest } = settings as Settings & {
      clearApiKey?: boolean; clearGithubToken?: boolean; hasApiKey?: boolean; hasGithubToken?: boolean
    }
    writeFileSync(this.settingsPath, JSON.stringify(protectSettings(rest), null, 2), 'utf8')
  }

  /** 下发给渲染层的设置：不含明文密钥，只带「是否已配置」标记 */
  getPublicSettings(): Settings {
    return publicSettings(this.loadSettings())
  }

  /** 启动时把旧版明文密钥迁移成加密存储（幂等，只在确实需要时写盘） */
  migrateSecrets(): void {
    if (!existsSync(this.settingsPath)) return
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Settings
      const key = (raw.aiApiKey || '').trim()
      const token = (raw.githubToken || '').trim()
      if ((key && !key.startsWith(SECRET_PREFIX)) || (token && !token.startsWith(SECRET_PREFIX))) {
        this.saveSettings(raw)
      }
    } catch { /* 文件损坏时忽略，交给 loadSettings 兜底 */ }
  }

  /**
   * 渲染层保存设置：它拿到的是脱敏后的对象（密钥字段是空串）。
   * 这里做合并：留空 = 保持不变；给了新值 = 覆盖；带 clear 标志 = 清除。
   */
  saveSettingsFromRenderer(incoming: Settings): void {
    const current = this.loadSettings()
    const merged: Settings = { ...current, ...incoming }

    const apiKey = (incoming.aiApiKey ?? '').trim()
    const token = (incoming.githubToken ?? '').trim()
    merged.aiApiKey = incoming.clearApiKey ? '' : apiKey || current.aiApiKey
    merged.githubToken = incoming.clearGithubToken ? '' : token || current.githubToken

    this.saveSettings(merged)
  }

  loadCatalog(): CatalogEntry[] {
    if (!existsSync(this.catalogPath)) return []
    try {
      const arr = JSON.parse(readFileSync(this.catalogPath, 'utf8'))
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }

  saveCatalog(entries: CatalogEntry[]): void {
    writeFileSync(this.catalogPath, JSON.stringify(entries, null, 2), 'utf8')
  }

  findProblemBySlug(slug: string): Problem | undefined {
    return this.loadProblems().find((p) => p.slug === slug)
  }
}
