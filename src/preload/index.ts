import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiChatRequest, AiTestResult, AppInfo, AuthStatus, CatalogEntry, DebugSnapshot, DebugVar, FetchedProblemListEntry,
  Language, Problem, RunResult, Settings, SolutionDetail, SolutionListResult, SolutionOrderBy, SubmitVerdict,
  TestCase, ToolchainStatus, UpdateStatus, HarnessView
} from '../shared/types'

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  problems: {
    list: (): Promise<Problem[]> => invoke('problems:list'),
    update: (p: Problem): Promise<Problem[]> => invoke('problems:update', p),
    remove: (id: string): Promise<Problem[]> => invoke('problems:remove', id),
    ensure: (slug: string, host?: string): Promise<Problem> => invoke('problems:ensure', slug, host),
    refetch: (slug: string): Promise<Problem> => invoke('problems:refetch', slug)
  },
  catalog: {
    get: (): Promise<CatalogEntry[]> => invoke('catalog:get'),
    set: (entries: CatalogEntry[]): Promise<CatalogEntry[]> => invoke('catalog:set', entries)
  },
  settings: {
    get: (): Promise<Settings> => invoke('settings:get'),
    save: (s: Settings): Promise<boolean> => invoke('settings:save', s)
  },
  toolchains: {
    detect: (s?: Settings): Promise<Record<Language, ToolchainStatus>> => invoke('toolchains:detect', s),
    pick: (lang: Language): Promise<string | null> => invoke('toolchains:pick', lang)
  },
  fetch: {
    list: (): Promise<FetchedProblemListEntry[]> => invoke('fetch:list'),
    detail: (slug: string): Promise<Problem> => invoke('fetch:detail', slug),
    daily: (host?: string): Promise<{ problem: Problem; date: string }> => invoke('fetch:daily', host),
    listProblems: (favoriteSlug: string, host?: string, title?: string): Promise<CatalogEntry> =>
      invoke('fetch:listProblems', favoriteSlug, host, title)
  },
  run: {
    tests: (p: Problem, lang: Language, src: string, tests: TestCase[]): Promise<RunResult> =>
      invoke('run:tests', p, lang, src, tests)
  },
  solutions: {
    list: (questionSlug: string, opts?: { first?: number; skip?: number; orderBy?: SolutionOrderBy }): Promise<SolutionListResult> =>
      invoke('solutions:list', questionSlug, opts),
    detail: (slug: string, questionSlug?: string): Promise<SolutionDetail> =>
      invoke('solutions:detail', slug, questionSlug)
  },
  harness: {
    view: (p: Problem, lang: Language, src: string): Promise<HarnessView | null> => invoke('harness:view', p, lang, src),
    verify: (p: Problem, lang: Language, src: string, driver: string, tests: TestCase[]): Promise<RunResult> =>
      invoke('harness:verify', p, lang, src, driver, tests),
    save: (p: Problem, lang: Language, src: string, driver: string, tests: TestCase[]): Promise<RunResult> =>
      invoke('harness:save', p, lang, src, driver, tests),
    reset: (p: Problem, lang: Language): Promise<boolean> => invoke('harness:reset', p, lang)
  },
  debug: {
    start: (p: Problem, lang: Language, src: string, test: TestCase, bps: number[]): Promise<DebugSnapshot> =>
      invoke('debug:start', p, lang, src, test, bps),
    step: (): Promise<DebugSnapshot | undefined> => invoke('debug:step'),
    over: (): Promise<DebugSnapshot | undefined> => invoke('debug:over'),
    resume: (): Promise<DebugSnapshot | undefined> => invoke('debug:resume'),
    stop: (): Promise<DebugSnapshot | undefined> => invoke('debug:stop'),
    setBreak: (line: number): Promise<DebugSnapshot | undefined> => invoke('debug:break', line),
    children: (ref: string): Promise<DebugVar[]> => invoke('debug:children', ref),
    snapshot: (): Promise<DebugSnapshot | undefined> => invoke('debug:snapshot'),
    onEvent: (cb: (e: any) => void) => { ipcRenderer.on('debug:event', (_e, ev) => cb(ev)) },
    onOutput: (cb: (t: string) => void) => { ipcRenderer.on('debug:output', (_e, t) => cb(t)) },
    onDone: (cb: () => void) => { ipcRenderer.on('debug:done', () => cb()) }
  },
  app: {
    version: (): Promise<string> => invoke('app:version'),
    info: (): Promise<AppInfo> => invoke('app:info'),
    clipboardText: (): Promise<string> => invoke('clipboard:text'),
    openExternal: (url: string) => invoke('open:external', url)
  },
  updater: {
    check: (): Promise<boolean> => invoke('update:check'),
    install: (): Promise<boolean> => invoke('update:install'),
    onStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, s: UpdateStatus): void => cb(s)
      ipcRenderer.on('update:status', handler)
      return () => ipcRenderer.removeListener('update:status', handler)
    }
  },
  ai: {
    chat: (req: AiChatRequest): Promise<boolean> => invoke('ai:chat', req),
    abort: (): Promise<void> => invoke('ai:abort'),
    test: (): Promise<AiTestResult> => invoke('ai:test'),
    clearHarness: (): Promise<boolean> => invoke('ai:clearHarness'),
    onRunNote: (cb: (t: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, t: string): void => cb(t)
      ipcRenderer.on('run:note', handler)
      return () => ipcRenderer.removeListener('run:note', handler)
    },
    onDelta: (cb: (t: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, t: string): void => cb(t)
      ipcRenderer.on('ai:delta', handler)
      return () => ipcRenderer.removeListener('ai:delta', handler)
    },
    onDone: (cb: (full: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, t: string): void => cb(t)
      ipcRenderer.on('ai:done', handler)
      return () => ipcRenderer.removeListener('ai:done', handler)
    },
    onError: (cb: (m: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, m: string): void => cb(m)
      ipcRenderer.on('ai:error', handler)
      return () => ipcRenderer.removeListener('ai:error', handler)
    }
  },
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: (): Promise<boolean> => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
    isMaximized: (): Promise<boolean> => invoke('win:isMaximized'),
    onMaximizeChange: (cb: (max: boolean) => void) => { ipcRenderer.on('win:maximized', (_e, m) => cb(!!m)) }
  },
  lc: {
    status: (host?: string): Promise<AuthStatus> => invoke('lc:status', host),
    openLogin: (host: string): Promise<AuthStatus & { ok: boolean; error?: string }> => invoke('lc:openLogin', host),
    importCookies: (host: string, text: string): Promise<AuthStatus & { ok: boolean; error?: string }> =>
      invoke('lc:importCookies', host, text),
    logout: (host?: string): Promise<AuthStatus> => invoke('lc:logout', host),
    whoami: (host?: string): Promise<{ host: string; username?: string }> => invoke('lc:whoami', host),
    submit: (host: string | undefined, slug: string, qid: string | number, lang: Language, code: string): Promise<SubmitVerdict> =>
      invoke('lc:submit', host, slug, qid, lang, code)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type DshApi = typeof api
