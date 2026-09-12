import type * as Monaco from 'monaco-editor'
import type { Language, Problem } from '../../shared/types'

/**
 * 代码补全：Monaco 对 Python / Java / C / C++ 只提供语法高亮，没有语言服务，
 * 所以这里自己实现一套「LeetCode 场景」的补全：
 *   1) 关键字 / 常用类型与标准库（按语言整理）
 *   2) 常用代码片段（for 循环、建 map、优先队列、二分……）
 *   3) 成员补全：`nums.` 这类，靠参数类型 + 代码里的声明做轻量推断
 *   4) 题目相关：当前题目的参数名、方法签名、ListNode / TreeNode 字段
 * 另外提供签名提示（写方法名时显示参数）与悬停说明。
 */

type RawKind = 'keyword' | 'type' | 'fn' | 'member' | 'param' | 'snippet' | 'const'

interface Raw {
  label: string
  kind: RawKind
  insert?: string
  detail?: string
  doc?: string
  snip?: boolean
  sort?: string
}

/** 接收者类型（用于 `x.` 之后的成员补全） */
type Recv =
  | 'list' | 'dict' | 'set' | 'str' | 'num' | 'listnode' | 'treenode'
  | 'deque' | 'pq' | 'sb' | 'unknown'

// ---------------------------------------------------------------- Python

const PY_BASE: Raw[] = [
  // 关键字
  ...[
    'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
    'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'None', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while',
    'with', 'yield', 'self', 'async', 'await', 'nonlocal'
  ].map<Raw>((k) => ({ label: k, kind: 'keyword', sort: '5' })),
  // 内置函数
  ...[
    ['len', 'len(x) — 长度'], ['range', 'range(n) / range(a, b) / range(a, b, step)'],
    ['enumerate', 'enumerate(seq) — 下标+值'], ['zip', 'zip(a, b) — 并行遍历'],
    ['sorted', 'sorted(iterable, key=..., reverse=...)'], ['reversed', 'reversed(seq)'],
    ['sum', 'sum(iterable)'], ['min', 'min(a, b) / min(iterable)'], ['max', 'max(a, b) / max(iterable)'],
    ['abs', 'abs(x)'], ['pow', 'pow(a, b)'], ['divmod', 'divmod(a, b)'],
    ['int', 'int(x)'], ['float', 'float(x)'], ['str', 'str(x)'], ['bool', 'bool(x)'],
    ['list', 'list(iterable)'], ['dict', 'dict(**kw)'], ['set', 'set(iterable)'],
    ['tuple', 'tuple(iterable)'], ['frozenset', 'frozenset(iterable)'],
    ['all', 'all(iterable)'], ['any', 'any(iterable)'], ['filter', 'filter(fn, iterable)'],
    ['map', 'map(fn, iterable)'], ['next', 'next(iterator, default)'], ['iter', 'iter(seq)'],
    ['isinstance', 'isinstance(x, T)'], ['ord', 'ord(c)'], ['chr', 'chr(i)'],
    ['bin', 'bin(i)'], ['hex', 'hex(i)'], ['round', 'round(x, ndigits)'],
    ['print', 'print(*args)'], ['input', 'input()'], ['type', 'type(x)'],
    ['float("inf")', '正无穷']
  ].map<Raw>(([label, doc]) => ({ label, kind: 'fn', insert: label, doc, sort: '4' })),
  // 常用模块与结构
  { label: 'ListNode', kind: 'type', detail: '链表节点（平台提供）', doc: '字段：`val`、`next`\n\n```python\nclass ListNode:\n    def __init__(self, val=0, next=None): ...\n```', sort: '3' },
  { label: 'TreeNode', kind: 'type', detail: '二叉树节点（平台提供）', doc: '字段：`val`、`left`、`right`', sort: '3' },
  { label: 'collections', kind: 'type', insert: 'from collections import defaultdict, Counter, deque', detail: 'defaultdict / Counter / deque', snip: true, sort: '3', doc: '```python\nfrom collections import defaultdict, Counter, deque\n```' },
  { label: 'defaultdict', kind: 'fn', detail: '缺省值字典', doc: '`defaultdict(int)` / `defaultdict(list)`', sort: '4' },
  { label: 'Counter', kind: 'fn', detail: '计数器', doc: '`Counter(nums)` → 元素计数', sort: '4' },
  { label: 'deque', kind: 'type', detail: '双端队列（BFS 用）', doc: '`q = deque([root])`，`q.popleft()` / `q.append(x)`', sort: '4' },
  { label: 'heapq', kind: 'type', insert: 'import heapq', detail: '堆', snip: true, sort: '3', doc: '`heapq.heappush(h, x)` / `heapq.heappop(h)`（小顶堆）' },
  { label: 'bisect', kind: 'type', insert: 'import bisect', detail: '二分查找', snip: true, sort: '3', doc: '`bisect.bisect_left(a, x)` 返回插入位置（数组需有序）' },
  { label: 'functools', kind: 'type', insert: 'from functools import lru_cache', detail: '记忆化搜索', snip: true, sort: '3', doc: '装饰器 `@lru_cache(None)` 做记忆化' },
  { label: 'math', kind: 'type', insert: 'import math', detail: '数学函数', snip: true, sort: '3', doc: '`math.gcd` / `math.inf` / `math.isqrt`' },
  // 片段
  { label: 'fori', kind: 'snippet', insert: 'for i in range(n):\n    ${0:pass}', detail: 'for i in range(n)', snip: true, sort: '2' },
  { label: 'forlen', kind: 'snippet', insert: 'for i in range(len(${1:arr})):\n    ${0:pass}', detail: '遍历下标', snip: true, sort: '2' },
  { label: 'forenum', kind: 'snippet', insert: 'for i, v in enumerate(${1:nums}):\n    ${0:pass}', detail: 'enumerate 遍历', snip: true, sort: '2' },
  { label: 'forzip', kind: 'snippet', insert: 'for a, b in zip(${1:a}, ${2:b}):\n    ${0:pass}', detail: 'zip 并行遍历', snip: true, sort: '2' },
  { label: 'whilelr', kind: 'snippet', insert: 'while ${1:left} < ${2:right}:\n    ${0:pass}', detail: '双指针 while', snip: true, sort: '2' },
  { label: 'dfs', kind: 'snippet', insert: 'def dfs(${1:node}):\n    if not ${1:node}:\n        return\n    dfs(${1:node}.left)\n    dfs(${1:node}.right)', detail: 'DFS 递归模板', snip: true, sort: '2' },
  { label: 'bfs', kind: 'snippet', insert: 'q = deque([${1:root}])\nwhile q:\n    n = q.popleft()\n    ${0:pass}', detail: 'BFS 模板（deque）', snip: true, sort: '2' },
  { label: 'uf', kind: 'snippet', insert: 'parent = list(range(${1:n}))\n\ndef find(x):\n    while parent[x] != x:\n        parent[x] = parent[parent[x]]\n        x = parent[x]\n    return x', detail: '并查集模板（路径压缩）', snip: true, sort: '2' },
  { label: 'cnt', kind: 'snippet', insert: 'cnt = Counter(${1:nums})', detail: '计数', snip: true, sort: '2' },
  { label: 'inf', kind: 'snippet', insert: 'INF = float("inf")', detail: '正无穷', snip: true, sort: '2' },
  { label: 'clssol', kind: 'snippet', insert: 'class Solution:\n    def ${1:method}(self, ${2}):\n        ${0:pass}', detail: 'class Solution 模板', snip: true, sort: '2' }
]

