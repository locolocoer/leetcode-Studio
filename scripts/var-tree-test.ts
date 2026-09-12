// 验证变量树：顶层变量可展开，vector 元素可继续展开（嵌套 vector）
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { DebugVar, Language, Problem, ToolchainStatus } from '../src/shared/types'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(tools, 'w64', 'w64devkit', 'bin')
function tc(lang: Language, exe: string): ToolchainStatus {
  return { language: lang, available: true, compilerPath: join(w64, exe), source: 'bundled' }
}

const src = [
  'class Solution {',                            // 1
  'public:',                                      // 2
  '    int run(vector<int>& nums) {',             // 3
  '        vector<int> v = {3, 1, 2};',           // 4
  '        sort(v.begin(), v.end());',            // 5
  '        vector<vector<int>> vv;',              // 6
  '        vv.push_back({1, 2});',                // 7
  '        vv.push_back({3, 4, 5});',             // 8
  '        string s = "hello";',                  // 9
  '        int total = 0;',                       // 10 ← 断点
  '        for (int x : v) total += x;',          // 11
  '        return total;',                        // 12
  '    }',                                        // 13
  '};'                                            // 14
].join('\n')

function makeProblem(): Problem {
  return {
    id: '0', slug: 'var-tree-test', title: 'var tree', difficulty: 'easy', tags: [], content: '',
    judgeType: 'function', methodName: 'run',
    params: [{ name: 'nums', type: 'integer[]' }],
    returnType: 'integer', tests: [], starters: { cpp: src }, source: 'local'
  }
}

const runtime = join(process.cwd(), '.tmp-tree-test')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const show = (vs: DebugVar[]) => vs.map((v) => `${v.name}${v.expandable ? '▸' : '='}${v.value}`).join('  ')

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  const sess = new DebugSession({})
  await sess.start(makeProblem(), src, { id: 't1', input: ['[9,8,7]'], expected: '6' }, 'cpp', tc('cpp', 'g++.exe'), runtime, [10])
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    await sleep(150)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  const snap = sess.snapshot
  console.log('status=' + snap.status + ' line=' + snap.pausedAt + (snap.error ? ' err=' + snap.error.slice(0, 160) : ''))
  const vars = snap.frame?.vars || []
  console.log('顶层变量：')
  for (const v of vars) console.log(`  ${v.name} ${v.expandable ? '▸' : ' '} = ${v.value}`)

  const byName = (n: string) => vars.find((v) => v.name === n)!
  for (const name of ['v', 'vv', 'nums']) {
    const node = byName(name)
    if (!node) { console.log(`${name}: 未找到`); continue }
    const kids = await sess.children(node.ref)
    console.log(`${name} 展开（${kids.length} 项）：${show(kids)}`)
    if (kids[0]?.expandable) {
      const sub = await sess.children(kids[0].ref)
      console.log(`  └ ${kids[0].name} 再展开：${show(sub)}`)
    }
  }
  // 展开后步过一次，确认不卡
  const t1 = Date.now()
  sess.stepOver()
  while (Date.now() - t1 < 15000) {
    await sleep(120)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  console.log(`步过用时 ${Date.now() - t1}ms -> ${sess.snapshot.status} line=${sess.snapshot.pausedAt}`)
  sess.dispose()
  await sleep(800)
  rmSync(runtime, { recursive: true, force: true })
}
main()
