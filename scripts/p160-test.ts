import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings, ToolchainStatus } from '../src/shared/types'
import { fetchProblemDetail } from '../src/main/fetcher'
import { runAll } from '../src/main/runner'

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

async function main() {
  const problem: Problem = await fetchProblemDetail('intersection-of-two-linked-lists', 'leetcode.cn')
  console.log('problem:', problem.title, 'manual=', !!problem.manual, 'params=', JSON.stringify(problem.params))
  console.log('tests:', problem.tests.map((t) => t.input.join(' | ') + ' => ' + t.expected).join('\n       '))
  const runtimeDir = join(process.cwd(), '.p160-runtime')
  mkdirSync(runtimeDir, { recursive: true })
  const codes: Record<string, string> = { cpp: cppCode, python: pyCode, java: javaCode }
  for (const lang of ['cpp', 'python', 'java'] as Language[]) {
    const r = await runAll(problem, lang, codes[lang], problem.tests, { toolchains, settings, runtimeDir })
    console.log(`\n== ${lang}: ok=${r.ok}${r.compileFailed ? ' COMPILE-FAIL' : ''}${r.error ? ' err=' + String(r.error).slice(0, 200) : ''}`)
    if (r.compileFailed) console.log((r.compileOutput || '').slice(0, 500))
    for (const c of r.cases) console.log(`   expected=${c.expected} actual=${c.actual} passed=${c.passed}${c.error ? ' error=' + c.error.slice(0, 160) : ''}`)
  }

  // 模拟用户本地"旧数据"：期望值仍是自然语言未归一化
  console.log('\n== 模拟旧数据（未归一化的自然语言期望）==')
  const rawExpected = ["Intersected at '8'", "Intersected at '2'", 'No intersection']
  problem.tests = problem.tests.map((t, i) => ({ ...t, expected: rawExpected[i] ?? t.expected }))
  const r2 = await runAll(problem, 'cpp', cppCode, problem.tests, { toolchains, settings, runtimeDir })
  console.log(`cpp stale: ok=${r2.ok}`)
  for (const c of r2.cases) console.log(`   expected=${c.expected} actual=${c.actual} passed=${c.passed}`)
}
main()
