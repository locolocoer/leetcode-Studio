import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, ToolchainStatus } from '../src/shared/types'
import { DebugSession } from '../src/main/debugger'

const w64 = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains\\w64\\w64devkit\\bin'
const jdk = 'C:\\Users\\14579\\Desktop\\DSH\\leetcode-studio\\toolchains\\jdk17\\bin'

function tc(lang: Language, exe: string): ToolchainStatus {
  return { language: lang, available: true, compilerPath: join(w64, exe), source: 'bundled' }
}
function tcJava(): ToolchainStatus {
  return { language: 'java', available: true, compilerPath: join(jdk, 'javac.exe'), runnerPath: join(jdk, 'java.exe'), source: 'bundled' }
}

function makeProblem(lang: Language, src: string): Problem {
  return {
    id: '9', slug: 'native-test', title: 'Two Sum', difficulty: 'easy', tags: [], content: '',
    judgeType: 'function', methodName: 'twoSum',
    params: [{ name: 'nums', type: 'integer[]' }, { name: 'target', type: 'integer' }],
    returnType: 'integer[]', tests: [], starters: { [lang]: src }, source: 'local'
  }
}

const cppSrc = [
  'class Solution {',
  'public:',
  '    vector<int> twoSum(vector<int>& nums, int target) {',
  '        unordered_map<int, int> m;',
  '        for (int i = 0; i < (int)nums.size(); i++) {',
  '            int need = target - nums[i];',
  '            if (m.count(need)) return {m[need], i};',
  '            m[nums[i]] = i;',
  '        }',
  '        return {};',
  '    }',
  '};'
].join('\n')

const cSrc = [
  '#include <stdlib.h>',
  'int* twoSum(int* nums, int numsSize, int target, int* returnSize) {',
  '    int* r = (int*)malloc(2 * sizeof(int));',
  '    for (int i = 0; i < numsSize; i++)',
  '        for (int j = i + 1; j < numsSize; j++)',
  '            if (nums[i] + nums[j] == target) { r[0] = i; r[1] = j; *returnSize = 2; return r; }',
  '    *returnSize = 0;',
  '    return NULL;',
  '}'
].join('\n')

const runtime = join(process.cwd(), '.native-runtime')
mkdirSync(runtime, { recursive: true })

async function runCase(lang: Language, src: string, bpLines: number[], label: string) {
  const sess = new DebugSession({})
  const tool = lang === 'java' ? tcJava() : tc(lang, lang === 'cpp' ? 'g++.exe' : 'gcc.exe')
  const snap = await sess.start(makeProblem(lang, src), src, { id: 't1', input: ['[2,7,11,15]', '9'], expected: '[0,1]' }, lang, tool, runtime, bpLines)
  console.log(`\n== ${label}: start status=${snap.status} err=${snap.error ? snap.error.slice(0, 200) : ''}`)

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // wait for first paused / finished
  for (let i = 0; i < 160; i++) {
    await wait(500)
    if (sess.snapshot.status === 'paused' || sess.snapshot.status === 'finished' || sess.snapshot.status === 'error') break
  }
  let s = sess.snapshot
  console.log('first:', JSON.stringify({ status: s.status, line: s.pausedAt, fn: s.frame?.name, vars: Object.keys(s.frame?.locals || {}).slice(0, 8) }))
  if (s.status === 'error') console.log('ERROR:', s.error)

  // two steps
  for (const cmd of ['step', 'step'] as const) {
    if (sess.snapshot.status !== 'paused') break
    if (cmd === 'step') sess.step(); else sess.resume()
    for (let i = 0; i < 160; i++) {
      await wait(500)
      if (sess.snapshot.status === 'paused' || sess.snapshot.status === 'finished' || sess.snapshot.status === 'error') break
    }
    s = sess.snapshot
    console.log('after', cmd, ':', JSON.stringify({ status: s.status, line: s.pausedAt, vars: Object.keys(s.frame?.locals || {}).slice(0, 8) }))
  }
  sess.dispose()
}

const javaSrc = [
  'import java.util.*;',
  'class Solution {',
  '    public int[] twoSum(int[] nums, int target) {',
  '        Map<Integer,Integer> m = new HashMap<>();',
  '        for (int i = 0; i < nums.length; i++) {',
  '            int need = target - nums[i];',
  '            if (m.containsKey(need)) return new int[]{m.get(need), i};',
  '            m.put(nums[i], i);',
  '        }',
  '        return new int[]{};',
  '    }',
  '}'
].join('\n')

;(async () => {
  await runCase('cpp', cppSrc, [5], 'CPP two-sum bp5')
  await runCase('c', cSrc, [4], 'C two-sum bp4')
  await runCase('java', javaSrc, [5], 'JAVA two-sum bp5')
})()
