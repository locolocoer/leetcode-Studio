// AI 判题模板的管线测试：
//  1) 确定性模板不适配（元数据缺参数）→ 触发 AI 生成 → 验证通过 → 采用 + 缓存 + 标记
//  2) 缓存命中：第二次直接使用缓存模板
//  3) 生成的代码不调用解答方法 → 被规则拒绝 → 回退到确定性模板结果
// 用打桩的 aiComplete 代替真实模型（无需 API Key），验证的是整条管线。
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { runAll } from '../src/main/runner'
import { initAiHarnessCache, clearHarnessCache } from '../src/main/aiHarness'
// 打桩：替换 ai.ts 的 aiComplete（CommonJS 下改写导出对象即可）
import * as aiModule from '../src/main/ai'

const T = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(T, 'w64', 'w64devkit', 'bin')
const tc: ToolchainStatus = { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' }

// 元数据缺参数：确定性模板会生成无参调用 → 编译失败 → 触发 AI 路径
const problem: Problem = {
  id: '9999', slug: 'ai-harness-demo', title: 'AI 模板演示', difficulty: 'easy', tags: [], content: '',
  judgeType: 'function', methodName: 'findKth',
  params: [],
  returnType: 'integer',
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

const GOOD_DRIVER = `int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> L; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) L.push_back(line); } }
  auto _a0 = _vint(JVal::parse(L[0]));
  int _a1 = JVal::parse(L[1]).asInt();
  Solution obj;
  auto result = obj.findKth(_a0, _a1);
  cout << _ser(result);
  return 0;
}`

const BAD_DRIVER = `int main(){
  cout << "2";
  return 0;
}`

const settings = { timeLimitMs: 8000, theme: 'dark', toolpaths: {}, aiApiKey: 'test-key', autoHarness: true } as unknown as Settings
const runtime = join(process.cwd(), '.tmp-aih')
const dataDir = join(runtime, 'data')

let stubReply: string | null = GOOD_DRIVER
let calls = 0
;(aiModule as any).aiComplete = async () => {
  calls++
  if (!stubReply) return { ok: false, message: 'stub: empty' }
  return { ok: true, text: JSON.stringify({ code: stubReply }) }
}

const check = (ok: boolean, msg: string) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + msg)
  if (!ok) process.exitCode = 1
}

async function run(label: string) {
  return runAll(problem, 'cpp' as Language, src, problem.tests, {
    runtimeDir: runtime, settings, toolchains: { cpp: tc } as Record<Language, ToolchainStatus>
  })
}

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  initAiHarnessCache(dataDir)
  clearHarnessCache()

  console.log('1) 确定性模板失败 → AI 生成 → 验证通过')
  calls = 0
  stubReply = GOOD_DRIVER
  const r1 = await run('first')
  check(r1.ok, `最终结果 ok=${r1.ok}（用例 ${(r1.cases || []).map((c) => c.actual).join('/')}）`)
  check(!!r1.aiHarness?.used, `标记为使用了 AI 模板：${JSON.stringify(r1.aiHarness)}`)
  check(calls === 1, `调用了一次模型（实际 ${calls} 次）`)
  check(existsSync(join(dataDir, 'ai-harness.json')), '生成了缓存文件 ai-harness.json')

  console.log('2) 第二次运行：命中缓存，不再调用模型')
  calls = 0
  const r2 = await run('second')
  check(r2.ok, `结果 ok=${r2.ok}`)
  check(calls === 0, `没有再次调用模型（实际 ${calls} 次）`)
  check((r2.aiHarness?.note || '').includes('缓存'), `提示来自缓存：${r2.aiHarness?.note}`)

  console.log('3) 生成的代码不调用解答方法 → 规则拒绝 → 回退')
  clearHarnessCache()
  calls = 0
  stubReply = BAD_DRIVER
  const r3 = await run('third')
  check(calls >= 1, `仍然尝试了生成（调用 ${calls} 次）`)
  check(!r3.aiHarness?.used, `没有采用：${JSON.stringify(r3.aiHarness)}`)
  check(!r3.ok, `如实回退到确定性模板的结果（ok=${r3.ok}，compileFailed=${r3.compileFailed}）`)

  await new Promise((r) => setTimeout(r, 200))
  rmSync(runtime, { recursive: true, force: true })
  console.log(process.exitCode ? '\n有失败项' : '\n全部通过')
}
main()
