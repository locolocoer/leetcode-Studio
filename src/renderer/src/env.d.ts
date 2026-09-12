/// <reference types="vite/client" />

import type {
  DebugVar,
  AiChatRequest, AiTestResult, AppInfo, AuthStatus, CatalogEntry, DebugSnapshot, FetchedProblemListEntry,
  Language, Problem, RunResult, Settings, SolutionDetail, SolutionListResult, SolutionOrderBy, SubmitVerdict,
  ToolchainStatus, UpdateStatus
} from '../../shared/types'

interface DshApiShape {
  problems: {
    list(): Promise<Problem[]>
    update(p: Problem): Promise<Problem[]>
    remove(id: string): Promise<Problem[]>
    ensure(slug: string, host?: string): Promise<Problem>
    refetch(slug: string): Promise<Problem>
  }
  catalog: {
    get(): Promise<CatalogEntry[]>
    set(entries: CatalogEntry[]): Promise<CatalogEntry[]>
  }
  settings: { get(): Promise<Settings>; save(s: Settings): Promise<boolean> }
  toolchains: { detect(s?: Settings): Promise<Record<Language, ToolchainStatus>>; pick(lang: Language): Promise<string | null> }
  fetch: {
    list(): Promise<FetchedProblemListEntry[]>
    detail(slug: string): Promise<Problem>
    daily(host?: string): Promise<{ problem: Problem; date: string }>
    listProblems(favoriteSlug: string, host?: string, title?: string): Promise<CatalogEntry>
  }
  run: { tests(p: Problem, lang: Language, src: string, tests: any[]): Promise<RunResult> }
  solutions: {
    list(questionSlug: string, opts?: { first?: number; skip?: number; orderBy?: SolutionOrderBy }): Promise<SolutionListResult>
    detail(slug: string, questionSlug?: string): Promise<SolutionDetail>
  }
  debug: {
    start(p: Problem, lang: Language, src: string, test: any, bps: number[]): Promise<DebugSnapshot>
    step(): Promise<DebugSnapshot | undefined>
    over(): Promise<DebugSnapshot | undefined>
    resume(): Promise<DebugSnapshot | undefined>
    stop(): Promise<DebugSnapshot | undefined>
    setBreak(line: number): Promise<DebugSnapshot | undefined>
    children(ref: string): Promise<DebugVar[]>
    snapshot(): Promise<DebugSnapshot | undefined>
    onEvent(cb: (e: any) => void): void
    onOutput(cb: (t: string) => void): void
    onDone(cb: () => void): void
  }
  app: {
    version(): Promise<string>
    info(): Promise<AppInfo>
    clipboardText(): Promise<string>
    openExternal(url: string): void
  }
  updater: {
    check(): Promise<boolean>
    install(): Promise<boolean>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  ai: {
    chat(req: AiChatRequest): Promise<boolean>
    abort(): Promise<void>
    test(): Promise<AiTestResult>
    clearHarness(): Promise<boolean>
    onRunNote(cb: (t: string) => void): () => void
    onDelta(cb: (t: string) => void): () => void
    onDone(cb: (full: string) => void): () => void
    onError(cb: (m: string) => void): () => void
  }
  win: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (max: boolean) => void): void
  }
  lc: {
    status(host?: string): Promise<AuthStatus>
    openLogin(host: string): Promise<AuthStatus & { ok: boolean; error?: string }>
    importCookies(host: string, text: string): Promise<AuthStatus & { ok: boolean; error?: string }>
    logout(host?: string): Promise<AuthStatus>
    whoami(host?: string): Promise<{ host: string; username?: string }>
    submit(host: string | undefined, slug: string, qid: string | number, lang: Language, code: string): Promise<SubmitVerdict>
  }
}

declare global {
  interface Window {
    api: DshApiShape
  }
}

export {}
