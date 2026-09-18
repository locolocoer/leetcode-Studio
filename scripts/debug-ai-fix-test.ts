// 调试路径的 AI 自动修正：内置模板编译不过时，让 AI 生成并验证，然后继续调试
// 用打桩模型（无需 API Key），验证的是「编译失败 → 生成 → 验证 → 重写文件 → 调试成功」整条链路
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { DebugSession } from '../src/main/debugger'
import { initAiHarnessCache, resetHarness } from '../src/main/aiHarness'
import * as aiModule from '../src/main/ai'

const T = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(T, 'w64', 'w64devkit', 'bin')
const tc: ToolchainStatus = { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' }

// 元数据故意写成 integer[]，真实签名是 vector<vector<char>> —— 内置模板必然编译失败
const problem: Problem = {
  id: '221', slug: 'ai-debug-fix', title: '最大正方形', difficulty: 'medium', tags: [], content: '',
  judgeType: 'function', methodName: 'maximalSquare',
  params: [{ name: 'matrix', type: 'integer[]' }],
  returnType: 'integer',
  tests: [
    { id: 'ex0', input: ['[["1","0","1"],["1","1","1"],["1","1","1"]]'], expected: '4' },
    { id: 'ex1', input: ['[["0"]]'], expected: '0' }
  ],
  starters: {}, source: 'leetcode'
}

const src = `class Solution {
public:
    int maximalSquare(vector<vector<char>>& matrix) {
        int m = matrix.size(), n = matrix[0].size(), best = 0;
        vector<vector<int>> dp(m + 1, vector<int>(n + 1, 0));
        for (int i = 1; i <= m; i++)
            for (int j = 1; j <= n; j++)
                if (matrix[i-1][j-1] == '1') {
                    dp[i][j] = min(min(dp[i-1][j], dp[i][j-1]), dp[i-1][j-1]) + 1;
                    best = max(best, dp[i][j]);
                }
        return best * best;
    }
};`

// 打桩模型：第一轮故意给错的（用 _vint），第二轮给对的（用 _vvchar）
const BAD = `int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> L; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) L.push_back(line); } }
  auto matrix = _vint(JVal::parse(L[0]));
  Solution obj;
  cout << _ser(obj.maximalSquare(matrix));
  return 0;
}`
const GOOD = `int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> L; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) L.push_back(line); } }
  auto matrix = _vvchar(JVal::parse(L[0]));
  Solution obj;
  cout << _ser(obj.maximalSquare(matrix));
  return 0;
}`

const settings = { timeLimitMs: 8000, theme: 'dark', toolpaths: {}, aiApiKey: 'test-key', autoHarness: true } as unknown as Settings
const runtime = join(process.cwd(), '.tmp-dbg-ai')
const dataDir = join(runtime, 'data')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let calls = 0
;(aiModule as any).aiComplete = async () => {
  calls++
  return { ok: true, text: JSON.stringify({ code: calls === 1 ? BAD : GOOD }) }
}

let bad = 0
const check = (ok: boolean, msg: string) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++ }

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  initAiHarnessCache(dataDir)
  resetHarness(problem, 'cpp')

  console.log('1) 内置模板编译不过 → AI 修正 → 调试可用')
  calls = 0
  const sess = new DebugSession({})
  sess.setSettings(settings)
  await sess.start(problem, src, problem.tests[0], 'cpp', tc, runtime, [8])
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    await sleep(150)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  const snap = sess.snapshot
  console.log(`  状态=${snap.status} 第${snap.pausedAt}行${snap.error ? ' err=' + snap.error.slice(0, 150) : ''}`)
  check(snap.status === 'paused', '调试已停在断点（说明编译失败被自动修好了）')
  check(calls >= 2, `模型被调用 ${calls} 次（第一次给错的、第二次修正）`)
  const dir = join(runtime, 'debug', 'ai-debug-fix-cpp')
  const log = existsSync(join(dir, 'session.log')) ? readFileSync(join(dir, 'session.log'), 'utf8') : ''
  check(log.includes('AI 模板已生效') || log.includes('尝试让 AI 生成判题模板'), '日志记录了 AI 修正过程')
  check(readFileSync(join(dir, 'main.cpp'), 'utf8').includes('_vvchar'), '会话里的 main.cpp 已换成修正后的模板')

  console.log('2) 步过一次仍正常')
  const t1 = Date.now()
  sess.stepOver()
  while (Date.now() - t1 < 15000) {
    await sleep(120)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  check(sess.snapshot.status === 'paused', `步过 → 第 ${sess.snapshot.pausedAt} 行（${Date.now() - t1}ms）`)
  sess.dispose()

  console.log('3) 第二次调试：直接用缓存模板，不再调用模型')
  await sleep(800)
  calls = 0
  const sess2 = new DebugSession({})
  sess2.setSettings(settings)
  await sess2.start(problem, src, problem.tests[0], 'cpp', tc, runtime, [8])
  const t2 = Date.now()
  while (Date.now() - t2 < 40000) {
    await sleep(150)
    const s = sess2.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  check(sess2.snapshot.status === 'paused', `第二次调试直接可用（第 ${sess2.snapshot.pausedAt} 行）`)
  check(calls === 0, `没有再次调用模型（${calls} 次）`)
  sess2.dispose()
  await sleep(800)
  rmSync(runtime, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
  process.exit(bad ? 1 : 0)
}
main()
