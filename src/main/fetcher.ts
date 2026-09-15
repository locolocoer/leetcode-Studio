import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  CatalogEntry, CatalogItem, Difficulty, FetchedProblemListEntry, Language, Method, Param, Problem, SolutionDetail,
  SolutionItem, SolutionListResult, SolutionOrderBy, TestCase
} from '../shared/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const GRAPHQL_COM = 'https://leetcode.com/graphql'

export function hostBase(host?: string): string {
  const h = (host || 'leetcode.com').toLowerCase().replace(/^https?:\/\//, '')
  return h.includes('.') ? `https://${h}` : 'https://leetcode.com'
}

function diffFromLevel(level: number): Difficulty {
  if (level === 1) return 'easy'
  if (level === 3) return 'hard'
  return 'medium'
}

function langMap(langSlug: string): Language | null {
  const s = (langSlug || '').toLowerCase()
  if (s === 'python' || s === 'python3') return 'python'
  if (s === 'java') return 'java'
  if (s === 'c++' || s === 'cpp') return 'cpp'
  if (s === 'c') return 'c'
  return null
}


const QUESTION_QUERY = `query getQuestionDetail($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId title titleSlug translatedTitle translatedContent content difficulty
    metaData codeSnippets { lang langSlug code }
    topicTags { name }
  }
}`

export async function fetchProblemDetail(slug: string, host?: string): Promise<Problem> {
  const base = hostBase(host)
  const graphql = `${base}/graphql`
  const res = await fetch(graphql, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Referer: `${base}/problems/${slug}/`
    },
    body: JSON.stringify({
      operationName: 'getQuestionDetail',
      variables: { titleSlug: slug },
      query: QUESTION_QUERY
    })
  })
  const txt = await res.text()
  let json: any
  try { json = JSON.parse(txt) } catch { throw new Error('GraphQL 返回非 JSON') }
  if (!res.ok) throw new Error(`问题详情请求失败：HTTP ${res.status}`)
  const q = json?.data?.question
  if (!q) throw new Error(`未找到题目「${slug}」`)

  const meta = parseMeta(q.metaData)
  const starters: Partial<Record<Language, string>> = {}
  for (const s of q.codeSnippets || []) {
    const lang = langMap(s.langSlug)
    if (lang) starters[lang] = s.code || ''
  }

  const contentText = (host && /cn$/i.test(host) && q.translatedContent) ? q.translatedContent : (q.content || '')
  let tests = parseExamples(contentText, meta)
  const title = q.translatedTitle || q.title || slug

  // 手动判题题（如相交链表）：真实签名从 starter 代码解析，metaData 的判题字段单独保存
  let params = meta.params
  const manualParams = meta.manual ? meta.params : undefined
  if (meta.manual) {
    const real = realParamsFromStarters(starters, meta.methodName)
    if (real.length) {
      const byName = new Map(meta.params.map((p) => [p.name, p]))
      params = real.map((rp) => {
        const metaP = byName.get(rp.name)
        return { name: rp.name, type: metaP && metaP.type !== 'void' ? metaP.type : rp.type }
      })
    }
  }
  const manualIntersect = !!(manualParams &&
    manualParams.some((p) => p.name === 'intersectVal') && manualParams.some((p) => p.name === 'skipA'))
  if (manualIntersect) {
    tests = tests.map((t) => ({ ...t, expected: normalizeManualExpected(t.expected) }))
  }

  const problem: Problem = {
    id: String(q.questionId || slug),
    slug,
    title,
    titleCn: q.translatedTitle || undefined,
    difficulty: diffFromLevel(diffStr(q.difficulty)),
    tags: (q.topicTags || []).map((t: any) => t.name).slice(0, 5),
    content: contentText,
    judgeType: meta.judgeType,
    methodName: meta.methodName,
    params,
    returnType: meta.returnType,
    constructorParams: meta.constructorParams,
    methods: meta.methods,
    manual: meta.manual || undefined,
    manualParams,
    tests,
    starters,
    link: `${base}/problems/${slug}/`,
    source: 'leetcode'
  }
  return problem
}

