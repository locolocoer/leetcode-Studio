// Native step-debug backend: gdb for C/C++ (jdb for Java planned).
// Events follow DebugEvent (kind line|breakpoint|finished|error).
import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import type { DebugEvent, DebugVar } from '../shared/types'

export interface NativeRunner {
  step(): void
  over(): void
  resume(): void
  stop(): void
  addBreakpoint(line: number): void
  /** 展开变量的子节点（ref 由上一级返回） */
  children(ref: string): Promise<DebugVar[]>
}

export interface NativeOpts {
  lang: 'c' | 'cpp'
  exe: string
  cwd: string
  env: NodeJS.ProcessEnv
  methodName: string
  initialBps: number[]
  onEvent: (e: DebugEvent) => void
}

function userFile(lang: string): string {
  return lang === 'cpp' ? 'solution.cpp' : 'solution.c'
}

function fileIsUser(fname: string, lang: string): boolean {
  const b = (fname || '').replace(/\\/g, '/').split('/').pop() || ''
  return b === userFile(lang)
}

function capVal(v: string, max = 300): string {
  const s = (v || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  return s.length > max ? s.slice(0, max) + '...' : s
}

/**
 * 结束整棵进程树。Windows 下只杀 gdb/jdb 不会带走被调试的程序
 * （main.exe / java.exe），残留进程会锁住会话目录 → 下次链接报 Permission denied。
 */
function killTree(child: ChildProcess | null): void {
  if (!child || !child.pid) return
  const pid = child.pid
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 8000 }) } catch {}
  }
  try { child.kill('SIGKILL') } catch {}
}

