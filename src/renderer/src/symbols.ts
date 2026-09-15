// 从当前代码里提取「用户自己定义的东西」，用于补全：
//   - 变量 / 字段（含 for 循环变量、函数参数、元组解包、结构化绑定）
//   - 函数与方法（自己写的辅助函数、类方法）
//   - 类 / 结构体 / 类型别名，以及它们的成员（支持 `obj.` 成员补全）
//   - #define 宏、import 进来的名字
//
// 只做轻量词法扫描（正则 + 括号/缩进配平），不依赖完整语法树：
// 目标是「写完就能补全」，允许少量误报，但尽量不漏。

import type { Language } from '../../shared/types'

export interface VarSym {
  name: string
  /** 声明类型（原样，如 `vector<int>`、`ListNode *`、`Integer`） */
  type: string
}

export interface FuncSym {
  name: string
  params: { name: string; type: string }[]
  ret: string
  /** 所属类（类内方法） */
  owner?: string
}

export interface DocSymbols {
  vars: Map<string, VarSym>
  funcs: Map<string, FuncSym>
  types: Set<string>
  /** 自定义类型 → 成员（字段与方法） */
  typeMembers: Map<string, VarSym[]>
  macros: Set<string>
  imports: Set<string>
}

function empty(): DocSymbols {
  return {
    vars: new Map(),
    funcs: new Map(),
    types: new Set(),
    typeMembers: new Map(),
    macros: new Set(),
    imports: new Set()
  }
}

