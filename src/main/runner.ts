import { spawn, execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, dirname, delimiter } from 'path'
import type {
  CaseResult, HarnessView, Language, Problem, RunResult, Settings, TestCase, ToolchainStatus
} from '../shared/types'
import { buildHarness, type Harness } from './harness'
import { generateHarness, getHarnessEntry, assembleHarness, splitHarness } from './aiHarness'

const RUNNER_TIMEOUT_MS_DEFAULT = 4000

// gcc/g++/内嵌工具链需要把自己的 bin 放进 PATH 才能找到 cc1/as/ld 等
function toolchainEnv(tc: ToolchainStatus): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const dir = tc.compilerPath ? dirname(tc.compilerPath) : undefined
  if (dir) env.PATH = dir + delimiter + (env.PATH || '')
  return env
}

/**
 * Windows 上残留的进程（上一次调试的 main.exe / java.exe）会锁住编译产物，
 * 表现为 `ld.exe: cannot open output file main.exe: Permission denied`。
 */
export function isLockError(output: string): boolean {
  return /Permission denied|being used by another process|EBUSY|EPERM|EACCES|Access is denied|另一个程序正在使用|拒绝访问|无法访问|text file busy/i
    .test(output || '')
}

/** 结束所有「可执行文件位于该目录下」的进程（按路径匹配，不会误杀同名程序） */
export function killProcessesUnder(dir: string): void {
  if (process.platform !== 'win32') return
  const d = dir.replace(/'/g, "''")
  const script = [
    `$d = '${d}';`,
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
    'Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($d, [System.StringComparison]::OrdinalIgnoreCase) } |',
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  ].join(' ')
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
      { stdio: 'ignore', timeout: 15000 })
  } catch { /* 清理失败就走重试/报错 */ }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      if (!(k in (b as Record<string, unknown>))) return false
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}

function parseMaybe(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s.trim()
  }
}

function normCompare(a: string, b: string): boolean {
  return deepEqual(parseMaybe(a), parseMaybe(b))
}

// 手动判题题的期望值是自然语言（如 "Intersected at '8'" / "No intersection"），
// 需要归一化后再与适配器输出的数字比较（兼容旧数据）。
export function normalizeManualExpected(expected: string): string {
  const compact = (expected || '').replace(/\s+/g, '')
  if (/^nointersection/i.test(compact)) return '0'
  if (/intersect/i.test(compact)) {
    const m = /(-?\d+)/.exec(compact)
    return m ? m[1] : '0'
  }
  return expected
}

function randId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function buildTestInput(test: TestCase): string {
  return test.input.join('\n') + '\n'
}

function runProcess(
  cmd: string,
  args: string[],
  stdin: string,
  workingDir: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(cmd, args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut })
    }

    child.on('error', (err) => {
      stderr += '\n' + String(err.message || err)
      finish(-1)
    })
    child.on('close', (code) => finish(code))

    child.stdin.on('error', () => {})
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

export interface RunnerContext {
  toolchains: Record<Language, ToolchainStatus>
  settings: Settings
  runtimeDir: string
  /** 运行过程中的提示（如「AI 正在生成判题模板」） */
  onNote?: (msg: string) => void
}

/**
 * 用一份具体的判题模板编译并跑完所有用例。
 * runAll 会先用确定性模板跑一遍，必要时再用 AI 生成的模板重跑。
 */
