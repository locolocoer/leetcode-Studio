// Matrix language harness smoke test with correct per-language sources.
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { buildHarness } from '../src/main/harness'
import type { Language, Problem } from '../src/shared/types'

const twoSum: Problem = {
  id: '1', slug: 'two-sum', title: 'Two Sum', difficulty: 'easy', tags: [], content: '',
  judgeType: 'function', methodName: 'twoSum',
  params: [{ name: 'nums', type: 'integer[]' }, { name: 'target', type: 'integer' }],
  returnType: 'integer[]', tests: [], starters: {}, source: 'local'
}
const minStack: Problem = {
  id: '155', slug: 'min-stack', title: 'Min Stack', difficulty: 'medium', tags: [], content: '',
  judgeType: 'class', methodName: 'MinStack', params: [], returnType: 'void', constructorParams: [],
  methods: [
    { name: 'push', params: [{ name: 'val', type: 'integer' }], returnType: 'void' },
    { name: 'pop', params: [], returnType: 'void' },
    { name: 'top', params: [], returnType: 'integer' },
    { name: 'getMin', params: [], returnType: 'integer' }
  ],
  tests: [], starters: {}, source: 'local'
}

const code: Record<string, { ts: string; ms: string }> = {
  python: {
    ts: 'class Solution:\n    def twoSum(self, nums, target):\n        m = {}\n        for i, x in enumerate(nums):\n            if target - x in m:\n                return [m[target - x], i]\n            m[x] = i\n        return []\n',
    ms: 'class MinStack:\n    def __init__(self):\n        self.st = []\n        self.mn = []\n    def push(self, val):\n        self.st.append(val)\n        if not self.mn or val <= self.mn[-1]: self.mn.append(val)\n    def pop(self):\n        if self.st.pop() == self.mn[-1]: self.mn.pop()\n    def top(self): return self.st[-1]\n    def getMin(self): return self.mn[-1]\n'
  },
  java: {
    ts: 'import java.util.*;\nclass Solution {\n    public int[] twoSum(int[] nums, int target) {\n        Map<Integer,Integer> m = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            int need = target - nums[i];\n            if (m.containsKey(need)) return new int[]{m.get(need), i};\n            m.put(nums[i], i);\n        }\n        return new int[]{};\n    }\n}\n',
    ms: 'import java.util.*;\nclass MinStack {\n    Deque<Integer> st = new ArrayDeque<>();\n    Deque<Integer> mn = new ArrayDeque<>();\n    public MinStack() {}\n    public void push(int val) { st.push(val); if (mn.isEmpty() || val <= mn.peek()) mn.push(val); }\n    public void pop() { if (st.pop().equals(mn.peek())) mn.pop(); }\n    public int top() { return st.peek(); }\n    public int getMin() { return mn.peek(); }\n}\n'
  },
  cpp: {
    ts: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int,int> m;\n        for (int i = 0; i < (int)nums.size(); i++) {\n            int need = target - nums[i];\n            if (m.count(need)) return {m[need], i};\n            m[nums[i]] = i;\n        }\n        return {};\n    }\n};\n',
    ms: 'class MinStack {\n    stack<int> st, mn;\npublic:\n    MinStack() {}\n    void push(int val) { st.push(val); if (mn.empty() || val <= mn.top()) mn.push(val); }\n    void pop() { if (st.top() == mn.top()) mn.pop(); st.pop(); }\n    int top() { return st.top(); }\n    int getMin() { return mn.top(); }\n};\n'
  },
  c: {
    ts: '#include <stdlib.h>\nint* twoSum(int* nums, int numsSize, int target, int* returnSize){\n    int* r = (int*)malloc(2*sizeof(int));\n    for (int i=0;i<numsSize;i++) for (int j=i+1;j<numsSize;j++)\n        if (nums[i]+nums[j]==target){ r[0]=i; r[1]=j; *returnSize=2; return r; }\n    *returnSize=0; return NULL;\n}\n',
    ms: ''
  }
}

const lang = process.argv[2] as Language
const base = process.argv[3]
if (!lang || !base) { console.error('usage: node lang-matrix.mjs <lang> <dir>'); process.exit(2) }
try { rmSync(base, { recursive: true, force: true }) } catch {}
mkdirSync(base, { recursive: true })

function emit(problem: Problem, src: string, name: string) {
  const h = buildHarness(problem, lang, src)
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  for (const f of h.files) writeFileSync(join(dir, f.name), f.content, 'utf8')
  console.log(JSON.stringify({ name, compile: h.compile, run: h.run }))
}

emit(twoSum, code[lang].ts, 'two-sum')
if (code[lang].ms) emit(minStack, code[lang].ms, 'min-stack')
