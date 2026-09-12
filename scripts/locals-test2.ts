import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Language, Settings, ToolchainStatus } from '../src/shared/types'
import { fetchProblemDetail } from '../src/main/fetcher'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(tools, 'w64', 'w64devkit', 'bin')
const jdk = join(tools, 'jdk17', 'bin')
const py = join(tools, 'python', 'python.exe')

const toolchains: Record<Language, ToolchainStatus> = {
  c: { language: 'c', available: true, compilerPath: join(w64, 'gcc.exe'), source: 'bundled' },
  cpp: { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' },
  java: { language: 'java', available: true, compilerPath: join(jdk, 'javac.exe'), runnerPath: join(jdk, 'java.exe'), source: 'bundled' },
  python: { language: 'python', available: true, compilerPath: py, runnerPath: py, source: 'bundled' }
}
const settings: Settings = { toolpaths: {}, timeLimitMs: 5000, theme: 'dark', contentLang: 'zh' }
void settings

const treeCpp = `class Solution {
public:
    int maxDepth(TreeNode* root) {
        if (root == nullptr) return 0;
        int l = maxDepth(root->left);
        int r = maxDepth(root->right);
        return 1 + (l > r ? l : r);
    }
};
`
const treeJava = `public class Solution {
    public int maxDepth(TreeNode root) {
        if (root == null) return 0;
        int l = maxDepth(root.left);
        int r = maxDepth(root.right);
        return 1 + Math.max(l, r);
    }
}
`
const treePy = `class Solution(object):
    def maxDepth(self, root):
        if not root:
            return 0
        l = self.maxDepth(root.left)
        r = self.maxDepth(root.right)
        return 1 + max(l, r)
`
const twoSumCpp = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> m;
        for (int i = 0; i < (int)nums.size(); i++) {
            int need = target - nums[i];
            if (m.count(need)) return {m[need], i};
            m[nums[i]] = i;
        }
        return {};
    }
};
`
const twoSumJava = `import java.util.*;
public class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer,Integer> m = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int need = target - nums[i];
            if (m.containsKey(need)) return new int[]{m.get(need), i};
            m.put(nums[i], i);
        }
        return new int[]{};
    }
}
`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(sess: DebugSession, maxMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await wait(200)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') return
  }
}
function dump(sess: DebugSession) {
  const s = sess.snapshot
  console.log(`  status=${s.status} line=${s.pausedAt} fn=${s.frame?.name}`)
  if (s.error) console.log('  ERROR: ' + s.error.slice(0, 300))
  for (const [k, v] of Object.entries(s.frame?.locals || {})) console.log(`    ${k} = ${v}`)
}

async function run(slug: string, lang: Language, code: string, bp: number, label: string, steps: number) {
  const runtimeDir = join(process.cwd(), '.locals-dbg')
  mkdirSync(runtimeDir, { recursive: true })
  console.log(`\n===== ${label} (${lang}) bp=${bp} =====`)
  const problem = await fetchProblemDetail(slug, 'leetcode.cn')
  const test = problem.tests[0]
  console.log('input:', test.input.join(' | '), '=> expected', test.expected)
  const sess = new DebugSession({})
  const snap = await sess.start(problem, code, test, lang, toolchains[lang], runtimeDir, [bp])
  console.log('start:', snap.status, snap.error ? 'err=' + snap.error.slice(0, 300) : '')
  await settle(sess)
  console.log('-- first stop --')
  dump(sess)
  for (let i = 0; i < steps; i++) {
    if (sess.snapshot.status !== 'paused') break
    sess.step()
    await settle(sess)
    console.log(`-- after step ${i + 1} --`)
    dump(sess)
  }
  console.log('output:', JSON.stringify(sess.snapshot.programOutput).slice(0, 160))
  sess.dispose()
}

const revPy = `class Solution(object):
    def reverseList(self, head):
        prev = None
        while head:
            nxt = head.next
            head.next = prev
            prev = head
            head = nxt
        return prev
`

async function runToEnd(slug: string, lang: Language, code: string, bp: number, label: string) {
  const runtimeDir = join(process.cwd(), '.locals-dbg')
  mkdirSync(runtimeDir, { recursive: true })
  console.log(`\n===== ${label} (${lang}) bp=${bp} =====`)
  const problem = await fetchProblemDetail(slug, 'leetcode.cn')
  const test = problem.tests[0]
  console.log('input:', test.input.join(' | '), '=> expected', test.expected)
  const sess = new DebugSession({})
  const snap = await sess.start(problem, code, test, lang, toolchains[lang], runtimeDir, [bp])
  console.log('start:', snap.status, snap.error ? 'err=' + snap.error.slice(0, 300) : '')
  await settle(sess)
  dump(sess)
  for (let i = 0; i < 12 && sess.snapshot.status === 'paused'; i++) {
    sess.resume()
    await wait(400)
    await settle(sess, 30000)
  }
  console.log('final:', sess.snapshot.status, 'output=', JSON.stringify(sess.snapshot.programOutput).slice(0, 200))
  sess.dispose()
}

const tree = 'maximum-depth-of-binary-tree'
const twoSum = 'two-sum'

async function main() {
  const only = process.argv[2] || 'all'
  if (only === 'all' || only === 'tree') {
    await run(tree, 'cpp', treeCpp, 4, 'C++ 二叉树最大深度', 1)
    await run(tree, 'java', treeJava, 4, 'Java 二叉树最大深度', 1)
    await run(tree, 'python', treePy, 5, 'Python 二叉树最大深度', 1)
  }
  if (only === 'all' || only === 'sum') {
    await run(twoSum, 'cpp', twoSumCpp, 5, 'C++ 两数之和', 4)
    await run(twoSum, 'java', twoSumJava, 5, 'Java 两数之和', 4)
  }
  if (only === 'all' || only === 'rev') {
    await runToEnd('reverse-linked-list', 'python', revPy, 4, 'Python 反转链表')
  }
}
main()
