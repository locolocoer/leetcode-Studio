import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Language, Settings, ToolchainStatus } from '../src/shared/types'
import { fetchProblemDetail } from '../src/main/fetcher'
import { DebugSession } from '../src/main/debugger'

const tools = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains'
const py = join(tools, 'python', 'python.exe')
const toolchains: Record<Language, ToolchainStatus> = {
  c: { language: 'c', available: true, compilerPath: join(tools, 'w64', 'w64devkit', 'bin', 'gcc.exe'), source: 'bundled' },
  cpp: { language: 'cpp', available: true, compilerPath: join(tools, 'w64', 'w64devkit', 'bin', 'g++.exe'), source: 'bundled' },
  java: { language: 'java', available: true, compilerPath: join(tools, 'jdk17', 'bin', 'javac.exe'), runnerPath: join(tools, 'jdk17', 'bin', 'java.exe'), source: 'bundled' },
  python: { language: 'python', available: true, compilerPath: py, runnerPath: py, source: 'bundled' }
}
const settings: Settings = { toolpaths: {}, timeLimitMs: 5000, theme: 'dark', contentLang: 'zh' }

const pyCode = `class Solution(object):
    def getIntersectionNode(self, headA, headB):
        p, q = headA, headB
        while p is not q:
            p = p.next if p else headB
            q = q.next if q else headA
        return p
`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const problem = await fetchProblemDetail('intersection-of-two-linked-lists', 'leetcode.cn')
  const runtimeDir = join(process.cwd(), '.p160-dbg')
  mkdirSync(runtimeDir, { recursive: true })
  const sess = new DebugSession({})
  const snap = await sess.start(problem, pyCode, problem.tests[0], 'python', toolchains.python, runtimeDir, [4])
  console.log('start status', snap.status, snap.error ? 'err=' + snap.error : '')

  for (let i = 0; i < 60; i++) {
    await wait(300)
    const s = sess.snapshot.status
    if (s === 'paused' || s === 'finished' || s === 'error') break
  }
  let s = sess.snapshot
  console.log('paused:', JSON.stringify({ status: s.status, line: s.pausedAt, fn: s.frame?.name, vars: Object.keys(s.frame?.locals || {}) }))
  if (s.error) console.log('ERROR:', s.error)

  for (const cmd of ['step', 'step', 'resume'] as const) {
    if (sess.snapshot.status !== 'paused') break
    if (cmd === 'step') sess.step(); else sess.resume()
    for (let i = 0; i < 60; i++) {
      await wait(300)
      const st = sess.snapshot.status
      if (st === 'paused' || st === 'finished' || st === 'error') break
    }
    s = sess.snapshot
    console.log(`after ${cmd}:`, JSON.stringify({ status: s.status, line: s.pausedAt, vars: Object.keys(s.frame?.locals || {}) }))
  }
  console.log('output:', JSON.stringify(sess.snapshot.programOutput))
  sess.dispose()
}
main()