// ---------------------------------------------------------------- C++

const CPP_BASE: Raw[] = [
  ...[
    'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue',
    'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'extern', 'false', 'float',
    'for', 'friend', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'nullptr',
    'operator', 'private', 'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static',
    'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename',
    'union', 'unsigned', 'using', 'virtual', 'void', 'while', 'static_cast', 'dynamic_cast'
  ].map<Raw>((k) => ({ label: k, kind: 'keyword', sort: '5' })),
  ...[
    ['vector', '动态数组'], ['string', '字符串'], ['unordered_map', '哈希表 O(1)'],
    ['unordered_set', '哈希集合'], ['map', '有序表 O(log n)'], ['set', '有序集合'],
    ['queue', '队列'], ['deque', '双端队列'], ['stack', '栈'],
    ['priority_queue', '优先队列（默认大顶堆）'], ['pair', '二元组'], ['tuple', '多元组'],
    ['sort', 'std::sort(v.begin(), v.end())'], ['reverse', 'std::reverse'],
    ['max', 'std::max(a, b)'], ['min', 'std::min(a, b)'], ['abs', 'std::abs(x)'],
    ['swap', 'std::swap(a, b)'], ['accumulate', '求和（numeric）'],
    ['lower_bound', '第一个 >= x 的位置'], ['upper_bound', '第一个 > x 的位置'],
    ['binary_search', '有序区间二分查找'], ['unique', '去重（需先排序）'],
    ['INT_MAX', 'int 最大值'], ['INT_MIN', 'int 最小值'], ['LLONG_MAX', 'long long 最大值'],
    ['size_t', '无符号大小类型'], ['long long', '64 位整数']
  ].map<Raw>(([label, doc]) => ({ label, kind: 'type', doc, sort: '4' })),
  { label: 'ListNode', kind: 'type', detail: '链表节点（平台提供）', doc: '字段：`val`、`next`（`ListNode*`）', sort: '3' },
  { label: 'TreeNode', kind: 'type', detail: '二叉树节点（平台提供）', doc: '字段：`val`、`left`、`right`（`TreeNode*`）', sort: '3' },
  { label: 'bits', kind: 'snippet', insert: '#include <bits/stdc++.h>\nusing namespace std;', detail: '万能头文件', snip: true, sort: '2' },
  { label: 'fori', kind: 'snippet', insert: 'for (int i = 0; i < ${1:n}; ++i) {\n    ${0}\n}', detail: 'for 循环', snip: true, sort: '2' },
  { label: 'forn', kind: 'snippet', insert: 'for (int i = 0; i < (int)${1:nums}.size(); ++i) {\n    ${0}\n}', detail: '遍历下标', snip: true, sort: '2' },
  { label: 'forr', kind: 'snippet', insert: 'for (const auto& ${1:x} : ${2:nums}) {\n    ${0}\n}', detail: '范围 for', snip: true, sort: '2' },
  { label: 'forsort', kind: 'snippet', insert: 'sort(${1:v}.begin(), ${1:v}.end());', detail: '排序', snip: true, sort: '2' },
  { label: 'sortl', kind: 'snippet', insert: 'sort(${1:v}.begin(), ${1:v}.end(), [](const auto& a, const auto& b) {\n    return ${0:a < b};\n});', detail: '自定义排序', snip: true, sort: '2' },
  { label: 'umap', kind: 'snippet', insert: 'unordered_map<${1:int}, ${2:int}> ${3:mp};', detail: '哈希表', snip: true, sort: '2' },
  { label: 'uset', kind: 'snippet', insert: 'unordered_set<${1:int}> ${2:seen};', detail: '哈希集合', snip: true, sort: '2' },
  { label: 'pq', kind: 'snippet', insert: 'priority_queue<${1:int}, vector<${1:int}>, greater<${1:int}>> ${2:pq};', detail: '小顶堆', snip: true, sort: '2' },
  { label: 'vvi', kind: 'snippet', insert: 'vector<vector<int>> ${1:grid};', detail: '二维数组', snip: true, sort: '2' },
  { label: 'll', kind: 'snippet', insert: 'long long ${1:ans} = 0;', detail: 'long long 变量', snip: true, sort: '2' },
  { label: 'bfs', kind: 'snippet', insert: 'queue<TreeNode*> q;\nq.push(${1:root});\nwhile (!q.empty()) {\n    auto* n = q.front(); q.pop();\n    ${0}\n}', detail: 'BFS 模板', snip: true, sort: '2' }
]

// ---------------------------------------------------------------- Java

