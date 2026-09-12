import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { CatalogEntry, Problem, Settings } from '../shared/types'

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
    if (idx >= 0) problems[idx] = problem
    else problems.push(problem)
    this.saveProblems(problems)
    return problems
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
      return { ...defaults, ...s }
    } catch {
      return defaults
    }
  }

  saveSettings(settings: Settings): void {
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
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
