import { spawn, execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, dirname, delimiter } from 'path'
import type {
  CaseResult, Language, Problem, RunResult, Settings, TestCase, ToolchainStatus
} from '../shared/types'
import { buildHarness } from './harness'

const RUNNER_TIMEOUT_MS_DEFAULT = 4000

// gcc/g++/内嵌工具链需要把自己的 bin 放进 PATH 才能找到 cc1/as/ld 等
function toolchainEnv(tc: ToolchainStatus): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const dir = tc.compilerPath ? dirname(tc.compilerPath) : undefined
  if (dir) env.PATH = dir + delimiter + (env.PATH || '')
  return env
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

  const dir = join(ctx.runtimeDir, sanitize(problem.slug || problem.id || 'problem'), language)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  mkdirSync(dir, { recursive: true })

  const harness = buildHarness(problem, language, sourceCode)

  for (const f of harness.files) {
    // ensure the class-name java file is written under its own name
    writeFileSync(join(dir, f.name), f.content, 'utf8')
  }

  // compile if needed
  let compileOutput = ''
  if (harness.compile) {
    const cmd = harness.compile.cmd
    const realCmd = tc.compilerPath || cmd
    try {
      compileOutput = execFileSync(realCmd, harness.compile.args, {
        cwd: dir,
        encoding: 'utf8',
        timeout: 20000,
        env: toolchainEnv(tc)
      })
    } catch (e: any) {
      const errOut = (e?.stdout || '') + (e?.stderr || '') + (e?.message || '')
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

export function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export { deepEqual, randId }
