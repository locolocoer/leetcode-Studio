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
  /** 刷题记录：提交通过（Accepted）的时间与语言 */
  solvedAt?: string
  solvedLang?: Language
  /** 本地「运行所有用例」全过的最近时间（仅供提示，不算通过） */
  localPassAt?: string
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
  /** 本次是否用了 AI 生成的判题模板 */
  aiHarness?: { used: boolean; note?: string; origin?: 'user' | 'ai' }
}

/** 判题模板（编译模板）的可查看/可编辑视图 */
export interface HarnessView {
  /** 驱动所在文件名，如 main.cpp / Main.java / main.py */
  file: string
  /** 可编辑的驱动部分 */
  driver: string
  /** 固定脚手架（只读，供参考） */
  head: string
  /** 当前生效来源：你编辑的 / AI 生成的 / 内置确定性模板 */
  origin: 'user' | 'ai' | 'builtin'
  language: Language
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
  /** 可展开的变量树（当前支持 C/C++） */
  vars?: DebugVar[]
}

/** 变量树节点：value 是一行预览，ref 用于按需展开子节点 */
export interface DebugVar {
  name: string
  value: string
  /** 不透明引用（内部是 gdb 表达式），展开子节点时回传 */
  ref: string
  expandable?: boolean
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
  /** 英文标题（中文题面时也带上，两种语言都能搜到） */
  titleEn?: string
  difficulty: Difficulty
  paidOnly?: boolean
  tags?: string[]
  frontendId?: number | string
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
  // ---- AI 做题助手（OpenAI 兼容接口）----
  aiBaseUrl?: string
  aiModel?: string
  aiApiKey?: string
  /** 严格模式：绝不给出完整题解（默认开启） */
  aiNoAnswer?: boolean
  /** 判题模板不适配时，自动让 AI 生成编译模板（默认开启，需配置 API Key） */
  autoHarness?: boolean
  /** 上次使用的刷题语言：下次打开题目默认用它 */
  lastLanguage?: Language
  /** 共享判题模板库：内置模板不适配时自动从 OSS / GitHub 拉取（默认开启） */
  shareHarness?: boolean
  /** 发布模板到共享库用的 GitHub Token（只需该仓库的 contents 写权限） */
  githubToken?: string
}

// ---- AI 助手 ----
export type AiRole = 'system' | 'user' | 'assistant'

export interface AiMessage {
  role: AiRole
  content: string
}

export type AiMode = 'hint' | 'debug' | 'chat'

/** 发送给主进程的上下文（由渲染进程按需组装） */
export interface AiContext {
  problemTitle?: string
  problemContent?: string
  signature?: string
  language?: string
  code?: string
  /** 最近一次运行结果摘要 */
  runResult?: string
  /** 调试暂停状态摘要 */
  debugState?: string
}

export interface AiChatRequest {
  context: AiContext
  history: AiMessage[]
  /** 本轮用户输入（可为空，表示点的是快捷动作） */
  input?: string
  mode: AiMode
  /** 已给出多少个提示（用于逐级提升） */
  hintLevel: number
  /** 严格模式：不得给出完整题解 */
  noAnswer: boolean
}

export interface AiTestResult {
  ok: boolean
  message: string
  model?: string
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
  /** 昵称（力扣的 realName，可能没有） */
  authorName?: string
  /** 头像地址 */
  authorAvatar?: string
  authorSlug?: string
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
  authorName?: string
  authorAvatar?: string
  authorSlug?: string
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
