// 符号提取回归：用户自己的变量/函数/类型/成员能不能被识别出来
import { collectSymbols } from '../src/renderer/src/symbols'
import type { Language } from '../src/shared/types'

const cases: { lang: Language; name: string; code: string; wantVars: string[]; wantFuncs: string[]; wantTypes?: string[]; wantMembers?: Record<string, string[]> }[] = [
  {
    lang: 'cpp',
    name: 'C++ 双指针 + 辅助函数 + 自定义结构体',
    code: `class Solution {
public:
    struct Item { int val; int idx; };
    int helper(vector<int>& nums, int k) {
        int total = 0;
        for (int i = 0; i < (int)nums.size(); i++) {
            total += nums[i] * k;
        }
        return total;
    }
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        Item best{0, -1};
        ListNode* p = nullptr;
        auto it = seen.begin();
        for (auto& [key, value] : seen) {
            best.val = value;
        }
        int left = 0, right = (int)nums.size() - 1;
        for (int i = 0; i < 3; ++i) {
            int need = target - nums[i];
            if (seen.count(need)) return {seen[need], i};
        }
        int sub = helper(nums, 2);
        return {};
    }
};`,
    wantVars: ['total', 'i', 'seen', 'best', 'p', 'it', 'key', 'value', 'left', 'right', 'need', 'sub', 'nums', 'target', 'k'],
    wantFuncs: ['helper', 'twoSum'],
    wantTypes: ['Item', 'Solution'],
    wantMembers: { Item: ['val', 'idx'] }
  },
  {
    lang: 'java',
    name: 'Java 辅助方法 + 字段 + 增强 for',
    code: `class Solution {
    private int count = 0;
    private Map<Integer, Integer> memo = new HashMap<>();

    private int dfs(int node, int depth) {
        if (node < 0) return 0;
        return depth + 1;
    }

    public int maxDepth(TreeNode root) {
        int result = 0;
        List<Integer> level = new ArrayList<>();
        for (int x : level) {
            result += x;
        }
        for (int i = 0; i < 3; i++) {
            count++;
        }
        String name = "abc";
        boolean ok = name.isEmpty();
        int d = dfs(1, 2);
        return result + d + count;
    }
}`,
    wantVars: ['count', 'memo', 'node', 'depth', 'result', 'level', 'x', 'i', 'name', 'ok', 'd', 'root'],
    wantFuncs: ['dfs', 'maxDepth'],
    wantTypes: ['Solution'],
    wantMembers: { Solution: ['count', 'memo', 'dfs', 'maxDepth'] }
  },
  {
    lang: 'python',
    name: 'Python 内部函数 + 类方法 + 各种赋值',
    code: `class Solution:
    CACHE = {}

    def helper(self, nums, k):
        return sum(nums) * k

    def twoSum(self, nums, target):
        seen = {}
        left, right = 0, len(nums) - 1
        for i, v in enumerate(nums):
            need = target - v
            if need in seen:
                return [seen[need], i]
            seen[v] = i
        with open('x') as fh:
            pass
        try:
            pass
        except ValueError as err:
            print(err)
        total = self.helper(nums, 2)
        fn = lambda a, b: a + b
        return [total, fn(1, 2)]`,
    wantVars: ['seen', 'left', 'right', 'i', 'v', 'need', 'fh', 'err', 'total', 'fn', 'a', 'b', 'nums', 'target'],
    wantFuncs: ['helper', 'twoSum'],
    wantTypes: ['Solution'],
    wantMembers: { Solution: ['CACHE', 'helper', 'twoSum'] }
  },
  {
    lang: 'c',
    name: 'C 结构体 + 变量',
    code: `struct Pair { int a; int b; };
#define MAXN 1005

int compare(const void* x, const void* y) { return 0; }

int* twoSum(int* nums, int numsSize, int target, int* returnSize) {
    int i = 0;
    struct Pair p;
    int* res = (int*)malloc(sizeof(int) * 2);
    for (i = 0; i < numsSize; i++) {
        int need = target - nums[i];
        if (need == 0) break;
    }
    *returnSize = 2;
    return res;
}`,
    wantVars: ['i', 'p', 'res', 'need', 'nums', 'numsSize', 'target', 'returnSize', 'x', 'y'],
    wantFuncs: ['compare', 'twoSum'],
    wantTypes: ['Pair'],
    wantMembers: { Pair: ['a', 'b'] }
  }
]

let bad = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) { bad++; console.log('    ✗ ' + msg) }
}

for (const c of cases) {
  const s = collectSymbols(c.lang, c.code)
  console.log(`\n=== ${c.lang} · ${c.name} ===`)
  const vars = [...s.vars.keys()]
  const funcs = [...s.funcs.keys()]
  console.log('  变量: ' + vars.join(', '))
  console.log('  函数: ' + funcs.join(', '))
  console.log('  类型: ' + [...s.types].join(', '))
  if (s.typeMembers.size) {
    for (const [t, m] of s.typeMembers) console.log(`  成员 ${t}: ${m.map((x) => x.name).join(', ')}`)
  }
  if (s.macros.size) console.log('  宏: ' + [...s.macros].join(', '))

  const missingVars = c.wantVars.filter((v) => !s.vars.has(v))
  const missingFuncs = c.wantFuncs.filter((f) => !s.funcs.has(f))
  check(missingVars.length === 0, `缺少变量: ${missingVars.join(', ')}`)
  check(missingFuncs.length === 0, `缺少函数: ${missingFuncs.join(', ')}`)
  for (const t of c.wantTypes || []) check(s.types.has(t), `缺少类型 ${t}`)
  for (const [t, members] of Object.entries(c.wantMembers || {})) {
    const got = (s.typeMembers.get(t) || []).map((m) => m.name)
    const miss = members.filter((m) => !got.includes(m))
    check(miss.length === 0, `${t} 缺少成员: ${miss.join(', ')}（实际 ${got.join(', ')}）`)
  }
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad ? 1 : 0)