const JAVA_BASE: Raw[] = [
  ...[
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
    'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
    'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'new', 'null',
    'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch',
    'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
    'true', 'false', 'var'
  ].map<Raw>((k) => ({ label: k, kind: 'keyword', sort: '5' })),
  ...[
    ['int', '32 位整数'], ['long', '64 位整数'], ['double', '浮点数'], ['char', '字符'],
    ['boolean', '布尔'], ['String', '字符串'], ['Integer', 'int 包装类'],
    ['List', '列表接口'], ['ArrayList', '数组列表'], ['LinkedList', '链表'],
    ['Map', '映射接口'], ['HashMap', '哈希表'], ['TreeMap', '有序映射'], ['LinkedHashMap', '保序哈希表'],
    ['Set', '集合接口'], ['HashSet', '哈希集合'], ['TreeSet', '有序集合'],
    ['Queue', '队列接口'], ['Deque', '双端队列'], ['ArrayDeque', '数组双端队列'],
    ['PriorityQueue', '优先队列（默认小顶堆）'], ['Stack', '栈'],
    ['StringBuilder', '可变字符串'], ['Arrays', '数组工具类'], ['Collections', '集合工具类'],
    ['Math', '数学函数'], ['Character', '字符工具类'],
    ['Integer.MAX_VALUE', 'int 最大值'], ['Integer.MIN_VALUE', 'int 最小值'],
    ['Long.MAX_VALUE', 'long 最大值']
  ].map<Raw>(([label, doc]) => ({ label, kind: 'type', doc, sort: '4' })),
  { label: 'ListNode', kind: 'type', detail: '链表节点（平台提供）', doc: '字段：`val`、`next`', sort: '3' },
  { label: 'TreeNode', kind: 'type', detail: '二叉树节点（平台提供）', doc: '字段：`val`、`left`、`right`', sort: '3' },
  { label: 'fori', kind: 'snippet', insert: 'for (int i = 0; i < ${1:n}; i++) {\n    ${0}\n}', detail: 'for 循环', snip: true, sort: '2' },
  { label: 'forn', kind: 'snippet', insert: 'for (int i = 0; i < ${1:arr}.length; i++) {\n    ${0}\n}', detail: '遍历数组', snip: true, sort: '2' },
  { label: 'forr', kind: 'snippet', insert: 'for (${1:int} ${2:x} : ${3:arr}) {\n    ${0}\n}', detail: '增强 for', snip: true, sort: '2' },
  { label: 'sout', kind: 'snippet', insert: 'System.out.println(${0});', detail: '打印', snip: true, sort: '2' },
  { label: 'map', kind: 'snippet', insert: 'Map<${1:Integer}, ${2:Integer}> ${3:map} = new HashMap<>();', detail: 'HashMap', snip: true, sort: '2' },
  { label: 'list', kind: 'snippet', insert: 'List<${1:Integer}> ${2:list} = new ArrayList<>();', detail: 'ArrayList', snip: true, sort: '2' },
  { label: 'set', kind: 'snippet', insert: 'Set<${1:Integer}> ${2:set} = new HashSet<>();', detail: 'HashSet', snip: true, sort: '2' },
  { label: 'pq', kind: 'snippet', insert: 'PriorityQueue<${1:Integer}> ${2:pq} = new PriorityQueue<>();', detail: '优先队列', snip: true, sort: '2' },
  { label: 'deque', kind: 'snippet', insert: 'Deque<${1:Integer}> ${2:q} = new ArrayDeque<>();', detail: '双端队列', snip: true, sort: '2' },
  { label: 'sb', kind: 'snippet', insert: 'StringBuilder ${1:sb} = new StringBuilder();', detail: 'StringBuilder', snip: true, sort: '2' },
  { label: 'sortarr', kind: 'snippet', insert: 'Arrays.sort(${1:arr});', detail: '数组排序', snip: true, sort: '2' },
  { label: 'bfs', kind: 'snippet', insert: 'Deque<TreeNode> q = new ArrayDeque<>();\nq.add(${1:root});\nwhile (!q.isEmpty()) {\n    TreeNode n = q.poll();\n    ${0}\n}', detail: 'BFS 模板', snip: true, sort: '2' }
]

// ---------------------------------------------------------------- C

const C_BASE: Raw[] = [
  ...[
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else',
    'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'return', 'short', 'signed',
    'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while'
  ].map<Raw>((k) => ({ label: k, kind: 'keyword', sort: '5' })),
  ...[
    ['NULL', '空指针'], ['malloc', 'void* malloc(size_t)'], ['calloc', 'calloc(n, size)'],
    ['realloc', 'realloc(p, size)'], ['free', 'free(p)'], ['memset', 'memset(p, v, n)'],
    ['memcpy', 'memcpy(dst, src, n)'], ['qsort', 'qsort(base, n, size, cmp)'],
    ['strlen', '字符串长度'], ['strcmp', '字符串比较'], ['strcpy', '字符串复制'],
    ['abs', '绝对值'], ['INT_MAX', 'int 最大值'], ['INT_MIN', 'int 最小值'],
    ['size_t', '无符号大小类型'], ['bool', '布尔（stdbool.h）'], ['true', '真'], ['false', '假']
  ].map<Raw>(([label, doc]) => ({ label, kind: 'type', doc, sort: '4' })),
  { label: 'struct ListNode', kind: 'type', detail: '链表节点（平台提供）', doc: '字段：`val`、`next`（`struct ListNode*`）', sort: '3' },
  { label: 'struct TreeNode', kind: 'type', detail: '二叉树节点（平台提供）', doc: '字段：`val`、`left`、`right`（`struct TreeNode*`）', sort: '3' },
  { label: 'inc', kind: 'snippet', insert: '#include <stdlib.h>\n#include <string.h>\n#include <stdio.h>\n#include <stdbool.h>\n#include <limits.h>', detail: '常用头文件', snip: true, sort: '2' },
  { label: 'fori', kind: 'snippet', insert: 'for (int i = 0; i < ${1:n}; i++) {\n    ${0}\n}', detail: 'for 循环', snip: true, sort: '2' },
  { label: 'malloc', kind: 'snippet', insert: 'int* ${1:arr} = (int*)malloc(sizeof(int) * ${2:n});', detail: '分配数组', snip: true, sort: '2' },
  { label: 'cmp', kind: 'snippet', insert: 'int cmp(const void* a, const void* b) {\n    return (*(int*)a) - (*(int*)b);\n}', detail: 'qsort 比较函数', snip: true, sort: '2' },
  { label: 'qsort', kind: 'snippet', insert: 'qsort(${1:arr}, ${2:n}, sizeof(int), cmp);', detail: '快速排序', snip: true, sort: '2' },
  { label: 'memset', kind: 'snippet', insert: 'memset(${1:arr}, 0, sizeof(${1:arr}));', detail: '清零', snip: true, sort: '2' }
]

const BASE: Record<Language, Raw[]> = { python: PY_BASE, cpp: CPP_BASE, java: JAVA_BASE, c: C_BASE }

// ---------------------------------------------------------------- 成员补全