async function runWithHarness(
  problem: Problem,
  language: Language,
  sourceCode: string,
  tests: TestCase[],
  ctx: RunnerContext,
  tc: ToolchainStatus,
  harness: Harness,
  onTest?: (caseResult: CaseResult) => void
): Promise<RunResult> {
  const dir = join(ctx.runtimeDir, sanitize(problem.slug || problem.id || 'problem'), language)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  mkdirSync(dir, { recursive: true })

  for (const f of harness.files) {
    // ensure the class-name java file is written under its own name
    writeFileSync(join(dir, f.name), f.content, 'utf8')
  }

  // compile if needed
  let compileOutput = ''
  if (harness.compile) {
    const cmd = harness.compile.cmd
    const realCmd = tc.compilerPath || cmd
    let lastErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        compileOutput = execFileSync(realCmd, harness.compile.args, {
          cwd: dir,
          encoding: 'utf8',
          timeout: 20000,
          env: toolchainEnv(tc)
        })
        lastErr = ''
        break
      } catch (e: any) {
        lastErr = (e?.stdout || '') + (e?.stderr || '') + (e?.message || '')
        // 上一次运行/调试残留的进程会锁住产物（Windows 常见），清掉后重试一次
        if (attempt === 0 && isLockError(lastErr)) {
          killProcessesUnder(dir)
          await new Promise((r) => setTimeout(r, 300))
          continue
        }
        break
      }
    }
    if (lastErr) {
      const errOut = lastErr
      return {
        ok: false,
        compileFailed: true,
        compileOutput: errOut.trim(),
        cases: [],
        error: '编译失败'
      }
    }
  }

  let runCmd = harness.run.cmd
  let runArgs = harness.run.args
  if (language === 'java') {
    runCmd = tc.runnerPath || 'java'
    runArgs = ['Main']
  } else if (language === 'python') {
    runCmd = tc.runnerPath || tc.compilerPath || runCmd
  }
  // C / C++: run the compiled binary via harness.run.cmd (./main)

  const timeLimit = ctx.settings.timeLimitMs || RUNNER_TIMEOUT_MS_DEFAULT
  const cases: CaseResult[] = []
  const results: CaseResult[] = []
  let timedOut = false

  for (const test of tests) {
    const r = await runProcess(runCmd, runArgs, buildTestInput(test), dir, timeLimit, toolchainEnv(tc))
    const actual = r.stdout.trim()
    const expectedNorm = normalizeManualExpected(test.expected)
    const passed = r.code === 0 && !r.timedOut && r.stderr === '' ? normCompare(actual, expectedNorm) : false
    let error: string | undefined
    if (r.timedOut) { timedOut = true; error = '运行超时' }
    else if (r.code !== 0) error = r.stderr || `进程退出码 ${r.code}`
    else if (r.stderr) error = r.stderr

    let actualStr = actual
    if (error && !actualStr) actualStr = error
    const cr: CaseResult = {
      id: test.id || randId(),
      input: test.input,
      expected: expectedNorm,
      actual: actualStr,
      passed,
      error,
      timeMs: r.timedOut ? undefined : undefined,
      stdout: r.stdout.trim()
    }
    cases.push(cr)
    results.push(cr)
    onTest?.(cr)
  }

  const compiled = harness.compile ? compileOutput.trim() : undefined
  return {
    ok: cases.every((c) => c.passed),
    cases,
    compileOutput: compiled || undefined,
    timedOut,
    totalTimeMs: undefined
  }
}

/** 这次失败像是「模板不对」而不是「你的代码不对」？ */
function looksLikeHarnessProblem(r: RunResult): boolean {
  if (r.compileFailed) return true
  const cases = r.cases || []
  if (!cases.length) return false
  // 全部用例都没过、而且不同输入得到的实际输出完全一样 → 多半是驱动/序列化的问题
  if (cases.every((c) => !c.passed)) {
    const uniq = new Set(cases.map((c) => c.actual))
    if (uniq.size === 1) return true
  }
  return false
}

