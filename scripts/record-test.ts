// 刷题记录：写入 / 不被普通写入抹掉 / 按题单清除 / 全部清除
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Problem } from '../src/shared/types'
import { Store } from '../src/main/store'

const dir = mkdtempSync(join(tmpdir(), 'lc-store-'))
const store = new Store(dir)

const mk = (id: string, slug: string): Problem => ({
  id, slug, title: 'T' + id, difficulty: 'easy', tags: [], content: '题面',
  judgeType: 'function', methodName: 'f', params: [], returnType: 'integer',
  tests: [], starters: {}, source: 'leetcode'
})

let bad = 0
const check = (ok: boolean, msg: string) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++ }

const a = mk('1', 'two-sum')
const b = mk('2', 'add-two-numbers')
const c = mk('3', 'lru-cache')
store.upsertProblem(a); store.upsertProblem(b); store.upsertProblem(c)

console.log('1) 提交通过 → 记录')
store.upsertProblem({ ...a, solvedAt: '2026-01-01T00:00:00Z', solvedLang: 'cpp' })
let p = store.findProblemBySlug('two-sum')!
check(p.solvedAt === '2026-01-01T00:00:00Z' && p.solvedLang === 'cpp', `solvedAt/solvedLang 已写入`)

console.log('2) 之后改代码（普通写入）不应抹掉记录')
store.upsertProblem({ ...store.findProblemBySlug('two-sum')!, starters: { cpp: '// new code' } })
p = store.findProblemBySlug('two-sum')!
check(!!p.solvedAt, `记录仍在：${p.solvedAt}`)
check(p.starters.cpp === '// new code', '代码已更新')

console.log('3) 模拟「旧快照覆盖」（没有记录字段的写入）')
const stale = mk('1', 'two-sum')   // 从旧数据构造，没有 solvedAt
store.upsertProblem(stale)
p = store.findProblemBySlug('two-sum')!
check(!!p.solvedAt, `记录没被旧快照抹掉：${p.solvedAt}`)

console.log('4) 按题单清除（只清该题单里的题）')
store.upsertProblem({ ...b, solvedAt: '2026-01-02T00:00:00Z' })
store.upsertProblem({ ...c, localPassAt: '2026-01-03T00:00:00Z' })
const list = store.clearRecords(['two-sum', 'add-two-numbers'])
const bySlug = (s: string) => list.find((x) => x.slug === s)!
check(!bySlug('two-sum').solvedAt && !bySlug('add-two-numbers').solvedAt, '题单内两道题的记录已清')
check(!!bySlug('lru-cache').localPassAt, '题单外的题不受影响')

console.log('5) 全部清除')
const cleared = store.clearRecords()
check(cleared.every((x) => !x.solvedAt && !x.localPassAt), '全部记录已清')

console.log('6) 持久化（重新打开仍在）')
store.upsertProblem({ ...bySlug('two-sum'), solvedAt: '2026-02-01T00:00:00Z' })
const store2 = new Store(dir)
check(store2.findProblemBySlug('two-sum')!.solvedAt === '2026-02-01T00:00:00Z', '重新加载后记录仍在')

rmSync(dir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad ? 1 : 0)
