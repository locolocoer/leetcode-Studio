// 共享判题模板库：拉取 → 本地验证 → 采用并缓存；以及发布（导出 / GitHub API）
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { runAll } from '../src/main/runner'
import { initAiHarnessCache, resetHarness, getHarnessEntry } from '../src/main/aiHarness'
import * as registry from '../src/main/harnessRegistry'

const T = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(T, 'w64', 'w64devkit', 'bin')
const tc: ToolchainStatus = { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' }

// 元数据故意写错（integer[]），真实签名是 vector<vector<char>> —— 内置模板必然编译失败
const problem: Problem = {
  id: '221', slug: 'maximal-square', title: '最大正方形', difficulty: 'medium', tags: [], content: '',
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

// 共享库里「别人已经写好的」模板
const SHARED_CODE = `int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> L; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) L.push_back(line); } }
  auto matrix = _vvchar(JVal::parse(L[0]));
  Solution obj;
  cout << _ser(obj.maximalSquare(matrix));
  return 0;
}`

const runtime = join(process.cwd(), '.tmp-registry')
const dataDir = join(runtime, 'data')
const settings = { timeLimitMs: 8000, theme: 'dark', toolpaths: {}, shareHarness: true } as unknown as Settings
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (ok: boolean, msg: string) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++ }

// 打桩 fetch：只提供「OSS 索引 + 模板文件」
const realFetch = globalThis.fetch
const key = registry.sharedKeyFor(problem, 'cpp', require('../src/main/aiHarness').harnessSigHash(problem))
let indexHits = 0
let fileHits = 0
;(globalThis as any).fetch = async (url: string, init?: any) => {
  const u = String(url)
  if (u.includes('/graphql')) return realFetch(url as any, init)
  if (u.endsWith('index.json')) {
    indexHits++
    return new Response(JSON.stringify({
      version: 1,
      entries: [{ key, problemId: '221', slug: 'maximal-square', title: '最大正方形', language: 'cpp', sigHash: 'x', author: 'someone' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (u.endsWith(`${key}.json`)) {
    fileHits++
    return new Response(JSON.stringify({ key, language: 'cpp', code: SHARED_CODE }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response('not found', { status: 404 })
}

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  initAiHarnessCache(dataDir)
  resetHarness(problem, 'cpp')

  console.log('1) 内置模板失败 → 从共享库拉取 → 本地验证 → 采用')
  const notes: string[] = []
  let r = await runAll(problem, 'cpp', src, problem.tests, {
    runtimeDir: runtime, settings, toolchains: { cpp: tc } as Record<Language, ToolchainStatus>,
    onNote: (m) => notes.push(m)
  })
  check(r.ok === true, `运行通过（${(r.cases || []).map((c) => c.actual).join('/')}）`)
  check(notes.some((n) => n.includes('共享模板库')), `提示信息：${notes.join(' | ').slice(0, 120)}`)
  check(indexHits === 1 && fileHits === 1, `从共享库读了索引 ${indexHits} 次、模板 ${fileHits} 次`)
  const entry = getHarnessEntry(problem, 'cpp')
  check(entry?.source === 'shared', `本地已缓存为共享模板（source=${entry?.source}）`)

  console.log('2) 第二次运行：直接用本地缓存，不再访问网络')
  indexHits = 0; fileHits = 0
  r = await runAll(problem, 'cpp', src, problem.tests, {
    runtimeDir: runtime, settings, toolchains: { cpp: tc } as Record<Language, ToolchainStatus>
  })
  check(r.ok === true && indexHits === 0 && fileHits === 0, `命中本地缓存（网络访问 ${indexHits + fileHits} 次）`)

  console.log('3) 发布：没配 Token → 导出到本地目录')
  const out = await registry.publishSharedHarness(
    { ...settings, githubToken: '' } as Settings, problem, 'cpp',
    require('../src/main/aiHarness').harnessSigHash(problem), SHARED_CODE,
    { note: '最大正方形字符矩阵', outDir: runtime }
  )
  check(out.ok === false && !!out.localDir, `提示：${out.message.slice(0, 80)}`)
  const dir = out.localDir!
  check(existsSync(join(dir, `${key}.json`)), `已导出模板文件：${readdirSync(dir).join(', ')}`)
  const exported = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'))
  check(exported.code === SHARED_CODE && exported.problemId === '221', '导出内容完整（含 code 与题目信息）')

  console.log('4) 发布：带 Token → 走 GitHub API（打桩）')
  const calls: { url: string; method: string; body?: any }[] = []
  ;(globalThis as any).fetch = async (url: string, init?: any) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined })
    if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response('null', { status: 404 })   // 文件还不存在
  }
  const out2 = await registry.publishSharedHarness(
    { ...settings, githubToken: 'ghp_fake' } as Settings, problem, 'cpp',
    require('../src/main/aiHarness').harnessSigHash(problem), SHARED_CODE,
    { note: 'x', outDir: runtime }
  )
  check(out2.ok === true, `发布成功：${out2.message.slice(0, 60)}`)
  const puts = calls.filter((c) => c.method === 'PUT')
  check(puts.length === 2, `提交了 ${puts.length} 个文件（模板 + 索引）`)
  check(puts.some((p) => p.url.includes(`harness/shared/${key}.json`)), '提交了模板文件')
  check(puts.some((p) => p.url.endsWith('harness/shared/index.json')), '更新了索引')
  const idxPut = puts.find((p) => p.url.endsWith('index.json'))!
  const idxJson = JSON.parse(Buffer.from(idxPut.body.content, 'base64').toString('utf8'))
  check(idxJson.entries.some((e: any) => e.key === key), '索引里已包含新条目')

  ;(globalThis as any).fetch = realFetch
  await sleep(200)
  rmSync(runtime, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
  process.exit(bad ? 1 : 0)
}
main()