export function startGdbRunner(o: NativeOpts): NativeRunner {  let child: ChildProcess | null = null
  let buf = ''
  const waiters: { re: RegExp; resolve: (m: RegExpExecArray) => void; t?: NodeJS.Timeout }[] = []
  let queue: Promise<unknown> = Promise.resolve()
  let done = false

  function emit(e: DebugEvent) {
    o.onEvent(e)
  }

  function feed(txt: string) {
    buf += txt
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.replace(/\r/g, '')
      if (process.env.LC_GDB_DEBUG) console.error('[mi] ' + line)
      for (let i = 0; i < waiters.length; i++) {
        const m = waiters[i].re.exec(line)
        if (m) {
          const w = waiters[i]
          if (w.t) clearTimeout(w.t)
          waiters.splice(i, 1)
          w.resolve(m)
          break
        }
      }
    }
  }

  function waitFor(re: RegExp, ms = 9000): Promise<RegExpExecArray | null> {
    return new Promise((resolve) => {
      const w = { re, resolve: resolve as (m: RegExpExecArray) => void }
      const t = setTimeout(() => {
        const i = waiters.indexOf(w as never)
        if (i >= 0) waiters.splice(i, 1)
        resolve(null)
      }, ms)
      ;(w as any).t = t
      waiters.push(w as never)
    })
  }

  function send(s: string) {
    if (child && child.stdin && child.exitCode === null && !done) {
      try { child.stdin.write(s) } catch {}
    }
  }

  /** 先注册等待再发送命令，避免响应早于 waiter 注册而丢失 */
  async function sendWait(cmd: string, re: RegExp, ms = 9000): Promise<RegExpExecArray | null> {
    const p = waitFor(re, ms)
    send(cmd)
    const m = await p
    if (!m) markDead('gdb 没有响应（命令超时）。调试会话已结束，请重新开始调试。')
    return m
  }

  // 一旦出现「发出去的命令没有响应」，gdb 与本地的命令队列就失配了：
  // 继续发送只会越来越乱，所以直接结束会话并提示用户重开，绝不假装还在工作。
  function markDead(msg: string): void {
    if (done) return
    done = true
    emit({ kind: 'error', line: 0, message: msg })
    killTree(child)
  }

  child = spawn('gdb', ['-q', '-i=mi3', o.exe], {
    cwd: o.cwd,
    env: o.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdout!.on('data', (d: Buffer) => feed(d.toString('utf8')))
  child.on('close', () => {
    if (!done) {
      done = true
      emit({ kind: 'finished', line: 0 })
    }
  })

  const STOP = /^\*stopped,.*/
  const parseStopped = (line: string) => {
    const reason = /reason="([^"]+)"/.exec(line)?.[1] || ''
    const file = /file="([^"]*)"/.exec(line)?.[1] || ''
    const ln = /line="(\d+)"/.exec(line)?.[1]
    const fn = /func="([^"]*)"/.exec(line)?.[1] || ''
    return { reason, file, line: ln ? parseInt(ln, 10) : null, func: fn }
  }

  // MI: 求值一个表达式，返回紧凑的单行结果（失败返回空串）
  async function evalExpr(expr: string, ms = 9000): Promise<string> {
    const p = waitFor(/^\^done,value="(?:[^"\\]|\\.)*"|^\^error/, ms)
    send('-data-evaluate-expression "' + expr.replace(/"/g, '\\"') + '"\n')
    const m = await p
    if (!m) {
      // 读内存也应该秒回；没响应说明 gdb 已经不正常了
      markDead('gdb 没有响应（读取变量超时）。调试会话已结束，请重新开始调试。')
      return ''
    }
    if (!m[0].startsWith('^done')) return ''
    const vm = /^value="((?:[^"\\]|\\.)*)"/.exec(m[0].slice(m[0].indexOf(',') + 1))
    if (!vm) return ''
    return vm[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // MI 变量对象：拿到变量的类型名和是否有子成员（用来判断是不是结构体）
  async function varCreate(expr: string): Promise<{ vn: string; type: string; numchild: number } | null> {
    const p = waitFor(/^\^done,name="[^"]*".*|^\^error/, 9000)
    send('-var-create - * ' + expr + '\n')
    const m = await p
    if (!m) {
      markDead('gdb 没有响应（创建变量对象超时）。调试会话已结束，请重新开始调试。')
      return null
    }
    if (!m[0].startsWith('^done')) return null
    const line = m[0]
    return {
      vn: /name="((?:[^"\\]|\\.)*)"/.exec(line)?.[1] || '',
      type: (/type="((?:[^"\\]|\\.)*)"/.exec(line)?.[1] || '').replace(/\\"/g, '"'),
      numchild: parseInt(/numchild="(\d+)"/.exec(line)?.[1] || '0', 10)
    }
  }

  async function varDelete(vn: string): Promise<void> {
    if (!vn) return
    const p = waitFor(/^\^done|^\^error/)
    send('-var-delete ' + vn + '\n')
    await p
  }

  const fieldRe = (f: string) => new RegExp('(?:^|[{\\s,])' + f + '\\s*=\\s*([^,}]+)')
  const isZero = (a: string | null) => !a || /^(0x0+|null)$/i.test(a)

  // 把指针指向的结构体展开成 IDE 风格的文本：链表 → ListNode[4, 1, 8]，树 → TreeNode[1, 2, 3]
  async function structExpand(name: string, seen: Set<string>, depth = 0): Promise<string | null> {
    const info = await varCreate(name)
    if (process.env.LC_GDB_DEBUG) console.error('[expand] ' + name + ' info=' + JSON.stringify(info))
    if (!info) return null
    try {
      if (info.numchild === 0) return null
      const typeName = info.type.replace(/\s*\*+\s*$/, '').replace(/^(struct|class|union)\s+/, '') || 'object'
      const head = await evalExpr('*(' + name + ')')
      if (process.env.LC_GDB_DEBUG) console.error('[expand] head=' + head)
      if (!head || !head.startsWith('{') || head.includes('<No data fields>')) return null
      const readField = (s: string, f: string) => {
        const m = fieldRe(f).exec(s)
        return m ? m[1].trim() : null
      }
      const hasField = (s: string, f: string) => fieldRe(f).test(s)
      const val0 = readField(head, 'val')

      // 单链表
      if (val0 != null && hasField(head, 'next')) {
        const out = [val0]
        let cur = head
        let expr = '(' + name + ')'
        for (let i = 0; i < 24; i++) {
          const nx = readField(cur, 'next')
          if (isZero(nx) || !nx) break
          if (seen.has(nx)) { out.push('...(环)'); break }
          seen.add(nx)
          expr = '(' + expr + '->next)'
          const s = await evalExpr('*' + expr)
          if (!s || !s.startsWith('{')) break
          const v = readField(s, 'val')
          if (v == null) break
          out.push(v)
          cur = s
        }
        return typeName + '[' + out.join(', ') + ']'
      }

      // 二叉树：层序，null 补齐后去掉尾部 null
      if (val0 != null && hasField(head, 'left') && hasField(head, 'right')) {
        const parts: string[] = []
        const queue: (string | null)[] = ['(' + name + ')']
        while (queue.length && parts.length < 31) {
          const e = queue.shift()!
          if (e == null) { parts.push('null'); continue }
          const s = await evalExpr('*' + e)
          const v = s && s.startsWith('{') ? readField(s, 'val') : null
          if (v == null) { parts.push('null'); continue }
          parts.push(v)
          const l = readField(s, 'left')
          const r = readField(s, 'right')
          queue.push(isZero(l) ? null : '(' + e + '->left)')
          queue.push(isZero(r) ? null : '(' + e + '->right)')
        }
        while (parts.length && parts[parts.length - 1] === 'null') parts.pop()
        return typeName + '[' + parts.join(', ') + ']'
      }

      // 普通对象：展开一层字段（嵌套结构体再展开一层）
      const fields: string[] = []
      for (const m of head.matchAll(/(?:^|[{\s,])([A-Za-z_]\w*)\s*=\s*([^,}]+)/g)) {
        if (fields.length >= 10) { fields.push('...'); break }
        const fn = m[1]
        const fv = m[2].trim()
        if (depth < 1 && /^0x[0-9a-fA-F]+$/.test(fv) && !isZero(fv) && !seen.has(fv)) {
          seen.add(fv)
          const sub = await structExpand('(' + name + ')->' + fn, seen, depth + 1)
          fields.push(fn + '=' + (sub ?? fv))
        } else {
          fields.push(fn + '=' + fv)
        }
      }
      if (!fields.length) return null
      return typeName + '{' + fields.join(', ') + '}'
    } finally {
      await varDelete(info.vn)
    }
  }

  // 变量读取统一走 readVars()（预览 + 可展开树），这里不再保留旧实现。

  // -------------------------------------------------------------------------
  // STL 容器显示：全部基于 gdb 读内存（-data-evaluate-expression 里的取址/解引用），
  // 不调用被调试程序里的任何函数。
  //
  // 之前用 lc_show(x) 这种「在被调试程序里执行函数」的方式渲染容器，
  // 一旦这次 inferior call 卡住（C++ 静态初始化/锁/分配都可能），
  // gdb 就永远停在调用里 —— 之后再发单步/步过都没有响应，表现为「点步过卡死」。
  // -------------------------------------------------------------------------

  /** 从 std::vector<T, A> 的类型名里取出 T（处理嵌套模板） */
  function firstTemplateArg(type: string): string | null {
    const i = type.indexOf('<')
    if (i < 0) return null
    let depth = 0
    for (let k = i; k < type.length; k++) {
      const c = type[k]
      if (c === '<') depth++
      else if (c === '>') {
        depth--
        if (depth === 0) {
          const inner = type.slice(i + 1, k)
          // 取顶层第一个逗号之前的类型
          let d2 = 0
          for (let j = 0; j < inner.length; j++) {
            const cj = inner[j]
            if (cj === '<') d2++
            else if (cj === '>') d2--
            else if (cj === ',' && d2 === 0) return inner.slice(0, j).trim()
          }
          return inner.trim()
        }
      }
    }
    return null
  }

  const isVectorType = (t: string) => /^std::vector<\s*/.test(t) || /^std::__cxx11::vector</.test(t)
  const isStringType = (t: string) => /basic_string<|^std::string$/.test(t)
  const isAssocType = (t: string) =>
    /^std::(unordered_)?(map|set)</.test(t) || /^std::(unordered_)?multimap</.test(t) || /^std::(unordered_)?multiset</.test(t)
  const isMapType = (t: string) => /^std::(unordered_)?(multi)?map</.test(t)
  const SCALAR = /^(const\s+)?(int|long|short|char|signed|unsigned|size_t|double|float|bool|auto|void)(\s*\*?)?$/
  /** 该类型是否值得再展开一层（去掉 const / 指针 / 引用修饰再判断） */
  const isExpandableType = (t: string) => {
    const s = t.replace(/\b(const|volatile)\b/g, '').replace(/[*&\s]+$/, '').replace(/\s+/g, ' ').trim()
    if (!s) return false
    if (isVectorType(s) || isAssocType(s) || /^std::pair</.test(s)) return true
    if (SCALAR.test(s)) return false
    if (/^std::/.test(s)) return false            // std::string 等已在本行显示内容
    return /^[A-Za-z_]\w*(<[^>]*>)?$/.test(s)     // 自定义结构体 / 类
  }

  function fmtSeq(items: string[], more: boolean): string {
    return '[' + items.join(', ') + (more ? ', …' : '') + ']'
  }

  /** 读 vector 的 size：finish - start */
  async function vecCount(expr: string): Promise<number> {
    const s = await evalExpr(`(${expr})._M_impl._M_finish - (${expr})._M_impl._M_start`, 4000)
    const n = parseInt(s.replace(/[^0-9-]/g, ''), 10)
    return Number.isFinite(n) && n >= 0 ? n : -1
  }

  /** 读 vector<T>（T 为标量）的元素：start[0]@n，gdb 直接打印成 {a, b, c} */
  async function vecScalarItems(expr: string, n: number): Promise<string[]> {
    const s = await evalExpr(`(${expr})._M_impl._M_start[0]@${n}`, 5000)
    const m = /^\{(.*)\}$/s.exec(s.trim())
    if (!m) return []
    return m[1].split(',').map((x) => x.trim()).filter((x) => x !== '')
  }

  async function readStl(name: string): Promise<string | null> {
    const info = await varCreate(name)
    if (!info) return null
    try {
      const type = info.type
      if (isStringType(type) && !/vector/.test(type)) {
        // std::string：读 _M_dataplus._M_p，gdb 会打印成 0x... "abc"
        const s = await evalExpr(`(${name})._M_dataplus._M_p`, 4000)
        const q = /"(.*)"\s*$/.exec(s)
        return q ? '"' + q[1] + '"' : null
      }
      if (isVectorType(type)) {
        // vector<bool> 是位压缩的特殊实现，跳过（不冒险）
        const elem = firstTemplateArg(type) || ''
        if (/\bbool\b/.test(elem)) return null
        const n = await vecCount(name)
        if (n < 0) return null
        if (n === 0) return '[]'
        const show = Math.min(n, 24)
        if (isVectorType(elem)) {
          // vector<vector<T>>：逐个读内层
          const out: string[] = []
          for (let i = 0; i < show; i++) {
            const inner = `(${name})._M_impl._M_start[${i}]`
            const k = await vecCount(inner)
            if (k <= 0) { out.push('[]'); continue }
            out.push(fmtSeq(await vecScalarItems(inner, Math.min(k, 24)), k > 24))
          }
          return fmtSeq(out, n > show)
        }
        if (isStringType(elem)) {
          const out: string[] = []
          for (let i = 0; i < show; i++) {
            const s = await evalExpr(`(${name})._M_impl._M_start[${i}]._M_dataplus._M_p`, 4000)
            const q = /"(.*)"\s*$/.exec(s)
            out.push(q ? '"' + q[1] + '"' : '""')
          }
          return fmtSeq(out, n > show)
        }
        const items = await vecScalarItems(name, show)
        if (!items.length) return null
        return fmtSeq(items, n > show)
      }
      if (isAssocType(type)) {
        // map/set 的结点结构不适合用表达式遍历（会退化成函数调用或极深的字段访问），
        // 这里只报元素个数，保证绝不卡住调试器。
        const cntField = /unordered/.test(type)
          ? `(${name})._M_h._M_element_count`
          : `(${name})._M_t._M_impl._M_node_count`
        const s = await evalExpr(cntField, 4000)
        const n = parseInt(s.replace(/[^0-9-]/g, ''), 10)
        if (!Number.isFinite(n) || n < 0) return null
        const label = /unordered_map|^std::map/.test(type) ? 'map' : 'set'
        return n === 0 ? '{}' : `{${label}: ${n} 项}`
      }
      return null
    } finally {
      await varDelete(info.vn)
    }
  }

  // -------------------------------------------------------------------------
  // 变量树：点击展开（只读内存，绝不调用被调试程序里的函数）
  // -------------------------------------------------------------------------

  const MAX_CHILDREN = 64

  /** 折叠时显示的一行预览 */
  async function previewOf(expr: string, type: string): Promise<string> {
    if (isStringType(type) && !isVectorType(type)) {
      const s = await evalExpr(`(${expr})._M_dataplus._M_p`, 4000)
      const q = /"(.*)"\s*$/.exec(s)
      return q ? '"' + q[1] + '"' : '""'
    }
    if (isVectorType(type)) {
      const n = await vecCount(expr)
      if (n < 0) return '?'
      if (n === 0) return '[]'
      const elem = firstTemplateArg(type) || ''
      if (isVectorType(elem) || isAssocType(elem) || isStringType(elem)) {
        // 嵌套容器：项数不多时把内容也显示出来，多了就只报个数（内容可展开看）
        if (n > 3) return `[${n} 项]`
        const parts: string[] = []
        for (let i = 0; i < n; i++) {
          parts.push((await previewOf(`(${expr})._M_impl._M_start[${i}]`, elem)) || '?')
        }
        return '[' + parts.join(', ') + ']'
      }
      const show = Math.min(n, 12)
      const items = await vecScalarItems(expr, show)
      if (!items.length) return `[${n} 项]`
      return items.length <= show ? fmtSeq(items, n > show) : `[${n} 项]`
    }
    if (isAssocType(type)) {
      const n = await assocCount(expr, type)
      return n < 0 ? '?' : n === 0 ? '{}' : `{${n} 项}`
    }
    return ''
  }

  async function assocCount(expr: string, type: string): Promise<number> {
    const field = /unordered/.test(type)
      ? `(${expr})._M_h._M_element_count`
      : `(${expr})._M_t._M_impl._M_node_count`
    const s = await evalExpr(field, 4000)
    const n = parseInt(s.replace(/[^0-9-]/g, ''), 10)
    return Number.isFinite(n) && n >= 0 ? n : -1
  }

  interface RawChild { exp: string; numchild: number; value: string; type: string }

  async function listVarChildren(vn: string): Promise<RawChild[]> {
    const p = waitFor(/^\^done,numchild="\d+",children=\[.*|^\^done,numchild="0"/, 8000)
    send(`-var-list-children --all-values ${vn}\n`)
    const m = await p
    if (!m) { markDead('gdb 没有响应（展开变量超时）。调试会话已结束，请重新开始调试。'); return [] }
    const line = m[0]
    const out: RawChild[] = []
    const re = /child=\{name="(?:[^"\\]|\\.)*",exp="((?:[^"\\]|\\.)*)",numchild="(\d+)",value="((?:[^"\\]|\\.)*)"(?:,type="((?:[^"\\]|\\.)*)")?/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(line))) {
      out.push({
        exp: mm[1].replace(/\\"/g, '"'),
        numchild: parseInt(mm[3], 10),
        value: capVal(mm[4] ?? ''),
        type: (mm[5] || '').replace(/\\"/g, '"')
      })
      if (out.length >= MAX_CHILDREN + 8) break
    }
    return out
  }

  /** 结构体 / 对象的字段（含 C++ 访问修饰符分组的一层展开） */
  async function structChildren(expr: string, vn: string, depth = 0): Promise<DebugVar[]> {
    const kids = await listVarChildren(vn)
    const out: DebugVar[] = []
    for (const k of kids) {
      const isAccessGroup = /^(public|private|protected)$/.test(k.exp)
      if (isAccessGroup) {
        if (depth < 1) {
          // 展开访问分组里的字段
          const sub = await structChildren(expr, `${vn}.${k.exp}`, depth + 1)
          out.push(...sub)
        }
        continue
      }
      const t = k.type || ''
      out.push({
        name: k.exp,
        value: k.value !== '' ? k.value : (isVectorType(t) ? await previewOf(`${expr}.${k.exp}`, t) : ''),
        ref: `(${expr}).${k.exp}`,
        expandable: k.numchild > 0 || isExpandableType(t)
      })
      if (out.length >= MAX_CHILDREN) break
    }
    return out
  }

  /** 展开一个节点：ref 是本模块生成并回传的 gdb 表达式 */
  async function childList(ref: string): Promise<DebugVar[]> {
    if (!ref || ref.length > 500 || done) return []
    const info = await varCreate(ref)
    if (!info) return []
    try {
      const type = info.type.replace(/\s*\*+$/, '').trim()
      // vector<T>
      if (isVectorType(type)) {
        const n = await vecCount(ref)
        if (n <= 0) return []
        const show = Math.min(n, MAX_CHILDREN)
        const elem = firstTemplateArg(type) || ''
        const scalarElem = SCALAR.test(elem)
        const out: DebugVar[] = []
        if (scalarElem) {
          const items = await vecScalarItems(ref, show)
          for (let i = 0; i < items.length; i++) {
            out.push({ name: `[${i}]`, value: items[i], ref: `(${ref})._M_impl._M_start[${i}]`, expandable: false })
          }
        } else {
          for (let i = 0; i < show; i++) {
            const childRef = `(${ref})._M_impl._M_start[${i}]`
            out.push({ name: `[${i}]`, value: await previewOf(childRef, elem), ref: childRef, expandable: true })
          }
        }
        if (n > show) out.push({ name: '…', value: `还有 ${n - show} 项`, ref: '', expandable: false })
        return out
      }
      if (isAssocType(type) || isStringType(type)) return []   // 暂不展开内容（避免版本相关的内存遍历）
      // 结构体 / 类 / pair（含 ListNode、TreeNode、自定义对象）
      return await structChildren(ref, info.vn)
    } finally {
      await varDelete(info.vn)
    }
  }

  /** 把 MI 的 `{k="v",...}` 列表切成一个个对象字符串（引号内的括号不参与计数） */
  function splitMiObjects(s: string): string[] {
    const out: string[] = []
    let depth = 0
    let start = -1
    let inStr = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (inStr) {
        if (c === '\\') { i++; continue }
        if (c === '"') inStr = false
        continue
      }
      if (c === '"') { inStr = true; continue }
      if (c === '{') { if (depth === 0) start = i + 1; depth++ }
      else if (c === '}') {
        depth--
        if (depth === 0 && start >= 0) { out.push(s.slice(start, i)); start = -1 }
      }
    }
    return out
  }

  /** 从扁平对象串里取字段 */
  function miFields(obj: string): Record<string, string> {
    const r: Record<string, string> = {}
    const re = /([A-Za-z-]+)="((?:[^"\\]|\\.)*)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(obj))) r[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    return r
  }

  /** 顶层变量列表：每个变量带 ref、类型与「是否可展开」 */
  async function readVars(): Promise<DebugVar[]> {
    const p = waitFor(/^\^done,variables=\[.*/, 8000)
    // --simple-values 会带上 type（标量还带 value），据此决定是否显示展开箭头
    send('-stack-list-variables --thread 1 --frame 0 --simple-values\n')
    const m = await p
    if (!m) return []
    const rest = m[0].slice(m[0].indexOf('[') + 1)
    const out: DebugVar[] = []
    for (const obj of splitMiObjects(rest)) {
      const f = miFields(obj)
      const name = f.name
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
      const type = f.type || ''
      const raw = capVal(f.value ?? '')
      const preview = await previewForLocal(name, raw, type)
      out.push({
        name,
        value: preview,
        ref: name,
        expandable: type ? isExpandableType(type.replace(/\s*\*+\s*$/, '').trim()) : true
      })
      if (out.length >= 40) break
    }
    return out
  }

  /** 顶层变量的预览：结构体指针展开成 ListNode[...]，容器展开成 [..] */
  async function previewForLocal(name: string, raw: string, type: string): Promise<string> {
    if (/^0x[0-9a-fA-F]+$/.test(raw.trim()) && !isZero(raw.trim())) {
      const rendered = await structExpand(name, new Set([raw.trim().toLowerCase()]))
      if (rendered) return capVal(rendered, 300)
      return raw
    }
    if (type && (isVectorType(type) || isStringType(type) || isAssocType(type))) {
      const rendered = await previewOf(name, type)
      if (rendered) return capVal(rendered, 300)
    }
    if (/std::|{<|_M_|\.\.\.}/.test(raw)) {
      const rendered = await readStl(name)
      if (rendered) return capVal(rendered, 300)
    }
    return raw
  }

  function isLocallyExpandable(_name: string): boolean {
    return true
  }

  async function stopInUser(st: { reason: string; line: number | null; func: string }, kindDefault: 'breakpoint' | 'line') {
    // 只读一轮变量：预览与树共用，避免每个停顿重复解析
    const vars = await readVars()
    const l: Record<string, string> = {}
    for (const v of vars) l[v.name] = v.value
    const line = st.line ?? 0
    emit({
      kind: st.reason === 'breakpoint-hit' ? 'breakpoint' : kindDefault,
      line,
      frame: { name: st.func, line, locals: l, vars }
    })
  }

  // advance until a stop in the user file or the program exits
  async function waitUserStop(): Promise<void> {
    // 用「继续」在驱动代码里穿行：给总时间预算，避免无限等待
    const deadline = Date.now() + 60_000
    let count = 0
    while (Date.now() < deadline && count < 200) {
      const p = waitFor(STOP, 15000)
      send('-exec-continue\n')
      const m = await p
      if (!m) { markDead('gdb 没有响应（继续执行超时）。调试会话已结束，请重新开始调试。'); return }
      count++
      const st = parseStopped(m[0])
      if (st.reason === 'exited-normally' || st.reason === 'exited') {
        emit({ kind: 'finished', line: 0 })
        return
      }
      if (st.line != null && fileIsUser(st.file, o.lang)) {
        await stopInUser(st, 'line')
        return
      }
    }
    markDead('gdb 始终没有回到你的代码。调试会话已结束，请重新开始调试。')
  }

  function bootstrap() {
    queue = queue.then(async () => {
      // 注意：必须「先注册等待再发送」，否则响应可能在 waiter 注册前就到达并被丢弃，
      // 之后每个命令都要白等一次超时（表现为点击单步/步过长时间无反应）。
      await sendWait('-gdb-set print pretty on\n', /^\^done/)
      await sendWait('-enable-pretty-printing\n', /^\^done/)
      await sendWait('-interpreter-exec console "set print elements 32"\n', /^\^done/)
      if (o.initialBps.length === 0) {
        await sendWait('-break-insert ' + o.methodName + '\n', /^\^done,bkpt=.*/)
      }
      for (const b of o.initialBps) {
        await sendWait('-break-insert -f ' + userFile(o.lang) + ':' + b + '\n', /^\^done,bkpt=.*/)
      }
      const p = waitFor(STOP)
      send('-interpreter-exec console "run < input.txt"\n')
      const m = await p
      if (!m) { markDead('gdb 启动程序失败（没有收到停止事件）。'); return }
      const st = parseStopped(m[0])
      if (st.reason === 'exited-normally' || st.reason === 'exited') {
        emit({ kind: 'finished', line: 0 })
        return
      }
      if (st.line != null && fileIsUser(st.file, o.lang)) {
        await stopInUser(st, 'breakpoint')
      } else {
        await waitUserStop()
      }
    })
  }

  // 单步/步过共用的推进循环：总预算 + 单次响应超时，避免「点了没反应」长时间挂着
  async function advance(cmd: '-exec-step' | '-exec-next', label: '步进' | '步过'): Promise<void> {
    const deadline = Date.now() + 25_000   // 总预算：跨过 STL 内部最多给 25 秒
    let count = 0
    while (Date.now() < deadline && count < 300) {
      const p = waitFor(STOP, 8000)
      send(cmd + '\n')
      const m = await p
      if (!m) {
        markDead(`gdb 没有响应（${label}超时）。调试会话已结束，请重新开始调试。`)
        return
      }
      count++
      const st = parseStopped(m[0])
      if (st.reason === 'exited-normally' || st.reason === 'exited') {
        emit({ kind: 'finished', line: 0 })
        return
      }
      if (st.reason === 'breakpoint-hit' || (st.line != null && fileIsUser(st.file, o.lang))) {
        await stopInUser(st, label === '步过' ? 'line' : 'line')
        return
      }
    }
    emit({
      kind: 'error', line: 0,
      message: `${label}时间过长：这一行可能进入了很深的库代码（如 STL 内部）。可以改用「继续」跑到断点，或把断点放到更外层。`
    })
  }

  function stepInto(): void {
    if (done) return
    queue = queue.then(() => advance('-exec-step', '步进'))
  }

  function nextOver(): void {
    if (done) return
    queue = queue.then(() => advance('-exec-next', '步过'))
  }

  bootstrap()

  return {
    step: stepInto,
    over: nextOver,
    resume: () => {
      if (done) return
      queue = queue.then(() => waitUserStop())
    },
    addBreakpoint: (line) => {
      if (done) return
      queue = queue.then(async () => {
        await sendWait('-break-insert -f ' + userFile(o.lang) + ':' + line + '\n', /^\^done,bkpt=.*/)
      })
    },
    stop: () => {
      done = true
      killTree(child)
    },
    children: (ref: string) => childList(ref)
  }
}

