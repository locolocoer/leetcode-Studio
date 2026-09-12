// Generates per-language wrapper ("main") files that drive a user's LeetCode
// solution against test-case input, printing the result as JSON on stdout.
//
// Input contract (written to the child's stdin, one piece per line):
//   function mode: one JSON value per parameter, e.g.
//       [2,7,11,15]
//       9
//   class mode: line 1 = operations JSON array, line 2+ = arguments array-of-arrays
//       ["LRUCache","get","put"]
//       [[2],[1],[5]]
//
// Output contract: a single JSON value printed on stdout (the method return, or
// the array of method returns for class mode).

import type { Language, Method, Problem } from '../shared/types'
import { parseType, type Shape } from './types'

const NAME = 'Solution' // default class name for function-mode problems

export interface GeneratedFile {
  name: string
  content: string
}

export interface Harness {
  // files to write into the session dir (including the user's solution)
  files: GeneratedFile[]
  solutionFile: string
  // compile command (passed on to the runner) or null if no compilation needed
  compile?: { cmd: string; args: string[] }
  // run command
  run: { cmd: string; args: string[] }
  className: string
}

function classNameFor(problem: Problem): string {
  return problem.judgeType === 'class' ? problem.methodName : NAME
}

// ---- 手动判题：相交链表模式（intersectVal/listA/listB/skipA/skipB） ----
// 兼容旧数据：manualParams 缺失时回退到 params（早期拉取的题目参数里就混着判题字段）
function manualSource(problem: Problem): { name: string; type: string }[] {
  if (problem.manualParams && problem.manualParams.length) return problem.manualParams
  return problem.params || []
}
function hasParam(problem: Problem, name: string): boolean {
  return manualSource(problem).some((p) => p.name === name)
}
function isIntersectProblem(problem: Problem): boolean {
  return hasParam(problem, 'intersectVal') && hasParam(problem, 'listA') &&
    hasParam(problem, 'listB') && hasParam(problem, 'skipA') && hasParam(problem, 'skipB')
}
function manualIndex(problem: Problem, name: string): number {
  const i = manualSource(problem).findIndex((p) => p.name === name)
  return i >= 0 ? i : 0
}

// 供调试驱动使用：相交链表模式的各字段在输入中的下标
export function intersectIndices(problem: Problem): { iv: number; lA: number; lB: number; sa: number; sb: number } | null {
  if (!isIntersectProblem(problem)) return null
  return {
    iv: manualIndex(problem, 'intersectVal'),
    lA: manualIndex(problem, 'listA'),
    lB: manualIndex(problem, 'listB'),
    sa: manualIndex(problem, 'skipA'),
    sb: manualIndex(problem, 'skipB')
  }
}

// ---------------------------------------------------------------------------
// 「按值引用的节点参数」——二叉树最近公共祖先这类题
//
// LeetCode 的元数据里 p/q 写的是 integer、测试用例给的是节点值（如 "5"），
// 但真实签名是 TreeNode*（题目要求传入树里的那个节点）。本地判题必须：
//   1) 先由前面的树参数建出整棵树；
//   2) 在树里按值找到对应节点，把指针传进去；
//   3) 返回值也是「节点引用」时，按节点值（而不是整棵树）比较。
// 这里解析用户真实签名来判断哪些参数属于这种情况。
// ---------------------------------------------------------------------------

export interface NodeRefParam {
  index: number
  kind: 'tree' | 'linkedlist'
  /** 用来查找节点的「节点池」参数下标（前面第一个同类型参数） */
  pool: number
}

