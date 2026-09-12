import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { fetchProblemDetail } from '../src/main/fetcher'
import { runAll } from '../src/main/runner'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const py = join(tools, 'python', 'python.exe')
const toolchains: Record<Language, ToolchainStatus> = {
  c: { language: 'c', available: true, compilerPath: join(tools, 'w64', 'w64devkit', 'bin', 'gcc.exe'), source: 'bundled' },
  cpp: { language: 'cpp', available: true, compilerPath: join(tools, 'w64', 'w64devkit', 'bin', 'g++.exe'), source: 'bundled' },
  java: { language: 'java', available: true, compilerPath: join(tools, 'jdk17', 'bin', 'javac.exe'), runnerPath: join(tools, 'jdk17', 'bin', 'java.exe'), source: 'bundled' },
  python: { language: 'python', available: true, compilerPath: py, runnerPath: py, source: 'bundled' }
}
const settings: Settings = { toolpaths: {}, timeLimitMs: 5000, theme: 'dark', contentLang: 'zh' }
void settings

const codes: Record<string, Record<string, string>> = {
  'maximum-depth-of-binary-tree': {
    python: `class Solution(object):
    def maxDepth(self, root):
        if not root:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))
`,
    java: `public class Solution {
    public int maxDepth(TreeNode root) {
        if (root == null) return 0;
        return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
    }
}
`,
    cpp: `class Solution {
public:
    int maxDepth(TreeNode* root) {
        if (root == nullptr) return 0;
        return 1 + std::max(maxDepth(root->left), maxDepth(root->right));
    }
};
`
  },
  'binary-tree-inorder-traversal': {
    python: `class Solution(object):
    def inorderTraversal(self, root):
        out = []
        def go(n):
            if not n:
                return
            go(n.left)
            out.append(n.val)
            go(n.right)
        go(root)
        return out
`
  },
  'reverse-linked-list': {
    python: `class Solution(object):
    def reverseList(self, head):
        prev = None
        while head:
            nxt = head.next
            head.next = prev
            prev = head
            head = nxt
        return prev
`
  },
  'merge-two-sorted-lists': {
    python: `class Solution(object):
    def mergeTwoLists(self, list1, list2):
        d = ListNode()
        c = d
        while list1 and list2:
            if list1.val <= list2.val:
                c.next = list1; list1 = list1.next
            else:
                c.next = list2; list2 = list2.next
            c = c.next
        c.next = list1 or list2
        return d.next
`
  },
  'two-sum': {
    python: `class Solution(object):
    def twoSum(self, nums, target):
        m = {}
        for i, v in enumerate(nums):
            if target - v in m:
                return [m[target - v], i]
            m[v] = i
        return []
`,
    cpp: `class Solution {
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
  }
}

async function main() {
  const runtimeDir = join(process.cwd(), '.py-nodes-run')
  mkdirSync(runtimeDir, { recursive: true })
  for (const [slug, langs] of Object.entries(codes)) {
    const problem: Problem = await fetchProblemDetail(slug, 'leetcode.cn')
    for (const [lang, code] of Object.entries(langs)) {
      const r = await runAll(problem, lang as Language, code, problem.tests, { toolchains, settings, runtimeDir })
      const detail = r.cases
        .map((c) => `expected=${c.expected} actual=${c.actual} pass=${c.passed}${c.error ? ' err=' + c.error.slice(0, 120) : ''}`)
        .join(' ; ')
      console.log(`== ${slug} [${lang}] ok=${r.ok}${r.compileFailed ? ' COMPILE-FAIL' : ''}${r.error ? ' err=' + String(r.error).slice(0, 200) : ''}`)
      console.log('   ' + detail)
      if (r.compileFailed) console.log((r.compileOutput || '').slice(0, 600))
    }
  }
}
main()
