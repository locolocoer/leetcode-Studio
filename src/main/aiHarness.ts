import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Language, Problem, Settings } from '../shared/types'
import type { Harness } from './harness'
import { aiComplete } from './ai'

// ---------------------------------------------------------------------------
// AI 判题适配模板（编译模板）
//
// 确定性模板（harness.ts）覆盖了绝大多数题型，但遇到没见过的题型会生成的驱动
// 编译不过或读不对输入。这里让 AI 在「确定性模板失败」时生成一份驱动，
// 然后**必须通过本题全部用例**才会被采用，并按题目+语言+签名缓存起来。
//
// 安全约束（生成的是会被编译执行的代码）：
//   - AI 只写驱动部分（main / Main.java），不写用户解答文件；
//   - 禁止出现 system/exec/subprocess/Runtime.exec 等进程与网络调用；
//   - 必须真的调用用户的方法；
//   - 用例期望值不允许作为字面量硬编码进驱动；
//   - 通过全部用例才接受，否则回退到确定性模板并如实报错。
// ---------------------------------------------------------------------------

export interface AiHarnessResult {
  harness: Harness
  attempts: number
  notes: string[]
}

const MAX_CODE = 20_000

const FORBIDDEN = [
  /\bsystem\s*\(/i,
  /\bpopen\s*\(/i,
  /\bexec[lv]?p?\s*\(/i,
  /\bsubprocess\b/i,
  /\bRuntime\s*\.\s*getRuntime\b/i,
  /\bProcessBuilder\b/i,
  /\bsocket\b/i,
  /\bchild_process\b/i,
  /\bprocess\s*\.\s*exit\s*\(\s*[1-9]/ // 非零退出会污染判题
]

function problemBrief(problem: Problem): string {
  const params = (problem.params || []).map((p) => `${p.name}: ${p.type}`).join(', ')
  const tests = (problem.tests || []).slice(0, 4).map((t, i) => ({
    case: i + 1,
    inputLines: t.input,
    expected: t.expected
  }))
  return JSON.stringify(
    {
      judgeType: problem.judgeType,
      className: problem.judgeType === 'class' ? problem.methodName : 'Solution',
      methodName: problem.methodName,
      params: problem.params,
      paramsText: params,
      returnType: problem.returnType,
      constructorParams: problem.constructorParams,
      methods: problem.methods,
      samples: tests
    },
    null,
    1
  )
}

/** 各语言驱动可用的脚手架（AI 只能在此基础上写驱动） */
function scaffoldBrief(language: Language): string {
  switch (language) {
    case 'cpp':
      return `主文件 main.cpp 已包含（你不需要重复写）：
- JSON 解析器 JVal（JVal::parse(string)，字段 .arr / .t（JVal::NUL 表示 null）/ .asInt() / .asDouble() / .asBool() / .asStr()）
- 节点结构体与构造器：struct ListNode / struct TreeNode；_listnode(JVal) / _treenode(JVal) 由 JSON 数组构造
- 向量助手：_vint(JVal) / _vdbl / _vbool / _vstr / _vvint
- 序列化：_ser(...)（支持 int/bool/string/vector<T>/ListNode*/TreeNode*）
- 已 #include "solution.cpp"（用户解答），并 using namespace std;
你只需要给出 int main() 的完整实现（可另外定义需要的辅助函数，放在 main 之前）。
注意：main 必须是最后一个函数，且不要重复定义上述名字。`
    case 'java':
      return `主文件 Main.java 需要你完整给出（包含 public class Main），可用的工具类已放在同文件之前的 Json 类里：
- Json.parse(String) 解析 JSON（返回 Object：List / Map / Long / Double / Boolean / String / null）
- Json.toInt / toLong / toDouble / toBool / Json.toStr / Json.toIntArray / Json.toLongArray / Json.toDoubleArray / Json.toStrArray / Json.toIntList / Json.toIntMatrix / Json.toStrMatrix
- Json.ser(Object) 序列化（List / 基本类型 / String）
- 用户解答类是 Solution（或题目给定的类名），节点类 TreeNode / ListNode 会随解答一起编译，可用 TreeNode.from(List) / ListNode.from(List) 构造
你只需要给出完整的 public class Main { public static void main(String[] args) throws Exception { ... } }。`
    case 'python':
      return `主文件 main.py 已包含（你不需要重复写）：
- ListNode / TreeNode 类定义与 JSON 转换：_lc_ll(list) / _lc_tree(list) / _lc_dump(value)
- 你只需要给出 main() 的实现与最后的 main() 调用（可另外定义辅助函数）。
- 用户解答类是 Solution（或题目给定的类名），形如 sol = Solution(); result = sol.method(...)。`
    default:
      return ''
  }
}

function buildPrompt(
  problem: Problem,
  language: Language,
  sourceCode: string,
  scaffoldHead: string,
  feedback: string | null,
  previousCode: string | null
): string {
  return `你要为一个本地刷题工具的**判题驱动程序**（编译模板）生成代码。

## 题目信息
${problemBrief(problem)}

## 用户当前解答（不要修改它，只调用它）
\`\`\`
${sourceCode.slice(0, 6000)}
\`\`\`

## 运行环境
${scaffoldBrief(language)}

## 输入输出契约（必须严格遵守）
- 程序从 **stdin** 读取当前用例的输入：**每个参数一行**，按参数顺序（样例里的 inputLines 就是这些行）。
- 参数行是 JSON（数组/对象/数字/字符串/null），与样例完全一致的格式。
- 把结果打印到 **stdout**，只打印结果本身（JSON 风格），不要有其它输出、日志、提示文字。
- 期望格式参照样例里的 expected：数组用 []，字符串带引号，空结果按题目语义（节点/链表为空输出 null 或 []，与 expected 一致）。
- 只处理标准输入输出的这一个用例（判题工具会为每个用例单独运行一次）。

## 可用脚手架（已存在的代码）
\`\`\`
${scaffoldHead.slice(0, 2500)}
\`\`\`

## 硬性要求
1. 必须真的调用用户解答里的方法（解题逻辑只能在解答里，驱动只负责输入输出转换）。
2. **禁止**把样例的 expected 结果硬编码到驱动里（不要靠 if/查表输出答案）。
3. **禁止**任何进程、网络、文件系统操作（system/popen/subprocess/exec/Runtime.exec/ProcessBuilder/socket 等）。
4. 不要修改或覆盖用户的解答文件。
5. 注意边界：空树/空链表、null 值、多参数、引用参数（如 vector<int>&）等情况。
${feedback ? `\n## 上一次尝试的问题（请修正）\n${feedback.slice(0, 2500)}\n` : ''}${previousCode ? `\n## 上一次生成的驱动（在上面的问题基础上改，不要推倒重来）\n\`\`\`\n${previousCode.slice(0, 4000)}\n\`\`\`\n` : ''}
## 输出格式（只输出 JSON，不要 markdown 代码块，不要解释）
{"code":"<完整驱动代码，字符串里的换行写成 \\n 转义>"}
`
}

/** 从模型回复里抠出代码（容忍 ```json 代码块等包装） */
function parseCode(raw: string): string | null {
  let t = raw.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = t.slice(start, end + 1)
    try {
      const obj = JSON.parse(slice)
      const code = typeof obj.code === 'string' ? obj.code : typeof obj.main === 'string' ? obj.main : null
      if (code && code.trim()) return code
    } catch {
      /* 落到下面的兜底 */
    }
  }
  // 兜底：模型直接给了代码
  if (/(int\s+main\s*\(|public\s+class\s+Main|def\s+main\s*\()/.test(t)) return t
  return null
}

/** 生成代码的安全性与正确性体检 */
export function checkGenerated(
  problem: Problem,
  language: Language,
  code: string
): { ok: true } | { ok: false; reason: string } {
  if (!code || code.length > MAX_CODE) return { ok: false, reason: '代码为空或过长' }
  if (/\bsolution\.(cpp|py|c|java)\b/.test(code) || /writeFile|open\s*\(/.test(code)) {
    return { ok: false, reason: '试图操作解答文件' }
  }
  for (const re of FORBIDDEN) {
    if (re.test(code)) return { ok: false, reason: `包含被禁止的调用：${re}` }
  }
  const fn = problem.methodName || ''
  const callsMethod = fn
    ? new RegExp(`\\.\\s*${fn}\\s*\\(|getattr\\s*\\(\\s*\\w+\\s*,\\s*["']${fn}["']|->\\s*${fn}\\s*\\(`).test(code)
    : true
  if (!callsMethod) return { ok: false, reason: `没有调用解答方法 ${fn}()` }

  // 硬编码期望值：多个不同期望值以字面量出现 → 认为在查表作弊
  const exps = Array.from(
    new Set((problem.tests || []).map((t) => String(t.expected ?? '').trim()).filter((e) => e.length >= 1))
  )
  let hard = 0
  for (const e of exps) {
    if (e.length > 60) continue
    const esc = e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`["']${esc}["']`).test(code)) hard++
  }
  if (exps.length >= 2 && hard >= 2) {
    return { ok: false, reason: '疑似把期望结果硬编码进驱动' }
  }
  return { ok: true }
}

/** 把 AI 的驱动代码拼回完整文件（复用确定性模板的脚手架） */
export function assembleHarness(
  language: Language,
  base: Harness,
  aiCode: string
): Harness | null {
  const split = splitHarness(language, base)
  if (!split) return null
  const mainName = driverFileName(language)
  const content = split.head + aiCode.trim() + '\n'
  const files = base.files.map((f) => (f.name === mainName ? { ...f, content } : f))
  return { ...base, files }
}

/** 驱动文件名（可编辑的那一份） */
export function driverFileName(language: Language): string {
  return language === 'java' ? 'Main.java' : language === 'python' ? 'main.py' : language === 'c' ? 'main.c' : 'main.cpp'
}

/**
 * 把完整模板拆成「脚手架 + 驱动」：脚手架是固定部分（JSON 解析、节点构造、序列化…），
 * 用户/模型只需要看和改驱动那一小段。
 */
export function splitHarness(language: Language, harness: Harness): { head: string; driver: string; file: string } | null {
  const name = driverFileName(language)
  const file = harness.files.find((f) => f.name === name)
  if (!file) return null
  let i = -1
  if (language === 'cpp' || language === 'c') i = file.content.lastIndexOf('int main(')
  else if (language === 'python') i = file.content.lastIndexOf('def main(')
  else i = file.content.indexOf('public class Main')
  if (i < 0) return null
  return { head: file.content.slice(0, i), driver: file.content.slice(i), file: name }
}

/** 缓存/覆盖：题目+语言+签名 → 驱动代码 */
export type HarnessSource = 'ai' | 'user' | 'shared'
interface CacheEntry {
  code: string
  source: HarnessSource
  at: number
}
type CacheMap = Record<string, CacheEntry>

let cachePath: string | null = null
let cache: CacheMap | null = null

export function initAiHarnessCache(dataDir: string): void {
  cachePath = join(dataDir, 'ai-harness.json')
  try {
    cache = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, 'utf8')) as CacheMap) : {}
  } catch {
    cache = {}
  }
}

/** 题目 + 语言 + 签名的哈希：本地缓存与共享模板库都用它做 key（取绝对值，避免出现 `1-cpp--700170664` 这种双横线 key） */
export function harnessSigHash(problem: Problem): string {
  const sig = JSON.stringify({
    p: problem.params,
    r: problem.returnType,
    m: problem.methodName,
    j: problem.judgeType,
    c: problem.constructorParams,
    ms: problem.methods
  })
  let h = 0
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0
  return String(Math.abs(h))
}

function cacheKey(problem: Problem, language: Language): string {
  return `${problem.id || problem.slug || 'x'}:${language}:${harnessSigHash(problem)}`
}

function persist(): void {
  if (!cache || !cachePath) return
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, JSON.stringify(cache, null, 1), 'utf8')
  } catch {
    /* 缓存失败不影响本次判题 */
  }
}

