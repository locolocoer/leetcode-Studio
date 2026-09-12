// 复现「步过卡住」：C++ threeSum（含 sort + 嵌套循环 + STL 容器）逐步步过，
// 记录每次操作的耗时；若某次超过阈值或超时即判定卡住。
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, ToolchainStatus } from '../src/shared/types'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(tools, 'w64', 'w64devkit', 'bin')

function tc(lang: Language, exe: string): ToolchainStatus {
  return { language: lang, available: true, compilerPath: join(w64, exe), source: 'bundled' }
}

const cppSrc = [
  'class Solution {',                                                    // 1
  'public:',                                                              // 2
  '    vector<vector<int>> threeSum(vector<int>& nums) {',                // 3
  '        vector<vector<int>> res;',                                     // 4
  '        sort(nums.begin(), nums.end());',                              // 5
  '        int n = nums.size();',                                         // 6
  '        for (int i = 0; i < n; i++) {',                                // 7
  '            if (i > 0 && nums[i] == nums[i - 1]) continue;',           // 8
  '            int l = i + 1, r = n - 1;',                                // 9
  '            while (l < r) {',                                          // 10
  '                int s = nums[i] + nums[l] + nums[r];',                 // 11
  '                if (s == 0) {',                                        // 12
  '                    res.push_back({nums[i], nums[l], nums[r]});',      // 13
  '                    while (l < r && nums[l] == nums[l + 1]) l++;',     // 14
  '                    while (l < r && nums[r] == nums[r - 1]) r--;',     // 15
  '                    l++; r--;',                                        // 16
  '                } else if (s < 0) {',                                  // 17
  '                    l++;',                                             // 18
  '                } else {',                                             // 19
  '                    r--;',                                             // 20
  '                }',                                                    // 21
  '            }',                                                        // 22
  '        }',                                                            // 23
  '        return res;',                                                  // 24
  '    }',                                                                // 25
  '};'                                                                    // 26
].join('\n')

function makeProblem(): Problem {
  return {
    id: '15', slug: 'step-over-test', title: 'Three Sum', difficulty: 'medium', tags: [], content: '',
    judgeType: 'function', methodName: 'threeSum',
    params: [{ name: 'nums', type: 'integer[]' }],
    returnType: 'integer[][]', tests: [], starters: { cpp: cppSrc }, source: 'local'
  }
}

const runtime = join(process.cwd(), '.tmp-step-test')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function settle(sess: DebugSession, maxMs: number): Promise<{ ms: number; timedOut: boolean }> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(120)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') return { ms: Date.now() - t0, timedOut: false }
  }
  return { ms: Date.now() - t0, timedOut: true }
}

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  const test = { id: 't1', input: ['[-1,0,1,2,-1,-4]'], expected: '[[-1,-1,2],[-1,0,1]]' }

  const sess = new DebugSession({})
  const snap = await sess.start(makeProblem(), cppSrc, test, 'cpp', tc('cpp', 'g++.exe'), runtime, [7])
  console.log('start:', snap.status, snap.error ? 'err=' + snap.error.slice(0, 160) : '')
  const first = await settle(sess, 40000)
  console.log(`首次停顿: ${first.timedOut ? '超时 ' : ''}${first.ms}ms -> ` +
    JSON.stringify({ status: sess.snapshot.status, line: sess.snapshot.pausedAt, error: sess.snapshot.error?.slice(0, 120) }))

  let worst = 0
  for (let i = 1; i <= 12; i++) {
    if (sess.snapshot.status !== 'paused') { console.log(`第 ${i} 次跳过：状态 ${sess.snapshot.status}`); break }
    const beforeLine = sess.snapshot.pausedAt
    sess.stepOver()
    const r = await settle(sess, 25000)
    const s = sess.snapshot
    worst = Math.max(worst, r.ms)
    const flag = r.timedOut ? '  ← 卡住/超时' : (r.ms > 3000 ? '  ← 很慢' : '')
    console.log(`步过 #${i}: 第 ${beforeLine} 行 → 第 ${s.pausedAt} 行，用时 ${r.ms}ms，status=${s.status}${s.error ? ' err=' + s.error.slice(0, 80) : ''}${flag}`)
    if (r.timedOut) break
  }
  console.log(`最慢一次步过：${worst}ms`)

  const dir = join(runtime, 'debug', 'step-over-test-cpp')
  try {
    const log = readFileSync(join(dir, 'session.log'), 'utf8')
    const tail = log.split('\n').filter((l) => l.includes('SEND') || l.includes('EVT')).slice(-6)
    console.log('日志尾部：\n  ' + tail.join('\n  ').slice(0, 800))
  } catch {}
  sess.dispose()
  await sleep(1000)
  // 保留现场
}
main()