/** 把顶层逗号分隔开（忽略括号/尖括号/引号内部的逗号） */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let inStr: string | null = null
  for (const c of s) {
    if (inStr) {
      cur += c
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** 从源码里解析函数签名，返回各参数的类型文本（不含参数名） */
export function declaredParamTypes(
  sourceCode: string,
  language: Language,
  methodName: string
): string[] | null {
  const src = sourceCode || ''
  const idx = methodName ? src.indexOf(methodName) : -1
  if (idx < 0) return null
  const open = src.indexOf('(', idx + methodName.length)
  if (open < 0) return null
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return null
  const inner = src.slice(open + 1, end)
  const out: string[] = []
  for (const raw of splitTopLevel(inner)) {
    let p = raw.trim()
    if (!p) continue
    if (language === 'python') {
      if (/^self$/.test(p)) continue
      const ci = p.indexOf(':')
      if (ci < 0) { out.push(''); continue }
      out.push(p.slice(ci + 1).replace(/=.*$/, '').replace(/['"]/g, '').trim())
      continue
    }
    // C / C++ / Java：去掉默认值，再去掉末尾的参数名
    p = p.replace(/=.*$/, '').trim()
    const m = /^(.*?)\b([A-Za-z_]\w*)\s*(\[\s*\])?$/.exec(p)
    const type = (m ? m[1] : p).trim()
    out.push(type || p)
  }
  return out
}

/** 元数据说是标量、但真实签名是节点指针的参数 */
export function nodeRefParams(
  problem: Problem,
  sourceCode: string,
  language: Language
): NodeRefParam[] {
  if (problem.judgeType !== 'function') return []
  const params = problem.params || []
  const declared = declaredParamTypes(sourceCode, language, problem.methodName || '')
  if (!declared) return []
  const out: NodeRefParam[] = []
  for (let i = 0; i < params.length; i++) {
    if (parseType(params[i].type).kind !== 'scalar') continue
    const d = declared[i] || ''
    if (!/TreeNode|ListNode/.test(d)) continue
    const kind: 'tree' | 'linkedlist' = /TreeNode/.test(d) ? 'tree' : 'linkedlist'
    let pool = -1
    for (let j = 0; j < i; j++) {
      if (parseType(params[j].type).kind === kind) { pool = j; break }
    }
    if (pool < 0) continue
    out.push({ index: i, kind, pool })
  }
  return out
}

/** 返回值是「节点引用」而不是整棵树/链表：测试期望值是标量（如 LCA 返回节点值） */
export function nodeValueReturn(problem: Problem): boolean {
  const rs = parseType(problem.returnType || '')
  if (rs.kind !== 'tree' && rs.kind !== 'linkedlist') return false
  const exps = (problem.tests || [])
    .map((t) => String(t.expected ?? '').trim())
    .filter((e) => e !== '')
  if (!exps.length) return false
  return exps.every((e) => /^(null|-?\d+)$/.test(e))
}

// ---------- Python ----------

// LeetCode Python 的 ListNode / TreeNode 由平台提供，本地需要自己构造。
// 运行与调试两条路径共用这段代码：把 JSON 输入转成节点对象，把返回值转回列表比较。
export const PY_NODES = `
class ListNode(object):
    def __init__(self, x=0, nxt=None):
        self.val = x
        self.next = nxt


class TreeNode(object):
    def __init__(self, x=0, left=None, right=None):
        self.val = x
        self.left = left
        self.right = right


def _lc_ll(arr):
    d = ListNode()
    c = d
    for v in (arr or []):
        c.next = ListNode(v)
        c = c.next
    return d.next


def _lc_tree(arr):
    if not arr or arr[0] is None:
        return None
    root = TreeNode(arr[0])
    q = [root]
    i = 1
    while q and i < len(arr):
        n = q.pop(0)
        if i < len(arr) and arr[i] is not None:
            n.left = TreeNode(arr[i])
            q.append(n.left)
        i += 1
        if i < len(arr) and arr[i] is not None:
            n.right = TreeNode(arr[i])
            q.append(n.right)
        i += 1
    return root


def _lc_load(args, shapes):
    out = []
    for i, a in enumerate(args):
        k = shapes[i] if i < len(shapes) else ""
        if k == "ll":
            out.append(_lc_ll(a))
        elif k == "tree":
            out.append(_lc_tree(a))
        elif k.startswith("ll@"):
            out.append(_lc_find_ll(out[int(k[3:])], a))
        elif k.startswith("tree@"):
            out.append(_lc_find_tree(out[int(k[5:])], a))
        else:
            out.append(a)
    return out


# 按值引用的节点（LCA 这类题：测试给的是节点值，需要拿出树里对应的那个节点）
def _lc_find_tree(root, v):
    if root is None:
        return None
    q = [root]
    while q:
        n = q.pop(0)
        if n.val == v:
            return n
        if n.left is not None:
            q.append(n.left)
        if n.right is not None:
            q.append(n.right)
    return None


def _lc_find_ll(head, v):
    while head is not None:
        if head.val == v:
            return head
        head = head.next
    return None


def _lc_dump(v):
    if isinstance(v, ListNode):
        out = []
        while v is not None:
            out.append(v.val)
            v = v.next
        return out
    if isinstance(v, TreeNode):
        out = []
        q = [v]
        while q:
            n = q.pop(0)
            if n is None:
                out.append(None)
            else:
                out.append(n.val)
                q.append(n.left)
                q.append(n.right)
        while out and out[-1] is None:
            out.pop()
        return out
    return v


def _lc_bind_nodes(sol):
    global ListNode, TreeNode
    c = getattr(sol, "ListNode", None)
    if c is not None:
        ListNode = c
    else:
        sol.ListNode = ListNode
    c = getattr(sol, "TreeNode", None)
    if c is not None:
        TreeNode = c
    else:
        sol.TreeNode = TreeNode
`

// 每个参数对应的节点构造方式（ll=链表, tree=二叉树, ll@n/tree@n=从第 n 个参数里按值找节点, 空=原样传入）
export function pyShapes(problem: Problem, sourceCode = ''): string[] {
  const refs = new Map(
    nodeRefParams(problem, sourceCode, 'python').map((r) => [r.index, r])
  )
  return (problem.params || []).map((p, i) => {
    const nr = refs.get(i)
    if (nr) return (nr.kind === 'tree' ? 'tree@' : 'll@') + nr.pool
    const s = parseType(p.type)
    return s.kind === 'linkedlist' ? 'll' : s.kind === 'tree' ? 'tree' : ''
  })
}

// 返回值是链表/二叉树？（空结果需要序列化成 [] 而不是 null）
export function isNodeReturn(problem: Problem): boolean {
  const s = parseType(problem.returnType || '')
  return s.kind === 'linkedlist' || s.kind === 'tree'
}

// 把一段 Python 代码整体缩进（调试驱动里整段代码位于函数体内）
export function pyIndent(code: string, n = 4): string {
  const pad = ' '.repeat(n)
  return code
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n')
}


function pythonHarness(problem: Problem, sourceCode: string, className: string): Harness {
  const fn = problem.methodName
  const files: GeneratedFile[] = [
    { name: 'solution.py', content: sourceCode }
  ]
  // embeddable python（内置精简版）sys.path 受限，显式加入脚本目录
  const boot = `import sys, os\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n`
  let main: string
  if (problem.judgeType === 'class') {
    const methods = problem.methods ?? []
    main = `${boot}import json, sys
from solution import ${className}

def main():
    raw = sys.stdin.read()
    lines = [l for l in raw.split('\\n') if l.strip() != '']
    ops = json.loads(lines[0])
    argsets = json.loads(lines[1]) if len(lines) > 1 else []
    obj = ${className}(*argsets[0])
    out = [None]
    for i in range(1, len(ops)):
        r = getattr(obj, ops[i])(*argsets[i])
        out.append(r)
    print(json.dumps(out, ensure_ascii=False, default=lambda o: None))

main()
`
  } else if (isIntersectProblem(problem)) {
    const iA = manualIndex(problem, 'intersectVal')
    const iL = manualIndex(problem, 'listA')
    const iB = manualIndex(problem, 'listB')
    const iSA = manualIndex(problem, 'skipA')
    const iSB = manualIndex(problem, 'skipB')
    main = `${boot}import json, sys

class ListNode(object):
    def __init__(self, x=0):
        self.val = x
        self.next = None

import solution as _sol
_sol.ListNode = ListNode
from solution import ${className}

def _build(arr):
    dummy = ListNode()
    cur = dummy
    for v in arr:
        cur.next = ListNode(v)
        cur = cur.next
    return dummy.next

def main():
    raw = sys.stdin.read()
    L = [l for l in raw.split('\\n') if l.strip() != '']
    iv = json.loads(L[${iA}])
    A = json.loads(L[${iL}])
    B = json.loads(L[${iB}])
    sa = json.loads(L[${iSA}])
    sb = json.loads(L[${iSB}])
    headA = _build(A)
    if iv != 0:
        shared = headA
        for _ in range(sa):
            if shared is not None:
                shared = shared.next
        if sb <= 0:
            headB = shared
        else:
            headB = _build(B)
            t = headB
            for _ in range(sb - 1):
                if t is not None:
                    t = t.next
            if t is not None:
                t.next = shared
    else:
        headB = _build(B)
    r = ${className}().${fn}(headA, headB)
    print(json.dumps(r.val if r else 0))

main()
`
  } else {
    const retShape = parseType(problem.returnType || '')
    const retNode = retShape.kind === 'linkedlist' || retShape.kind === 'tree'
    main = `${boot}import json, sys
from solution import ${className}
${PY_NODES}
_lc_bind_nodes(sys.modules["solution"])
_SHAPES = json.loads(${JSON.stringify(JSON.stringify(pyShapes(problem, sourceCode)))})
_RET_NODE = ${retNode ? 'True' : 'False'}
_RET_NODE_VALUE = ${nodeValueReturn(problem) ? 'True' : 'False'}

def main():
    raw = sys.stdin.read()
    lines = [l for l in raw.split('\\n') if l.strip() != '']
    args = _lc_load([json.loads(l) for l in lines], _SHAPES)
    sol = ${className}()
    result = sol.${fn}(*args)
    if _RET_NODE_VALUE:
        # 返回的是「树里的某个节点」（如最近公共祖先）：比节点值而不是整棵树
        print("null" if result is None else json.dumps(result.val))
        return
    if result is None and _RET_NODE:
        result = []
    print(json.dumps(_lc_dump(result), ensure_ascii=False, default=lambda o: None))

main()
`
  }
  files.push({ name: 'main.py', content: main })
  return {
    files,
    solutionFile: 'solution.py',
    run: { cmd: 'python', args: ['main.py'] },
    className
  }
}

// ---------- Java ----------

// A shared JSON utility with typed converters, embedded into every Java harness.
const JAVA_JSON_UTIL = `
import java.util.*;
import java.lang.reflect.*;

class Json {
  static Object parse(String s) {
    int[] i = {0};
    Object v = value(s, i);
    return v;
  }
  static Object value(String s, int[] i) {
    char c = s.charAt(i[0]);
    while (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') { c = s.charAt(++i[0]); }
    if (c == '[') return array(s, i);
    if (c == '{') return object(s, i);
    if (c == '"') return str(s, i);
    if (c == 't' || c == 'f') return bool(s, i);
    if (c == 'n') { i[0] += 4; return null; }
    return num(s, i);
  }
  static Object array(String s, int[] i) {
    List<Object> l = new ArrayList<>();
    i[0]++; // [
    char c = s.charAt(i[0]);
    while (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') { c = s.charAt(++i[0]); }
    if (c == ']') { i[0]++; return l; }
    while (true) {
      l.add(value(s, i));
      c = s.charAt(i[0]);
      while (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') { c = s.charAt(++i[0]); }
      if (c == ']') { i[0]++; return l; }
      i[0]++; // ,
    }
  }
  static Object object(String s, int[] i) {
    Map<String,Object> m = new LinkedHashMap<>();
    i[0]++; // {
    char c = s.charAt(i[0]);
    while (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') { c = s.charAt(++i[0]); }
    if (c == '}') { i[0]++; return m; }
    while (true) {
      String k = (String) str(s, i);
      i[0]++; // :
      m.put(k, value(s, i));
      c = s.charAt(i[0]);
      while (c == ' ' || c == '\\t' || c == '\\n' || c == '\\r') { c = s.charAt(++i[0]); }
      if (c == '}') { i[0]++; return m; }
      i[0]++; // ,
    }
  }
  static Object str(String s, int[] i) {
    StringBuilder b = new StringBuilder();
    i[0]++; // "
    while (true) {
      char c = s.charAt(i[0]);
      if (c == '\\\\') {
        i[0]++;
        char e = s.charAt(i[0]);
        if (e == 'n') b.append('\\n'); else if (e == 't') b.append('\\t'); else b.append(e);
      } else if (c == '"') { i[0]++; break; }
      else b.append(c);
      i[0]++;
    }
    return b.toString();
  }
  static Object bool(String s, int[] i) {
    if (s.startsWith("true", i[0])) { i[0] += 4; return Boolean.TRUE; }
    i[0] += 5; return Boolean.FALSE;
  }
  static Object num(String s, int[] i) {
    int start = i[0];
    while (i[0] < s.length() && ("-+.0123456789eE".indexOf(s.charAt(i[0])) >= 0)) i[0]++;
    String t = s.substring(start, i[0]);
    if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) return Double.parseDouble(t);
    return (long) Long.parseLong(t);
  }
  public static int toInt(Object o) { return ((Number)o).intValue(); }
  // node referenced by value: locate the node with this value (LCA-style problems)
  public static TreeNode findTreeNode(TreeNode root, int v) {
    if (root == null) return null;
    Deque<TreeNode> q = new ArrayDeque<>();
    q.add(root);
    while (!q.isEmpty()) {
      TreeNode n = q.poll();
      if (n.val == v) return n;
      if (n.left != null) q.add(n.left);
      if (n.right != null) q.add(n.right);
    }
    return null;
  }
  public static ListNode findListNode(ListNode head, int v) {
    while (head != null) { if (head.val == v) return head; head = head.next; }
    return null;
  }
  public static long toLong(Object o) { return ((Number)o).longValue(); }
  public static double toDouble(Object o) { return ((Number)o).doubleValue(); }
  public static boolean toBool(Object o) { return o instanceof Boolean ? (Boolean)o : ((Number)o).intValue() != 0; }
  public static String toStr(Object o) { return o == null ? null : o.toString(); }
  public static int[] toIntArray(Object o) {
    List<?> l = (List<?>) o; int[] r = new int[l.size()];
    for (int k = 0; k < l.size(); k++) r[k] = ((Number)l.get(k)).intValue(); return r;
  }
  public static long[] toLongArray(Object o) {
    List<?> l = (List<?>) o; long[] r = new long[l.size()];
    for (int k = 0; k < l.size(); k++) r[k] = ((Number)l.get(k)).longValue(); return r;
  }
  public static double[] toDoubleArray(Object o) {
    List<?> l = (List<?>) o; double[] r = new double[l.size()];
    for (int k = 0; k < l.size(); k++) r[k] = ((Number)l.get(k)).doubleValue(); return r;
  }
  public static boolean[] toBoolArray(Object o) {
    List<?> l = (List<?>) o; boolean[] r = new boolean[l.size()];
    for (int k = 0; k < l.size(); k++) r[k] = toBool(l.get(k)); return r;
  }
  public static String[] toStrArray(Object o) {
    List<?> l = (List<?>) o; String[] r = new String[l.size()];
    for (int k = 0; k < l.size(); k++) r[k] = toStr(l.get(k)); return r;
  }
  public static int[][] toIntMatrix(Object o) {
    List<?> l = (List<?>) o; int[][] r = new int[l.size()][];
    for (int k = 0; k < l.size(); k++) r[k] = toIntArray(l.get(k)); return r;
  }
  public static String[][] toStrMatrix(Object o) {
    List<?> l = (List<?>) o; String[][] r = new String[l.size()][];
    for (int k = 0; k < l.size(); k++) r[k] = toStrArray(l.get(k)); return r;
  }
  public static double[][] toDoubleMatrix(Object o) {
    List<?> l = (List<?>) o; double[][] r = new double[l.size()][];
    for (int k = 0; k < l.size(); k++) r[k] = toDoubleArray(l.get(k)); return r;
  }
  public static List<List<Integer>> toIntListMatrix(Object o) {
    List<?> l = (List<?>) o; List<List<Integer>> r = new ArrayList<>();
    for (Object x : l) { List<?> row = (List<?>) x; List<Integer> rr = new ArrayList<>();
      for (Object y : row) rr.add(((Number)y).intValue()); r.add(rr); } return r;
  }
  public static List<Integer> toIntList(Object o) {
    List<?> l = (List<?>) o; List<Integer> r = new ArrayList<>();
    for (Object x : l) r.add(((Number)x).intValue()); return r;
  }
  public static List<String> toStrList(Object o) {
    List<?> l = (List<?>) o; List<String> r = new ArrayList<>();
    for (Object x : l) r.add(toStr(x)); return r;
  }
  // ---- serializers ----
  public static String ser(Object o) {
    if (o == null) return "null";
    if (o instanceof Long || o instanceof Integer || o instanceof Short || o instanceof Byte) return o.toString();
    if (o instanceof Double || o instanceof Float) { double d = ((Number)o).doubleValue();
      if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf((long)d); return String.valueOf(d); }
    if (o instanceof Boolean) return o.toString();
    if (o instanceof String) { StringBuilder b = new StringBuilder("\\""); String s = (String)o;
      for (char c : s.toCharArray()) { if (c == '"' || c == '\\\\') b.append('\\\\'); b.append(c); } b.append('\\"'); return b.toString(); }
    if (o instanceof int[]) { int[] a = (int[])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(a[i]); } return b.append("]").toString(); }
    if (o instanceof long[]) { long[] a = (long[])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(a[i]); } return b.append("]").toString(); }
    if (o instanceof double[]) { double[] a = (double[])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(ser(a[i])); } return b.append("]").toString(); }
    if (o instanceof boolean[]) { boolean[] a = (boolean[])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(a[i]); } return b.append("]").toString(); }
    if (o instanceof String[]) { String[] a = (String[])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(ser(a[i])); } return b.append("]").toString(); }
    if (o instanceof int[][]) { int[][] a = (int[][])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(ser(a[i])); } return b.append("]").toString(); }
    if (o instanceof String[][]) { String[][] a = (String[][])o; StringBuilder b = new StringBuilder("["); for (int i=0;i<a.length;i++){ if(i>0)b.append(","); b.append(ser(a[i])); } return b.append("]").toString(); }
    if (o instanceof List) { List<?> l = (List<?>)o; StringBuilder b = new StringBuilder("["); for (int i=0;i<l.size();i++){ if(i>0)b.append(","); b.append(ser(l.get(i))); } return b.append("]").toString(); }
    if (o instanceof Map) { Map<?,?> m = (Map<?,?>)o; StringBuilder b = new StringBuilder("{"); boolean f=true; for (Map.Entry<?,?> e : m.entrySet()){ if(!f)b.append(","); f=false; b.append(ser(e.getKey().toString())).append(":").append(ser(e.getValue())); } return b.append("}").toString(); }
    return "null";
  }
}

class ListNode {
  int val; ListNode next;
  ListNode() {} ListNode(int val) { this.val = val; }
  ListNode(int val, ListNode next) { this.val = val; this.next = next; }
  static ListNode from(Object o) {
    List<?> l = (List<?>) o; ListNode dummy = new ListNode(0); ListNode cur = dummy;
    for (Object x : l) { cur.next = new ListNode(((Number)x).intValue()); cur = cur.next; }
    return dummy.next;
  }
  static Object to(Object o) {
    ListNode h = (ListNode) o; List<Integer> r = new ArrayList<>();
    while (h != null) { r.add(h.val); h = h.next; } return r;
  }
}

class TreeNode {
  int val; TreeNode left; TreeNode right;
  TreeNode() {} TreeNode(int val) { this.val = val; }
  TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }
  static TreeNode from(Object o) {
    if (o == null) return null;
    List<?> l = (List<?>) o;
    if (l.isEmpty()) return null;
    if (l.get(0) == null) return null;
    TreeNode root = new TreeNode(((Number)l.get(0)).intValue());
    Queue<TreeNode> q = new LinkedList<>(); q.offer(root);
    int i = 1;
    while (i < l.size() && !q.isEmpty()) {
      TreeNode p = q.poll();
      if (i < l.size() && l.get(i) != null) { p.left = new TreeNode(((Number)l.get(i)).intValue()); q.offer(p.left); }
      i++;
      if (i < l.size() && l.get(i) != null) { p.right = new TreeNode(((Number)l.get(i)).intValue()); q.offer(p.right); }
      i++;
    }
    return root;
  }
  static Object to(Object o) {
    TreeNode r = (TreeNode) o; List<Object> out = new ArrayList<>();
    Queue<TreeNode> q = new LinkedList<>(); q.offer(r);
    while (!q.isEmpty()) {
      TreeNode p = q.poll();
      if (p == null) { out.add(null); }
      else { out.add(p.val); q.offer(p.left); q.offer(p.right); }
    }
    while (!out.isEmpty() && out.get(out.size()-1) == null) out.remove(out.size()-1);
    return out;
  }
}
`

function javaHarness(problem: Problem, sourceCode: string, className: string): Harness {
  const methods = problem.judgeType === 'class' ? problem.methods ?? [] : []
  const fnName = problem.methodName
  const files: GeneratedFile[] = [{ name: className + '.java', content: sourceCode }]

  const argCall = (idx: number, shape: Shape): string => javaLoadFrom(shape, `args.get(${idx})`)

  let mainBody: string
  if (problem.judgeType === 'class') {
    const ctorParams = problem.constructorParams ?? []
    const ctorArgs = ctorParams.map((p, i) => javaLoadFrom(parseType(p.type), `argv.get(0).get(${i})`)).join(', ')
    const dispatch = methods
      .map((m) => {
        const margs = m.params.map((p, pi) => javaLoadFrom(parseType(p.type), `argv.get(i).get(${pi})`)).join(', ')
        const isVoid = !m.returnType || m.returnType === 'void'
        const body = isVoid
          ? `{ obj.${m.name}(${margs}); out.add(Json.ser(null)); }`
          : `out.add(Json.ser(obj.${m.name}(${margs})));`
        return `if (op.equals(${JSON.stringify(m.name)})) { ${body} }`
      })
      .join(' else ')
    mainBody = `
    String raw = new String(System.in.readAllBytes());
    String[] lines = raw.split("\\n");
    String opsRaw = lines[0];
    List<Object> ops = (List<Object>) Json.parse(opsRaw);
    List<List<Object>> argv = new ArrayList<>();
    if (lines.length > 1 && !lines[1].trim().isEmpty()) argv = (List<List<Object>>) Json.parse(lines[1]);
    ${className} obj = new ${className}(${ctorArgs});
    List<Object> out = new ArrayList<>();
    out.add(Json.ser(null));
    for (int i = 1; i < ops.size(); i++) {
      String op = (String) ops.get(i);
      ${dispatch}
    }
    System.out.println("[" + String.join(",", out.stream().map(x -> x.toString()).toList()) + "]");
`
  } else if (isIntersectProblem(problem)) {
    const iA = manualIndex(problem, 'intersectVal')
    const iL = manualIndex(problem, 'listA')
    const iB = manualIndex(problem, 'listB')
    const iSA = manualIndex(problem, 'skipA')
    const iSB = manualIndex(problem, 'skipB')
    mainBody = `
    String raw = new String(System.in.readAllBytes());
    String[] lines = raw.split("\\\\n");
    List<String> L = new ArrayList<>();
    for (String l : lines) { if (!l.trim().isEmpty()) L.add(l.trim()); }
    int iv = Json.toInt(Json.parse(L.get(${iA})));
    List<Object> A = (List<Object>) Json.parse(L.get(${iL}));
    List<Object> B = (List<Object>) Json.parse(L.get(${iB}));
    int sa = Json.toInt(Json.parse(L.get(${iSA})));
    int sb = Json.toInt(Json.parse(L.get(${iSB})));
    ListNode headA = ListNode.from(A);
    ListNode headB;
    if (iv != 0) {
      ListNode shared = headA;
      for (int k = 0; k < sa && shared != null; k++) shared = shared.next;
      if (sb <= 0) { headB = shared; }
      else {
        headB = ListNode.from(B.subList(0, Math.min(sb, B.size())));
        ListNode t = headB;
        for (int k = 0; k < sb - 1 && t != null; k++) t = t.next;
        if (t != null) t.next = shared;
      }
    } else {
      headB = ListNode.from(B);
    }
    ${className} obj = new ${className}();
    ListNode r = obj.${fnName}(headA, headB);
    System.out.println(r == null ? "0" : String.valueOf(r.val));
`
  } else {
    const params = problem.params
    const refs = new Map(nodeRefParams(problem, sourceCode, 'java').map((r) => [r.index, r]))
    const declared = declaredParamTypes(sourceCode, 'java', problem.methodName || '') || []
    const lds = params.map((p, i) => {
      const nr = refs.get(i)
      const t = (declared[i] || '').trim() || 'Object'
      if (nr) {
        const finder = nr.kind === 'tree' ? 'Json.findTreeNode' : 'Json.findListNode'
        return `    ${t} _a${i} = ${finder}(_a${nr.pool}, Json.toInt(a.get(${i})));`
      }
      return `    ${t} _a${i} = ${javaLoadFrom(parseType(p.type), `a.get(${i})`)};`
    }).join('\n')
    const args = params.map((_, i) => `_a${i}`).join(', ')
    mainBody = `
    String raw = new String(System.in.readAllBytes());
    String[] lines = raw.split("\\n");
    List<Object> a = new ArrayList<>();
    for (String l : lines) { if (!l.trim().isEmpty()) a.add(Json.parse(l)); }
    ${className} obj = new ${className}();
${lds}
    Object result = obj.${fnName}(${args});
${nodeValueReturn(problem)
  ? '    if (result == null) System.out.println("null"); else System.out.println(Json.ser(((TreeNode) result).val));'
  : '    System.out.println(Json.ser(result));'}
`
  }

  const main = `public class Main {
  public static void main(String[] args) throws Exception {
${mainBody}
  }
}
`
  files.push({ name: 'Main.java', content: JAVA_JSON_UTIL + '\n' + main })
  return {
    files,
    solutionFile: className + '.java',
    compile: { cmd: 'javac', args: ['-encoding', 'UTF-8', className + '.java', 'Main.java'] },
    run: { cmd: 'java', args: ['Main'] },
    className
  }
}

function javaLoadFrom(shape: Shape, expr: string): string {
  switch (shape.kind) {
    case 'scalar':
      switch (shape.base) {
        case 'int': return `Json.toInt(${expr})`
        case 'double': return `Json.toDouble(${expr})`
        case 'bool': return `Json.toBool(${expr})`
        case 'string': return `Json.toStr(${expr})`
      }
      break
    case 'list': {
      const inner: Shape = shape.item
      if (inner.kind === 'scalar') {
        switch (inner.base) {
          case 'int': return `Json.toIntArray(${expr})`
          case 'double': return `Json.toDoubleArray(${expr})`
          case 'bool': return `Json.toBoolArray(${expr})`
          case 'string': return `Json.toStrArray(${expr})`
        }
      }
      if (inner.kind === 'list') {
        const inn: Shape = inner.item
        if (inn.kind === 'scalar') {
          switch (inn.base) {
            case 'int': return `Json.toIntMatrix(${expr})`
            case 'string': return `Json.toStrMatrix(${expr})`
            case 'double': return `Json.toDoubleMatrix(${expr})`
          }
        }
        return `Json.toIntListMatrix(${expr})`
      }
      return `Json.toIntList(${expr})`
    }
    case 'linkedlist':
      return `ListNode.from(${expr})`
    case 'tree':
      return `TreeNode.from(${expr})`
    case 'nestedinteger':
      return 'null'
  }
  return `Json.toStr(${expr})`
}

// ---------- C++ ----------

const CPP_PREAMBLE = `
#include <bits/stdc++.h>
using namespace std;

struct JVal {
  enum T { NUL, BOOL, NUM, STR, ARR } t = NUL;
  bool b = false; double num = 0; string str; vector<JVal> arr;
  static JVal parse(const string& s, size_t& i) {
    JVal v;
    while (i < s.size() && (s[i]==' '||s[i]=='\\t'||s[i]=='\\n'||s[i]=='\\r')) i++;
    char c = s[i];
    if (c == '[') {
      v.t = ARR; i++;
      while (true) {
        while (i < s.size() && (s[i]==' '||s[i]=='\\t'||s[i]=='\\n'||s[i]=='\\r')) i++;
        if (s[i] == ']') { i++; break; }
        v.arr.push_back(parse(s, i));
        while (i < s.size() && (s[i]==' '||s[i]=='\\t'||s[i]=='\\n'||s[i]=='\\r')) i++;
        if (s[i] == ',') i++;
      }
    } else if (c == '"') {
      v.t = STR; i++;
      while (i < s.size() && s[i] != '"') {
        if (s[i] == '\\\\') { i++; char e = s[i]; v.str += (e=='n'?'\\n':e); }
        else v.str += s[i];
        i++;
      }
      i++; // closing quote
    } else if (c == 't' || c == 'f') {
      v.t = BOOL; 
      if (s.compare(i, 4, "true") == 0) { v.b = true; i += 4; } else { v.b = false; i += 5; }
    } else if (c == 'n') { v.t = NUL; i += 4; }
    else {
      v.t = NUM; size_t start = i;
      while (i < s.size() && (isdigit(s[i]) || s[i]=='-' || s[i]=='+' || s[i]=='.' || s[i]=='e' || s[i]=='E')) i++;
      v.num = stod(s.substr(start, i-start));
    }
    return v;
  }
  static JVal parse(const string& s) { size_t i = 0; return parse(s, i); }
  int asInt() const { return (int)num; }
  double asDouble() const { return num; }
  bool asBool() const { return b; }
  string asStr() const { return str; }
};`

function cppBuildHelpers(problem: Problem): string {
  const needs = new Set<string>()
  const scan = (shape: Shape) => {
    const seen = new Set<string>()
    const walk = (sh: Shape) => {
      if (sh.kind === 'list') {
        if (sh.item.kind === 'scalar') {
          switch (sh.item.base) {
            case 'int': if (!seen.has('_vint')) { seen.add('_vint'); needs.add('_vint'); } break
            case 'double': if (!seen.has('_vdbl')) { seen.add('_vdbl'); needs.add('_vdbl'); } break
            case 'bool': if (!seen.has('_vbool')) { seen.add('_vbool'); needs.add('_vbool'); } break
            case 'string': if (!seen.has('_vstr')) { seen.add('_vstr'); needs.add('_vstr'); } break
          }
        } else if (sh.item.kind === 'list' && sh.item.item.kind === 'scalar' && sh.item.item.base === 'int') {
          if (!seen.has('_vvint')) { seen.add('_vvint'); needs.add('_vvint'); }
        }
      }
    }
    walk(shape)
  }
  if (problem.judgeType === 'function') problem.params.forEach((p) => scan(parseType(p.type)))
  else {
    problem.constructorParams?.forEach((p) => scan(parseType(p.type)))
    problem.methods?.forEach((m) => m.params.forEach((p) => scan(parseType(p.type))))
  }
  // 相交链表适配器需要 vector<int> 解析助手
  if (isIntersectProblem(problem)) needs.add('_vint')

  let helpers = ''
  if (needs.has('_vint')) helpers += `
vector<int> _vint(const JVal& v){ vector<int> r; for(auto&x:v.arr) r.push_back(x.asInt()); return r; }`
  if (needs.has('_vdbl')) helpers += `
vector<double> _vdbl(const JVal& v){ vector<double> r; for(auto&x:v.arr) r.push_back(x.asDouble()); return r; }`
  if (needs.has('_vbool')) helpers += `
vector<bool> _vbool(const JVal& v){ vector<bool> r; for(auto&x:v.arr) r.push_back(x.asBool()); return r; }`
  if (needs.has('_vstr')) helpers += `
vector<string> _vstr(const JVal& v){ vector<string> r; for(auto&x:v.arr) r.push_back(x.asStr()); return r; }`
  if (needs.has('_vvint')) helpers += `
vector<vector<int>> _vvint(const JVal& v){ vector<vector<int>> r; for(auto&x:v.arr){ vector<int> row; for(auto&y:x.arr) row.push_back(y.asInt()); r.push_back(row); } return r; }`

  return helpers
}

function cppHarness(problem: Problem, sourceCode: string, className: string): Harness {
  const files: GeneratedFile[] = [{ name: 'solution.cpp', content: sourceCode }]
  const fn = problem.methodName
  const helpers = cppBuildHelpers(problem)

  let driver: string
  if (problem.judgeType === 'class') {
    const ctorArgs = (problem.constructorParams ?? []).map((p, i) => {
      const shape = parseType(p.type)
      return cppLoadArg(shape, `_all.arr[0].arr[${i}]`)
    }).join(', ')
    const dispatch = (problem.methods ?? []).map((m) => {
      const margs = m.params.map((_, pi) => cppLoadArg(parseType(m.params[pi].type), `_args_i.arr[${pi}]`)).join(', ')
      const isVoid = m.returnType === 'void'
      const expr = `obj.${m.name}(${margs})`
      return `if (op == ${JSON.stringify(m.name)}) { ${isVoid ? `${expr}; result.push_back("null");` : `result.push_back(_ser(${expr}));`} }`
    }).join(' else ')
    const body = `
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> argvRaw; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) argvRaw.push_back(line); } }
  vector<JVal> ops_j = JVal::parse(argvRaw[0]).arr;
  vector<string> ops; for(auto&o:ops_j) ops.push_back(o.asStr());
  JVal _all = JVal::parse(argvRaw[1]);
  ${className} obj${ctorArgs ? `(${ctorArgs})` : ''};
  vector<string> result; result.push_back("null");
  for (size_t i = 1; i < ops.size(); i++) {
    string op = ops[i];
    JVal _args_i = _all.arr[i];
    ${dispatch || 'result.push_back("null");'}
  }
  cout << "[" ;
  for (size_t i = 0; i < result.size(); i++) { if(i) cout << ","; cout << result[i]; }
  cout << "]";
`
    driver = `int main(){${body}\n  return 0;\n}`
  } else if (isIntersectProblem(problem)) {
    // 手动判题：相交链表 —— 用真实签名(两个 ListNode*)调用，并构造共享节点
    const iA = manualIndex(problem, 'intersectVal')
    const iL = manualIndex(problem, 'listA')
    const iB = manualIndex(problem, 'listB')
    const iSA = manualIndex(problem, 'skipA')
    const iSB = manualIndex(problem, 'skipB')
    driver = `
int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> L; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) L.push_back(line); } }
  int _iv = JVal::parse(L[${iA}]).asInt();
  vector<int> _A = _vint(JVal::parse(L[${iL}]));
  vector<int> _B = _vint(JVal::parse(L[${iB}]));
  int _sa = JVal::parse(L[${iSA}]).asInt();
  int _sb = JVal::parse(L[${iSB}]).asInt();
  ListNode* headA = _buildList(_A);
  ListNode* headB = nullptr;
  if (_iv != 0) {
    ListNode* shared = _nodeAt(headA, _sa);
    if (_sb <= 0) { headB = shared; }
    else {
      headB = _buildList(_B);
      ListNode* t = _nodeAt(headB, _sb - 1);
      if (t) t->next = shared;
    }
  } else {
    headB = _buildList(_B);
  }
  ${className} obj;
  auto r = obj.${fn}(headA, headB);
  cout << (r ? to_string(r->val) : string("0"));
  return 0;
}`
  } else {
    const refs = new Map(nodeRefParams(problem, sourceCode, 'cpp').map((r) => [r.index, r]))
    const decls = problem.params.map((p, i) => {
      const shape = parseType(p.type)
      const nr = refs.get(i)
      if (nr) {
        // 元数据是 integer、签名是 TreeNode*/ListNode*：从节点池里按值找
        const finder = nr.kind === 'tree' ? '_lcFindTree' : '_lcFindList'
        return `  auto _a${i} = ${finder}(_a${nr.pool}, JVal::parse(argvRaw[${i}]).asInt());`
      }
      // 先解析到局部左值变量：兼容 vector<int>& 等非 const 引用参数
      return `  auto _a${i} = ${cppLoadArg(shape, `JVal::parse(argvRaw[${i}])`)};`
    }).join('\n')
    const args = problem.params.map((_, i) => `_a${i}`).join(', ')
    // 返回节点引用（如 LCA 返回那个节点）时按节点值比较，而不是打印整棵树
    const out = nodeValueReturn(problem)
      ? `  cout << (result ? to_string(result->val) : string("null"));`
      : `  cout << _ser(result);`
    driver = `
int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> argvRaw; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) argvRaw.push_back(line); } }
${decls}
  ${className} obj;
  auto result = obj.${fn}(${args});
${out}
  return 0;
}`
  }

  const ser = CPP_SERIALIZER
  const full = CPP_PREAMBLE + '\n' + helpers + '\n' + CPP_NODE_HELPERS + '\n' + ser + '\n' + '#include "solution.cpp"\n' + `${driver}`
  files.push({ name: 'main.cpp', content: full })
  return {
    files,
    solutionFile: 'solution.cpp',
    compile: { cmd: 'g++', args: ['-std=c++17', '-static', 'main.cpp', '-o', 'main'] },
    run: { cmd: process.platform === 'win32' ? './main.exe' : './main', args: [] },
    className
  }
}

function cppLoadArg(shape: Shape, expr: string): string {
  switch (shape.kind) {
    case 'scalar':
      switch (shape.base) {
        case 'int': return `(${expr}).asInt()`
        case 'double': return `(${expr}).asDouble()`
        case 'bool': return `(${expr}).asBool()`
        case 'string': return `(${expr}).asStr()`
      }
      break
    case 'list': {
      const inner = shape.item
      if (inner.kind === 'scalar') {
        switch (inner.base) {
          case 'int': return `_vint(${expr})`
          case 'double': return `_vdbl(${expr})`
          case 'bool': return `_vbool(${expr})`
          case 'string': return `_vstr(${expr})`
        }
      }
      return `_vvint(${expr})`
    }
    case 'linkedlist': return `_listnode(${expr})`
    case 'tree': return `_treenode(${expr})`
  }
  return `(${expr}).asStr()`
}

const CPP_NODE_HELPERS = `
struct ListNode { int val; ListNode* next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode* n) : val(x), next(n) {} };
ListNode* _listnode(const JVal& v){ ListNode* d = new ListNode(); ListNode* c = d; for(auto&x:v.arr){ c->next = new ListNode(x.asInt()); c = c->next; } return d->next; }
ListNode* _buildList(const vector<int>& a){ ListNode* d = new ListNode(); ListNode* c = d; for(int x : a){ c->next = new ListNode(x); c = c->next; } return d->next; }
ListNode* _nodeAt(ListNode* h, int idx){ for(int i=0;i<idx && h;i++) h = h->next; return h; }
struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode* l, TreeNode* r) : val(x), left(l), right(r) {} };
TreeNode* _treenode(const JVal& v){ if(v.arr.empty() || v.arr[0].t==JVal::NUL) return nullptr; TreeNode* root = new TreeNode(v.arr[0].asInt()); queue<TreeNode*> q; q.push(root); size_t i=1; auto put=[&](TreeNode* &child){ if(i<v.arr.size() && v.arr[i].t!=JVal::NUL){ child = new TreeNode(v.arr[i].asInt()); q.push(child);} i++; }; while(!q.empty()){ TreeNode* p=q.front(); q.pop(); put(p->left); put(p->right); } return root; }
// 「按值引用的节点」：在树/链表里找出值为 v 的那个节点（LCA 这类题传的是树里的节点）
TreeNode* _lcFindTree(TreeNode* root, int v){ if(!root) return nullptr; queue<TreeNode*> q; q.push(root); while(!q.empty()){ TreeNode* p=q.front(); q.pop(); if(p->val==v) return p; if(p->left) q.push(p->left); if(p->right) q.push(p->right);} return nullptr; }
ListNode* _lcFindList(ListNode* h, int v){ while(h){ if(h->val==v) return h; h=h->next; } return nullptr; }
`

const CPP_SERIALIZER = `
string _ser(const string& s){ string r="\\""; for(char c:s){ if(c=='"'||c=='\\\\') r+='\\\\'; r+=c; } return r+"\\""; }
string _ser(bool b){ return b?"true":"false"; }
string _ser(int v){ return to_string(v); }
string _ser(long v){ return to_string(v); }
string _ser(long long v){ return to_string(v); }
string _ser(double v){ if(v==(long long)v && abs(v)<1e15){ return to_string((long long)v); } return to_string(v); }
template<class T> string _ser(const vector<T>& v){ string r="["; for(size_t i=0;i<v.size();i++){ if(i) r+=","; r+=_ser(v[i]); } return r+"]"; }
string _ser(const vector<vector<int>>& v){ string r="["; for(size_t i=0;i<v.size();i++){ if(i) r+=","; r+=_ser(v[i]); } return r+"]"; }
string _ser(const vector<vector<string>>& v){ string r="["; for(size_t i=0;i<v.size();i++){ if(i) r+=","; r+=_ser(v[i]); } return r+"]"; }
string _ser(const vector<int*>& v){ string r="["; for(size_t i=0;i<v.size();i++){ if(i) r+=","; r+= _ser(v[i]?v[i][0]:0); } return r+"]"; }
string _ser(ListNode* h){ string r="["; bool f=true; while(h){ if(!f) r+=","; f=false; r+=to_string(h->val); h=h->next; } return r+"]"; }
string _ser(TreeNode* r){ string s="["; queue<TreeNode*> q; q.push(r); vector<string> out; while(!q.empty()){ TreeNode* p=q.front(); q.pop(); if(!p){ out.push_back("null"); } else { out.push_back(to_string(p->val)); q.push(p->left); q.push(p->right); } } while(!out.empty() && out.back()=="null") out.pop_back(); for(size_t i=0;i<out.size();i++){ if(i) s+=","; s+=out[i]; } return s+"]"; }
`

// ---------- C ----------
// C harness for function-mode problems. Supports `int`/`double`/`bool` params,
// `int[]` params (int* + intSize), string params (char*), and return types
// int, double, bool, string (char*) and int[] (int* + int* returnSize).
function cHarness(problem: Problem, sourceCode: string, className: string): Harness {
  const files: GeneratedFile[] = [{ name: 'solution.c', content: sourceCode }]
  const fn = problem.methodName
  const params = problem.params
  const retShape = parseType(problem.returnType)
  const returnsArray = retShape.kind === 'list' && retShape.item.kind === 'scalar' && retShape.item.base === 'int'

  let decls = ''
  let callArgs: string[] = []
  params.forEach((p, i) => {
    const sh = parseType(p.type)
    if (sh.kind === 'list' && sh.item.kind === 'scalar' && sh.item.base === 'int') {
      decls += `  int _n${i}; int* _a${i} = _int_arr(lines[${i}], &_n${i});\n`
      callArgs.push(`_a${i}`, `_n${i}`)
    } else if (sh.kind === 'scalar' && sh.base === 'string') {
      decls += `  char* _a${i} = _str(lines[${i}]);\n`
      callArgs.push(`_a${i}`)
    } else if (sh.kind === 'scalar' && sh.base === 'double') {
      decls += `  double _a${i} = atof(lines[${i}]);\n`
      callArgs.push(`_a${i}`)
    } else if (sh.kind === 'scalar') {
      decls += `  int _a${i} = atoi(lines[${i}]);\n`
      callArgs.push(`_a${i}`)
    } else {
      decls += `  int _a${i} = 0; /* unsupported type */\n`
      callArgs.push(`_a${i}`)
    }
  })

  let resultDeclaration: string
  let call: string
  let ser: string
  if (returnsArray) {
    resultDeclaration = `  int _retSize = 0;`
    call = `  int* _ret = ${fn}(${callArgs.join(', ')}, &_retSize);`
    ser = `  printf("["); for (int i=0;i<_retSize;i++){ if(i) printf(","); printf("%d", _ret[i]); } printf("]");`
  } else if (retShape.kind === 'scalar' && retShape.base === 'string') {
    resultDeclaration = ''
    call = `  char* _ret = ${fn}(${callArgs.join(', ')});`
    ser = `  printf("\\""); for (char* p=_ret; *p; p++){ if(*p=='"'||*p=='\\\\') putchar('\\\\'); putchar(*p); } printf("\\"");`
  } else if (retShape.kind === 'scalar' && retShape.base === 'double') {
    resultDeclaration = ''
    call = `  double _ret = ${fn}(${callArgs.join(', ')});`
    ser = `  printf("%s", _dbl(_ret));`
  } else if (retShape.kind === 'scalar') {
    resultDeclaration = ''
    call = `  int _ret = ${fn}(${callArgs.join(', ')});`
    ser = `  printf("%d", _ret);`
  } else {
    resultDeclaration = ''
    call = `  int _ret = ${fn}(${callArgs.join(', ')});`
    ser = `  printf("%d", _ret);`
  }

  const driver = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "solution.c"

static int* _int_arr(const char* s, int* n){
  int cap = 16, len = 0; int* a = (int*)malloc(cap*sizeof(int));
  const char* p = strchr(s, '['); if(!p){ *n = 0; return a; }
  p++;
  while(*p && *p != ']'){
    if(*p == '-' || (*p >= '0' && *p <= '9')){
      int v = atoi(p); if(len==cap){cap*=2; a=(int*)realloc(a,cap*sizeof(int));} a[len++]=v;
      while(*p && (*p=='-'||(*p>='0'&&*p<='9'))) p++;
    } else p++;
  }
  *n = len; return a;
}
static char* _str(const char* s){
  const char* q0 = strchr(s, '"'); if(!q0) return strdup("");
  const char* q1 = strrchr(q0+1, '"'); size_t n = q1 ? (size_t)(q1-q0-1) : strlen(q0+1);
  char* r = (char*)malloc(n+1); strncpy(r, q0+1, n); r[n]=0; return r;
}
static const char* _dbl(double d){
  static char b[64]; if(d==(long long)d && d<1e15){ snprintf(b,64,"%lld",(long long)d); } else snprintf(b,64,"%g",d); return b;
}
int main(void){
  char raw[1<<20]; int n = (int)fread(raw, 1, sizeof(raw)-1, stdin); raw[n]=0;
  char* lines[256]; int nl=0; char* save=NULL; char* tok = strtok_r(raw, "\\n", &save);
  while(tok && nl<256){ char* t=tok; while(*t==' ') t++; if(*t) lines[nl++]=t; tok = strtok_r(NULL,"\\n",&save); }
  if(nl < ${params.length}) return 2;
${decls}${resultDeclaration}
${call}
  ${ser}
  return 0;
}
`
  files.push({ name: 'main.c', content: driver })
  return {
    files,
    solutionFile: 'solution.c',
    compile: { cmd: 'gcc', args: ['-static', 'main.c', '-o', 'main'] },
    run: { cmd: process.platform === 'win32' ? './main.exe' : './main', args: [] },
    className
  }
}

export function buildHarness(
  problem: Problem,
  language: Language,
  sourceCode: string
): Harness {
  switch (language) {
    case 'python':
      return pythonHarness(problem, sourceCode, classNameFor(problem))
    case 'java':
      return javaHarness(problem, sourceCode, classNameFor(problem))
    case 'cpp':
      return cppHarness(problem, sourceCode, classNameFor(problem))
    case 'c':
      return cHarness(problem, sourceCode, classNameFor(problem))
  }
}
