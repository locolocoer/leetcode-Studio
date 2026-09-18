import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Language, Problem, Settings } from '../shared/types'
import { putSharedHarness } from './aiHarness'

// ---------------------------------------------------------------------------
// 共享判题模板库
//
// 解决问题：内置确定性模板覆盖不到的题型，以前只能每个用户各自让 AI 生成一遍。
// 现在可以在「判题模板」弹窗里把验证过的模板**发布**到共享库（本仓库 harness/shared/），
// 其他人运行/调试时若内置模板不可用，会先自动从共享库拉取（OSS 优先，失败回退 GitHub raw），
// 本地编译 + 全用例验证通过后直接采用，**不再需要 AI**。
//
// 目录约定（都在仓库里，随 CI 同步到 OSS）：
//   harness/shared/index.json        条目索引
//   harness/shared/<key>.json        单个模板（key = <题目 id>:<语言>:<签名哈希>）
// ---------------------------------------------------------------------------

const OSS_BASE = 'https://fryappstore.oss-cn-beijing.aliyuncs.com/leetcodestudio/harness/shared/'
const GH_REPO = 'locolocoer/leetcode-Studio'
const GH_RAW = `https://raw.githubusercontent.com/${GH_REPO}/main/harness/shared/`
const GH_API = 'https://api.github.com'

export interface SharedEntry {
  key: string
  problemId: string
  slug: string
  title?: string
  language: Language
  sigHash: string
  author?: string
  createdAt?: string
  note?: string
}

interface SharedIndex {
  version: number
  updatedAt?: string
  entries: SharedEntry[]
}

/**
 * 共享库里的条目 key 也是文件名，必须只用安全字符：
 * 本地缓存用 `id:语言:哈希`，但文件名不能带冒号（Windows 建不了这种文件），所以换成 `-`。
 */
export function sharedKeyFor(problem: Problem, language: Language, sigHash: string): string {
  const pid = String(problem.id || problem.slug || 'x').replace(/[^A-Za-z0-9_-]/g, '_')
  const h = String(sigHash).replace(/[^A-Za-z0-9_-]/g, '_')
  return `${pid}-${language}-${h}`
}

let cachedIndex: { at: number; data: SharedIndex } | null = null
const INDEX_TTL_MS = 60 * 60 * 1000

async function getJson(url: string, timeoutMs = 8000): Promise<any | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'LeetCode-Studio' } })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** 取共享库索引：OSS 优先，失败回退 GitHub raw */
export async function fetchSharedIndex(force = false): Promise<SharedIndex | null> {
  if (!force && cachedIndex && Date.now() - cachedIndex.at < INDEX_TTL_MS) return cachedIndex.data
  const fromOss = await getJson(OSS_BASE + 'index.json')
  const data: SharedIndex | null = fromOss || (await getJson(GH_RAW + 'index.json'))
  if (!data || !Array.isArray(data.entries)) return null
  cachedIndex = { at: Date.now(), data }
  return data
}

export interface SharedHarness {
  code: string
  entry: SharedEntry
  from: 'oss' | 'github'
}

/**
 * 找一份可用于本题的共享模板。先按 key 精确匹配；没有则用「同题目 + 同语言」的条目兜底
 * （签名可能因为题面改版而变），最终能否用由调用方本地验证决定。
 */
export async function findSharedHarness(
  problem: Problem,
  language: Language,
  sigHash: string
): Promise<SharedHarness | null> {
  const index = await fetchSharedIndex()
  if (!index?.entries.length) return null
  const pid = String(problem.id || '')
  const key = sharedKeyFor(problem, language, sigHash)
  const exact = index.entries.find((e) => e.key === key)
  const loose = exact || index.entries.find((e) => e.language === language && (e.problemId === pid || (!!problem.slug && e.slug === problem.slug)))
  if (!loose) return null
  for (const base of [OSS_BASE, GH_RAW]) {
    const j = await getJson(base + `${encodeURIComponent(loose.key)}.json`)
    if (j && typeof j.code === 'string' && j.code.trim()) {
      return { code: j.code, entry: loose, from: base === OSS_BASE ? 'oss' : 'github' }
    }
  }
  return null
}

/** 共享模板验证通过后落盘到本地缓存（来源标记为 shared） */
export function installSharedHarness(problem: Problem, language: Language, code: string): void {
  putSharedHarness(problem, language, code)
}

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