const PY_MEMBERS: Partial<Record<Recv, Raw[]>> = {
  list: [
    { label: 'append', kind: 'member', insert: 'append(${1:x})', doc: '`list.append(x)` 末尾追加', snip: true },
    { label: 'pop', kind: 'member', insert: 'pop(${1:-1})', doc: '`list.pop()` 弹出末尾 / `pop(i)`' , snip: true },
    { label: 'insert', kind: 'member', insert: 'insert(${1:i}, ${2:x})', doc: '在 i 处插入', snip: true },
    { label: 'extend', kind: 'member', insert: 'extend(${1:it})', doc: '追加可迭代对象', snip: true },
    { label: 'sort', kind: 'member', insert: 'sort(${1:key=lambda x: x}, reverse=${2:False})', doc: '原地排序', snip: true },
    { label: 'reverse', kind: 'member', doc: '原地反转' },
    { label: 'index', kind: 'member', insert: 'index(${1:x})', doc: '首次出现的下标', snip: true },
    { label: 'count', kind: 'member', insert: 'count(${1:x})', doc: '出现次数', snip: true },
    { label: 'remove', kind: 'member', insert: 'remove(${1:x})', doc: '删除第一个等于 x 的元素', snip: true },
    { label: 'clear', kind: 'member', doc: '清空' },
    { label: 'copy', kind: 'member', doc: '浅拷贝' }
  ],
  dict: [
    { label: 'get', kind: 'member', insert: 'get(${1:key}, ${2:0})', doc: '取键值，缺省返回默认值', snip: true },
    { label: 'keys', kind: 'member', doc: '所有键' },
    { label: 'values', kind: 'member', doc: '所有值' },
    { label: 'items', kind: 'member', doc: '键值对：`for k, v in d.items():`' },
    { label: 'setdefault', kind: 'member', insert: 'setdefault(${1:key}, ${2:[]})', doc: '不存在时设置默认值', snip: true },
    { label: 'pop', kind: 'member', insert: 'pop(${1:key}, ${2:None})', doc: '弹出键值', snip: true },
    { label: 'update', kind: 'member', insert: 'update(${1:other})', doc: '合并字典', snip: true },
    { label: 'clear', kind: 'member', doc: '清空' }
  ],
  set: [
    { label: 'add', kind: 'member', insert: 'add(${1:x})', doc: '添加元素', snip: true },
    { label: 'discard', kind: 'member', insert: 'discard(${1:x})', doc: '删除（不存在不报错）', snip: true },
    { label: 'remove', kind: 'member', insert: 'remove(${1:x})', doc: '删除（不存在报错）', snip: true },
    { label: 'union', kind: 'member', insert: 'union(${1:other})', doc: '并集', snip: true },
    { label: 'intersection', kind: 'member', insert: 'intersection(${1:other})', doc: '交集', snip: true },
    { label: 'difference', kind: 'member', insert: 'difference(${1:other})', doc: '差集', snip: true }
  ],
  str: [
    { label: 'split', kind: 'member', insert: 'split(${1})', doc: '按分隔符切分', snip: true },
    { label: 'join', kind: 'member', insert: 'join(${1:parts})', doc: '拼接', snip: true },
    { label: 'strip', kind: 'member', doc: '去首尾空白' },
    { label: 'replace', kind: 'member', insert: 'replace(${1:old}, ${2:new})', doc: '替换', snip: true },
    { label: 'find', kind: 'member', insert: 'find(${1:sub})', doc: '首次出现位置（无则 -1）', snip: true },
    { label: 'startswith', kind: 'member', insert: 'startswith(${1:prefix})', doc: '前缀判断', snip: true },
    { label: 'endswith', kind: 'member', insert: 'endswith(${1:suffix})', doc: '后缀判断', snip: true },
    { label: 'isdigit', kind: 'member', doc: '是否全为数字' },
    { label: 'isalpha', kind: 'member', doc: '是否全为字母' },
    { label: 'lower', kind: 'member', doc: '转小写' },
    { label: 'upper', kind: 'member', doc: '转大写' },
    { label: 'zfill', kind: 'member', insert: 'zfill(${1:width})', doc: '左补零', snip: true },
    { label: 'count', kind: 'member', insert: 'count(${1:sub})', doc: '子串出现次数', snip: true }
  ],
  deque: [
    { label: 'append', kind: 'member', insert: 'append(${1:x})', doc: '右端入队', snip: true },
    { label: 'appendleft', kind: 'member', insert: 'appendleft(${1:x})', doc: '左端入队', snip: true },
    { label: 'pop', kind: 'member', doc: '右端出队' },
    { label: 'popleft', kind: 'member', doc: '左端出队' }
  ],
  pq: [
    { label: 'heappush', kind: 'member', insert: 'heappush(${1:h}, ${2:x})', doc: '入堆', snip: true },
    { label: 'heappop', kind: 'member', insert: 'heappop(${1:h})', doc: '弹出最小值', snip: true },
    { label: 'heapify', kind: 'member', insert: 'heapify(${1:h})', doc: '原地建堆', snip: true }
  ],
  listnode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'next', kind: 'member', doc: '下一个节点' }
  ],
  treenode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'left', kind: 'member', doc: '左子树' },
    { label: 'right', kind: 'member', doc: '右子树' }
  ]
}