// Daily coding challenge. The daily query is only exposed on leetcode.com, so we
// always resolve today's slug there, then fetch the details from the chosen host.
export async function fetchDaily(host?: string): Promise<{ problem: Problem; date: string }> {  const res = await fetch(GRAPHQL_COM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: 'https://leetcode.com/problemset/' },
    body: JSON.stringify({
      operationName: 'daily',
      query: `query daily { activeDailyCodingChallengeQuestion { date link question { titleSlug } } }`
    })
  })
  if (!res.ok) throw new Error(`每日一题请求失败：HTTP ${res.status}`)
  const j: any = await res.json()
  const d = j?.data?.activeDailyCodingChallengeQuestion
  if (!d?.question?.titleSlug) throw new Error('未能获取每日一题信息')
  const problem = await fetchProblemDetail(d.question.titleSlug, host)
  return { problem, date: d.date }
}

// ---------------------------------------------------------------------------
// 题目索引（「拉取题目」弹窗里的列表）
//
// 以前固定用 leetcode.com 的 /api/problems/all/，标题永远是英文、也不跟题面语言。
// 现在按题面语言取：
//   zh → leetcode.cn 的 problemsetQuestionList（titleCn 是中文标题），分页取全量后缓存到本地
//   en → leetcode.com 的 /api/problems/all/（一次请求拿全量）
// ---------------------------------------------------------------------------

interface IndexedProblem extends FetchedProblemListEntry {
  titleEn?: string
  frontendId?: string | number
}

const INDEX_TTL_MS = 7 * 24 * 3600 * 1000

function indexCacheFile(dir: string, lang: 'zh' | 'en'): string {
  return join(dir, `problem-index-${lang}.json`)
}

function readIndexCache(dir: string, lang: 'zh' | 'en'): IndexedProblem[] | null {
  try {
    const f = indexCacheFile(dir, lang)
    if (!existsSync(f)) return null
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (!j?.at || Date.now() - j.at > INDEX_TTL_MS) return null
    return Array.isArray(j.items) && j.items.length ? j.items : null
  } catch {
    return null
  }
}

function writeIndexCache(dir: string, lang: 'zh' | 'en', items: IndexedProblem[]): void {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(indexCacheFile(dir, lang), JSON.stringify({ at: Date.now(), items }), 'utf8')
  } catch {
    /* 缓存失败不影响使用 */
  }
}

