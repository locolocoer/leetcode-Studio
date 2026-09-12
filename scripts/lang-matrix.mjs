// scripts/lang-matrix.ts
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// src/main/types.ts
function parseType(type) {
  const t = (type || "integer").replace(/\s+/g, "");
  if (/^nestedinteger$/i.test(t)) return { kind: "nestedinteger" };
  if (/^listnode$/i.test(t)) return { kind: "linkedlist" };
  if (/^treenode$/i.test(t)) return { kind: "tree" };
  if (/^char$/i.test(t)) return { kind: "scalar", base: "string" };
  const dims = (t.match(/\[\]/g) || []).length;
  const base2 = t.replace(/\[\]/g, "");
  let shape;
  switch (base2) {
    case "integer":
    case "int":
    case "long":
    case "number":
      shape = { kind: "scalar", base: "int" };
      break;
    case "double":
    case "float":
      shape = { kind: "scalar", base: "double" };
      break;
    case "boolean":
    case "bool":
      shape = { kind: "scalar", base: "bool" };
      break;
    case "string":
    case "char":
      shape = { kind: "scalar", base: "string" };
      break;
    case "list":
      shape = { kind: "scalar", base: "string" };
      break;
    default:
      shape = { kind: "scalar", base: "int" };
  }
  for (let i = 0; i < dims; i++) shape = { kind: "list", item: shape };
  return shape;
}