const CPP_MEMBERS: Partial<Record<Recv, Raw[]>> = {
  list: [
    { label: 'push_back', kind: 'member', insert: 'push_back(${1:x})', doc: '末尾追加', snip: true },
    { label: 'pop_back', kind: 'member', doc: '弹出末尾' },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true },
    { label: 'empty', kind: 'member', insert: 'empty()', doc: '是否为空', snip: true },
    { label: 'back', kind: 'member', insert: 'back()', doc: '末尾元素', snip: true },
    { label: 'front', kind: 'member', insert: 'front()', doc: '首元素', snip: true },
    { label: 'begin', kind: 'member', insert: 'begin()', doc: '起始迭代器', snip: true },
    { label: 'end', kind: 'member', insert: 'end()', doc: '结束迭代器', snip: true },
    { label: 'clear', kind: 'member', insert: 'clear()', doc: '清空', snip: true },
    { label: 'resize', kind: 'member', insert: 'resize(${1:n})', doc: '调整大小', snip: true },
    { label: 'erase', kind: 'member', insert: 'erase(${1:it})', doc: '删除迭代器指向元素', snip: true },
    { label: 'insert', kind: 'member', insert: 'insert(${1:it}, ${2:x})', doc: '插入', snip: true }
  ],
  dict: [
    { label: 'count', kind: 'member', insert: 'count(${1:key})', doc: '是否存在（0/1）', snip: true },
    { label: 'find', kind: 'member', insert: 'find(${1:key})', doc: '查找，返回迭代器', snip: true },
    { label: 'insert', kind: 'member', insert: 'insert({${1:key}, ${2:val}})', doc: '插入键值对', snip: true },
    { label: 'erase', kind: 'member', insert: 'erase(${1:key})', doc: '删除', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true },
    { label: 'empty', kind: 'member', insert: 'empty()', doc: '是否为空', snip: true },
    { label: 'begin', kind: 'member', insert: 'begin()', doc: '起始迭代器', snip: true },
    { label: 'end', kind: 'member', insert: 'end()', doc: '结束迭代器', snip: true },
    { label: 'clear', kind: 'member', insert: 'clear()', doc: '清空', snip: true }
  ],
  set: [
    { label: 'insert', kind: 'member', insert: 'insert(${1:x})', doc: '插入', snip: true },
    { label: 'count', kind: 'member', insert: 'count(${1:x})', doc: '是否存在（0/1）', snip: true },
    { label: 'find', kind: 'member', insert: 'find(${1:x})', doc: '查找', snip: true },
    { label: 'erase', kind: 'member', insert: 'erase(${1:x})', doc: '删除', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true },
    { label: 'empty', kind: 'member', insert: 'empty()', doc: '是否为空', snip: true }
  ],
  str: [
    { label: 'size', kind: 'member', insert: 'size()', doc: '长度', snip: true },
    { label: 'length', kind: 'member', insert: 'length()', doc: '长度', snip: true },
    { label: 'substr', kind: 'member', insert: 'substr(${1:pos}, ${2:len})', doc: '子串', snip: true },
    { label: 'find', kind: 'member', insert: 'find(${1:sub})', doc: '子串位置（npos 表示未找到）', snip: true },
    { label: 'push_back', kind: 'member', insert: 'push_back(${1:c})', doc: '追加字符', snip: true },
    { label: 'pop_back', kind: 'member', doc: '删除末尾字符' },
    { label: 'empty', kind: 'member', insert: 'empty()', doc: '是否为空', snip: true },
    { label: 'begin', kind: 'member', insert: 'begin()', doc: '起始迭代器', snip: true },
    { label: 'end', kind: 'member', insert: 'end()', doc: '结束迭代器', snip: true }
  ],
  pq: [
    { label: 'push', kind: 'member', insert: 'push(${1:x})', doc: '入堆', snip: true },
    { label: 'pop', kind: 'member', insert: 'pop()', doc: '弹出堆顶', snip: true },
    { label: 'top', kind: 'member', insert: 'top()', doc: '堆顶元素', snip: true },
    { label: 'empty', kind: 'member', insert: 'empty()', doc: '是否为空', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true }
  ],
  deque: [
    { label: 'push_back', kind: 'member', insert: 'push_back(${1:x})', doc: '尾部入队', snip: true },
    { label: 'push_front', kind: 'member', insert: 'push_front(${1:x})', doc: '头部入队', snip: true },
    { label: 'pop_back', kind: 'member', doc: '尾部出队' },
    { label: 'pop_front', kind: 'member', doc: '头部出队' },
    { label: 'front', kind: 'member', insert: 'front()', doc: '队首', snip: true },
    { label: 'back', kind: 'member', insert: 'back()', doc: '队尾', snip: true },
    { label: 'empty', kind: 'member', insert: 'empty()', doc: '是否为空', snip: true }
  ],
  listnode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'next', kind: 'member', doc: '下一个节点' }
  ],
  treenode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'left', kind: 'member', doc: '左子树' },
    { label: 'right', kind: 'member', doc: '右子树' }
  ]
}

