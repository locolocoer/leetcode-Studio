import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, dirname, delimiter } from 'path'
import type {
  DebugEvent, DebugSnapshot, Language, Problem, TestCase, ToolchainStatus
} from '../shared/types'
import { sanitize, isLockError, killProcessesUnder } from './runner'
import { buildHarness, intersectIndices, pyShapes, pyIndent, isNodeReturn, PY_NODES } from './harness'
import { startGdbRunner, startJdbRunner, type NativeRunner } from './nativeDebug'

export type DebuggerEvents = {
  onEvent?: (e: DebugEvent) => void
  onOutput?: (text: string) => void
  onDone?: (finished: boolean) => void
}

// 调试产物的「残留进程」处理见 runner.ts 的 isLockError / killProcessesUnder：
// Windows 上杀掉 gdb / jdb 不会带走被调试的程序，残留进程会锁住会话目录，
// 导致下一次链接报 `ld.exe: cannot open output file main.exe: Permission denied`。
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PY_DEBUG_SCRIPT = `#!/usr/bin/env python3
import sys, json, os
_ORIG = sys.stdout
def emit(obj):
    _ORIG.write("@@DBG " + json.dumps(obj) + "\\n"); _ORIG.flush()
def emit_out(text):
    _ORIG.write("@@OUT " + json.dumps(text) + "\\n"); _ORIG.flush()
def fmt_value(v):
    try:
        if v is None or isinstance(v, (int, float, bool, str)):
            s = repr(v)
            return s if len(s) <= 120 else s[:117] + '...'
        if isinstance(v, (list, tuple, dict, set)):
            s = repr(v)
            return s if len(s) <= 160 else s[:157] + '...'
        name = type(v).__name__
        if hasattr(v, 'next') and hasattr(v, 'val'):
            out = []; cur = v; seen = set()
            for _ in range(24):
                if cur is None: break
                if id(cur) in seen: out.append('...cycle'); break
                seen.add(id(cur))
                out.append(repr(getattr(cur, 'val', None)))
                cur = getattr(cur, 'next', None)
            return name + '[' + ', '.join(out) + ']'
        if hasattr(v, 'left') and hasattr(v, 'right') and hasattr(v, 'val'):
            out = []; q = [v]; n = 0
            while q and n < 31:
                node = q.pop(0)
                if node is None: out.append('null'); continue
                out.append(repr(getattr(node, 'val', None)))
                q.append(getattr(node, 'left', None)); q.append(getattr(node, 'right', None)); n += 1
            while out and out[-1] == 'null': out.pop()
            return name + '[' + ', '.join(out) + ']'
        if hasattr(v, '__dict__'):
            items = []
            for k, val in list(vars(v).items())[:8]:
                items.append(k + '=' + repr(val))
            s = name + '(' + ', '.join(items) + ')'
            return s if len(s) <= 200 else s[:197] + '...'
        s = repr(v)
        return s if len(s) <= 120 else s[:117] + '...'
    except Exception:
        return '<unrepr>'
def locals_of(frame):
    out = {}
    for k, v in frame.f_locals.items():
        out[k] = fmt_value(v)
    return out
def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "Solution"
    input_path = sys.argv[2] if len(sys.argv) > 2 else None
    bps = set()
    if len(sys.argv) > 3 and sys.argv[3]:
        for x in sys.argv[3].split(","):
            x = x.strip()
            if x.isdigit(): bps.add(int(x))
    # snap breakpoints to executable statement lines (Python emits line events there only)
    try:
        import ast as _ast
        _here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(_here, "solution.py"), encoding="utf-8-sig") as _fh:
            _tree = _ast.parse(_fh.read())
        _exec_lines = set()
        _defmap = {}
        def _first_body(n):
            stack = list(getattr(n, "body", []) or [])
            while stack:
                c = stack.pop(0)
                if isinstance(c, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)): continue
                if hasattr(c, "lineno") and c.lineno: return c.lineno
                stack[0:0] = list(_ast.iter_child_nodes(c))
            return None
        for n in _ast.walk(_tree):
            if not isinstance(n, _ast.stmt): continue
            if isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                f = _first_body(n)
                if f: _defmap[n.lineno] = f
                continue
            if hasattr(n, "lineno") and n.lineno: _exec_lines.add(n.lineno)
        _nb = set()
        for b in bps:
            b = _defmap.get(b, b)
            if b not in _exec_lines:
                _ge = sorted(l for l in _exec_lines if l >= b)
                if _ge: b = _ge[0]
            _nb.add(b)
        bps = _nb
    except Exception:
        pass
    import importlib
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sol = importlib.import_module("solution")
    cls = getattr(sol, target)
${pyIndent(PY_NODES)}
    _lc_ln = getattr(sol, "ListNode", None)
    if _lc_ln is not None:
        ListNode = _lc_ln
    else:
        sol.ListNode = ListNode
    _lc_tn = getattr(sol, "TreeNode", None)
    if _lc_tn is not None:
        TreeNode = _lc_tn
    else:
        sol.TreeNode = TreeNode
    lines = []
    if input_path and os.path.exists(input_path):
        with open(input_path, "r", encoding="utf-8-sig") as f:
            lines = [l for l in f.read().split("\\n") if l.strip()]
    if not lines:
        emit({"kind": "error", "message": "no input provided"}); sys.exit(1)
    state = {"mode": "run" if bps else "step", "over_frame": None, "stop": False}
    def pause(frame, event, line):
        emit({"kind": "breakpoint" if event == "breakpoint" else "line", "line": line,
              "frame": {"name": frame.f_code.co_name, "line": line, "locals": locals_of(frame)}})
        while True:
            cmd = sys.stdin.readline().strip() if sys.stdin else ""
            if cmd == "stop":
                state["stop"] = True; return None
            if cmd.startswith("break "):
                try: bps.add(int(cmd.split()[1]))
                except Exception: pass
                continue
            break
        if cmd == "step": state["mode"] = "step"
        elif cmd == "over": state["mode"] = "over"; state["over_frame"] = frame
        else: state["mode"] = "run"
        return trace
    def trace(frame, event, arg):
        if state["stop"]: return None
        fn = frame.f_code.co_filename
        if not fn.endswith("solution.py"): return trace
        line = frame.f_lineno
        if event == "line":
            if state["mode"] == "step": return pause(frame, "line", line)
            if state["mode"] == "over" and frame is state["over_frame"]: return pause(frame, "line", line)
            if line in bps: return pause(frame, "breakpoint", line)
        elif event == "exception":
            emit({"kind": "exception", "line": line, "message": str(arg[1])})
        return trace
    class _Capture:
        def write(self, s): emit_out(s); return len(s)
        def flush(self): sys.__stdout__.flush()
    real_stdout = sys.stdout
    try:
        sys.settrace(trace); sys.stdout = _Capture()
        judge = os.environ.get("LC_JUDGE", "function"); method = os.environ.get("LC_METHOD", "run")
        if judge == "class":
            ops = json.loads(lines[0]); argsets = json.loads(lines[1]) if len(lines) > 1 else []
            obj = cls(*argsets[0]); out = [None]
            for i in range(1, len(ops)):
                r = getattr(obj, ops[i])(*argsets[i]); out.append(r)
            print(json.dumps(out, ensure_ascii=False, default=lambda o: None))
        elif os.environ.get("LC_MANUAL", "") == "intersect":
            # 手动判题：相交链表 —— 构造共享节点后按真实签名(2参)调用
            class ListNode(object):
                def __init__(self, x=0):
                    self.val = x
                    self.next = None
            sol.ListNode = ListNode
            iv = json.loads(lines[int(os.environ["LC_IV"])])
            A = json.loads(lines[int(os.environ["LC_LA"])])
            B = json.loads(lines[int(os.environ["LC_LB"])])
            sa = json.loads(lines[int(os.environ["LC_SA"])])
            sb = json.loads(lines[int(os.environ["LC_SB"])])
            def _build(arr):
                d = ListNode(); c = d
                for v in arr:
                    c.next = ListNode(v); c = c.next
                return d.next
            headA = _build(A)
            if iv != 0:
                shared = headA
                for _ in range(sa):
                    if shared is not None: shared = shared.next
                if sb <= 0:
                    headB = shared
                else:
                    headB = _build(B)
                    t = headB
                    for _ in range(sb - 1):
                        if t is not None: t = t.next
                    if t is not None: t.next = shared
            else:
                headB = _build(B)
            obj = cls()
            rr = getattr(obj, method)(headA, headB)
            print(json.dumps(rr.val if rr else 0))
        else:
            shapes = json.loads(os.environ.get("LC_SHAPES", "[]"))
            args = _lc_load([json.loads(l) for l in lines], shapes)
            obj = cls(); result = getattr(obj, method)(*args)
            if result is None and os.environ.get("LC_RET_NODE") == "1":
                result = []
            print(json.dumps(_lc_dump(result), ensure_ascii=False, default=lambda o: None))
    finally:
        sys.stdout = real_stdout; sys.settrace(None); emit({"kind": "finished"})
main()
`

