// 验证：学习计划 + 我的题单 能真正拉到题目
import { fetchStudyPlan, fetchMyProblemLists, STUDY_PLANS } from '../src/main/fetcher'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const isZh = (s) => /[\u4e00-\u9fa5]/.test(String(s || ''))
const sessFile = join(process.env.APPDATA || '', 'leetcode-studio', '.leetcode-studio', 'lc-session.json')
let cookie = ''
if (existsSync(sessFile)) {
  const s = JSON.parse(readFileSync(sessFile, 'utf8'))
  const cn = s['leetcode.cn'] || {}
  if (cn.session) cookie = `LEETCODE_SESSION=${cn.session}`
}

let bad = 0
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++ }

async function main() {
  console.log('1) 学习计划清单（内置）')
  check(STUDY_PLANS.length >= 5, `内置 ${STUDY_PLANS.length} 个学习计划：${STUDY_PLANS.map((p) => p.name).join(' / ')}`)

  console.log('2) 逐个拉取学习计划')
  for (const p of STUDY_PLANS.slice(0, 3)) {
    try {
      const e = await fetchStudyPlan(p.slug)
      const zh = e.items.filter((x) => isZh(x.titleCn || x.title)).length
      console.log(`  ✓ ${e.title.padEnd(16)} ${String(e.items.length).padStart(4)} 题，中文标题 ${zh}，例：${e.items[0].frontendId} ${e.items[0].titleCn || e.items[0].title} (${e.items[0].difficulty})`)
      if (e.items.length !== p.count) console.log(`    （注意：内置写的 ${p.count} 题，实际 ${e.items.length} 题）`)
    } catch (e) {
      check(false, `${p.slug} 拉取失败：${e.message}`)
    }
  }

  console.log('3) 我的题单（带登录态）')
  const mine = await fetchMyProblemLists(cookie ? { Cookie: cookie } : undefined)
  check(mine.length > 0, `共 ${mine.length} 个：${mine.map((m) => `${m.name}(${m.slug})`).join(' / ') || '(未登录或无题单)'}`)
  if (mine.length) {
    const first = await fetchStudyPlan(mine[0].slug).catch(() => null)
    console.log(`  （第一个题单用学习计划接口拉取：${first ? first.items.length + ' 题' : '不适用，属收藏夹题单'}）`)
  }
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
  process.exit(bad ? 1 : 0)
}
main()