const JAVA_MEMBERS: Partial<Record<Recv, Raw[]>> = {
  list: [
    { label: 'add', kind: 'member', insert: 'add(${1:x})', doc: '追加元素', snip: true },
    { label: 'get', kind: 'member', insert: 'get(${1:i})', doc: '按下标取值', snip: true },
    { label: 'set', kind: 'member', insert: 'set(${1:i}, ${2:x})', doc: '按下标赋值', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true },
    { label: 'isEmpty', kind: 'member', insert: 'isEmpty()', doc: '是否为空', snip: true },
    { label: 'contains', kind: 'member', insert: 'contains(${1:x})', doc: '是否包含', snip: true },
    { label: 'remove', kind: 'member', insert: 'remove(${1:i})', doc: '删除下标元素', snip: true },
    { label: 'indexOf', kind: 'member', insert: 'indexOf(${1:x})', doc: '首次下标', snip: true },
    { label: 'clear', kind: 'member', insert: 'clear()', doc: '清空', snip: true },
    { label: 'addAll', kind: 'member', insert: 'addAll(${1:other})', doc: '批量追加', snip: true },
    { label: 'length', kind: 'member', doc: '（数组）长度' }
  ],
  dict: [
    { label: 'put', kind: 'member', insert: 'put(${1:k}, ${2:v})', doc: '写入', snip: true },
    { label: 'get', kind: 'member', insert: 'get(${1:k})', doc: '读取', snip: true },
    { label: 'getOrDefault', kind: 'member', insert: 'getOrDefault(${1:k}, ${2:0})', doc: '读不到时返回默认值', snip: true },
    { label: 'putIfAbsent', kind: 'member', insert: 'putIfAbsent(${1:k}, ${2:v})', doc: '不存在才写入', snip: true },
    { label: 'computeIfAbsent', kind: 'member', insert: 'computeIfAbsent(${1:k}, x -> new ArrayList<>())', doc: '不存在时计算并写入', snip: true },
    { label: 'merge', kind: 'member', insert: 'merge(${1:k}, ${2:1}, Integer::sum)', doc: '合并计数', snip: true },
    { label: 'containsKey', kind: 'member', insert: 'containsKey(${1:k})', doc: '是否含键', snip: true },
    { label: 'containsValue', kind: 'member', insert: 'containsValue(${1:v})', doc: '是否含值', snip: true },
    { label: 'keySet', kind: 'member', insert: 'keySet()', doc: '键集合', snip: true },
    { label: 'values', kind: 'member', insert: 'values()', doc: '值集合', snip: true },
    { label: 'entrySet', kind: 'member', insert: 'entrySet()', doc: '键值对集合', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true },
    { label: 'isEmpty', kind: 'member', insert: 'isEmpty()', doc: '是否为空', snip: true },
    { label: 'remove', kind: 'member', insert: 'remove(${1:k})', doc: '删除', snip: true }
  ],
  set: [
    { label: 'add', kind: 'member', insert: 'add(${1:x})', doc: '添加', snip: true },
    { label: 'contains', kind: 'member', insert: 'contains(${1:x})', doc: '是否存在', snip: true },
    { label: 'remove', kind: 'member', insert: 'remove(${1:x})', doc: '删除', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true },
    { label: 'isEmpty', kind: 'member', insert: 'isEmpty()', doc: '是否为空', snip: true },
    { label: 'iterator', kind: 'member', insert: 'iterator()', doc: '迭代器', snip: true }
  ],
  str: [
    { label: 'length', kind: 'member', insert: 'length()', doc: '长度', snip: true },
    { label: 'charAt', kind: 'member', insert: 'charAt(${1:i})', doc: '取字符', snip: true },
    { label: 'substring', kind: 'member', insert: 'substring(${1:begin}, ${2:end})', doc: '子串', snip: true },
    { label: 'indexOf', kind: 'member', insert: 'indexOf(${1:s})', doc: '首次位置', snip: true },
    { label: 'split', kind: 'member', insert: 'split("${1:\\\\s+}")', doc: '切分', snip: true },
    { label: 'toCharArray', kind: 'member', insert: 'toCharArray()', doc: '转字符数组', snip: true },
    { label: 'equals', kind: 'member', insert: 'equals(${1:other})', doc: '比较内容', snip: true },
    { label: 'compareTo', kind: 'member', insert: 'compareTo(${1:other})', doc: '字典序比较', snip: true },
    { label: 'startsWith', kind: 'member', insert: 'startsWith(${1:prefix})', doc: '前缀', snip: true },
    { label: 'endsWith', kind: 'member', insert: 'endsWith(${1:suffix})', doc: '后缀', snip: true },
    { label: 'replace', kind: 'member', insert: 'replace(${1:a}, ${2:b})', doc: '替换', snip: true },
    { label: 'trim', kind: 'member', insert: 'trim()', doc: '去首尾空白', snip: true },
    { label: 'toLowerCase', kind: 'member', insert: 'toLowerCase()', doc: '转小写', snip: true },
    { label: 'toUpperCase', kind: 'member', insert: 'toUpperCase()', doc: '转大写', snip: true },
    { label: 'valueOf', kind: 'member', insert: 'valueOf(${1:x})', doc: '静态：转字符串', snip: true }
  ],
  sb: [
    { label: 'append', kind: 'member', insert: 'append(${1:x})', doc: '追加', snip: true },
    { label: 'toString', kind: 'member', insert: 'toString()', doc: '转字符串', snip: true },
    { label: 'reverse', kind: 'member', insert: 'reverse()', doc: '反转', snip: true },
    { label: 'length', kind: 'member', insert: 'length()', doc: '长度', snip: true },
    { label: 'charAt', kind: 'member', insert: 'charAt(${1:i})', doc: '取字符', snip: true },
    { label: 'deleteCharAt', kind: 'member', insert: 'deleteCharAt(${1:i})', doc: '删除字符', snip: true }
  ],
  pq: [
    { label: 'offer', kind: 'member', insert: 'offer(${1:x})', doc: '入队', snip: true },
    { label: 'add', kind: 'member', insert: 'add(${1:x})', doc: '入队', snip: true },
    { label: 'poll', kind: 'member', insert: 'poll()', doc: '出队（堆顶）', snip: true },
    { label: 'peek', kind: 'member', insert: 'peek()', doc: '查看堆顶', snip: true },
    { label: 'isEmpty', kind: 'member', insert: 'isEmpty()', doc: '是否为空', snip: true },
    { label: 'size', kind: 'member', insert: 'size()', doc: '元素个数', snip: true }
  ],
  deque: [
    { label: 'addLast', kind: 'member', insert: 'addLast(${1:x})', doc: '尾部入队', snip: true },
    { label: 'addFirst', kind: 'member', insert: 'addFirst(${1:x})', doc: '头部入队', snip: true },
    { label: 'poll', kind: 'member', insert: 'poll()', doc: '头部出队', snip: true },
    { label: 'pollFirst', kind: 'member', doc: '头部出队' },
    { label: 'pollLast', kind: 'member', doc: '尾部出队' },
    { label: 'peek', kind: 'member', insert: 'peek()', doc: '查看队首', snip: true },
    { label: 'isEmpty', kind: 'member', insert: 'isEmpty()', doc: '是否为空', snip: true }
  ],
  listnode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'next', kind: 'member', doc: '下一个节点' }
  ],
  treenode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'left', kind: 'member', doc: '左子树' },
    { label: 'right', kind: 'member', doc: '右子树' }
  ]
}

const C_MEMBERS: Partial<Record<Recv, Raw[]>> = {
  list: [
    { label: 'val', kind: 'member', doc: '节点值（结构体成员）' },
    { label: 'next', kind: 'member', doc: '下一个节点' }
  ],
  listnode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'next', kind: 'member', doc: '下一个节点' }
  ],
  treenode: [
    { label: 'val', kind: 'member', doc: '节点值' },
    { label: 'left', kind: 'member', doc: '左子树' },
    { label: 'right', kind: 'member', doc: '右子树' }
  ]
}

const MEMBERS: Record<Language, Partial<Record<Recv, Raw[]>>> = {
  python: PY_MEMBERS, cpp: CPP_MEMBERS, java: JAVA_MEMBERS, c: C_MEMBERS
}

// ---------------------------------------------------------------- 轻量类型推断

