// 端到端验证「跟随题面语言」：
//   1) 中文索引（titleCn）
//   2) 详情按 host 取对应语言
//   3) 已存题面语言不一致时会重拉（contentLangOf 逻辑）
import { rmSync } from 'fs'
import { join } from 'path'
import { fetchProblemIndex, fetchProblemDetail } from '../src/main/fetcher'

const isZh = (s) => /[\u4e00-\u9fa5]/.test(String(s || ''))
const dir = join(process.cwd(), '.tmp-idx-cache2')

async function main() {
  rmSync(dir, { recursive: true, force: true })
  let bad = 0
  const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++ }

  console.log('1) 中文索引')
  const zh = await fetchProblemIndex('leetcode.cn', dir)
  const zhRatio = zh.filter((x) => isZh(x.title)).length / zh.length
  check(zhRatio > 0.95, `中文标题占比 ${(zhRatio * 100).toFixed(1)}%（共 ${zh.length} 题）`)
  const twoSum = zh.find((x) => x.slug === 'two-sum')
  check(!!twoSum && isZh(twoSum.title), `两数之和标题 = ${twoSum?.title}`)
  check(!!twoSum && !!twoSum.titleEn, `英文别名保留 = ${twoSum?.titleEn}`)

  console.log('2) 英文索引')
  const en = await fetchProblemIndex('leetcode.com', dir)
  check(en.every((x) => !isZh(x.title)) && en.length > 3000, `英文标题 ${en.length} 题，无中文`)

  console.log('3) 详情按语言取')
  const pZh = await fetchProblemDetail('two-sum', 'leetcode.cn')
  const pEn = await fetchProblemDetail('two-sum', 'leetcode.com')
  check(isZh(pZh.title) && isZh(pZh.content), `zh: ${pZh.title} / ${pZh.content.slice(0, 24)}…`)
  check(!isZh(pEn.title) && !isZh(pEn.content), `en: ${pEn.title} / ${pEn.content.slice(0, 24)}…`)

  console.log('4) 语言判定（已存题面需要重拉时用）')
  const langOf = (c) => (/[\u4e00-\u9fa5]/.test(String(c || '')) ? 'zh' : 'en')
  check(langOf(pZh.content) === 'zh' && langOf(pEn.content) === 'en', 'contentLangOf 判定正确')
  check(langOf(pZh.content) !== 'en', '中文题面不会误判成英文（切到中文时会重拉）')

  await new Promise((r) => setTimeout(r, 200))
  rmSync(dir, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
  process.exit(bad ? 1 : 0)
}
main()