export interface PublishResult {
  ok: boolean
  message: string
  /** 没配 token 时，模板写到哪里了（供手动提交） */
  localDir?: string
  payload?: { path: string; content: string }[]
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LeetCode-Studio',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

async function ghGet(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`${GH_API}${path}`, { headers: ghHeaders(token) })
    if (res.status === 404) return null
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function ghPut(path: string, token: string, message: string, contentB64: string, sha?: string): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { message, content: contentB64 }
    if (sha) body.sha = sha
    const res = await fetch(`${GH_API}${path}`, { method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body) })
    return res.ok
  } catch {
    return false
  }
}

/** 发布一份模板到共享库：有 token 走 GitHub API 提交，没有就落盘到本地目录供手动提交 */
export async function publishSharedHarness(
  settings: Settings,
  problem: Problem,
  language: Language,
  sigHash: string,
  code: string,
  opts: { note?: string; author?: string; outDir: string }
): Promise<PublishResult> {
  const key = sharedKeyFor(problem, language, sigHash)
  const entry: SharedEntry = {
    key,
    problemId: String(problem.id || ''),
    slug: problem.slug || '',
    title: problem.title,
    language,
    sigHash,
    author: opts.author || 'anonymous',
    createdAt: new Date().toISOString(),
    note: opts.note
  }
  const entryFile = {
    key,
    language,
    sigHash,
    problemId: entry.problemId,
    slug: entry.slug,
    title: entry.title,
    author: entry.author,
    createdAt: entry.createdAt,
    note: entry.note,
    code
  }

  // 本地也留一份（无论是否上传，方便查看/手动提交）
  const localDir = join(opts.outDir, 'harness-publish')
  let localErr = ''
  try {
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, `${key}.json`), JSON.stringify(entryFile, null, 2), 'utf8')
  } catch (e: any) {
    localErr = String(e?.message || e)
  }

  const token = (settings.githubToken || '').trim()
  if (!token) {
    return {
      ok: false,
      message: localErr
        ? `未配置 GitHub Token，且导出失败：${localErr}`
        : `未配置 GitHub Token，已导出到本地：${localDir}（也可以直接把这份 JSON 提交到仓库 harness/shared/ 目录）`,
      localDir: localErr ? undefined : localDir,
      payload: [
        { path: `harness/shared/${key}.json`, content: JSON.stringify(entryFile, null, 2) },
        { path: 'harness/shared/index.json', content: '' }
      ]
    }
  }

  // 1) 提交模板文件
  const entryPath = `/repos/${GH_REPO}/contents/harness/shared/${encodeURIComponent(key)}.json`
  const existing = await ghGet(entryPath, token)
  const okEntry = await ghPut(
    entryPath, token,
    `harness(${entry.problemId} ${language}): ${problem.title || problem.slug}`,
    Buffer.from(JSON.stringify(entryFile, null, 2), 'utf8').toString('base64'),
    existing?.sha
  )
  if (!okEntry) {
    return { ok: false, message: '提交模板失败：请检查 Token 是否有该仓库的 contents 写权限', localDir }
  }

  // 2) 更新索引
  const indexPath = `/repos/${GH_REPO}/contents/harness/shared/index.json`
  const idxFile = await ghGet(indexPath, token)
  let index: SharedIndex = { version: 1, entries: [] }
  if (idxFile?.content) {
    try {
      index = JSON.parse(Buffer.from(idxFile.content, 'base64').toString('utf8'))
      if (!Array.isArray(index.entries)) index.entries = []
    } catch { /* 用空索引重建 */ }
  }
  index.entries = index.entries.filter((e) => e.key !== key)
  index.entries.push(entry)
  index.updatedAt = new Date().toISOString()
  const okIndex = await ghPut(
    indexPath, token,
    `harness: add ${key}`,
    Buffer.from(JSON.stringify(index, null, 2), 'utf8').toString('base64'),
    idxFile?.sha
  )
  if (!okIndex) return { ok: false, message: '模板已提交，但索引更新失败（请重试）', localDir }

  cachedIndex = null
  return { ok: true, message: '已发布到共享库 🎉 其他人遇到这道题时会自动拉取（CI 会同步到 OSS）', localDir }
}

/** 读本地 index.json（开发/离线用；发布时用于合并） */
export function readLocalIndex(repoDir: string): SharedIndex | null {
  const f = join(repoDir, 'harness', 'shared', 'index.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
