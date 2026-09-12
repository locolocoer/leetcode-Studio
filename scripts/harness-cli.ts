// CLI: bundle with esbuild, then run to emit harness files for a smoke test.
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { buildHarness } from '../src/main/harness'
import type { Language, Problem } from '../src/shared/types'

const twoSum: Problem = {
  id: '1',
  slug: 'two-sum',
  title: 'Two Sum',
  difficulty: 'easy',
  tags: [],
  content: '',
  judgeType: 'function',
  methodName: 'twoSum',
  params: [{ name: 'nums', type: 'integer[]' }, { name: 'target', type: 'integer' }],
  returnType: 'integer[]',
  tests: [],
  starters: {},
  source: 'local'
}

const pythonCode = `class Solution:
    def twoSum(self, nums, target):
        m = {}
        for i, x in enumerate(nums):
            if target - x in m:
                return [m[target - x], i]
            m[x] = i
        return []
`

const minStack: Problem = {
  id: '155',
  slug: 'min-stack',
  title: 'Min Stack',
  difficulty: 'medium',
  tags: [],
  content: '',
  judgeType: 'class',
  methodName: 'MinStack',
  params: [],
  returnType: 'void',
  constructorParams: [],
  methods: [
    { name: 'push', params: [{ name: 'val', type: 'integer' }], returnType: 'void' },
    { name: 'pop', params: [], returnType: 'void' },
    { name: 'top', params: [], returnType: 'integer' },
    { name: 'getMin', params: [], returnType: 'integer' }
  ],
  tests: [],
  starters: {},
  source: 'local'
}

const minStackPy = `class MinStack:
    def __init__(self):
        self.stack = []
        self.mins = []
    def push(self, val: int) -> None:
        self.stack.append(val)
        if not self.mins or val <= self.mins[-1]:
            self.mins.append(val)
    def pop(self) -> None:
        if self.stack.pop() == self.mins[-1]:
            self.mins.pop()
    def top(self) -> int:
        return self.stack[-1]
    def getMin(self) -> int:
        return self.mins[-1]
`

const minStackJava = `class MinStack {
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    java.util.Deque<Integer> min = new java.util.ArrayDeque<>();
    public MinStack() {}
    public void push(int val) { st.push(val); if (min.isEmpty() || val <= min.peek()) min.push(val); }
    public void pop() { int v = st.pop(); if (v == min.peek()) min.pop(); }
    public int top() { return st.peek(); }
    public int getMin() { return min.peek(); }
}
`

const javaCode = `class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.Map<Integer,Integer> m = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int need = target - nums[i];
            if (m.containsKey(need)) return new int[]{m.get(need), i};
            m.put(nums[i], i);
        }
        return new int[]{};
    }
}
`

const lang = process.argv[2] as Language
const outdir = process.argv[3]
if (!lang || !outdir) { console.error('usage: node harness-cli.mjs <lang> <outdir>'); process.exit(2) }

try { rmSync(outdir, { recursive: true, force: true }) } catch {}
mkdirSync(outdir, { recursive: true })

function emit(problem: Problem, source: string, name: string) {
  const h = buildHarness(problem, lang, source)
  const dir = join(outdir, name)
  mkdirSync(dir, { recursive: true })
  for (const f of h.files) writeFileSync(join(dir, f.name), f.content, 'utf8')
  console.log(JSON.stringify({ dir, compile: h.compile, run: h.run, className: h.className, files: h.files.map(f => f.name) }))
}

emit(twoSum, lang === 'python' ? pythonCode : javaCode, 'two-sum-' + lang)
emit(minStack, lang === 'python' ? minStackPy : minStackJava, 'min-stack-' + lang)