export function getHarnessEntry(problem: Problem, language: Language): CacheEntry | null {
  if (!cache) return null
  return cache[cacheKey(problem, language)] ?? null
}

export function getCachedHarness(problem: Problem, language: Language): string | null {
  return getHarnessEntry(problem, language)?.code ?? null
}

export function putCachedHarness(problem: Problem, language: Language, code: string): void {
  if (!cache) return
  cache[cacheKey(problem, language)] = { code, source: 'ai', at: Date.now() }
  persist()
}

/** 用户手写的模板：优先级最高，且不再让 AI 介入 */
export function putHarnessOverride(problem: Problem, language: Language, code: string): void {
  if (!cache) return
  cache[cacheKey(problem, language)] = { code, source: 'user', at: Date.now() }
  persist()
}

/** 从共享模板库拉取并验证通过的模板 */
export function putSharedHarness(problem: Problem, language: Language, code: string): void {
  if (!cache) return
  cache[cacheKey(problem, language)] = { code, source: 'shared', at: Date.now() }
  persist()
}

/** 撤销某题的模板（回到确定性模板） */
export function resetHarness(problem: Problem, language: Language): void {
  if (!cache) return
  delete cache[cacheKey(problem, language)]
  persist()
}

export function clearHarnessCache(): void {
  cache = {}
  persist()
}

