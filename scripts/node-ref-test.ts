// 回归：二叉树的最近公共祖先（236）—— 元数据 p/q 是 integer，真实签名是 TreeNode*
// 三种语言都要能编译、能跑对；同时确认「返回整棵树」的题没有被误改
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { runAll } from '../src/main/runner'

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

const settings: Settings = {
  timeLimitMs: 8000, theme: 'dark', fontSize: 14, ai: { baseUrl: '', apiKey: '', model: '', strict: true }
} as unknown as Settings

// 236：p/q 在元数据里是 integer，输入给的是节点值
const lcaMeta: Problem = {
  id: '236', slug: 'lca', title: '二叉树的最近公共祖先', difficulty: 'medium', tags: [], content: '',
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

const cppSrc = `class Solution {
public:
    TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q) {
        if (root == nullptr) return nullptr;
        if (root == p || root == q) return root;
        TreeNode* left = lowestCommonAncestor(root->left, p, q);
        TreeNode* right = lowestCommonAncestor(root->right, p, q);
        if (left == nullptr) return right;
        if (right == nullptr) return left;
        return root;
    }
};`

const javaSrc = `class Solution {
    public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
        if (root == null) return null;
        if (root == p || root == q) return root;
        TreeNode left = lowestCommonAncestor(root.left, p, q);
        TreeNode right = lowestCommonAncestor(root.right, p, q);
        if (left == null) return right;
        if (right == null) return left;
        return root;
    }
}`

const pySrc = `class Solution:
    def lowestCommonAncestor(self, root: 'TreeNode', p: 'TreeNode', q: 'TreeNode') -> 'TreeNode':
        if root is None:
            return None
        if root is p or root is q:
            return root
        left = self.lowestCommonAncestor(root.left, p, q)
        right = self.lowestCommonAncestor(root.right, p, q)
        if left is None:
            return right
        if right is None:
            return left
        return root
`

// 对照：226 翻转二叉树（返回整棵树，期望是数组）—— 不能被「按节点值比较」误伤
const invertMeta: Problem = {
  id: '226', slug: 'invert', title: '翻转二叉树', difficulty: 'easy', tags: [], content: '',
  judgeType: 'function', methodName: 'invertTree',
  params: [{ name: 'root', type: 'TreeNode' }],
  returnType: 'TreeNode',
  tests: [{ id: 'ex0', input: ['[4,2,7,1,3,6,9]'], expected: '[4,7,2,9,6,3,1]' }],
  starters: {}, source: 'leetcode'
}
const invertCpp = `class Solution {
public:
    TreeNode* invertTree(TreeNode* root) {
        if (!root) return nullptr;
        TreeNode* t = root->left; root->left = root->right; root->right = t;
        invertTree(root->left); invertTree(root->right);
        return root;
    }
};`

const runtime = join(process.cwd(), '.tmp-236')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function run(problem: Problem, lang: Language, src: string) {
  const r = await runAll(problem, lang, src, problem.tests, { runtimeDir: runtime, settings, toolchains: tools() })
  const sum = (r.cases || []).map((c, i) => `#${i}:${c.passed ? 'ok' : 'FAIL(' + JSON.stringify(c.actual) + '≠' + JSON.stringify(c.expected) + ')'}`).join(' ')
  console.log(`  ${lang.padEnd(7)} ok=${r.ok} ${r.error || ''} ${sum}`)
  if (r.compileFailed) console.log('    编译输出：' + String(r.compileOutput).split('\n').slice(0, 6).join(' | '))
  return r
}

async function main() {
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  let bad = 0
  console.log('=== 236 最近公共祖先（p/q 按值引用树节点）===')
  for (const [lang, src] of [['cpp', cppSrc], ['java', javaSrc], ['python', pySrc]] as [Language, string][]) {
    const r = await run(lcaMeta, lang, src)
    if (!r.ok || (r.cases || []).some((c) => !c.passed)) bad++
  }
  console.log('=== 对照 226 翻转二叉树（返回整棵树，期望数组）===')
  const r2 = await run(invertMeta, 'cpp', invertCpp)
  if (!r2.ok || (r2.cases || []).some((c) => !c.passed)) bad++
  await sleep(300)
  rmSync(runtime, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项有问题`)
  process.exit(bad === 0 ? 0 : 1)
}
main()