// src/main/harness.ts
var NAME = "Solution";
function classNameFor(problem) {
  return problem.judgeType === "class" ? problem.methodName : NAME;
}
function pythonHarness(problem, sourceCode, className) {
  const fn = problem.methodName;
  const files = [
    { name: "solution.py", content: sourceCode }
  ];
  const boot = `import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
`;
  let main;
  if (problem.judgeType === "class") {
    const methods = problem.methods ?? [];
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
`;
  } else {
    main = `${boot}import json, sys
from solution import ${className}

def main():
    raw = sys.stdin.read()
    lines = [l for l in raw.split('\\n') if l.strip() != '']
    args = [json.loads(l) for l in lines]
    sol = ${className}()
    result = sol.${fn}(*args)
    print(json.dumps(result, ensure_ascii=False, default=lambda o: None))

main()
`;
  }
  files.push({ name: "main.py", content: main });
  return {
    files,
    solutionFile: "solution.py",
    run: { cmd: "python", args: ["main.py"] },
    className
  };
}
var JAVA_JSON_UTIL = `
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
`;
function javaHarness(problem, sourceCode, className) {
  const methods = problem.judgeType === "class" ? problem.methods ?? [] : [];
  const fnName = problem.methodName;
  const files = [{ name: className + ".java", content: sourceCode }];
  const argCall = (idx, shape) => javaLoadFrom(shape, `args.get(${idx})`);
  let mainBody;
  if (problem.judgeType === "class") {
    const ctorParams = problem.constructorParams ?? [];
    const ctorArgs = ctorParams.map((p, i) => javaLoadFrom(parseType(p.type), `argv.get(0).get(${i})`)).join(", ");
    const dispatch = methods.map((m) => {
      const margs = m.params.map((p, pi) => javaLoadFrom(parseType(p.type), `argv.get(i).get(${pi})`)).join(", ");
      const isVoid = !m.returnType || m.returnType === "void";
      const body = isVoid ? `{ obj.${m.name}(${margs}); out.add(Json.ser(null)); }` : `out.add(Json.ser(obj.${m.name}(${margs})));`;
      return `if (op.equals(${JSON.stringify(m.name)})) { ${body} }`;
    }).join(" else ");
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
`;
  } else {
    const params = problem.params;
    const args = params.map((p, i) => javaLoadFrom(parseType(p.type), `a.get(${i})`)).join(", ");
    mainBody = `
    String raw = new String(System.in.readAllBytes());
    String[] lines = raw.split("\\n");
    List<Object> a = new ArrayList<>();
    for (String l : lines) { if (!l.trim().isEmpty()) a.add(Json.parse(l)); }
    ${className} obj = new ${className}();
    Object result = obj.${fnName}(${args});
    System.out.println(Json.ser(result));
`;
  }
  const main = `public class Main {
  public static void main(String[] args) throws Exception {
${mainBody}
  }
}
`;
  files.push({ name: "Main.java", content: JAVA_JSON_UTIL + "\n" + main });
  return {
    files,
    solutionFile: className + ".java",
    compile: { cmd: "javac", args: [className + ".java", "Main.java"] },
    run: { cmd: "java", args: ["Main"] },
    className
  };
}
function javaLoadFrom(shape, expr) {
  switch (shape.kind) {
    case "scalar":
      switch (shape.base) {
        case "int":
          return `Json.toInt(${expr})`;
        case "double":
          return `Json.toDouble(${expr})`;
        case "bool":
          return `Json.toBool(${expr})`;
        case "string":
          return `Json.toStr(${expr})`;
      }
      break;
    case "list": {
      const inner = shape.item;
      if (inner.kind === "scalar") {
        switch (inner.base) {
          case "int":
            return `Json.toIntArray(${expr})`;
          case "double":
            return `Json.toDoubleArray(${expr})`;
          case "bool":
            return `Json.toBoolArray(${expr})`;
          case "string":
            return `Json.toStrArray(${expr})`;
        }
      }
      if (inner.kind === "list") {
        const inn = inner.item;
        if (inn.kind === "scalar") {
          switch (inn.base) {
            case "int":
              return `Json.toIntMatrix(${expr})`;
            case "string":
              return `Json.toStrMatrix(${expr})`;
            case "double":
              return `Json.toDoubleMatrix(${expr})`;
          }
        }
        return `Json.toIntListMatrix(${expr})`;
      }
      return `Json.toIntList(${expr})`;
    }
    case "linkedlist":
      return `ListNode.from(${expr})`;
    case "tree":
      return `TreeNode.from(${expr})`;
    case "nestedinteger":
      return "null";
  }
  return `Json.toStr(${expr})`;
}
var CPP_PREAMBLE = `
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
};`;
function cppBuildHelpers(problem) {
  const needs = /* @__PURE__ */ new Set();
  const scan = (shape) => {
    const seen = /* @__PURE__ */ new Set();
    const walk = (sh) => {
      if (sh.kind === "list") {
        if (sh.item.kind === "scalar") {
          switch (sh.item.base) {
            case "int":
              if (!seen.has("_vint")) {
                seen.add("_vint");
                needs.add("_vint");
              }
              break;
            case "double":
              if (!seen.has("_vdbl")) {
                seen.add("_vdbl");
                needs.add("_vdbl");
              }
              break;
            case "bool":
              if (!seen.has("_vbool")) {
                seen.add("_vbool");
                needs.add("_vbool");
              }
              break;
            case "string":
              if (!seen.has("_vstr")) {
                seen.add("_vstr");
                needs.add("_vstr");
              }
              break;
          }
        } else if (sh.item.kind === "list" && sh.item.item.kind === "scalar" && sh.item.item.base === "int") {
          if (!seen.has("_vvint")) {
            seen.add("_vvint");
            needs.add("_vvint");
          }
        }
      }
    };
    walk(shape);
  };
  if (problem.judgeType === "function") problem.params.forEach((p) => scan(parseType(p.type)));
  else {
    problem.constructorParams?.forEach((p) => scan(parseType(p.type)));
    problem.methods?.forEach((m) => m.params.forEach((p) => scan(parseType(p.type))));
  }
  let helpers = "";
  if (needs.has("_vint")) helpers += `
vector<int> _vint(const JVal& v){ vector<int> r; for(auto&x:v.arr) r.push_back(x.asInt()); return r; }`;
  if (needs.has("_vdbl")) helpers += `
vector<double> _vdbl(const JVal& v){ vector<double> r; for(auto&x:v.arr) r.push_back(x.asDouble()); return r; }`;
  if (needs.has("_vbool")) helpers += `
vector<bool> _vbool(const JVal& v){ vector<bool> r; for(auto&x:v.arr) r.push_back(x.asBool()); return r; }`;
  if (needs.has("_vstr")) helpers += `
vector<string> _vstr(const JVal& v){ vector<string> r; for(auto&x:v.arr) r.push_back(x.asStr()); return r; }`;
  if (needs.has("_vvint")) helpers += `
vector<vector<int>> _vvint(const JVal& v){ vector<vector<int>> r; for(auto&x:v.arr){ vector<int> row; for(auto&y:x.arr) row.push_back(y.asInt()); r.push_back(row); } return r; }`;
  return helpers;
}
function cppHarness(problem, sourceCode, className) {
  const files = [{ name: "solution.cpp", content: sourceCode }];
  const fn = problem.methodName;
  const helpers = cppBuildHelpers(problem);
  let driver;
  if (problem.judgeType === "class") {
    const ctorArgs = (problem.constructorParams ?? []).map((p, i) => {
      const shape = parseType(p.type);
      return cppLoadArg(shape, `_all.arr[0].arr[${i}]`);
    }).join(", ");
    const dispatch = (problem.methods ?? []).map((m) => {
      const margs = m.params.map((_, pi) => cppLoadArg(parseType(m.params[pi].type), `_args_i.arr[${pi}]`)).join(", ");
      const isVoid = m.returnType === "void";
      const expr = `obj.${m.name}(${margs})`;
      return `if (op == ${JSON.stringify(m.name)}) { ${isVoid ? `${expr}; result.push_back("null");` : `result.push_back(_ser(${expr}));`} }`;
    }).join(" else ");
    const body = `
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> argvRaw; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) argvRaw.push_back(line); } }
  vector<JVal> ops_j = JVal::parse(argvRaw[0]).arr;
  vector<string> ops; for(auto&o:ops_j) ops.push_back(o.asStr());
  JVal _all = JVal::parse(argvRaw[1]);
  ${className} obj${ctorArgs ? `(${ctorArgs})` : ""};
  vector<string> result; result.push_back("null");
  for (size_t i = 1; i < ops.size(); i++) {
    string op = ops[i];
    JVal _args_i = _all.arr[i];
    ${dispatch || 'result.push_back("null");'}
  }
  cout << "[" ;
  for (size_t i = 0; i < result.size(); i++) { if(i) cout << ","; cout << result[i]; }
  cout << "]";
`;
    driver = `int main(){${body}
  return 0;
}`;
  } else {
    const decls = problem.params.map((p, i) => {
      const shape = parseType(p.type);
      return `  auto _a${i} = ${cppLoadArg(shape, `JVal::parse(argvRaw[${i}])`)};`;
    }).join("\n");
    const args = problem.params.map((_, i) => `_a${i}`).join(", ");
    driver = `
int main(){
  string raw; { char c; while(cin.get(c)) raw += c; }
  vector<string> argvRaw; { string line; stringstream ss(raw); while(getline(ss, line)) { if(!line.empty()) argvRaw.push_back(line); } }
${decls}
  ${className} obj;
  auto result = obj.${fn}(${args});
  cout << _ser(result);
  return 0;
}`;
  }
  const ser = CPP_SERIALIZER;
  const full = CPP_PREAMBLE + "\n" + helpers + "\n" + CPP_NODE_HELPERS + "\n" + ser + `
#include "solution.cpp"
${driver}`;
  files.push({ name: "main.cpp", content: full });
  return {
    files,
    solutionFile: "solution.cpp",
    compile: { cmd: "g++", args: ["-std=c++17", "-static", "main.cpp", "-o", "main"] },
    run: { cmd: process.platform === "win32" ? "./main.exe" : "./main", args: [] },
    className
  };
}
function cppLoadArg(shape, expr) {
  switch (shape.kind) {
    case "scalar":
      switch (shape.base) {
        case "int":
          return `(${expr}).asInt()`;
        case "double":
          return `(${expr}).asDouble()`;
        case "bool":
          return `(${expr}).asBool()`;
        case "string":
          return `(${expr}).asStr()`;
      }
      break;
    case "list": {
      const inner = shape.item;
      if (inner.kind === "scalar") {
        switch (inner.base) {
          case "int":
            return `_vint(${expr})`;
          case "double":
            return `_vdbl(${expr})`;
          case "bool":
            return `_vbool(${expr})`;
          case "string":
            return `_vstr(${expr})`;
        }
      }
      return `_vvint(${expr})`;
    }
    case "linkedlist":
      return `_listnode(${expr})`;
    case "tree":
      return `_treenode(${expr})`;
  }
  return `(${expr}).asStr()`;
}
var CPP_NODE_HELPERS = `
struct ListNode { int val; ListNode* next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode* n) : val(x), next(n) {} };
ListNode* _listnode(const JVal& v){ ListNode* d = new ListNode(); ListNode* c = d; for(auto&x:v.arr){ c->next = new ListNode(x.asInt()); c = c->next; } return d->next; }
struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode* l, TreeNode* r) : val(x), left(l), right(r) {} };
TreeNode* _treenode(const JVal& v){ if(v.arr.empty() || v.arr[0].t==JVal::NUL) return nullptr; TreeNode* root = new TreeNode(v.arr[0].asInt()); queue<TreeNode*> q; q.push(root); size_t i=1; auto put=[&](TreeNode* &child){ if(i<v.arr.size() && v.arr[i].t!=JVal::NUL){ child = new TreeNode(v.arr[i].asInt()); q.push(child);} i++; }; while(!q.empty()){ TreeNode* p=q.front(); q.pop(); put(p->left); put(p->right); } return root; }
`;
var CPP_SERIALIZER = `
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
`;
function cHarness(problem, sourceCode, className) {
  const files = [{ name: "solution.c", content: sourceCode }];
  const fn = problem.methodName;
  const params = problem.params;
  const retShape = parseType(problem.returnType);
  const returnsArray = retShape.kind === "list" && retShape.item.kind === "scalar" && retShape.item.base === "int";
  let decls = "";
  let callArgs = [];
  params.forEach((p, i) => {
    const sh = parseType(p.type);
    if (sh.kind === "list" && sh.item.kind === "scalar" && sh.item.base === "int") {
      decls += `  int _n${i}; int* _a${i} = _int_arr(lines[${i}], &_n${i});
`;
      callArgs.push(`_a${i}`, `_n${i}`);
    } else if (sh.kind === "scalar" && sh.base === "string") {
      decls += `  char* _a${i} = _str(lines[${i}]);
`;
      callArgs.push(`_a${i}`);
    } else if (sh.kind === "scalar" && sh.base === "double") {
      decls += `  double _a${i} = atof(lines[${i}]);
`;
      callArgs.push(`_a${i}`);
    } else if (sh.kind === "scalar") {
      decls += `  int _a${i} = atoi(lines[${i}]);
`;
      callArgs.push(`_a${i}`);
    } else {
      decls += `  int _a${i} = 0; /* unsupported type */
`;
      callArgs.push(`_a${i}`);
    }
  });
  let resultDeclaration;
  let call;
  let ser;
  if (returnsArray) {
    resultDeclaration = `  int _retSize = 0;`;
    call = `  int* _ret = ${fn}(${callArgs.join(", ")}, &_retSize);`;
    ser = `  printf("["); for (int i=0;i<_retSize;i++){ if(i) printf(","); printf("%d", _ret[i]); } printf("]");`;
  } else if (retShape.kind === "scalar" && retShape.base === "string") {
    resultDeclaration = "";
    call = `  char* _ret = ${fn}(${callArgs.join(", ")});`;
    ser = `  printf("\\""); for (char* p=_ret; *p; p++){ if(*p=='"'||*p=='\\\\') putchar('\\\\'); putchar(*p); } printf("\\"");`;
  } else if (retShape.kind === "scalar" && retShape.base === "double") {
    resultDeclaration = "";
    call = `  double _ret = ${fn}(${callArgs.join(", ")});`;
    ser = `  printf("%s", _dbl(_ret));`;
  } else if (retShape.kind === "scalar") {
    resultDeclaration = "";
    call = `  int _ret = ${fn}(${callArgs.join(", ")});`;
    ser = `  printf("%d", _ret);`;
  } else {
    resultDeclaration = "";
    call = `  int _ret = ${fn}(${callArgs.join(", ")});`;
    ser = `  printf("%d", _ret);`;
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
`;
  files.push({ name: "main.c", content: driver });
  return {
    files,
    solutionFile: "solution.c",
    compile: { cmd: "gcc", args: ["-static", "main.c", "-o", "main"] },
    run: { cmd: process.platform === "win32" ? "./main.exe" : "./main", args: [] },
    className
  };
}
function buildHarness(problem, language, sourceCode) {
  switch (language) {
    case "python":
      return pythonHarness(problem, sourceCode, classNameFor(problem));
    case "java":
      return javaHarness(problem, sourceCode, classNameFor(problem));
    case "cpp":
      return cppHarness(problem, sourceCode, classNameFor(problem));
    case "c":
      return cHarness(problem, sourceCode, classNameFor(problem));
  }
}

// scripts/lang-matrix.ts
var twoSum = {
  id: "1",
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "easy",
  tags: [],
  content: "",
  judgeType: "function",
  methodName: "twoSum",
  params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }],
  returnType: "integer[]",
  tests: [],
  starters: {},
  source: "local"
};
var minStack = {
  id: "155",
  slug: "min-stack",
  title: "Min Stack",
  difficulty: "medium",
  tags: [],
  content: "",
  judgeType: "class",
  methodName: "MinStack",
  params: [],
  returnType: "void",
  constructorParams: [],
  methods: [
    { name: "push", params: [{ name: "val", type: "integer" }], returnType: "void" },
    { name: "pop", params: [], returnType: "void" },
    { name: "top", params: [], returnType: "integer" },
    { name: "getMin", params: [], returnType: "integer" }
  ],
  tests: [],
  starters: {},
  source: "local"
};
var code = {
  python: {
    ts: "class Solution:\n    def twoSum(self, nums, target):\n        m = {}\n        for i, x in enumerate(nums):\n            if target - x in m:\n                return [m[target - x], i]\n            m[x] = i\n        return []\n",
    ms: "class MinStack:\n    def __init__(self):\n        self.st = []\n        self.mn = []\n    def push(self, val):\n        self.st.append(val)\n        if not self.mn or val <= self.mn[-1]: self.mn.append(val)\n    def pop(self):\n        if self.st.pop() == self.mn[-1]: self.mn.pop()\n    def top(self): return self.st[-1]\n    def getMin(self): return self.mn[-1]\n"
  },
  java: {
    ts: "import java.util.*;\nclass Solution {\n    public int[] twoSum(int[] nums, int target) {\n        Map<Integer,Integer> m = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            int need = target - nums[i];\n            if (m.containsKey(need)) return new int[]{m.get(need), i};\n            m.put(nums[i], i);\n        }\n        return new int[]{};\n    }\n}\n",
    ms: "import java.util.*;\nclass MinStack {\n    Deque<Integer> st = new ArrayDeque<>();\n    Deque<Integer> mn = new ArrayDeque<>();\n    public MinStack() {}\n    public void push(int val) { st.push(val); if (mn.isEmpty() || val <= mn.peek()) mn.push(val); }\n    public void pop() { if (st.pop().equals(mn.peek())) mn.pop(); }\n    public int top() { return st.peek(); }\n    public int getMin() { return mn.peek(); }\n}\n"
  },
  cpp: {
    ts: "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int,int> m;\n        for (int i = 0; i < (int)nums.size(); i++) {\n            int need = target - nums[i];\n            if (m.count(need)) return {m[need], i};\n            m[nums[i]] = i;\n        }\n        return {};\n    }\n};\n",
    ms: "class MinStack {\n    stack<int> st, mn;\npublic:\n    MinStack() {}\n    void push(int val) { st.push(val); if (mn.empty() || val <= mn.top()) mn.push(val); }\n    void pop() { if (st.top() == mn.top()) mn.pop(); st.pop(); }\n    int top() { return st.top(); }\n    int getMin() { return mn.top(); }\n};\n"
  },
  c: {
    ts: "#include <stdlib.h>\nint* twoSum(int* nums, int numsSize, int target, int* returnSize){\n    int* r = (int*)malloc(2*sizeof(int));\n    for (int i=0;i<numsSize;i++) for (int j=i+1;j<numsSize;j++)\n        if (nums[i]+nums[j]==target){ r[0]=i; r[1]=j; *returnSize=2; return r; }\n    *returnSize=0; return NULL;\n}\n",
    ms: ""
  }
};
var lang = process.argv[2];
var base = process.argv[3];
if (!lang || !base) {
  console.error("usage: node lang-matrix.mjs <lang> <dir>");
  process.exit(2);
}
try {
  rmSync(base, { recursive: true, force: true });
} catch {
}
mkdirSync(base, { recursive: true });
function emit(problem, src, name) {
  const h = buildHarness(problem, lang, src);
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const f of h.files) writeFileSync(join(dir, f.name), f.content, "utf8");
  console.log(JSON.stringify({ name, compile: h.compile, run: h.run }));
}
emit(twoSum, code[lang].ts, "two-sum");
if (code[lang].ms) emit(minStack, code[lang].ms, "min-stack");