const CN_LIST_QUERY = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total
    questions { frontendQuestionId title titleCn titleSlug difficulty paidOnly }
  }
}`

/** 从 leetcode.cn 分页取全量题目（中文标题） */
async function fetchCnIndex(): Promise<IndexedProblem[]> {
  const base = 'https://leetcode.cn'
  const page = async (skip: number): Promise<{ total: number; items: IndexedProblem[] }> => {
    const res = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: `${base}/problemset/` },
      body: JSON.stringify({
        operationName: 'problemsetQuestionList',
        variables: { categorySlug: '', skip, limit: 100, filters: {} },
        query: CN_LIST_QUERY
      })
    })
    if (!res.ok) throw new Error(`题目索引请求失败：HTTP ${res.status}`)
    const j: any = await res.json()
    const r = j?.data?.problemsetQuestionList
    if (!r) throw new Error('题目索引返回为空')
    const items: IndexedProblem[] = (r.questions || []).map((q: any) => ({
      slug: q.titleSlug,
      title: q.titleCn || q.title || '',
      titleEn: q.title || undefined,
      difficulty: String(q.difficulty || '').toLowerCase() === 'easy'
        ? 'easy'
        : String(q.difficulty || '').toLowerCase() === 'hard' ? 'hard' : 'medium',
      paidOnly: !!q.paidOnly,
      frontendId: q.frontendQuestionId
    }))
    return { total: r.total || 0, items }
  }

  const first = await page(0)
  const total = first.total
  const out = [...first.items]
  const skips: number[] = []
  for (let s = 100; s < total; s += 100) skips.push(s)
  // 小并发分页，避免打太多请求
  const CONCURRENCY = 4
  for (let i = 0; i < skips.length; i += CONCURRENCY) {
    const batch = skips.slice(i, i + CONCURRENCY)
    const parts = await Promise.all(batch.map((s) => page(s).catch(() => ({ total: 0, items: [] }))))
    for (const p of parts) out.push(...p.items)
  }
  return out
}

/** 从 leetcode.com 取全量题目（英文标题，一次请求） */
async function fetchComIndex(): Promise<IndexedProblem[]> {
  const res = await fetch('https://leetcode.com/api/problems/all/', { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`题目列表请求失败：HTTP ${res.status}`)
  const data: any = await res.json()
  const pairs = data?.stat_status_pairs || []
  return pairs.map((p: any) => {
    const stat = p.stat || {}
    return {
      slug: stat.question__title_slug || '',
      title: stat.question__title || '',
      difficulty: diffFromLevel(p.difficulty?.level ?? 2),
      paidOnly: !!p.paid_only,
      frontendId: stat.frontend_question_id
    } as IndexedProblem
  })
}

/** 按语言取题目索引（带本地缓存） */
export async function fetchProblemIndex(host: string | undefined, cacheDir: string): Promise<IndexedProblem[]> {
  const lang: 'zh' | 'en' = host && /\.com$/i.test(hostBaseHost(host)) ? 'en' : 'zh'
  const cached = readIndexCache(cacheDir, lang)
  if (cached) return cached
  const items = lang === 'zh' ? await fetchCnIndex() : await fetchComIndex()
  // 两种来源的默认顺序不一样，统一按题号升序（纯数字在前，LCR/面试题在后）
  items.sort((a, b) => {
    const na = parseInt(String(a.frontendId ?? ''), 10)
    const nb = parseInt(String(b.frontendId ?? ''), 10)
    const aNum = Number.isFinite(na)
    const bNum = Number.isFinite(nb)
    if (aNum && bNum && na !== nb) return na - nb
    if (aNum !== bNum) return aNum ? -1 : 1
    return String(a.frontendId ?? '').localeCompare(String(b.frontendId ?? ''))
  })
  if (items.length) writeIndexCache(cacheDir, lang, items)
  return items
}

function hostBaseHost(host?: string): string {
  return (host || 'leetcode.cn').toLowerCase().replace(/^https?:\/\//, '')
}

// ---------------------------------------------------------------------------
// 学习计划（study plan）：官方「面试经典 150 题」「LeetCode 75」这类题单。
// 与收藏夹题单不是同一个接口，这里统一转换成 CatalogEntry（kind: 'list'）。
// ---------------------------------------------------------------------------

/** 已验证可用的学习计划（count 为实际可拉取的题目数；拉取时会用接口返回的真实名字覆盖展示名） */
export const STUDY_PLANS: { slug: string; name: string; count: number }[] = [
  { slug: 'top-interview-150', name: '面试经典 150 题', count: 150 },
  { slug: 'leetcode-75', name: 'LeetCode 75', count: 75 },
  { slug: 'programming-skills', name: '编程基础 0 到 1', count: 33 },
  { slug: 'dynamic-programming', name: '动态规划（基础版）', count: 46 },
  { slug: 'binary-search', name: '二分查找 · 系统掌握', count: 32 },
  { slug: 'graph-theory', name: '图论 · 从入门到精通', count: 36 },
  { slug: '30-days-of-javascript', name: '30 天 JavaScript 挑战', count: 30 }
]

const STUDY_PLAN_QUERY = `query studyPlanV2Detail($planSlug: String!) {
  studyPlanV2Detail(planSlug: $planSlug) {
    name
    slug
    questionNum
    planSubGroups {
      name
      questionNum
      questions { titleSlug translatedTitle title questionFrontendId difficulty paidOnly }
    }
  }
}`

function diffFromStr(d: any): Difficulty {
  const s = String(d || '').toLowerCase()
  if (s === 'easy') return 'easy'
  if (s === 'hard') return 'hard'
  return 'medium'
}

/** 拉取一个学习计划（面试经典 150 题、LeetCode 75……） */
export async function fetchStudyPlan(slug: string): Promise<CatalogEntry> {
  const base = hostBase(SOLUTION_HOST)
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: `${base}/studyplan/${slug}/` },
    body: JSON.stringify({
      operationName: 'studyPlanV2Detail',
      variables: { planSlug: slug },
      query: STUDY_PLAN_QUERY
    })
  })
  if (!res.ok) throw new Error(`学习计划请求失败：HTTP ${res.status}`)
  const j: any = await res.json()
  if (j?.errors?.length) throw new Error(String(j.errors[0]?.message || '学习计划接口报错'))
  const d = j?.data?.studyPlanV2Detail
  if (!d) throw new Error(`未找到学习计划「${slug}」（可能已下线）`)
  const seen = new Set<string>()
  const items: CatalogItem[] = []
  for (const g of d.planSubGroups || []) {
    for (const q of g.questions || []) {
      if (!q?.titleSlug || seen.has(q.titleSlug)) continue
      seen.add(q.titleSlug)
      items.push({
        slug: q.titleSlug,
        frontendId: q.questionFrontendId || undefined,
        title: q.title || q.translatedTitle || q.titleSlug,
        titleCn: q.translatedTitle || undefined,
        difficulty: diffFromStr(q.difficulty)
      })
    }
  }
  if (!items.length) throw new Error(`学习计划「${d.name || slug}」没有可拉取的题目`)
  return {
    id: 'plan-' + slug,
    kind: 'list',
    title: d.name || STUDY_PLANS.find((p) => p.slug === slug)?.name || slug,
    host: SOLUTION_HOST,
    note: '学习计划',
    items
  }
}

/** 我创建的题单（收藏夹），需要登录态 */
export async function fetchMyProblemLists(headers?: Record<string, string>): Promise<{ slug: string; name: string }[]> {
  const base = hostBase(SOLUTION_HOST)
  try {
    const res = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: `${base}/problem-list/`, ...(headers || {}) },
      body: JSON.stringify({
        operationName: 'myCreatedFavoriteList',
        query: `query myCreatedFavoriteList { myCreatedFavoriteList { favorites { slug name } } }`
      })
    })
    const j: any = await res.json()
    const list = j?.data?.myCreatedFavoriteList?.favorites
    if (!Array.isArray(list)) return []
    return list.filter((x: any) => x?.slug && x?.name).map((x: any) => ({ slug: x.slug, name: x.name }))
  } catch {
    return []
  }
}

export async function fetchProblemListCatalog(
  favoriteSlug: string,
  host?: string,
  listTitle?: string
): Promise<CatalogEntry> {
  const base = hostBase(host)
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Referer: `${base}/problem-list/${favoriteSlug}/`
    },
    body: JSON.stringify({
      operationName: 'favoriteQuestionList',
      variables: { favoriteSlug },
      query: `query favoriteQuestionList($favoriteSlug: String!) {
        favoriteQuestionList(favoriteSlug: $favoriteSlug) {
          questions { questionFrontendId title titleSlug difficulty paidOnly translatedTitle }
        }
      }`
    })
  })
  const txt = await res.text()
  let j: any
  try { j = JSON.parse(txt) } catch { throw new Error('题单返回非 JSON') }
  if (!res.ok || !j?.data?.favoriteQuestionList) {
    throw new Error(`题单拉取失败：${j?.errors?.[0]?.message || `HTTP ${res.status}`}`)
  }
  const list = j.data.favoriteQuestionList
  const items = (list.questions || [])
    .filter((qq: any) => !qq.paidOnly)
    .map((qq: any) => ({
      slug: qq.titleSlug,
      frontendId: qq.questionFrontendId,
      title: qq.title,
      titleCn: qq.translatedTitle || undefined,
      difficulty: diffFromLevel(diffStr(qq.difficulty))
    }))
  const entry: CatalogEntry = {
    id: favoriteSlug,
    kind: 'list',
    title: listTitle || favoriteSlug,
    host: base.replace(/^https:\/\//, ''),
    items
  }
  if (!items.length) throw new Error('该题单为空或全部需要会员')
  return entry
}

// ---- 题解（solutions）----
// 题解接口只在 leetcode.cn 提供（com 的 schema 不同且字段更少），因此固定走 cn。
const SOLUTION_HOST = 'leetcode.cn'

const SOLUTION_LIST_QUERY = `query questionSolutionArticles($questionSlug: String!, $first: Int, $skip: Int, $orderBy: SolutionArticleOrderBy) {
  questionSolutionArticles(questionSlug: $questionSlug, first: $first, skip: $skip, orderBy: $orderBy) {
    totalNum
    edges {
      node {
        slug title upvoteCount createdAt summary
        author { username profile { userAvatar realName userSlug } }
        tags { name }
      }
    }
  }
}`

const SOLUTION_LIST_QUERY_BASIC = `query questionSolutionArticles($questionSlug: String!, $first: Int, $skip: Int, $orderBy: SolutionArticleOrderBy) {
  questionSolutionArticles(questionSlug: $questionSlug, first: $first, skip: $skip, orderBy: $orderBy) {
    totalNum
    edges { node { slug title upvoteCount createdAt summary author { username } tags { name } } }
  }
}`

const SOLUTION_DETAIL_QUERY = `query solutionArticle($slug: String!) {
  solutionArticle(slug: $slug) {
    title content upvoteCount createdAt
    author { username profile { userAvatar realName userSlug } }
  }
}`

const SOLUTION_DETAIL_QUERY_BASIC = `query solutionArticle($slug: String!) {
  solutionArticle(slug: $slug) {
    title content upvoteCount createdAt
    author { username }
  }
}`

/** 头像/昵称字段（profile）在某些站点版本上可能不存在：失败后退回基础查询并记住 */
let solutionAuthorProfileOk = true

function authorOf(a: any): { author: string; authorName?: string; authorAvatar?: string; authorSlug?: string } {
  const p = a?.profile || {}
  return {
    author: a?.username || '匿名',
    authorName: p.realName || undefined,
    authorAvatar: p.userAvatar || undefined,
    authorSlug: p.userSlug || undefined
  }
}

async function gqlPost(base: string, referer: string, body: unknown): Promise<any> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Referer: referer
    },
    body: JSON.stringify(body)
  })
  const txt = await res.text()
  let json: any
  try { json = JSON.parse(txt) } catch { throw new Error(`题解接口返回非 JSON（HTTP ${res.status}）`) }
  if (json?.errors?.length) throw new Error(String(json.errors[0]?.message || '题解接口报错'))
  if (!res.ok) throw new Error(`题解请求失败：HTTP ${res.status}`)
  return json?.data
}

export async function fetchSolutionList(
  questionSlug: string,
  opts: { first?: number; skip?: number; orderBy?: SolutionOrderBy } = {}
): Promise<SolutionListResult> {
  const base = hostBase(SOLUTION_HOST)
  const first = Math.min(Math.max(opts.first ?? 20, 1), 50)
  const skip = Math.max(opts.skip ?? 0, 0)
  const vars = { questionSlug, first, skip, orderBy: opts.orderBy || 'DEFAULT' }
  const referer = `${base}/problems/${questionSlug}/solutions/`
  let data: any
  try {
    data = await gqlPost(base, referer, {
      operationName: 'questionSolutionArticles',
      variables: vars,
      query: solutionAuthorProfileOk ? SOLUTION_LIST_QUERY : SOLUTION_LIST_QUERY_BASIC
    })
  } catch (e: any) {
    // profile 字段不被支持时退回基础查询
    if (solutionAuthorProfileOk && /profile|userAvatar|realName/i.test(String(e?.message || ''))) {
      solutionAuthorProfileOk = false
      data = await gqlPost(base, referer, {
        operationName: 'questionSolutionArticles',
        variables: vars,
        query: SOLUTION_LIST_QUERY_BASIC
      })
    } else {
      throw e
    }
  }
  const conn = data?.questionSolutionArticles
  if (!conn) throw new Error(`未找到题目「${questionSlug}」的题解`)
  const items: SolutionItem[] = (conn.edges || [])
    .map((e: any) => e?.node)
    .filter(Boolean)
    .map((n: any) => ({
      slug: n.slug,
      title: n.title || '(无标题)',
      ...authorOf(n.author),
      upvoteCount: n.upvoteCount || 0,
      createdAt: n.createdAt || undefined,
      summary: (n.summary || '').replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
      tags: (n.tags || []).map((t: any) => t.name).filter(Boolean)
    }))
  return { total: conn.totalNum || items.length, items, host: base.replace(/^https:\/\//, '') }
}

export async function fetchSolutionDetail(slug: string, questionSlug?: string): Promise<SolutionDetail> {
  const base = hostBase(SOLUTION_HOST)
  const referer = `${base}/problems/${questionSlug || ''}/solutions/`
  let data: any
  try {
    data = await gqlPost(base, referer, {
      operationName: 'solutionArticle',
      variables: { slug },
      query: solutionAuthorProfileOk ? SOLUTION_DETAIL_QUERY : SOLUTION_DETAIL_QUERY_BASIC
    })
  } catch (e: any) {
    if (solutionAuthorProfileOk && /profile|userAvatar|realName/i.test(String(e?.message || ''))) {
      solutionAuthorProfileOk = false
      data = await gqlPost(base, referer, {
        operationName: 'solutionArticle',
        variables: { slug },
        query: SOLUTION_DETAIL_QUERY_BASIC
      })
    } else {
      throw e
    }
  }
  const a = data?.solutionArticle
  if (!a) throw new Error('题解内容为空（可能已被删除或需要登录）')
  return {
    slug,
    title: a.title || '(无标题)',
    ...authorOf(a.author),
    upvoteCount: a.upvoteCount || 0,
    createdAt: a.createdAt || undefined,
    content: a.content || '',
    link: questionSlug
      ? `${base}/problems/${questionSlug}/solutions/${slug}/`
      : `${base}/problemset/`
  }
}

function diffStr(d: any): number {
  if (typeof d === 'number') return d
  if (typeof d === 'string') {
    const s = d.toLowerCase()
    if (s === 'easy') return 1
    if (s === 'hard') return 3
  }
  return 2
}

interface Meta {
  judgeType: 'function' | 'class'
  methodName: string
  params: Param[]
  returnType: string
  constructorParams?: Param[]
  methods?: Method[]
  manual: boolean
}

function parseMeta(s: string | undefined): Meta {
  let raw: any = {}
  if (s && typeof s === 'string') { try { raw = JSON.parse(s) } catch { raw = {} } }
  else raw = s || {}

  // 注意：必须用 hasOwnProperty 判断，因为 raw.constructor 永远是 Object 构造函数（恒为真）
  if (raw && Object.prototype.hasOwnProperty.call(raw, 'constructor') && raw.constructor) {
    // class mode: metaData.name is the class name
    const methods: Method[] = (raw.methods || []).map((m: any) => ({
      name: m.name,
      params: (m.params || []).map((p: any) => ({ name: p.name, type: p.type })),
      returnType: m.return?.type || 'void'
    }))
    return {
      judgeType: 'class',
      methodName: raw.name || 'Solution',
      params: [],
      returnType: 'void',
      constructorParams: (raw.constructor?.params || []).map((p: any) => ({ name: p.name, type: p.type })),
      methods,
      manual: !!raw.manual
    }
  }

  return {
    judgeType: 'function',
    methodName: raw.name || 'run',
    params: (raw.params || []).map((p: any) => ({ name: p.name, type: p.type })),
    returnType: raw.return?.type || 'void',
    manual: !!raw.manual
  }
}

// 从语言 starter 代码里解析真实参数（名称 + 类型），手动判题题的真实签名不含判题专用字段
function realParamsFromStarters(starters: Partial<Record<Language, string>>, methodName: string): Param[] {
  const inferType = (token: string): string => {
    const t = token
    const dims = (t.match(/\[\s*\]/g) || []).length
    let base = 'integer'
    if (/ListNode/i.test(t)) base = 'ListNode'
    else if (/TreeNode/i.test(t)) base = 'TreeNode'
    else if (/\b(bool|boolean)\b/i.test(t)) base = 'boolean'
    else if (/\b(double|float)\b/i.test(t)) base = 'double'
    else if (/\b(String|string|char\s*\*|str)\b/.test(t)) base = 'string'
    else if (/\b(int|long|integer|size_t)\b/i.test(t)) base = 'integer'
    return base + '[]'.repeat(dims)
  }
  const pick = (code: string, style: 'cpp' | 'java' | 'python' | 'c'): Param[] => {
    for (const raw of code.split('\n')) {
      const line = raw.trim()
      if (!line.includes(methodName)) continue
      const open = line.indexOf('(')
      const close = line.lastIndexOf(')')
      if (open < 0 || close < open) continue
      const inner = line.slice(open + 1, close)
      if (!inner.trim()) return []
      const parts: string[] = []
      let depth = 0, cur = ''
      for (const ch of inner) {
        if (ch === '<' || ch === '[') depth++
        if (ch === '>' || ch === ']') depth--
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
        cur += ch
      }
      if (cur.trim()) parts.push(cur)
      const out: Param[] = []
      for (let p of parts) {
        p = p.trim()
        if (style === 'python') {
          const [namePart, ...typeParts] = p.split(':')
          const name = namePart.trim()
          if (!name || name === 'self') continue
          const typeText = typeParts.join(':')
          out.push({ name, type: typeText ? inferType(typeText) : 'integer' })
        } else {
          const m = /([A-Za-z_]\w*)\s*(?:\[\s*\])?\s*$/.exec(p)
          if (!m) continue
          out.push({ name: m[1], type: inferType(p.slice(0, p.length - m[1].length)) })
        }
      }
      return out
    }
    return []
  }
  const order: [Language, 'cpp' | 'java' | 'python' | 'c'][] = [
    ['cpp', 'cpp'], ['java', 'java'], ['python', 'python'], ['c', 'c']
  ]
  for (const [lang, style] of order) {
    const code = starters[lang]
    if (!code) continue
    const params = pick(code, style)
    if (params.length) return params
  }
  return []
}

// 手动判题：相交链表类（intersectVal/listA/listB/skipA/skipB）
export function isIntersectPattern(problem: Problem): boolean {
  const names = (problem.manualParams || []).map((p) => p.name)
  return !!(problem.manual &&
    names.includes('intersectVal') && names.includes('listA') && names.includes('listB') &&
    names.includes('skipA') && names.includes('skipB'))
}

function normalizeManualExpected(expected: string): string {
  const m = /(-?\d+)/.exec(expected)
  if (m) return m[1]
  return '0'
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function splitTopLevel(s: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  let inStr = false
  let quote = ''
  for (const ch of s) {
    if (inStr) {
      cur += ch
      if (ch === '\\') { /* keep next */ }
      else if (ch === quote) inStr = false
      continue
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; cur += ch; continue }
    if (ch === '[' || ch === '{') { depth++; cur += ch; continue }
    if (ch === ']' || ch === '}') { depth--; cur += ch; continue }
    if (ch === delim && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

export function parseExamples(content: string, meta: Meta): TestCase[] {
  const text = htmlToText(content)
  const tests: TestCase[] = []
  // 兼容中英文标签：Input: / 输入：  Output: / 输出：
  const re = /(?:Input|输入)\s*[:：]\s*([\s\S]*?)\n\s*(?:Output|输出)\s*[:：]\s*([\s\S]*?)(?=\n\s*\n|\n\s*(?:Example|示例|Explanation|解释|Constraints|Note|Input|输入|Output|输出)(?![A-Za-z\u4e00-\u9fa5])|\s*$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const inputBlock = m[1].trim()
    const outputBlock = m[2].trim()
    const inputLines = inputBlock.split(/\n/).map((s) => s.trim()).filter(Boolean)
    const expected = outputBlock.replace(/\s+/g, '').trim()

    let input: string[]
    if (meta.judgeType === 'class') {
      // ops line + args array-of-arrays
      input = inputLines.slice(0, 2)
      if (input.length < 2) continue
      // ops JSON line may be part of the first line
    } else {
      const tokens = splitTopLevel(inputBlock, ',')
      const args: string[] = []
      for (const tok of tokens) {
        const eq = tok.indexOf('=')
        if (eq >= 0) args.push(tok.slice(eq + 1).trim())
        else args.push(tok.trim())
      }
      input = args
    }
    if (input.length === 0 || !expected) continue
    try { JSON.parse(expected) } catch { /* still keep as string */ }
    tests.push({ id: 'ex' + tests.length, input, expected })
  }
  return tests
}
