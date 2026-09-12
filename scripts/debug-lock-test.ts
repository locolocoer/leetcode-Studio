// 验证「调试产物被残留进程占用」的修复：
//  A) 起一个 C++ 调试会话 → 应能编译并停在断点
//  B) dispose() 后不应残留 main.exe（旧实现会把被调试程序留在后台，锁住产物）
//  C) 把 main.exe 设为只读（模拟 Permission denied）后重开调试 → 应自动清理/换输出名并成功
import { mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync, spawn } from 'child_process'
import type { Language, Problem, ToolchainStatus } from '../src/shared/types'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(tools, 'w64', 'w64devkit', 'bin')

function tc(lang: Language, exe: string): ToolchainStatus {
  return { language: lang, available: true, compilerPath: join(w64, exe), source: 'bundled' }
}

function makeProblem(src: string): Problem {
  return {
    id: '9', slug: 'debug-lock-test', title: 'Two Sum', difficulty: 'easy', tags: [], content: '',
    judgeType: 'function', methodName: 'twoSum',
    params: [{ name: 'nums', type: 'integer[]' }, { name: 'target', type: 'integer' }],
    returnType: 'integer[]', tests: [], starters: { cpp: src }, source: 'local'
  }
}

const cppSrc = [
  'class Solution {',
  'public:',
  '    vector<int> twoSum(vector<int>& nums, int target) {',
  '        unordered_map<int, int> m;',
  '        for (int i = 0; i < (int)nums.size(); i++) {',
  '            int need = target - nums[i];',
  '            if (m.count(need)) return {m[need], i};',
  '            m[nums[i]] = i;',
  '        }',
  '        return {};',
  '    }',
  '};'
].join('\n')

const runtime = join(process.cwd(), '.tmp-lock-test')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 列出可执行文件位于 dir 下的进程 */
function procsUnder(dir: string): string[] {
  const d = dir.replace(/'/g, "''")
  const script = `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${d}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20000 })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

async function settle(sess: DebugSession, maxMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(250)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') return
  }
}

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  const dir = join(runtime, 'debug', 'debug-lock-test-cpp')
  const test = { id: 't1', input: ['[2,7,11,15]', '9'], expected: '[0,1]' }
  let fail = 0
  const check = (ok: boolean, msg: string) => {
    console.log((ok ? '  ✓ ' : '  ✗ ') + msg)
    if (!ok) fail++
  }

  // A) 正常会话
  console.log('A) 首次调试会话')
  const s1 = new DebugSession({})
  await s1.start(makeProblem(cppSrc), cppSrc, test, 'cpp', tc('cpp', 'g++.exe'), runtime, [5])
  await settle(s1)
  check(s1.snapshot.status === 'paused', `停在断点（status=${s1.snapshot.status} line=${s1.snapshot.pausedAt}）${s1.snapshot.error ? ' err=' + s1.snapshot.error.slice(0, 120) : ''}`)

  // B) dispose 后不应残留进程（旧实现会留下 main.exe 锁住产物）
  console.log('B) dispose 后检查残留进程')
  s1.dispose()
  await sleep(2000)
  const left = procsUnder(dir)
  check(left.length === 0, `目录下无残留进程${left.length ? '（残留：' + left.join(', ') + '）' : ''}`)

  // C) 用一个真正占用 main.exe 的进程模拟「上一次调试残留」（这才是 Permission denied 的真实成因）
  console.log('C) 让一个进程占住 main.exe，再重开调试')
  const exe = join(dir, 'main.exe')
  writeFileSync(join(dir, 'sleeper.c'), '#include <windows.h>\nint main(){ Sleep(120000); return 0; }\n')
  const gcc = join(w64, 'gcc.exe')
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: w64 + ';' + (process.env.PATH || '') }
  execFileSync(gcc, ['-O0', 'sleeper.c', '-o', 'main.exe'], { cwd: dir, env })
  spawn(exe, [], { stdio: 'ignore', detached: true }).unref()
  await sleep(700)
  const held = procsUnder(dir)
  check(held.length > 0, `main.exe 已被占用${held.length ? '（' + held.join(', ') + '）' : ''}`)

  const s2 = new DebugSession({})
  await s2.start(makeProblem(cppSrc), cppSrc, test, 'cpp', tc('cpp', 'g++.exe'), runtime, [5])
  await settle(s2)
  const err = s2.snapshot.error || ''
  check(!/Permission denied|cannot open output file/i.test(err), `自动恢复后编译成功${err ? '（err=' + err.slice(0, 160) + '）' : ''}`)
  check(s2.snapshot.status === 'paused', `第二次会话仍能停在断点（status=${s2.snapshot.status}）`)
  s2.dispose()

  // 确认确实走了恢复分支（说明首次编译真的被占用挡下了）
  const logText = readFileSync(join(dir, 'session.log'), 'utf8')
  const usedRetry = logText.includes('清理残留调试进程后重试')
  const usedFallback = logText.includes('改用输出名')
  const exes = readdirSync(dir).filter((f) => f.endsWith('.exe'))
  console.log('  恢复路径：清理重试=' + usedRetry + ' 换输出名=' + usedFallback + ' 目录内 exe=' + JSON.stringify(exes))
  check(usedRetry || usedFallback, '确实走了自动恢复逻辑（说明占用真的让首次编译失败）')

  // 清理
  await sleep(1200)
  try { execFileSync('attrib', ['-R', exe], { stdio: 'ignore' }) } catch {}
  try { rmSync(runtime, { recursive: true, force: true }) } catch {}

  console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
