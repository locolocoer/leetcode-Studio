import { detectAll } from '../src/main/toolchain'
import { fetchDaily, fetchProblemListCatalog, fetchProblemDetail } from '../src/main/fetcher'

async function main() {
  console.log('== toolchain detection ==')
  console.log(JSON.stringify(detectAll(), null, 1))

  console.log('== daily (com) ==')
  try {
    const d = await fetchDaily('leetcode.com')
    console.log('date:', d.date, 'title:', d.problem.title, 'tests:', d.problem.tests.length, 'langs:', Object.keys(d.problem.starters).join(','))
  } catch (e: any) { console.log('daily ERR', e.message) }

  console.log('== list (cn) HqYkJzEr ==')
  try {
    const e = await fetchProblemListCatalog('HqYkJzEr', 'leetcode.cn')
    console.log('title:', e.title, 'count:', e.items.length)
    console.log('first3:', e.items.slice(0, 3).map((i) => `${i.frontendId}.${i.titleCn || i.title}`).join(' | '))
  } catch (e: any) { console.log('list ERR', e.message) }

  console.log('== detail (cn) two-sum ==')
  try {
    const p = await fetchProblemDetail('two-sum', 'leetcode.cn')
    console.log('title:', p.title, 'method:', p.methodName, 'tests:', p.tests.length, 'hasCnContent:', /给定|整数|数组|目标值/.test(p.content))
  } catch (e: any) { console.log('detail ERR', e.message) }
}

main()