function kindOfTypeString(type: string, lang: Language): Recv {
  const t = (type || '').replace(/\s+/g, '')
  const low = t.toLowerCase()
  if (low.includes('listnode')) return 'listnode'
  if (low.includes('treenode')) return 'treenode'
  // 容器必须在基本类型之前判断：Map<Integer,Integer> / unordered_map<int,int> 里都含有 "int"
  if (low.includes('priority_queue')) return 'pq'
  if (low.includes('stringbuilder')) return 'sb'
  if (/deque|queue</.test(low)) return 'deque'
  if (/vector|arraylist|linkedlist|list<|int\[|long\[|double\[|char\[|string\[/.test(low)) return 'list'
  if (/unordered_map|hashmap|treemap|linkedhashmap|map<|dict/.test(low)) return 'dict'
  if (/unordered_set|hashset|treeset|linkedhashset|set<|set\[/.test(low)) return 'set'
  if (low.includes('string') || low.includes('char*') || low === 'char') return 'str'
  if (t.includes('[]')) return 'list'
  if (/\b(bool|boolean|double|float|int|long|short|byte|number|size_t|integer)\b/.test(low)) return 'num'
  return 'unknown'
}

/** 从参数类型 + 代码里的声明，推断变量属于哪一类（用于 `x.` 成员补全） */
function inferKinds(lang: Language, code: string, problem: Problem | null): Map<string, Recv> {
  const out = new Map<string, Recv>()
  if (problem) {
    for (const p of problem.params || []) {
      if (!p?.name) continue
      const k = kindOfTypeString(p.type, lang)
      if (k !== 'unknown') out.set(p.name, k)
    }
  }

  const lines = code.split('\n')
  const declRe: Record<Language, RegExp[]> = {
    python: [
      /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(.+)$/,
      /^\s*([A-Za-z_]\w*),\s*([A-Za-z_]\w*)\s*=\s*(.+)$/
    ],
    cpp: [
      /^\s*(?:const\s+)?(?:auto|(?:unsigned\s+)?(?:long\s+)?long|int|double|float|bool|char|size_t|string|vector<[^>]*>|unordered_map<[^>]*>|unordered_set<[^>]*>|map<[^>]*>|set<[^>]*>|queue<[^>]*>|deque<[^>]*>|stack<[^>]*>|priority_queue<[^>]*>|pair<[^>]*>|ListNode\*|TreeNode\*)\s*([A-Za-z_]\w*)/,
      /^\s*auto\s*(?:\*|&)?\s*([A-Za-z_]\w*)\s*=\s*(.+)$/
    ],
    java: [
      /^\s*(?:final\s+)?(?:int|long|double|char|boolean|String|Integer|Long|Double|Character|Boolean|StringBuilder|int\[\]|long\[\]|double\[\]|char\[\]|List<[^>]*>|ArrayList<[^>]*>|LinkedList<[^>]*>|Map<[^>]*>|HashMap<[^>]*>|TreeMap<[^>]*>|Set<[^>]*>|HashSet<[^>]*>|TreeSet<[^>]*>|Queue<[^>]*>|Deque<[^>]*>|PriorityQueue<[^>]*>|ListNode|TreeNode|var)\s+([A-Za-z_]\w*)/,
      /^\s*(?:final\s+)?var\s+([A-Za-z_]\w*)\s*=\s*(.+)$/
    ],
    c: [
      /^\s*(?:const\s+)?(?:unsigned\s+)?(?:char|int|long|short|float|double|size_t|bool|struct\s+ListNode\s*\*|struct\s+TreeNode\s*\*|ListNode\s*\*|TreeNode\s*\*)\s*([A-Za-z_]\w*)/
    ]
  }

  const rhsKind = (rhs: string): Recv | null => {
    const r = rhs.trim()
    if (/^\[\s*\]/.test(r)) return 'list'
    if (/^\{\s*\}/.test(r)) return lang === 'python' ? 'dict' : null
    if (/^set\(\)/.test(r)) return 'set'
    if (/^deque\(/.test(r)) return 'deque'
    if (/^(defaultdict|Counter)\(/.test(r)) return 'dict'
    if (/^(["'])/.test(r)) return 'str'
    if (/^-?\d/.test(r)) return 'num'
    if (/^\[[^\]]*\]/.test(r) && lang === 'python') return 'list'
    if (/new\s+StringBuilder/.test(r)) return 'sb'
    if (/new\s+(HashMap|TreeMap|LinkedHashMap)/.test(r)) return 'dict'
    if (/new\s+(HashSet|TreeSet|LinkedHashSet)/.test(r)) return 'set'
    if (/new\s+PriorityQueue/.test(r)) return 'pq'
    if (/new\s+ArrayDeque/.test(r)) return 'deque'
    if (/new\s+(ArrayList|LinkedList)/.test(r)) return 'list'
    if (/new\s+int\s*\[/.test(r)) return 'list'
    if (/^ListNode\(/.test(r)) return 'listnode'
    if (/^TreeNode\(/.test(r)) return 'treenode'
    return null
  }

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, '')
    // name = expr 形式的别名（如 p = headA）
    const alias = /^[\s]*(?:[A-Za-z_][\w:<>,\s\[\]]*\s+)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*$/.exec(line)
    if (alias && out.has(alias[2])) { out.set(alias[1], out.get(alias[2])!); continue }

    for (const re of declRe[lang] || []) {
      const m = re.exec(line)
      if (!m) continue
      const name = m[1]
      const rhs = m[2] || ''
      if (lang === 'python' && m[2] && m[3]) {
        // a, b = expr：按右侧推断
        const k = rhsKind(m[3]) ?? 'unknown'
        out.set(m[1], k)
        if (m[2] && out.has(m[2])) out.set(m[1], out.get(m[2])!)
        if (m[2] && k !== 'unknown') out.set(m[2], k)
        break
      }
      // 声明行前缀本身能判断类型
      const declText = line.slice(0, line.indexOf(name))
      const byDecl = kindOfTypeString(declText, lang)
      const byRhs = rhs ? rhsKind(rhs) : null
      let k: Recv = byDecl !== 'unknown' && byDecl !== 'num' ? byDecl : (byRhs ?? byDecl)
      if (declText.includes('*') && /ListNode|TreeNode/.test(declText)) {
        k = /TreeNode/.test(declText) ? 'treenode' : 'listnode'
      }
      if (k !== 'unknown') out.set(name, k)
      break
    }
  }
  return out
}

// ---------------------------------------------------------------- 题目相关

let context: { problem: Problem | null } = { problem: null }

export function setCompletionProblem(problem: Problem | null) {
  context = { problem }
}

function starterSignature(lang: Language, problem: Problem): { line: string; params: { name: string; type: string }[] } | null {
  const code = problem.starters?.[lang]
  if (!code) return null
  const fn = problem.methodName
  for (const raw of code.split('\n')) {
    if (!raw.includes(fn + '(')) continue
    const line = raw.trim()
    const open = line.indexOf('(')
    const close = line.lastIndexOf(')')
    if (open < 0 || close < open) continue
    const inner = line.slice(open + 1, close)
    const style = lang === 'python' ? 'python' : 'c'
    const parts: string[] = []
    let depth = 0, cur = ''
    for (const ch of inner) {
      if (ch === '<' || ch === '[') depth++
      if (ch === '>' || ch === ']') depth--
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
      cur += ch
    }
    if (cur.trim()) parts.push(cur)
    const params: { name: string; type: string }[] = []
    for (let p of parts) {
      p = p.trim()
      if (!p) continue
      if (style === 'python') {
        const [namePart, ...typeParts] = p.split(':')
        const name = namePart.trim()
        if (!name || name === 'self' || name === '*') continue
        params.push({ name, type: typeParts.join(':').trim() })
      } else {
        const m = /([A-Za-z_]\w*)\s*(?:\[\s*\])?\s*$/.exec(p)
        if (!m) continue
        params.push({ name: m[1], type: p.slice(0, p.length - m[1].length).trim().replace(/[&*]+$/, '') })
      }
    }
    return { line, params }
  }
  return null
}

// ---------------------------------------------------------------- 注册

let registered = false

const KIND_OF: Record<RawKind, keyof typeof Monaco.languages.CompletionItemKind> = {
  keyword: 'Keyword',
  type: 'Class',
  fn: 'Function',
  member: 'Method',
  param: 'Variable',
  snippet: 'Snippet',
  const: 'Constant'
}

function kindOf(monaco: typeof Monaco, k: RawKind): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind as any
  return K[KIND_OF[k]]
}

const SORT_GROUP: Record<RawKind, string> = {
  param: '0', member: '1', snippet: '2', type: '3', fn: '4', keyword: '5', const: '3'
}

function toItem(monaco: typeof Monaco, raw: Raw, range: Monaco.IRange): Monaco.languages.CompletionItem {
  const insert = raw.insert ?? raw.label
  return {
    label: raw.snip && insert !== raw.label ? { label: raw.label, description: raw.detail } : raw.label,
    kind: kindOf(monaco, raw.kind),
    insertText: insert,
    insertTextRules: raw.snip ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    detail: raw.detail,
    documentation: raw.doc ? { value: raw.doc } : undefined,
    range,
    sortText: (raw.sort ?? SORT_GROUP[raw.kind]) + raw.label.toLowerCase()
  }
}

/** 题目相关补全：参数名 / 方法签名 / 结构体 */
function problemItems(monaco: typeof Monaco, lang: Language, code: string, range: Monaco.IRange): Monaco.languages.CompletionItem[] {
  const problem = context.problem
  if (!problem) return []
  const items: Monaco.languages.CompletionItem[] = []
  const sig = starterSignature(lang, problem)

  // 参数名（带真实类型）
  for (const p of sig?.params || []) {
    const decl = (problem.params || []).find((x) => x.name === p.name)
    const type = p.type || decl?.type || ''
    items.push({
      label: p.name,
      kind: kindOf(monaco, 'param'),
      insertText: p.name,
      detail: type || '题目参数',
      documentation: { value: `题目参数 \`${p.name}\`${type ? `：\`${type}\`` : ''}` },
      range,
      sortText: '0' + p.name.toLowerCase()
    })
  }

  // 完整方法签名（代码里还没有这个方法时更有用）
  if (sig) {
    const hasMethod = new RegExp('\\b' + problem.methodName + '\\s*\\(').test(code)
    const langLabel = lang === 'python' ? 'Python' : lang === 'java' ? 'Java' : lang === 'cpp' ? 'C++' : 'C'
    if (!hasMethod) {
      const body = lang === 'python' ? '\n        ${0:pass}' : '\n        ${0}'
      items.push({
        label: `${problem.methodName}(...)`,
        kind: kindOf(monaco, 'snippet'),
        insertText: sig.line + body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: `${langLabel} 方法签名（来自题目模板）`,
        documentation: { value: '```' + lang + '\n' + sig.line + '\n```' },
        range,
        sortText: '0aaa'
      })
    }
  }

  // 结构体字段（写 ListNode / TreeNode 时给提示）
  const structs: Raw[] = lang === 'c' ? [
    { label: 'struct ListNode', kind: 'type', insert: 'struct ListNode', doc: '字段 `val`、`next`' },
    { label: 'struct TreeNode', kind: 'type', insert: 'struct TreeNode', doc: '字段 `val`、`left`、`right`' }
  ] : [
    { label: 'ListNode', kind: 'type', detail: '链表节点', doc: '字段 `val`、`next`' },
    { label: 'TreeNode', kind: 'type', detail: '二叉树节点', doc: '字段 `val`、`left`、`right`' }
  ]
  for (const s of structs) {
    items.push({
      label: s.label, kind: kindOf(monaco, 'type'), insertText: s.insert ?? s.label,
      detail: s.detail, documentation: s.doc ? { value: s.doc } : undefined, range, sortText: '0' + s.label
    })
  }
  return items
}

export function registerCompletions(monaco: typeof Monaco) {
  if (registered) return
  registered = true

  const langs: { id: string; lang: Language }[] = [
    { id: 'python', lang: 'python' },
    { id: 'cpp', lang: 'cpp' },
    { id: 'c', lang: 'c' },
    { id: 'java', lang: 'java' }
  ]

  for (const { id, lang } of langs) {
    monaco.languages.registerCompletionItemProvider(id, {
      triggerCharacters: ['.', '>', ':'],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
        const code = model.getValue()

        // `recv.` / `recv->` → 只给成员
        const memberMatch = /([A-Za-z_]\w*)\s*(?:->|\.)\s*[\w]*$/.exec(line)
        if (memberMatch) {
          const kinds = inferKinds(lang, code, context.problem)
          const recv = kinds.get(memberMatch[1]) || 'unknown'
          const members = MEMBERS[lang][recv]
          if (members?.length) {
            const suggestions = members.map((m) => toItem(monaco, { ...m, kind: 'member', sort: '1' }, range))
            return { suggestions }
          }
          // 类型未知时不拦截：继续给通用补全（关键字 / 类型 / 片段）
        }

        const suggestions: Monaco.languages.CompletionItem[] = [
          ...problemItems(monaco, lang, code, range),
          ...BASE[lang].map((r) => toItem(monaco, r, range))
        ]
        return { suggestions }
      }
    })

    // 签名提示：输入当前题目方法名 + "(" 时显示参数
    monaco.languages.registerSignatureHelpProvider(id, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp(model, position) {
        const problem = context.problem
        if (!problem) return null
        const sig = starterSignature(lang, problem)
        if (!sig) return null
        const before = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column))
        const idx = before.lastIndexOf(problem.methodName + '(')
        if (idx < 0) return null
        const after = before.slice(idx + problem.methodName.length + 1)
        if (/[)]/.test(after)) return null
        const active = Math.min((after.match(/,/g) || []).length, sig.params.length - 1)
        const label = `${problem.methodName}(${sig.params.map((p) => `${p.name}${p.type ? ': ' + p.type : ''}`).join(', ')})`
        return {
          value: {
            signatures: [{
              label,
              documentation: { value: `题目「${problem.title}」的方法签名` },
              parameters: sig.params.map((p) => ({ label: p.type ? `${p.name}: ${p.type}` : p.name }))
            }],
            activeSignature: 0,
            activeParameter: Math.max(active, 0)
          },
          dispose() {}
        }
      }
    })

    // 悬停说明
    monaco.languages.registerHoverProvider(id, {
      provideHover(model, position) {
        const word = model.getWordAtPosition(position)
        if (!word) return null
        const problem = context.problem
        if (!problem) return null
        const sig = starterSignature(lang, problem)
        const param = sig?.params.find((p) => p.name === word.word)
        if (param) {
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `**${param.name}**${param.type ? ` \`${param.type}\`` : ''}` },
              { value: '题目参数（LeetCode 判题时会传入）' }
            ]
          }
        }
        if (word.word === 'ListNode' || word.word === 'TreeNode') {
          const fields = word.word === 'ListNode' ? '`val`、`next`' : '`val`、`left`、`right`'
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [{ value: `**${word.word}**（平台提供的结构体）` }, { value: `字段：${fields}` }]
          }
        }
        return null
      }
    })
  }
}