/**
 * 生成一份判题驱动。返回 null 表示没能拿到可用的代码（此时应回退到确定性模板）。
 * `verify` 由调用方提供：编译 + 用本题用例跑一遍，全部通过才算成功。
 */
export async function generateHarness(
  settings: Settings,
  problem: Problem,
  language: Language,
  sourceCode: string,
  base: Harness,
  verify: (h: Harness) => Promise<{ ok: boolean; detail: string }>,
  onProgress?: (msg: string) => void
): Promise<AiHarnessResult | null> {
  if (!(settings.aiApiKey || '').trim()) return null
  const scaffoldHead =
    base.files.find((f) => f.name === (language === 'java' ? 'Main.java' : language === 'python' ? 'main.py' : 'main.cpp'))?.content || ''

  const notes: string[] = []
  let feedback: string | null = null
  let previousCode: string | null = null
  let attempts = 0
  const MAX_ROUNDS = 3

  for (let round = 0; round < MAX_ROUNDS; round++) {
    attempts++
    onProgress?.(round === 0 ? 'AI 正在生成判题模板…' : 'AI 正在根据报错修正模板…')
    const prompt = buildPrompt(problem, language, sourceCode, scaffoldHead, feedback, previousCode)
    const res = await aiComplete(
      settings,
      '你是严谨的判题适配器作者：只输出要求的 JSON，代码必须能编译、能真实调用用户解答，绝不硬编码答案。',
      prompt,
      { maxTokens: 4096, temperature: round === 0 ? 0.15 : 0.3 }
    )
    if (!res.ok) {
      notes.push('生成失败：' + ((res as { message?: string }).message || '未知错误'))
      return null
    }
    const code = parseCode(res.text)
    if (!code) {
      feedback = '上一次回复没能解析出代码，请严格按 {"code":"..."} 输出。'
      notes.push('模型没有返回可解析的代码')
      continue
    }
    previousCode = code
    const check = checkGenerated(problem, language, code)
    if (!check.ok) {
      const why = (check as { reason?: string }).reason || '未通过校验'
      feedback = `上一次生成的代码被规则拒绝：${why}。请重新生成，务必遵守硬性要求。`
      notes.push('被规则拒绝：' + why)
      continue
    }
    const harness = assembleHarness(language, base, code)
    if (!harness) {
      notes.push('无法拼接驱动文件')
      continue
    }
    onProgress?.('AI 模板已生成，正在用本题用例验证…')
    const v = await verify(harness)
    if (v.ok) {
      putCachedHarness(problem, language, code)
      notes.push('已通过本题全部用例并缓存')
      return { harness, attempts, notes }
    }
    feedback = `生成的驱动没有通过验证：${v.detail.slice(0, 1500)}`
    notes.push('验证未通过：' + v.detail.slice(0, 200))
  }
  return null
}
