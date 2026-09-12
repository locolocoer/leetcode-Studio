// Shared types between main process and renderer.

export type Language = 'c' | 'cpp' | 'java' | 'python'

export const ALL_LANGUAGES: Language[] = ['c', 'cpp', 'java', 'python']

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Param {
  name: string
  type: string
}

export interface Method {
  name: string
  params: Param[]
  returnType: string
}

export interface TestCase {
  id: string
  // Args, one JSON value per element, mirroring LeetCode's run input.
  input: string[]
  // Expected output as a JSON value string.
  expected: string
  isExample?: boolean
}

export interface Problem {
  id: string
  slug: string
  title: string
  titleCn?: string
  difficulty: Difficulty
  tags: string[]
  content: string // description (may contain HTML)
  judgeType: 'function' | 'class'
  // function mode:
  methodName: string
  params: Param[]
  returnType: string
  // class mode:
  constructorParams?: Param[]
  methods?: Method[]
  // 手动判题题（如相交链表/环形链表）：metaData 里混有判题专用字段
  manual?: boolean
  manualParams?: Param[]
  tests: TestCase[]
  starters: Partial<Record<Language, string>>
  link?: string
  source: 'leetcode' | 'local' | 'imported'
  solved?: boolean
}

export interface CaseResult {
  id: string
  input: string[]
  expected: string
  actual: string
  passed: boolean
  error?: string
  timeMs?: number
  stdout?: string
}

export interface RunResult {
  ok: boolean
  cases: CaseResult[]
  compileOutput?: string
  compileFailed?: boolean
  timedOut?: boolean
  error?: string
  totalTimeMs?: number
}

export interface ToolchainStatus {
  language: Language
  available: boolean
  version?: string
  compilerPath?: string
  runnerPath?: string
  source: 'bundled' | 'system' | 'none'
  error?: string
}

export type DebugStateName =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'step'
  | 'finished'
  | 'error'

export interface DebugFrame {
  name: string
  line: number
  locals: Record<string, string>
}

export interface DebugEvent {
  kind: 'line' | 'call' | 'return' | 'breakpoint' | 'pause' | 'resume' | 'exception' | 'error' | 'exit' | 'finished'
  line: number
  frame?: DebugFrame
  message?: string
}

export interface DebugSnapshot {
  status: DebugStateName
  events: DebugEvent[]
  pausedAt?: number
  frame?: DebugFrame
  programOutput: string
  error?: string
  language: Language
}

export interface FetchedProblemListEntry {
  slug: string
  title: string
  titleCn?: string
  difficulty: Difficulty
  paidOnly?: boolean
  tags?: string[]
  frontendId?: number
}

export interface FetchResult {
  ok: boolean
  problems: Problem[]
  error?: string
}

export interface Settings {
  // Override paths for bundled/system toolchains. Empty = auto-detect.
  toolpaths: Partial<Record<Language, string>>
  timeLimitMs: number
  theme: 'dark' | 'light'
  leetcodeUserSlug?: string
  // LeetCode account session info (cookies are kept in a separate file)
  lcHost?: string
  lcUsername?: string
  // 题面语言：zh=中文（leetcode.cn 翻译题面）en=英文
  contentLang?: 'zh' | 'en'
}

export interface AuthStatus {
  host: string
  username?: string
  loggedIn: boolean
}

export interface CatalogItem {
  slug: string
  frontendId?: string | number
  title: string
  titleCn?: string
  difficulty: Difficulty
}

export interface CatalogEntry {
  id: string
  kind: 'daily' | 'list'
  title: string
  host: string
  date?: string
  note?: string
  items: CatalogItem[]
}

export interface SubmitVerdict {
  ok: boolean
  accepted: boolean
  status: string
  runtime?: string
  memory?: string
  error?: string
  lastTestcase?: string
  expectedOutput?: string
  actualOutput?: string
  submissionId?: number
  totalCases?: number
  passedCases?: number
}

// ---- 题解（leetcode.cn 的 solutionArticle）----
export type SolutionOrderBy = 'DEFAULT' | 'MOST_UPVOTE'

export interface SolutionItem {
  slug: string
  title: string
  author: string
  upvoteCount: number
  createdAt?: string
  summary?: string
  tags: string[]
}

export interface SolutionListResult {
  total: number
  items: SolutionItem[]
  host: string
}

export interface SolutionDetail {
  slug: string
  title: string
  author: string
  upvoteCount: number
  createdAt?: string
  content: string // Markdown
  link: string
}

// ---- 自动更新 ----
export type UpdateState =
  | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}

export interface AppInfo {
  name: string
  version: string
  commit?: string
  electron: string
  chrome: string
  node: string
}
