// 用户现场复现：236 二叉树的最近公共祖先 —— 运行 + 逐步调试（C++）
// 用用户贴的那份代码，三组官方用例
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { runAll } from '../src/main/runner'
import { DebugSession } from '../src/main/debugger'

const T = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(T, 'w64', 'w64devkit', 'bin')

const tc: ToolchainStatus = { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' }
const settings = { timeLimitMs: 8000, theme: 'dark', fontSize: 14 } as unknown as Settings

const problem: Problem = {
  id: '236', slug: 'lowest-common-ancestor-of-a-binary-tree', title: '二叉树的最近公共祖先',
  difficulty: 'medium', tags: [], content: '',
  judgeType: 'function', methodName: 'lowestCommonAncestor',
  params: [
    { name: 'root', type: 'TreeNode' },
    { name: 'p', type: 'integer' },
    { name: 'q', type: 'integer' }
  ],
  returnType: 'TreeNode',
  tests: [
    { id: 'ex0', input: ['[3,5,1,6,2,0,8,null,null,7,4]', '5', '1'], expected: '3' },
    { id: 'ex1', input: ['[3,5,1,6,2,0,8,null,null,7,4]', '5', '4'], expected: '5' },
    { id: 'ex2', input: ['[1,2]', '1', '2'], expected: '1' }
  ],
  starters: {}, source: 'leetcode'
}

const src = `class Solution {
public:
    TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q) {
        if(root == nullptr) return nullptr;
        if(root == p || root == q) return root;

        TreeNode* left = lowestCommonAncestor(root->left,p,q);
        TreeNode* right = lowestCommonAncestor(root->right, p,q);
        if(left == nullptr) return right;
        if(right == nullptr) return left;
        return root;
    }
};`

const runtime = join(process.cwd(), '.tmp-236run')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })

  console.log('=== 运行所有用例 ===')
  const r = await runAll(problem, 'cpp', src, problem.tests, {
    runtimeDir: runtime, settings, toolchains: { cpp: tc } as Record<Language, ToolchainStatus>
  })
  console.log('ok=' + r.ok + (r.error ? ' error=' + r.error : ''))
  for (const c of r.cases || []) {
    console.log(`  用例 ${c.id}: ${c.passed ? '通过' : '不通过'} 期望=${c.expected} 实际=${c.actual}${c.error ? ' ' + c.error : ''}`)
  }

  console.log('=== 逐步调试（断点在第 8 行，验证 p/q 是真实节点） ===')
  const sess = new DebugSession({})
  await sess.start(problem, src, problem.tests[0], 'cpp', tc, runtime, [8])
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    await sleep(150)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  const snap = sess.snapshot
  console.log('status=' + snap.status + ' 第' + snap.pausedAt + '行' + (snap.error ? ' err=' + snap.error.slice(0, 200) : ''))
  for (const v of snap.frame?.vars || []) console.log(`  ${v.name} ${v.expandable ? '▸' : ' '} = ${v.value}`)
  // 展开 p，应该看到 val / left / right
  const p = (snap.frame?.vars || []).find((v) => v.name === 'p')
  if (p) {
    const kids = await sess.children(p.ref)
    console.log('  p 展开：' + kids.map((k) => `${k.name}=${k.value}`).join(' '))
  }
  // 步过一次
  const t1 = Date.now()
  sess.stepOver()
  while (Date.now() - t1 < 15000) {
    await sleep(120)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  console.log(`步过 ${Date.now() - t1}ms -> ${sess.snapshot.status} 第${sess.snapshot.pausedAt}行`)
  sess.dispose()
  await sleep(800)
  rmSync(runtime, { recursive: true, force: true })
}
main()
