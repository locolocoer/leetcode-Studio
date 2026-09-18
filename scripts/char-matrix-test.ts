// 221 最大正方形：character[][]（字符矩阵）三语言运行 + C++ 调试
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { runAll } from '../src/main/runner'
import { DebugSession } from '../src/main/debugger'

const T = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(T, 'w64', 'w64devkit', 'bin')
const jdk = join(T, 'jdk17', 'bin')
function tools(): Record<Language, ToolchainStatus> {
  return {
    python: { language: 'python', available: true, compilerPath: join(T, 'python', 'python.exe'), runnerPath: join(T, 'python', 'python.exe'), source: 'bundled' },
    cpp: { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' },
    c: { language: 'c', available: true, compilerPath: join(w64, 'gcc.exe'), source: 'bundled' },
    java: { language: 'java', available: true, compilerPath: join(jdk, 'javac.exe'), runnerPath: join(jdk, 'java.exe'), source: 'bundled' }
  } as Record<Language, ToolchainStatus>
}
const settings = { timeLimitMs: 8000, theme: 'dark', toolpaths: {} } as unknown as Settings

const problem: Problem = {
  id: '221', slug: 'maximal-square', title: '最大正方形', difficulty: 'medium', tags: [], content: '',
  judgeType: 'function', methodName: 'maximalSquare',
  params: [{ name: 'matrix', type: 'character[][]' }],
  returnType: 'integer',
  tests: [
    { id: 'ex0', input: ['[["1","0","1","0","0"],["1","0","1","1","1"],["1","1","1","1","1"],["1","0","0","1","0"]]'], expected: '4' },
    { id: 'ex1', input: ['[["0","1"],["1","0"]]'], expected: '1' },
    { id: 'ex2', input: ['[["0"]]'], expected: '0' }
  ],
  starters: {}, source: 'leetcode'
}

const cpp = `class Solution {
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

const java = `class Solution {
    public int maximalSquare(char[][] matrix) {
        int m = matrix.length, n = matrix[0].length, best = 0;
        int[][] dp = new int[m + 1][n + 1];
        for (int i = 1; i <= m; i++)
            for (int j = 1; j <= n; j++)
                if (matrix[i-1][j-1] == '1') {
                    dp[i][j] = Math.min(Math.min(dp[i-1][j], dp[i][j-1]), dp[i-1][j-1]) + 1;
                    best = Math.max(best, dp[i][j]);
                }
        return best * best;
    }
}`

const py = `class Solution:
    def maximalSquare(self, matrix):
        m, n = len(matrix), len(matrix[0])
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        best = 0
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if matrix[i-1][j-1] == '1':
                    dp[i][j] = min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1
                    best = max(best, dp[i][j])
        return best * best`

const runtime = join(process.cwd(), '.tmp-221')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  let bad = 0
  const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++ }

  console.log('=== 运行（character[][] 字符矩阵）===')
  for (const [lang, src] of [['cpp', cpp], ['java', java], ['python', py]] as [Language, string][]) {
    const r = await runAll(problem, lang, src, problem.tests, { runtimeDir: runtime, settings, toolchains: tools() })
    const cases = (r.cases || []).map((c) => (c.passed ? 'ok' : `FAIL(实际 ${c.actual})`)).join(' ')
    check(r.ok, `${lang.padEnd(7)} ${cases}${r.compileFailed ? ' 编译失败：' + String(r.compileOutput).split('\n')[0] : ''}`)
  }

  console.log('=== 调试（C++，断点在 dp 循环内）===')
  const sess = new DebugSession({})
  const start = await sess.start(problem, cpp, problem.tests[0], 'cpp', tools().cpp, runtime, [10])
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    await sleep(150)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  check(sess.snapshot.status === 'paused', `停在第 ${sess.snapshot.pausedAt} 行 ${sess.snapshot.error ? '| err=' + sess.snapshot.error.slice(0, 200) : ''}`)
  const matrixVar = (sess.snapshot.frame?.vars || []).find((v) => v.name === 'matrix')
  if (matrixVar) {
    const kids = await sess.children(matrixVar.ref)
    console.log(`  matrix 预览：${matrixVar.value.slice(0, 60)}`)
    check(kids.length > 0, `展开 matrix：${kids.length} 行，第一行 ${kids[0]?.value || ''}`)
  }
  const t1 = Date.now()
  sess.stepOver()
  while (Date.now() - t1 < 15000) {
    await sleep(120)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  check(sess.snapshot.status === 'paused', `步过一次 → 第 ${sess.snapshot.pausedAt} 行（${Date.now() - t1}ms）`)
  sess.dispose()
  await sleep(800)
  rmSync(runtime, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
  process.exit(bad ? 1 : 0)
}
main()
