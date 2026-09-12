// 验证 STL 容器显示：只用读内存的方式（不在被调试程序里调用函数）
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, ToolchainStatus } from '../src/shared/types'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(tools, 'w64', 'w64devkit', 'bin')
function tc(lang: Language, exe: string): ToolchainStatus {
  return { language: lang, available: true, compilerPath: join(w64, exe), source: 'bundled' }
}

const src = [
  'class Solution {',                                          // 1
  'public:',                                                    // 2
  '    int run(vector<int>& nums) {',                           // 3
  '        vector<int> v = {3, 1, 2};',                         // 4
  '        sort(v.begin(), v.end());',                          // 5
  '        vector<vector<int>> vv;',                            // 6
  '        vv.push_back({1, 2});',                              // 7
  '        vv.push_back({3});',                                 // 8
  '        string s = "hello";',                                // 9
  '        string empty = "";',                                 // 10
  '        unordered_map<int, int> um;',                        // 11
  '        um[5] = 1;',                                         // 12
  '        um[7] = 2;',                                         // 13
  '        map<int, int> m;',                                   // 14
  '        m[1] = 10;',                                         // 15
  '        set<int> st;',                                       // 16
  '        st.insert(4);',                                      // 17
  '        int total = 0;',                                     // 18  ← 断点
  '        for (int x : v) total += x;',                        // 19
  '        return total + (int)vv.size() + (int)s.size() + (int)empty.size() + (int)um.size() + (int)m.size() + (int)st.size();', // 20
  '    }',                                                      // 21
  '};'                                                          // 22
].join('\n')

function makeProblem(): Problem {
  return {
    id: '0', slug: 'stl-render-test', title: 'STL render', difficulty: 'easy', tags: [], content: '',
    judgeType: 'function', methodName: 'run',
    params: [{ name: 'nums', type: 'integer[]' }],
    returnType: 'integer', tests: [], starters: { cpp: src }, source: 'local'
  }
}

const runtime = join(process.cwd(), '.tmp-stl-test')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  const test = { id: 't1', input: ['[9,8,7]'], expected: '33' }
  const sess = new DebugSession({})
  await sess.start(makeProblem(), src, test, 'cpp', tc('cpp', 'g++.exe'), runtime, [18])
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    await sleep(150)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  const snap = sess.snapshot
  console.log('status=' + snap.status + ' line=' + snap.pausedAt + (snap.error ? ' err=' + snap.error.slice(0, 200) : ''))
  const locals = snap.frame?.locals || {}
  for (const k of ['nums', 'v', 'vv', 's', 'empty', 'um', 'm', 'st']) {
    console.log(`  ${k} = ${locals[k] ?? '(缺失)'}`)
  }
  // 步过一次，确认容器有内容时也不会卡
  const before = Date.now()
  sess.stepOver()
  while (Date.now() - before < 15000) {
    await sleep(120)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  console.log(`步过用时 ${Date.now() - before}ms -> status=${sess.snapshot.status} line=${sess.snapshot.pausedAt}`)
  sess.dispose()
  await sleep(800)
  const dir = join(runtime, 'debug', 'stl-render-test-cpp')
  const log = readFileSync(join(dir, 'session.log'), 'utf8')
  console.log('错误事件：' + (log.split('\n').filter((l) => l.includes('"error"')).join(' | ') || '（无）'))
  rmSync(runtime, { recursive: true, force: true })
}
main()
