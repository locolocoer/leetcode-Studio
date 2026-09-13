// 判题模板「查看 / 编辑 / 保存 / 生效 / 恢复」全流程测试
//  用一个内置模板适配不了的题（元数据缺参数），验证：
//   1) viewHarness 能拿到可编辑的驱动部分
//   2) 手写驱动 → 验证通过 → 保存为「用户模板」
//   3) 之后的运行直接用用户模板（且不会调用 AI）
//   4) reset 后回到内置模板（编译失败）
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { runAll, viewHarness } from '../src/main/runner'
import { initAiHarnessCache, putHarnessOverride, resetHarness, getHarnessEntry } from '../src/main/aiHarness'
import * as aiModule from '../src/main/ai'

const T = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(T, 'w64', 'w64devkit', 'bin')
const tc: ToolchainStatus = { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' }

const problem: Problem = {
  id: '8888', slug: 'harness-edit-demo', title: '模板编辑演示', difficulty: 'easy', tags: [], content: '',
  judgeType: 'function', methodName: 'findKth', params: [], returnType: 'integer',
  tests: [
    { id: 'ex0', input: ['[3,1,2]', '2'], expected: '2' },
    { id: 'ex1', input: ['[5,4,3,2,1]', '1'], expected: '1' }
  ],
  starters: {}, source: 'local'
}

const src = `class Solution {
public:
    int findKth(vector<int>& nums, int k) {
        sort(nums.begin(), nums.end());
        return nums[k - 1];
    }
};`

const MY_DRIVER = `int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> L; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) L.push_back(line); } }
  auto nums = _vint(JVal::parse(L[0]));
  int k = JVal::parse(L[1]).asInt();
  Solution obj;
  cout << _ser(obj.findKth(nums, k));
  return 0;
}`

const settings = { timeLimitMs: 8000, theme: 'dark', toolpaths: {}, aiApiKey: 'test-key', autoHarness: true } as unknown as Settings
const runtime = join(process.cwd(), '.tmp-hv')
const dataDir = join(runtime, 'data')

let aiCalls = 0
;(aiModule as any).aiComplete = async () => { aiCalls++; return { ok: false, message: 'stub: 不应该被调用' } }

const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + msg)
  if (!ok) process.exitCode = 1
}

const runNow = () => runAll(problem, 'cpp' as Language, src, problem.tests, {
  runtimeDir: runtime, settings, toolchains: { cpp: tc } as Record<Language, ToolchainStatus>
})

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  initAiHarnessCache(dataDir)
  resetHarness(problem, 'cpp')

  console.log('1) 内置模板（元数据缺参数）→ 编译失败')
  aiCalls = 0
  const r1 = await runNow()
  check(r1.compileFailed === true, `编译失败（compileFailed=${r1.compileFailed}）`)
  check(aiCalls >= 1, `尝试过 AI 兜底（调用 ${aiCalls} 次，stub 故意失败）`)

  console.log('2) 查看模板：能拿到可编辑的驱动部分')
  const v = viewHarness(problem, 'cpp', src)
  check(!!v, 'viewHarness 返回了模板')
  check(v?.origin === 'builtin', `来源 = ${v?.origin}`)
  check(v?.file === 'main.cpp', `文件名 = ${v?.file}`)
  check(!!v?.driver && v.driver.includes('int main('), '驱动部分含 int main(')
  check(!!v?.head && v.head.includes('struct TreeNode'), '脚手架部分含节点定义（只读参考）')
  console.log('    内置驱动的调用行：' + (v?.driver.split('\n').find((l) => l.includes('findKth')) || '(无)').trim())

  console.log('3) 手写驱动 → 保存为用户模板')
  putHarnessOverride(problem, 'cpp', MY_DRIVER)
  const entry = getHarnessEntry(problem, 'cpp')
  check(entry?.source === 'user', `缓存来源 = ${entry?.source}`)

  console.log('4) 再运行：用用户模板，不再调用 AI')
  aiCalls = 0
  const r2 = await runNow()
  check(r2.ok === true, `全部用例通过（${(r2.cases || []).map((c) => c.actual).join('/')}）`)
  check(aiCalls === 0, `没有调用 AI（${aiCalls} 次）`)
  check((r2.aiHarness?.note || '').includes('自己'), `结果标注：${r2.aiHarness?.note}`)

  console.log('5) 恢复内置模板 → 又变回编译失败')
  resetHarness(problem, 'cpp')
  const v2 = viewHarness(problem, 'cpp', src)
  check(v2?.origin === 'builtin', `来源回到 ${v2?.origin}`)

  await new Promise((r) => setTimeout(r, 200))
  rmSync(runtime, { recursive: true, force: true })
  console.log(process.exitCode ? '\n有失败项' : '\n全部通过')
}
main()