function classNameFor(problem: Problem): string {
  return problem.judgeType === 'class' ? problem.methodName : 'Solution'
}

const DEBUG_WATCHDOG_MS = 90_000



export class DebugSession {
  private child: ChildProcess | null = null
  private snap: DebugSnapshot
  private events: DebugEvent[] = []
  private out = ''
  private cb: DebuggerEvents
  private dir = ''
  private logPath = ''
  private watchdog: NodeJS.Timeout | null = null
  private stopped = false
  private native: NativeRunner | null = null

  constructor(cb: DebuggerEvents) {
    this.cb = cb
    this.snap = { status: 'idle', events: [], programOutput: '', language: 'python' }
  }

  private log(msg: string) {
    if (!this.logPath) return
    try { appendFileSync(this.logPath, `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`, 'utf8') } catch {}
  }

  get snapshot(): DebugSnapshot {
    return this.snap
  }

  async start(
    problem: Problem,
    sourceCode: string,
    test: TestCase,
    language: Language,
    toolchain: ToolchainStatus | undefined,
    runtimeDir: string,
    breakpoints: number[]
  ): Promise<DebugSnapshot> {
    // 起新会话前先彻底结束上一次：残留的 gdb/java 与被调试程序会锁住会话目录
    try { this.native?.stop() } catch {}
    this.native = null
    try { this.child?.kill('SIGKILL') } catch {}
    this.child = null
    this.clearWatchdog()

    if (language !== 'python' && language !== 'c' && language !== 'cpp' && language !== 'java') {
      this.snap = { status: 'error', events: [], programOutput: '', language, error: '不支持该语言调试。' }
      return this.snap
    }
    if (!toolchain?.available) {
      this.snap = {
        status: 'error',
        events: [],
        programOutput: '',
        language,
        error: '找不到对应语言的编译/调试工具。应用已内置 Python/JDK/GCC；如仍提示，请到「设置」确认检测结果。'
      }
      return this.snap
    }
    if (language === 'java') {
      return this.startNativeJava(problem, sourceCode, test, toolchain, runtimeDir, breakpoints)
    }
    if (language === 'c' || language === 'cpp') {
      return this.startNativeGcc(problem, sourceCode, test, language, toolchain, runtimeDir, breakpoints)
    }

    const dir = join(runtimeDir, 'debug', sanitize(problem.slug || problem.id || 'p'))
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    mkdirSync(dir, { recursive: true })
    this.dir = dir

    writeFileSync(join(dir, 'solution.py'), sourceCode, 'utf8')
    writeFileSync(join(dir, 'py_debug.py'), PY_DEBUG_SCRIPT, 'utf8')
    writeFileSync(join(dir, 'input.txt'), test.input.join('\n') + '\n', 'utf8')
    this.logPath = join(dir, 'session.log')
    try { appendFileSync(this.logPath, `== start lang=${language} judge=${problem.judgeType} bp=${breakpoints.join(',')} ==\n`, 'utf8') } catch {}

    const className = classNameFor(problem)
    this.events = []
    this.out = ''
    this.stopped = false
    this.snap = {
      status: 'starting',
      events: [],
      programOutput: '',
      language,
      frame: undefined,
      pausedAt: undefined
    }

    this.clearWatchdog()
    this.watchdog = setTimeout(() => {
      this.fail('调试超时（代码可能死循环或运行过久）。已强制停止。')
      this.kill()
    }, DEBUG_WATCHDOG_MS)
    this.watchdog.unref?.()

    const idx = intersectIndices(problem)
    this.child = spawn(
      toolchain.compilerPath || toolchain.runnerPath || 'python',
      ['py_debug.py', className, 'input.txt', breakpoints.join(',')],
      {
        cwd: dir,
        env: {
          ...process.env,
          LC_JUDGE: problem.judgeType,
          LC_METHOD: problem.judgeType === 'function' ? problem.methodName : '',
          LC_SHAPES: JSON.stringify(pyShapes(problem)),
          LC_RET_NODE: isNodeReturn(problem) ? '1' : '0',
          ...(idx
            ? {
                LC_MANUAL: 'intersect',
                LC_IV: String(idx.iv),
                LC_LA: String(idx.lA),
                LC_LB: String(idx.lB),
                LC_SA: String(idx.sa),
                LC_SB: String(idx.sb)
              }
            : {})
        },
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )

    let buf = ''
    this.child.stdout!.on('data', (d: Buffer) => {
      this.kickWatchdog()
      buf += d.toString('utf8')
      const parts = buf.split('\n')
      buf = parts.pop() || ''
      for (const line of parts) {
        if (line.startsWith('@@DBG ')) {
          try {
            const ev: DebugEvent = JSON.parse(line.slice(6))
            this.log('EVT ' + line.slice(6))
            this.handleEvent(ev)
          } catch { /* ignore malformed */ }
        } else if (line.startsWith('@@OUT ')) {
          try {
            const txt = JSON.parse(line.slice(6))
            this.out += txt
            this.cb.onOutput?.(txt)
          } catch { /* ignore */ }
        } else if (line.trim()) {
          this.out += line + '\n'
        }
      }
    })
    this.child.stderr!.on('data', (d: Buffer) => {
      const txt = d.toString('utf8')
      this.out += txt
      this.cb.onOutput?.(txt)
    })
    this.child.on('close', () => {
      this.clearWatchdog()
      this.snap.status = this.stopped || this.snap.status !== 'error' ? 'finished' : 'error'
      this.snap.programOutput = this.out
      this.snap.events = [...this.events]
      this.log('CHILD-CLOSE stopped=' + this.stopped + ' status=' + this.snap.status + ' events=' + this.events.length)
      this.cb.onDone?.(!this.stopped)
    })

    return this.snap
  }

  private kickWatchdog() {
    if (!this.watchdog) return
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      this.fail('调试超时（代码可能死循环或运行过久）。已强制停止。')
      this.kill()
    }, DEBUG_WATCHDOG_MS)
    this.watchdog.unref?.()
  }

  private clearWatchdog() {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null }
  }

  private fail(message: string) {
    if (this.snap.status === 'error') return
    this.snap.status = 'error'
    this.snap.error = message
    this.snap.programOutput = this.out
    this.snap.events = [...this.events]
    this.cb.onEvent?.({ kind: 'error', line: 0, message })
  }

  private handleEvent(e: DebugEvent) {
    this.events.push(e)
    this.snap.events = [...this.events]
    if (e.kind === 'line' || e.kind === 'breakpoint') {
      this.snap.status = 'paused'
      this.snap.pausedAt = e.line
      this.snap.frame = e.frame
      this.snap.error = undefined
    } else if (e.kind === 'exception' || e.kind === 'error') {
      // 关键：调试器报错必须反映到状态上，否则界面会一直停在「运行中」看着像卡死
      this.snap.status = 'error'
      this.snap.error = e.message || '调试器出错'
    } else if (e.kind === 'finished') {
      this.snap.status = 'finished'
    }
    this.cb.onEvent?.(e)
  }

  private send(cmd: string) {
    if (!this.child || !this.child.stdin || this.child.exitCode !== null) return
    if (this.snap.status !== 'paused') {
      this.log('SEND-SKIP ' + cmd + ' (status=' + this.snap.status + ')')
      return
    }
    try {
      this.child.stdin.write(cmd + '\n')
      this.snap.status = 'running'
      this.log('SEND ' + cmd)
    } catch { /* child gone */ }
  }

  step() {
    if (this.native) { this.native.step(); this.snap.status = 'running'; return }
    this.send('step')
  }
  stepOver() {
    if (this.native) { this.native.over(); this.snap.status = 'running'; return }
    this.send('over')
  }
  resume() {
    if (this.native) { this.native.resume(); this.snap.status = 'running'; return }
    this.send('continue')
  }
  stop() {
    if (this.native) { this.native.stop(); this.snap.status = 'finished'; return }
    this.stopped = true
    this.log('STOP')
    this.kill()
    this.snap.status = 'finished'
    this.snap.programOutput = this.out
  }
  addBreakpoint(line: number) {
    if (this.native) { this.native.addBreakpoint(line); return }
    // only meaningful while paused; driver applies it and stays paused
    this.send('break ' + line)
  }

  private kill() {
    try { this.child?.kill('SIGKILL') } catch {}
  }

  // ---------------- C / C++ native (gdb) ----------------

  private async startNativeGcc(
    problem: Problem,
    sourceCode: string,
    test: TestCase,
    language: 'c' | 'cpp',
    toolchain: ToolchainStatus,
    runtimeDir: string,
    breakpoints: number[]
  ): Promise<DebugSnapshot> {
    const dir = join(runtimeDir, 'debug', sanitize(problem.slug || problem.id || 'p') + '-' + language)
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    mkdirSync(dir, { recursive: true })
    this.dir = dir
    this.logPath = join(dir, 'session.log')

    const harness = buildHarness(problem, language, sourceCode)
    for (const f of harness.files) writeFileSync(join(dir, f.name), f.content, 'utf8')
    writeFileSync(join(dir, 'input.txt'), test.input.join('\n') + '\n', 'utf8')
    // 注意：不再向用户代码注入任何调试辅助头文件。
    // 容器显示改用「只读内存」的方式（见 nativeDebug.ts 的 readStl），
    // 绝不在被调试程序里调用函数——那种方式一旦卡住会让 gdb 永久无响应。

    const compiler = toolchain.compilerPath || (language === 'cpp' ? 'g++' : 'gcc')
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (toolchain.compilerPath) env.PATH = dirname(toolchain.compilerPath) + delimiter + (env.PATH || '')

    // 链接时若 main.exe 仍被上一次调试的残留进程占用，先清理再重试，必要时换输出名
    let exeName = 'main.exe'
    let compileErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const args = language === 'cpp'
        ? ['-std=c++17', '-g', '-O0', '-static', 'main.cpp', '-o', exeName]
        : ['-g', '-O0', '-static', 'main.c', '-o', exeName]
      try {
        execFileSync(compiler, args, { cwd: dir, encoding: 'utf8', timeout: 30000, env })
        compileErr = ''
        break
      } catch (e: any) {
        compileErr = ((e?.stdout || '') + (e?.stderr || '')).toString()
        if (!isLockError(compileErr)) break
        if (attempt === 0) {
          this.log('编译产物被占用，清理残留调试进程后重试')
          killProcessesUnder(dir)
          await sleepMs(400)
        } else {
          exeName = `main-${Date.now().toString().slice(-6)}.exe`
          this.log('仍被占用，改用输出名 ' + exeName)
        }
      }
    }
    if (compileErr) {
      this.snap = {
        status: 'error', events: [], programOutput: '', language,
        error: '编译失败（已加 -g 调试信息）：\n' + compileErr.slice(0, 1500)
      }
      return this.snap
    }

    this.events = []
    this.out = ''
    this.stopped = false
    this.native = null
    this.snap = { status: 'starting', events: [], programOutput: '', language, frame: undefined, pausedAt: undefined }

    const gdbEnv: NodeJS.ProcessEnv = { ...process.env }
    // gdb 与 gcc/g++ 同目录（内置 w64devkit/bin）
    const binDir = toolchain.compilerPath ? dirname(toolchain.compilerPath) : ''
    if (binDir) gdbEnv.PATH = binDir + delimiter + (gdbEnv.PATH || '')

    const runner = startGdbRunner({
      lang: language,
      exe: './' + exeName,
      cwd: dir,
      env: gdbEnv,
      methodName: problem.methodName,
      initialBps: breakpoints,
      onEvent: (e) => {
        this.kickWatchdog()
        this.events.push(e)
        this.snap.events = [...this.events]
        if (e.kind === 'line' || e.kind === 'breakpoint') {
          this.snap.status = 'paused'
          this.snap.pausedAt = e.line
          this.snap.frame = e.frame
          this.snap.error = undefined
        } else if (e.kind === 'finished') {
          this.clearWatchdog()
          this.snap.status = 'finished'
          this.snap.programOutput = this.out
          this.cb.onDone?.(true)
        } else if (e.kind === 'error') {
          this.snap.status = 'error'
          this.snap.error = e.message
        }
        this.cb.onEvent?.(e)
        this.log('EVT ' + JSON.stringify(e).slice(0, 400))
      }
    })
    this.native = runner

    this.clearWatchdog()
    this.watchdog = setTimeout(() => {
      if (this.snap.status !== 'paused' && this.snap.status !== 'finished' && this.snap.status !== 'error') {
        this.fail('调试超时（程序可能死循环）。已停止。')
        runner.stop()
      }
    }, 150_000)
    this.watchdog.unref?.()

    return this.snap
  }

  // ---------------- Java native (jdb) ----------------
  // 调试辅助类：用反射把对象渲染成 IDE 风格的文本（链表/树/数组/字段），
  // 供 jdb 的 print LcDbg.show(x) 调用，避免只看得到 instance of ...(id=N)。
  private static JAVA_DEBUG_HELPER = `import java.lang.reflect.*;
import java.util.*;

public class LcDbg {
    static final int MAXN = 40;
    static final int MAXD = 3;

    public static String show(Object v) {
        try {
            return render(v, 0);
        } catch (Throwable t) {
            try { return String.valueOf(v); } catch (Throwable t2) { return "<value>"; }
        }
    }

    static String render(Object v, int depth) {
        if (v == null) return "null";
        if (v instanceof String) return "\\"" + clip((String) v, 80) + "\\"";
        if (v instanceof Character || v instanceof Number || v instanceof Boolean) return String.valueOf(v);
        Class<?> c = v.getClass();
        if (c.isArray()) {
            int n = Array.getLength(v);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < n && i < MAXN; i++) {
                if (i > 0) sb.append(", ");
                sb.append(render(Array.get(v, i), depth + 1));
            }
            if (n > MAXN) sb.append(", ...");
            return sb.append("]").toString();
        }
        if (depth > MAXD) return c.getSimpleName() + "{...}";
        Field fnext = field(c, "next");
        Field fval = field(c, "val") != null ? field(c, "val") : field(c, "value");
        if (fnext != null && fval != null) {
            StringBuilder sb = new StringBuilder(c.getSimpleName()).append("[");
            ArrayList<Object> chain = new ArrayList<Object>();
            Object cur = v;
            while (cur != null && chain.size() < MAXN + 8) {
                boolean cyc = false;
                for (int i = 0; i < chain.size(); i++) if (chain.get(i) == cur) { cyc = true; break; }
                if (cyc) { sb.append(", ...(cycle)"); break; }
                if (!chain.isEmpty()) sb.append(", ");
                chain.add(cur);
                sb.append(String.valueOf(read(fval, cur)));
                cur = read(fnext, cur);
            }
            if (cur != null) sb.append(", ...");
            return sb.append("]").toString();
        }
        Field fl = field(c, "left");
        Field fr = field(c, "right");
        if (fl != null && fr != null && fval != null) {
            ArrayList<String> parts = new ArrayList<String>();
            LinkedList<Object> q = new LinkedList<Object>();
            q.add(v);
            Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
            while (!q.isEmpty() && parts.size() < 31) {
                Object node = q.poll();
                if (node == null) { parts.add("null"); continue; }
                if (!seen.add(node)) { parts.add("..."); continue; }
                parts.add(String.valueOf(read(fval, node)));
                q.add(read(fl, node));
                q.add(read(fr, node));
            }
            while (!parts.isEmpty() && parts.get(parts.size() - 1).equals("null")) parts.remove(parts.size() - 1);
            StringBuilder sb = new StringBuilder(c.getSimpleName()).append("[");
            for (int i = 0; i < parts.size(); i++) { if (i > 0) sb.append(", "); sb.append(parts.get(i)); }
            return sb.append("]").toString();
        }
        if (v instanceof Collection || v instanceof Map) return clip(String.valueOf(v), 200);
        ArrayList<String> parts = new ArrayList<String>();
        for (Field f : c.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            if (parts.size() >= 10) { parts.add("..."); break; }
            parts.add(f.getName() + "=" + render(read(f, v), depth + 1));
        }
        if (parts.isEmpty()) return c.getSimpleName() + "@" + Integer.toHexString(System.identityHashCode(v));
        StringBuilder sb = new StringBuilder(c.getSimpleName()).append("{");
        for (int i = 0; i < parts.size(); i++) { if (i > 0) sb.append(", "); sb.append(parts.get(i)); }
        return sb.append("}").toString();
    }

    static Field field(Class<?> c, String name) {
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
            try { Field f = k.getDeclaredField(name); f.setAccessible(true); return f; }
            catch (Throwable ignored) { }
        }
        return null;
    }

    static Object read(Field f, Object o) {
        try { return f.get(o); } catch (Throwable t) { return null; }
    }

    static String clip(String s, int n) {
        s = s.replace("\\r", "").replace("\\n", " ");
        return s.length() <= n ? s : s.substring(0, n) + "...";
    }
}
`

  private async startNativeJava(
    problem: Problem,
    sourceCode: string,
    test: TestCase,
    toolchain: ToolchainStatus,
    runtimeDir: string,
    breakpoints: number[]
  ): Promise<DebugSnapshot> {
    const dir = join(runtimeDir, 'debug', sanitize(problem.slug || problem.id || 'p') + '-java')
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    mkdirSync(dir, { recursive: true })
    this.dir = dir
    this.logPath = join(dir, 'session.log')

    const harness = buildHarness(problem, 'java', sourceCode)
    for (const f of harness.files) writeFileSync(join(dir, f.name), f.content, 'utf8')
    writeFileSync(join(dir, 'LcDbg.java'), DebugSession.JAVA_DEBUG_HELPER, 'utf8')
    writeFileSync(join(dir, 'input.txt'), test.input.join('\n') + '\n', 'utf8')
    const className = harness.className

    // jdb 下程序无法可靠读 stdin，把调试版 Main 改为读 input.txt；
    // 同时预热 LcDbg（jdb 的表达式求值只能引用已加载的类）
    const mainPath = join(dir, 'Main.java')
    try {
      const main = readFileSync(mainPath, 'utf8')
      writeFileSync(
        mainPath,
        main
          .replace(
            /System\.in\.readAllBytes\(\)/g,
            'java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("input.txt"))'
          )
          .replace(
            /(public static void main\(String\[\] args\)[^{]*\{)/,
            '$1\n    try { Class.forName("LcDbg"); } catch (Throwable ignored) { }'
          ),
        'utf8'
      )
    } catch {}

    const javac = toolchain.compilerPath || 'javac'
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (toolchain.compilerPath) env.PATH = dirname(toolchain.compilerPath) + delimiter + (env.PATH || '')
    const javacArgs = ['-g', className + '.java', 'Main.java', 'LcDbg.java']
    let javaErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        execFileSync(javac, javacArgs, { cwd: dir, encoding: 'utf8', timeout: 30000, env })
        javaErr = ''
        break
      } catch (e: any) {
        javaErr = ((e?.stdout || '') + (e?.stderr || '')).toString()
        // 上一次调试残留的 java.exe 会锁住 class 文件
        if (attempt === 0 && isLockError(javaErr)) {
          this.log('class 文件被占用，清理残留调试进程后重试')
          killProcessesUnder(dir)
          await sleepMs(400)
          continue
        }
        break
      }
    }
    if (javaErr) {
      this.snap = { status: 'error', events: [], programOutput: '', language: 'java', error: '编译失败：\n' + javaErr.slice(0, 1500) }
      return this.snap
    }

    this.events = []
    this.out = ''
    this.stopped = false
    this.native = null
    this.snap = { status: 'starting', events: [], programOutput: '', language: 'java', frame: undefined, pausedAt: undefined }

    const binDir = toolchain.runnerPath ? dirname(toolchain.runnerPath) : dirname(toolchain.compilerPath || '')
    const jdbPath = join(binDir, 'jdb.exe')
    const jdbEnv: NodeJS.ProcessEnv = { ...process.env }
    if (binDir) jdbEnv.PATH = binDir + delimiter + (jdbEnv.PATH || '')

    const runner = startJdbRunner({
      jdbPath: existsSync(jdbPath) ? jdbPath : 'jdb',
      javaExe: toolchain.runnerPath || join(binDir, 'java.exe'),
      cwd: dir,
      env: jdbEnv,
      userClass: className,
      entryMethod: problem.methodName,
      classMode: problem.judgeType === 'class',
      initialBps: breakpoints,
      onEvent: (e) => {
        this.kickWatchdog()
        this.events.push(e)
        this.snap.events = [...this.events]
        if (e.kind === 'line' || e.kind === 'breakpoint') {
          this.snap.status = 'paused'
          this.snap.pausedAt = e.line
          this.snap.frame = e.frame
          this.snap.error = undefined
        } else if (e.kind === 'finished') {
          this.clearWatchdog()
          this.snap.status = 'finished'
          this.cb.onDone?.(true)
        } else if (e.kind === 'error') {
          this.snap.status = 'error'
          this.snap.error = e.message
        }
        this.cb.onEvent?.(e)
        this.log('EVT ' + JSON.stringify(e).slice(0, 400))
      }
    })
    this.native = runner

    this.clearWatchdog()
    this.watchdog = setTimeout(() => {
      if (this.snap.status !== 'paused' && this.snap.status !== 'finished' && this.snap.status !== 'error') {
        this.fail('调试超时（程序可能死循环）。已停止。')
        runner.stop()
      }
    }, 150_000)
    this.watchdog.unref?.()

    return this.snap
  }

  dispose() {
    this.clearWatchdog()
    try { this.native?.stop() } catch {}
    try { this.child?.kill('SIGKILL') } catch {}
  }
}