/** 去掉注释（字符串里的 // 不处理，够用即可） */
export function stripComments(code: string, lang: Language): string {
  let s = code
  if (lang === 'python') {
    s = s.replace(/"""[\s\S]*?"""/g, '""').replace(/'''[\s\S]*?'''/g, "''")
    s = s.split('\n').map((l) => l.replace(/(^|[^#])#.*$/, '$1')).join('\n')
    return s
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ')
  s = s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  return s
}

const CTL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'case', 'default',
  'new', 'delete', 'throw', 'sizeof', 'typedef', 'using', 'class', 'struct', 'enum',
  'public', 'private', 'protected', 'namespace', 'template', 'operator', 'assert',
  'elif', 'except', 'with', 'lambda', 'print', 'and', 'or', 'not', 'in', 'is',
  'try', 'finally', 'raise', 'yield', 'global', 'nonlocal', 'del', 'import', 'from', 'as', 'pass'
])

const TYPE_STOP = new Set(['void', 'class', 'struct', 'enum', 'return', 'public', 'private', 'protected', 'if', 'for', 'while', 'switch', 'catch'])

// ---------------------------------------------------------------------------
// C / C++
// ---------------------------------------------------------------------------

const CPP_QUAL = '(?:const|static|inline|constexpr|volatile|unsigned|signed|long|short|register|mutable|virtual|explicit|friend|typename|auto)'
const CPP_TYPE = `(?:${CPP_QUAL}\\s+)*(?:[A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)*(?:\\s*<[^;{}()]*>)?)(?:\\s*[*&]+)?(?:\\s*\\[\\s*\\])?`

/** 顶层逗号切分（忽略 <> () [] {} 内部的逗号） */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/**
 * 取类/结构体的「类级声明」：跳过方法体内部的语句，避免把局部变量当成成员。
 * 遇到 `{` 说明一条方法声明结束（收下签名）并进入方法体，方法体整段丢弃。
 */
function classLevelStatements(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '{') {
      if (depth === 0 && cur.trim()) out.push(cur)
      cur = ''
      depth++
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      cur = ''
      continue
    }
    if (depth > 0) continue
    if (ch === ';') {
      if (cur.trim()) out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (depth === 0 && cur.trim()) out.push(cur)
  return out
}

/**
 * C/C++ 声明扫描：`int a = 0, *b = p, c[2];` 要能取出 a/b/c，
 * 后续声明符共享第一个声明符的类型。
 */
function cppDeclarators(stmt: string): { type: string; name: string }[] {
  // for (int i = 0 ...) / if (...) 之类：去掉控制关键字前缀
  const cleaned = stmt.trim().replace(/^(?:for|while|if|switch|catch|else)\s*\(\s*/, '')
  let seg0 = cleaned
  let prefix = ''
  // `struct Pair p;` 这类带 tag 关键字的声明
  const kw = /^(struct|class|union|enum)\s+/.exec(seg0)
  if (kw) {
    const rest = seg0.slice(kw[0].length).trim()
    // 类型定义本身（后面没有变量名）不算变量
    if (/^[A-Za-z_]\w*\s*(?::[^;{]*)?$/.test(rest)) return []
    prefix = kw[1] + ' '
    seg0 = rest
  }
  if (/^(class|interface|enum|record|@interface)\b/.test(seg0)) return []
  const parts = splitTopLevel(seg0)
  if (!parts.length) return []
  const out: { type: string; name: string }[] = []
  let type = ''
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (i === 0) {
      const m = new RegExp(`^\\s*(${CPP_TYPE})\\s+([A-Za-z_]\\w*)`).exec(seg)
      if (!m) return []
      type = (prefix + m[1].trim()).trim()
      const head = m[1].trim().split(/\s+/)[0]
      if (CTL.has(m[2]) || TYPE_STOP.has(head)) return []
      out.push({ type, name: m[2] })
      continue
    }
    // 后续声明符：name / *name / &name / name[...]
    const m = /^\s*[*&]*\s*([A-Za-z_]\w*)/.exec(seg)
    if (!m || CTL.has(m[1])) continue
    out.push({ type, name: m[1] })
  }
  return out
}

/** 按语句切分（; { } 换行），便于逐条匹配声明 */
function statements(code: string, lang: Language): string[] {
  if (lang === 'python') return code.split('\n')
  return code
    .split(/[;{}]/)
    .flatMap((s) => s.split('\n'))
}

function parseCppParams(raw: string): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = []
  let depth = 0
  let cur = ''
  const parts: string[] = []
  for (const ch of raw) {
    if (ch === '<' || ch === '(' || ch === '[') depth++
    else if (ch === '>' || ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  for (const part of parts) {
    const p = part.replace(/=.*$/, '').trim()
    if (!p || p === 'void') continue
    // 结构化绑定 / 无名参数
    const bind = /^(.+?)[\s*&]+([A-Za-z_]\w*)\s*$/.exec(p)
    if (bind) out.push({ type: bind[1].trim(), name: bind[2] })
  }
  return out
}

function scanCpp(code: string, out: DocSymbols): void {
  const src = stripComments(code, 'cpp')

  for (const m of src.matchAll(/\b(?:class|struct|union|enum(?:\s+class)?)\s+([A-Za-z_]\w*)/g)) out.types.add(m[1])
  for (const m of src.matchAll(/\btypedef\b[^;{}]*?\b([A-Za-z_]\w*)\s*;/g)) out.types.add(m[1])
  for (const m of src.matchAll(/\busing\s+([A-Za-z_]\w*)\s*=/g)) out.types.add(m[1])
  for (const m of src.matchAll(/^[ \t]*#define\s+([A-Za-z_]\w*)/gm)) out.macros.add(m[1])

  // 类/结构体成员：先取 body，再按语句扫
  const classRe = /\b(?:class|struct)\s+([A-Za-z_]\w*)[^;{]*\{/g
  let cm: RegExpExecArray | null
  while ((cm = classRe.exec(src))) {
    const name = cm[1]
    const bodyStart = cm.index + cm[0].length
    let depth = 1
    let i = bodyStart
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
    }
    const body = src.slice(bodyStart, Math.max(bodyStart, i - 1))
    const members: VarSym[] = []
    for (const stmt of classLevelStatements(body)) {
      const s = stmt.trim()
      if (!s || /^(public|private|protected)\s*:?$/.test(s)) continue
      const fn = new RegExp(`^(${CPP_TYPE})\\s+([A-Za-z_]\\w*)\\s*\\(`).exec(s)
      if (fn && !CTL.has(fn[2])) {
        members.push({ name: fn[2], type: `方法 → ${fn[1].trim()}` })
        continue
      }
      for (const d of cppDeclarators(s)) members.push({ name: d.name, type: d.type })
    }
    if (members.length) out.typeMembers.set(name, members)
  }

  // 函数定义 / 声明：返回类型 名字(参数)
  const fnRe = new RegExp(
    `(?:^|[;{}\\n])\\s*(?:template\\s*<[^>]*>\\s*)?(${CPP_TYPE})\\s+([A-Za-z_]\\w*)\\s*\\(([^;{}()]*)\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:override\\s*)?[{;:]`,
    'g'
  )
  for (const m of src.matchAll(fnRe)) {
    const ret = m[1].trim()
    const name = m[2]
    if (CTL.has(name) || TYPE_STOP.has(ret.split(/\s+/)[0] || '')) continue
    const params = parseCppParams(m[3])
    out.funcs.set(name, { name, ret, params })
    for (const p of params) if (!out.vars.has(p.name)) out.vars.set(p.name, { name: p.name, type: p.type })
  }

  // 变量：类型 名字（含 for 初始化、多声明符、结构化绑定）
  for (const stmt of statements(src, 'cpp')) {
    const s = stmt.trim()
    if (!s || s.startsWith('#')) continue
    for (const d of cppDeclarators(s)) {
      if (!out.vars.has(d.name)) out.vars.set(d.name, { name: d.name, type: d.type })
    }
    // 结构化绑定：auto& [k, v] : m
    const bind = /\[([^\]]+)\]/.exec(s)
    if (bind && /\b(auto|const)\b/.test(s)) {
      for (const raw of bind[1].split(',')) {
        const n = raw.trim().replace(/^&/, '')
        if (/^[A-Za-z_]\w*$/.test(n) && !out.vars.has(n)) out.vars.set(n, { name: n, type: 'auto' })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

const JAVA_TYPE = '(?:final\\s+)?(?:[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*(?:\\s*<[^;{}()]*>)?)(?:\\s*\\[\\s*\\])?'
/** 方法/字段前的修饰符（吃掉尾随空格，否则类型匹配不上） */
const JAVA_MODS = '(?:(?:public|private|protected|static|final|synchronized|abstract|native|default|transient|volatile|strictfp)\\s+|@\\w+(?:\\([^)]*\\))?\\s+)*'

function parseJavaParams(raw: string): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = []
  for (const part of raw.split(',')) {
    const p = part.replace(/@\w+(\([^)]*\))?/g, '').replace(/final\s+/g, '').trim()
    const m = /^(.+?)\s+([A-Za-z_]\w*)\s*(?:\[\s*\])?$/.exec(p)
    if (m) out.push({ type: m[1].trim(), name: m[2] })
  }
  return out
}

function scanJava(code: string, out: DocSymbols): void {
  const src = stripComments(code, 'java')

  for (const m of src.matchAll(/\b(?:class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/g)) out.types.add(m[1])
  for (const m of src.matchAll(/\bimport\s+(?:static\s+)?([\w.]+)\s*;/g)) {
    const last = m[1].split('.').pop() || ''
    if (last && last !== '*') out.imports.add(last)
  }

  // 类成员
  const classRe = /\b(?:class|interface|enum)\s+([A-Za-z_]\w*)[^;{]*\{/g
  let cm: RegExpExecArray | null
  while ((cm = classRe.exec(src))) {
    const name = cm[1]
    const bodyStart = cm.index + cm[0].length
    let depth = 1
    let i = bodyStart
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
    }
    const body = src.slice(bodyStart, Math.max(bodyStart, i - 1))
    const members: VarSym[] = []
    for (const stmt of classLevelStatements(body)) {
      const s = stmt.trim()
      if (!s) continue
      const fn = new RegExp(`^${JAVA_MODS}(?:[A-Za-z_][\\w<>,\\[\\].\\s]*?)\\s+([A-Za-z_]\\w*)\\s*\\(`).exec(s)
      if (fn && !CTL.has(fn[1])) {
        members.push({ name: fn[1], type: '方法' })
        continue
      }
      const v = new RegExp(`^${JAVA_MODS}(${JAVA_TYPE}|var)\\s+([A-Za-z_]\\w*)\\s*(?:=|$)`).exec(s)
      if (v && !CTL.has(v[2])) members.push({ name: v[2], type: v[1].trim() })
    }
    if (members.length) out.typeMembers.set(name, members)
  }

  // 方法
  const fnRe = new RegExp(
    `(?:^|[;{}\\n])\\s*${JAVA_MODS}(${JAVA_TYPE}|void|var)\\s+([A-Za-z_]\\w*)\\s*\\(([^;{}()]*)\\)\\s*(?:throws\\s+[\\w.,\\s]+)?[{;]`,
    'g'
  )
  for (const m of src.matchAll(fnRe)) {
    const ret = m[1].trim()
    const name = m[2]
    if (CTL.has(name) || TYPE_STOP.has(ret)) continue
    const params = parseJavaParams(m[3])
    out.funcs.set(name, { name, ret, params })
    for (const p of params) if (!out.vars.has(p.name)) out.vars.set(p.name, { name: p.name, type: p.type })
  }

  // 变量（含 for / catch / lambda 参数名）
  const varRe = new RegExp(`(${JAVA_TYPE}|var)\\s+([A-Za-z_]\\w*)\\s*(?=[=;,)\\[]|$)`, 'g')
  for (const stmt of statements(src, 'java')) {
    const s = stmt.trim()
    if (!s || /^(class|interface|enum|record|@interface)\b/.test(s)) continue
    for (const m of s.replace(/=.*$/, '').matchAll(varRe)) {
      const type = m[1].trim()
      const name = m[2]
      if (!type || CTL.has(name) || out.vars.has(name)) continue
      out.vars.set(name, { name, type })
    }
  }
  // for (X x : list)
  for (const m of src.matchAll(/for\s*\(\s*([A-Za-z_][\w<>,\[\].,\s]*?)\s+([A-Za-z_]\w*)\s*:/g)) {
    if (!CTL.has(m[2])) out.vars.set(m[2], { name: m[2], type: m[1].trim() })
  }
  // (a, b) -> ...  lambda 参数
  for (const m of src.matchAll(/\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*\)\s*->/g)) {
    for (const n of m[1].split(',')) {
      const name = n.trim()
      if (/^[A-Za-z_]\w*$/.test(name) && !out.vars.has(name)) out.vars.set(name, { name, type: 'lambda' })
    }
  }
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function scanPython(code: string, out: DocSymbols): void {
  const src = stripComments(code, 'python')
  const lines = src.split('\n')

  for (const m of src.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) out.types.add(m[1])
  for (const m of src.matchAll(/^\s*(?:import\s+([\w.]+)|from\s+[\w.]+\s+import\s+(.+))$/gm)) {
    if (m[1]) out.imports.add((m[1].split('.').pop() || '').trim())
    if (m[2]) for (const part of m[2].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() || ''
      if (name && name !== '*') out.imports.add(name)
    }
  }

  const addVar = (name: string) => {
    if (/^[A-Za-z_]\w*$/.test(name) && !CTL.has(name) && !out.vars.has(name)) {
      out.vars.set(name, { name, type: '' })
    }
  }
  const addMember = (owner: string, name: string, type: string) => {
    const list = out.typeMembers.get(owner) || []
    if (!list.some((x) => x.name === name)) list.push({ name, type })
    out.typeMembers.set(owner, list)
  }

  /** 作用域栈：类 / 函数（靠缩进判断归属） */
  const scopes: { kind: 'class' | 'def'; name: string; indent: number }[] = []
  const ownerClass = () => {
    const s = [...scopes].reverse().find((x) => x.kind === 'class')
    return s?.name
  }
  const inFunction = () => scopes.length > 0 && scopes[scopes.length - 1].kind === 'def'

  for (const line of lines) {
    if (!line.trim()) continue
    const indent = line.match(/^\s*/)?.[0].length || 0
    // 退出已经结束的作用域
    while (scopes.length && indent <= scopes[scopes.length - 1].indent) scopes.pop()

    const cls = /^\s*class\s+([A-Za-z_]\w*)/.exec(line)
    if (cls) {
      scopes.push({ kind: 'class', name: cls[1], indent })
      continue
    }
    const fn = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line)
    if (fn) {
      const name = fn[1]
      const params = fn[2]
        .split(',')
        .map((p) => p.trim().replace(/^\*+/, '').replace(/\s*=.*$/, '').replace(/\s*:.*$/, ''))
        .filter((p) => p && p !== 'self' && p !== 'cls')
        .map((p) => ({ name: p, type: '' }))
      const owner = ownerClass()
      const isDunder = name.startsWith('__') && name.endsWith('__')
      if (!isDunder) out.funcs.set(name, { name, ret: '', params, owner })
      // 函数参数在函数体内可用
      for (const p of params) addVar(p.name)
      if (owner && !inFunction()) addMember(owner, name, '方法')
      scopes.push({ kind: 'def', name, indent })
      continue
    }

    // 赋值：类体内是字段，函数体内（或顶层）是变量
    const assign = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/.exec(line)
    if (assign) {
      const owner = ownerClass()
      const asField = !!owner && !inFunction()
      for (const raw of assign[1].split(',')) {
        const name = raw.trim()
        if (!/^[A-Za-z_]\w*$/.test(name) || CTL.has(name)) continue
        if (asField) addMember(owner!, name, '字段')
        else addVar(name)
      }
      // 同一行的 lambda 参数也别漏
      const lam = /lambda\s+([^:]+):/.exec(line)
      if (lam) for (const raw of lam[1].split(',')) addVar(raw.trim().replace(/=.*$/, ''))
      continue
    }

    const forIn = /^\s*for\s+([^:]+?)\s+in\b/.exec(line)
    if (forIn) {
      for (const raw of forIn[1].split(',')) addVar(raw.trim().replace(/^\*+/, '').replace(/\(|\)/g, ''))
    }
    for (const m of line.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) addVar(m[1])
    for (const m of line.matchAll(/\(\s*([A-Za-z_]\w*)\s*:=/g)) addVar(m[1])
    const lam2 = /lambda\s+([^:]+):/.exec(line)
    if (lam2) for (const raw of lam2[1].split(',')) addVar(raw.trim().replace(/=.*$/, ''))
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const cache = new Map<string, DocSymbols>()
const CACHE_MAX = 8

export function collectSymbols(lang: Language, code: string): DocSymbols {
  const key = lang + '\u0000' + code
  const hit = cache.get(key)
  if (hit) return hit
  const out = empty()
  try {
    if (lang === 'python') scanPython(code, out)
    else if (lang === 'java') scanJava(code, out)
    else scanCpp(code, out)
  } catch {
    /* 解析失败就当没有符号，不影响补全 */
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, out)
  return out
}
