import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fetchSolutionList, fetchSolutionDetail, fetchProblemDetail } from '../src/main/fetcher'
import { renderMarkdown } from '../src/renderer/src/markdown'

async function main() {
  const problem = await fetchProblemDetail('two-sum', 'leetcode.cn')
  const list = await fetchSolutionList(problem.slug, { first: 5, orderBy: 'MOST_UPVOTE' })
  console.log(`列表：共 ${list.total} 篇，host=${list.host}`)
  for (const s of list.items) {
    console.log(` - [${s.upvoteCount}👍] ${s.title} · @${s.author} · ${(s.createdAt || '').slice(0, 10)} · tags=${s.tags.slice(0, 3).join('/')}`)
    console.log(`   ${(s.summary || '').slice(0, 70)}`)
  }
  if (!list.items.length) throw new Error('题解列表为空')

  const slug = list.items[0].slug
  const detail = await fetchSolutionDetail(slug, problem.slug)
  console.log(`\n详情：${detail.title} · @${detail.author} · ${detail.upvoteCount}👍 · ${detail.content.length} 字符`)
  console.log('链接：' + detail.link)

  const html = renderMarkdown(detail.content)
  console.log(`\nHTML 长度 ${html.length}`)
  console.log('包含代码块：', /class="md-code"/.test(html))
  console.log('代码复制按钮：', (html.match(/md-copy/g) || []).length, '个')
  console.log('图片：', (html.match(/<img /g) || []).length, '张；相对资源已补全：', !/<img src="(?!https?:)/.test(html))
  console.log('残留未渲染标记（** / 反引号 / $）：', /\*\*|`|\$\\?[a-zA-Z]/.test(html.replace(/<pre[\s\S]*?<\/pre>/g, '')) )
  const dir = join(process.cwd(), '.tmp-sol-out')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'solution.md'), detail.content, 'utf8')
  writeFileSync(join(dir, 'solution.html'), html, 'utf8')
  console.log('已写出 .tmp-sol-out/solution.md 与 solution.html')
  console.log('\n--- HTML 片段 ---')
  console.log(html.slice(0, 900))
}
main()