// ---------------------------------------------------------------------------
// Java via jdb
// ---------------------------------------------------------------------------
export interface JdbOpts {
  jdbPath: string
  javaExe: string // when set, attach to a suspend=y VM instead of 'run'
  cwd: string
  env: NodeJS.ProcessEnv
  userClass: string
  entryMethod: string
  classMode: boolean
  initialBps: number[]
  onEvent: (e: DebugEvent) => void
}

const JDB_STOP = /(?:Breakpoint hit|Step completed):[^\n]*?\b([\w.$<>]+)\(\), line=(\d+)/i

export function startJdbRunner(o: JdbOpts): NativeRunner {
  let child: ChildProcess | null = null
  let javaChild: ChildProcess | null = null
  let buf = ''
  let done = false
  const log: string[] = []
  let queue: Promise<unknown> = Promise.resolve()

  function emit(e: DebugEvent) {
    o.onEvent(e)
  }
  function feed(txt: string) {
    buf += txt
    const parts = buf.split('\n')
    buf = parts.pop() || ''
    for (const raw of parts) {
      const line = raw.replace(/\r/g, '')
      if (process.env.LC_JDB_DEBUG) console.error('[jdb] ' + line)
      log.push(line)
    }
  }
  function send(s: string) {
    if (child && child.stdin && child.exitCode === null && !done) {
      try { child.stdin.write(s + '\n') } catch {}
    }
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const stopLine = /([\w.$<>]+)\(\),\s*(?:line|行)=(\d+)/i
  const exitText = /exited|退出|应用/i

  // Collect new log lines until one matches pred, then return the whole new segment.
  // base 可在发送命令前先取好，避免响应早于基准而漏读。
  async function waitSeg(pred: (seg: string[]) => boolean, timeoutMs = 15000, base = log.length): Promise<string[]> {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      await sleep(150)
      const seg = log.slice(base)
      if (pred(seg)) return seg
    }
    return log.slice(base)
  }

  function segHasStop(seg: string[]): boolean {
    return seg.some((l) => stopLine.test(l))
  }
  function segHasExit(seg: string[]): boolean {
    return seg.some((l) => exitText.test(l))
  }
  function parseStopSeg(seg: string[]): { cls: string; line: number } | null {
    for (const l of seg) {
      const m = stopLine.exec(l)
      if (m) return { cls: m[1].split('.')[0], line: parseInt(m[2], 10) }
    }
    return null
  }
  function parseLocals(seg: string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const l of seg) {
      const m = /^\s*(\S+)\s*=\s*(.*)$/.exec(l)
      if (m && !/^>/.test(l)) {
        const v = m[2].trim()
        out[m[1]] = v.length > 300 ? v.slice(0, 300) + '...' : v
      }
    }
    return out
  }

  const PRIMITIVE = /^(null|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|'.*'|".*")$/s
  // null 表示还没试过；false 表示 LcDbg 展开不可用（后面不再尝试，避免每次停顿都等待超时）
  let expandOk: boolean | null = null

  async function locals(): Promise<Record<string, string>> {
    send('locals')
    const seg = await waitSeg(() => false, 250) // capture ~250ms of output
    const out = parseLocals(seg)
    // jdb 对对象只给 instance of X(id=N)：用 LcDbg.show 展开成 IDE 风格的链表/树/字段
    const names = Object.keys(out).filter(
      (n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) && !PRIMITIVE.test(out[n].trim())
    )
    if (names.length && expandOk !== false) {
      const joiner = ' + " | " + '
      const expr = names.map((n) => JSON.stringify(n + '=') + ' + LcDbg.show(' + n + ')').join(joiner)
      const rendered = await jdbPrint(expr)
      if (!rendered) expandOk = false
      else {
        expandOk = true
        for (const part of rendered.split(' | ')) {
          const eq = part.indexOf('=')
          if (eq <= 0) continue
          const name = part.slice(0, eq).trim()
          if (names.includes(name)) out[name] = capTxt(part.slice(eq + 1).trim(), 300)
        }
      }
    }
    return out
  }

  // 单行表达式求值（jdb print）；返回结果字符串（去掉外层引号）
  async function jdbPrint(expr: string): Promise<string> {
    const base = log.length
    send('print ' + expr)
    const t0 = Date.now()
    while (Date.now() - t0 < 2500) {
      await sleep(60)
      for (const l of log.slice(base)) {
        const line = l.replace(/^>\s*/, '')
        if (/^(error|错误)|not a valid|Unable to|Unknown|Cannot |unable to|No such/i.test(line)) return ''
        const m = /^.+? = (.*)$/.exec(line)
        if (m) {
          const v = m[1].trim()
          return /^".*"$/.test(v) ? v.slice(1, -1) : v
        }
      }
    }
    return ''
  }

  function capTxt(v: string, max: number): string {
    return v.length > max ? v.slice(0, max) + '...' : v
  }

  async function emitStop(seg: string[], kind: 'breakpoint' | 'line'): Promise<void> {
    const st = parseStopSeg(seg)
    if (!st) { emit({ kind: 'finished', line: 0 }); return }
    const loc = await locals()
    emit({ kind, line: st.line, frame: { name: o.userClass, line: st.line, locals: loc } })
  }

  // advance with a command until a user stop / exit
  async function advance(cmd: string): Promise<void> {
    const deadline = Date.now() + 60_000
    for (let i = 0; i < 200 && Date.now() < deadline; i++) {
      const base = log.length           // 先取基准，再发命令，避免漏读响应
      send(cmd)
      const seg = await waitSeg((s) => segHasStop(s) || segHasExit(s), 15000, base)
      if (segHasExit(seg) && !segHasStop(seg)) {
        emit({ kind: 'finished', line: 0 })
        return
      }
      const st = parseStopSeg(seg)
      if (!st) {
        emit({ kind: 'finished', line: 0 })
        return
      }
      if (st.cls === o.userClass) {
        await emitStop(seg, cmd === 'cont' ? 'breakpoint' : 'line')
        return
      }
      // driver stop: for cont keep going; for step/next treat as leaving user code -> run out
      if (cmd !== 'cont') {
        const seg2 = await waitSeg((s) => segHasExit(s), 8000)
        void seg2
        emit({ kind: 'finished', line: 0 })
        return
      }
    }
    emit({ kind: 'error', line: 0, message: 'jdb advance timeout' })
  }

  function freePort(): Promise<number> {
    return new Promise((res, rej) => {
      const srv = createServer()
      srv.once('error', rej)
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as { port: number }).port
        srv.close(() => res(port))
      })
    })
  }

  function bootstrap() {
    queue = queue.then(async () => {
      send('stop in Main.main')
      await sleep(300)
      for (const b of o.initialBps) {
        send('stop at ' + o.userClass + ':' + b)
        await sleep(250)
      }
      // first stop will be Main.main (driver); then move to user bp / entry
      if (o.initialBps.length > 0) {
        await advance('cont')
      } else {
        // step until first user stop
        for (let i = 0; i < 120; i++) {
          send('step')
          const seg = await waitSeg((s) => segHasStop(s) || segHasExit(s))
          if (segHasExit(seg) && !segHasStop(seg)) { emit({ kind: 'finished', line: 0 }); return }
          const st = parseStopSeg(seg)
          if (st && st.cls === o.userClass) {
            await emitStop(seg, 'line')
            return
          }
        }
        emit({ kind: 'error', line: 0, message: 'jdb entry timeout' })
      }
    })
  }

  queue = queue.then(async () => {
    const port = await freePort()
    javaChild = spawn(o.javaExe, [
      '-agentlib:jdwp=transport=dt_socket,address=127.0.0.1:' + port + ',server=y,suspend=y',
      '-classpath', o.cwd, 'Main'
    ], { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] })
    javaChild.stdout?.on('data', () => {})
    javaChild.stderr?.on('data', () => {})
    await sleep(1200)
    child = spawn(o.jdbPath, ['-J-Duser.language=en', '-J-Duser.country=US', '-connect', 'com.sun.jdi.SocketAttach:hostname=127.0.0.1,port=' + port], { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout!.on('data', (d: Buffer) => feed(d.toString('utf8')))
    child.on('close', () => {
      if (!done) { done = true; emit({ kind: 'finished', line: 0 }) }
    })
    await sleep(1000)
  })
  bootstrap()

  return {
    step: () => { queue = queue.then(() => advance('step')) },
    over: () => { queue = queue.then(() => advance('next')) },
    resume: () => { queue = queue.then(() => advance('cont')) },
    children: async () => [],   // jdb 侧暂不支持变量树
    addBreakpoint: (line) => {
      queue = queue.then(() => { send('stop at ' + o.userClass + ':' + line); return sleep(200) })
    },
    stop: () => {
      done = true
      killTree(child)
      killTree(javaChild)
    }
  }
}