export async function runAll(
  problem: Problem,
  language: Language,
  sourceCode: string,
  tests: TestCase[],
  ctx: RunnerContext,
  onTest?: (caseResult: CaseResult) => void
): Promise<RunResult> {
  if (language === 'c' && problem.judgeType === 'class') {
    return { ok: false, error: 'C 语言暂不支持 class 类型题目（构造函数/多方法）。仅支持函数型题目。', cases: [] }
  }

  const tc = ctx.toolchains[language]
  if (!tc?.available) {
    return {
      ok: false,
      error: `未找到 ${language} 编译器/解释器。请在「设置」中配置路径或安装工具链。${tc?.error ? ' ' + tc.error : ''}`,
      cases: []
    }
  }

  const base = buildHarness(problem, language, sourceCode)
  const aiEnabled = ctx.settings.autoHarness !== false && !!(ctx.settings.aiApiKey || '').trim()

  // 0) 用户手写的模板优先：用了它就不再让 AI 介入（用户明确选择了自己负责）
  const entry = getHarnessEntry(problem, language)
  if (entry?.source === 'user') {
    const h = assembleHarness(language, base, entry.code)
    if (h) {
      const r = await runWithHarness(problem, language, sourceCode, tests, ctx, tc, h, onTest)
      return { ...r, aiHarness: { used: false, origin: 'user', note: '使用你自己编辑的判题模板' } }
    }
  }

  // 1) 用过并验证通过的 AI 模板（缓存）
  if (aiEnabled && entry) {
    const h = assembleHarness(language, base, entry.code)
    if (h) {
      const r = await runWithHarness(problem, language, sourceCode, tests, ctx, tc, h, onTest)
      if (r.ok) {
        return { ...r, aiHarness: { used: true, origin: 'ai', note: '使用已完成验证的 AI 适配模板（本地缓存）' } }
      }
    }
  }

  // 2) 确定性模板
  const first = await runWithHarness(problem, language, sourceCode, tests, ctx, tc, base, onTest)
  if (!looksLikeHarnessProblem(first)) return first
  if (!aiEnabled) {
    return first
  }

  // 3) 看起来是模板的问题：让 AI 生成一份，并用本题用例验证（全过才采用）
  ctx.onNote?.('检测到判题模板可能不适配本题，正在让 AI 生成模板…')
  const gen = await generateHarness(
    ctx.settings,
    problem,
    language,
    sourceCode,
    base,
    async (h) => {
      const v = await runWithHarness(problem, language, sourceCode, tests, ctx, tc, h)
      if (v.compileFailed) return { ok: false, detail: '编译失败：\n' + String(v.compileOutput || '').slice(0, 1200) }
      const failed = (v.cases || []).filter((c) => !c.passed)
      if (failed.length) {
        return {
          ok: false,
          detail: failed
            .slice(0, 2)
            .map((c) => `用例输入 ${c.input.join(' | ')}：期望 ${c.expected}，实际 ${c.actual}${c.error ? '，' + c.error : ''}`)
            .join('\n')
        }
      }
      return { ok: true, detail: '' }
    },
    (m) => ctx.onNote?.(m)
  )
  if (!gen) {
    ctx.onNote?.('AI 模板生成未成功，仍按原模板结果展示。')
    return { ...first, aiHarness: { used: false, note: 'AI 模板生成未通过验证' } }
  }
  ctx.onNote?.('AI 模板验证通过，正在用它重新运行…')
  const second = await runWithHarness(problem, language, sourceCode, tests, ctx, tc, gen.harness, onTest)
  return { ...second, aiHarness: { used: true, origin: 'ai', note: 'AI 生成并通过本题用例验证（已缓存）' } }
}

export function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// ---------------------------------------------------------------------------
// 判题模板的查看 / 编辑（最后一道保障）
// ---------------------------------------------------------------------------

export interface HarnessViewResult extends HarnessView {}

/** 查看当前会用的判题模板（用户覆盖 > AI 缓存 > 内置） */
export function viewHarness(
  problem: Problem,
  language: Language,
  sourceCode: string
): HarnessView | null {
  const base = buildHarness(problem, language, sourceCode)
  const entry = getHarnessEntry(problem, language)
  const origin: HarnessView['origin'] = entry ? (entry.source === 'user' ? 'user' : 'ai') : 'builtin'
  const split = entry
    ? splitHarness(language, assembleHarness(language, base, entry.code) || base)
    : splitHarness(language, base)
  if (!split) return null
  return { file: split.file, driver: split.driver, head: split.head, origin, language }
}

/** 用给定模板跑一遍所有用例，返回结果（供编辑界面「验证并运行」用） */
export async function verifyHarness(
  problem: Problem,
  language: Language,
  sourceCode: string,
  driver: string,
  tests: TestCase[],
  ctx: RunnerContext,
  onTest?: (caseResult: CaseResult) => void
): Promise<RunResult> {
  const tc = ctx.toolchains[language]
  if (!tc?.available) return { ok: false, cases: [], error: '工具链不可用' }
  const base = buildHarness(problem, language, sourceCode)
  const h = assembleHarness(language, base, driver)
  if (!h) return { ok: false, cases: [], error: '模板无法拼接（缺少 main）' }
  return runWithHarness(problem, language, sourceCode, tests, ctx, tc, h, onTest)
}

export { deepEqual, randId }
