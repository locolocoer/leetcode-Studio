import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Language, Settings, ToolchainStatus } from '../src/shared/types'
import { fetchProblemDetail } from '../src/main/fetcher'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const w64 = join(tools, 'w64', 'w64devkit', 'bin')
const jdk = join(tools, 'jdk17', 'bin')
const py = join(tools, 'python', 'python.exe')

const toolchains: Record<Language, ToolchainStatus> = {
  c: { language: 'c', available: true, compilerPath: join(w64, 'gcc.exe'), source: 'bundled' },
  cpp: { language: 'cpp', available: true, compilerPath: join(w64, 'g++.exe'), source: 'bundled' },
  java: { language: 'java', available: true, compilerPath: join(jdk, 'javac.exe'), runnerPath: join(jdk, 'java.exe'), source: 'bundled' },
  python: { language: 'python', available: true, compilerPath: py, runnerPath: py, source: 'bundled' }
}
const settings: Settings = { toolpaths: {}, timeLimitMs: 5000, theme: 'dark', contentLang: 'zh' }
void settings

const cppCode = `class Solution {
public:
    ListNode* getIntersectionNode(ListNode* headA, ListNode* headB) {
        ListNode* p = headA;
        ListNode* q = headB;
        while (p != q) {
            p = p ? p->next : headB;
            q = q ? q->next : headA;
        }
        return p;
    }
};
`
const pyCode = `class Solution(object):
    def getIntersectionNode(self, headA, headB):
        p, q = headA, headB
        while p is not q:
            p = p.next if p else headB
            q = q.next if q else headA
        return p
`
const javaCode = `public class Solution {
    public ListNode getIntersectionNode(ListNode headA, ListNode headB) {
        ListNode p = headA, q = headB;
        while (p != q) {
            p = (p != null) ? p.next : headB;
            q = (q != null) ? q.next : headA;
        }
        return p;
    }
}
`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function settle(sess: DebugSession, maxMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await wait(200)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') return
  }
}

function dumpLocals(sess: DebugSession) {
  const s = sess.snapshot
  console.log(`  status=${s.status} line=${s.pausedAt} fn=${s.frame?.name}`)
  if (s.error) console.log('  ERROR: ' + s.error.slice(0, 400))
  for (const [k, v] of Object.entries(s.frame?.locals || {})) console.log(`    ${k} = ${v}`)
}

async function runLang(lang: Language, code: string, bp: number, label: string, runtimeDir: string) {
  console.log(`\n===== ${label} (${lang}) bp=${bp} =====`)
  const problem = await fetchProblemDetail('intersection-of-two-linked-lists', 'leetcode.cn')
  const sess = new DebugSession({})
  const snap = await sess.start(problem, code, problem.tests[0], lang, toolchains[lang], runtimeDir, [bp])
  console.log('start:', snap.status, snap.error ? 'err=' + snap.error.slice(0, 300) : '')
  await settle(sess)
  console.log('-- first stop --')
  dumpLocals(sess)
  for (let i = 0; i < 2; i++) {
    if (sess.snapshot.status !== 'paused') break
    sess.step()
    await settle(sess)
    console.log(`-- after step ${i + 1} --`)
    dumpLocals(sess)
  }
  console.log('output:', JSON.stringify(sess.snapshot.programOutput).slice(0, 200))
  sess.dispose()
}

async function main() {
  const runtimeDir = join(process.cwd(), '.locals-dbg')
  mkdirSync(runtimeDir, { recursive: true })
  const only = process.argv[2]
  if (!only || only === 'cpp') await runLang('cpp', cppCode, 6, 'C++ 相交链表', runtimeDir)
  if (!only || only === 'java') await runLang('java', javaCode, 4, 'Java 相交链表', runtimeDir)
  if (!only || only === 'python') await runLang('python', pyCode, 4, 'Python 相交链表', runtimeDir)
}
main()
