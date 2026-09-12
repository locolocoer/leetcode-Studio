import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { AuthStatus, Language, SubmitVerdict } from '../shared/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

export function baseOf(host: string): string {
  const h = (host || 'leetcode.com').toLowerCase().replace(/^https?:\/\//, '')
  return h.includes('.') ? `https://${h}` : 'https://leetcode.com'
}

export function langSlugOf(lang: Language): string | null {
  switch (lang) {
    case 'python': return 'python3'
    case 'java': return 'java'
    case 'cpp': return 'cpp'
    case 'c': return 'c'
  }
  return null
}

interface Jar { csrf?: string; session?: string; username?: string }

export class LeetCodeClient {
  private jar: Record<string, Jar> = {}
  private sessionFile: string

  constructor(dataDir: string) {
    this.sessionFile = join(dataDir, 'lc-session.json')
    try {
      this.jar = JSON.parse(readFileSync(this.sessionFile, 'utf8'))
    } catch {
      this.jar = {}
    }
  }

  private save() {
    mkdirSync(join(this.sessionFile, '..'), { recursive: true })
    writeFileSync(this.sessionFile, JSON.stringify(this.jar, null, 2), 'utf8')
  }

  private jarOf(host: string): Jar {
    if (!this.jar[host]) this.jar[host] = {}
    return this.jar[host]
  }

  private headers(host: string, extra?: Record<string, string>): Record<string, string> {
    const j = this.jarOf(host)
    const h: Record<string, string> = { 'User-Agent': UA, ...extra }
    const cookies: string[] = []
    if (j.csrf) cookies.push(`csrftoken=${j.csrf}`)
    if (j.session) cookies.push(`LEETCODE_SESSION=${j.session}`)
    if (cookies.length) h.Cookie = cookies.join('; ')
    return h
  }

  private capture(res: Response, host: string) {
    const j = this.jarOf(host)
    let scs: string[] = []
    try { scs = (res.headers as any).getSetCookie?.() || [] } catch { scs = [] }
    for (const sc of scs) {
      const [pair] = sc.split(';')
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const val = pair.slice(eq + 1).trim()
      if (name === 'csrftoken') j.csrf = val
      else if (name === 'LEETCODE_SESSION') j.session = val
    }
  }

  status(host: string): AuthStatus {
    const j = this.jarOf(host)
    return { host, loggedIn: !!j.session, username: j.username }
  }

  async whoami(host: string): Promise<string | undefined> {
    const base = baseOf(host)
    try {
      const res = await fetch(`${base}/api/problems/all/`, { headers: this.headers(host), redirect: 'follow' })
      if (!res.ok) return undefined
      const data: any = await res.json()
      const u = data?.user_name
      if (typeof u === 'string' && u.trim()) {
        this.jarOf(host).username = u.trim()
        this.save()
        return u.trim()
      }
    } catch { /* ignore */ }
    return undefined
  }

  async logout(host: string) {
    delete this.jar[host]
    this.save()
  }

  async login(host: string, username: string, password: string): Promise<AuthStatus & { ok: boolean; error?: string }> {
    const base = baseOf(host)
    const j = this.jarOf(host)

    // 1) GET the login page to obtain a fresh csrftoken cookie
    try {
      const page = await fetch(`${base}/accounts/login/`, {
        headers: { 'User-Agent': UA },
        redirect: 'manual'
      })
      this.capture(page, host)
      // fallback: scrape csrf token hidden field from the HTML
      if (!j.csrf) {
        const html = await page.text()
        const m = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)
        if (m) j.csrf = m[1]
      }
    } catch (e: any) {
      return { host, loggedIn: false, ok: false, error: `无法连接登录页：${e?.message || e}` }
    }

    if (!j.csrf) {
      return { host, loggedIn: false, ok: false, error: '未能获取 CSRF token（可能网络受限或被验证码拦截）' }
    }

    // 2) POST credentials
    const form = new URLSearchParams()
    form.set('csrfmiddlewaretoken', j.csrf)
    form.set('login', username)
    form.set('password', password)
    form.set('next', '/')

    try {
      const res = await fetch(`${base}/accounts/login/`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `csrftoken=${j.csrf}`,
          Referer: `${base}/accounts/login/`
        },
        body: form.toString()
      })
      this.capture(res, host)

      if (res.status === 302 && !j.session) {
        // followed nothing; check location
        const loc = res.headers.get('location') || ''
        if (loc.includes('two_factor')) {
          return { host, loggedIn: false, ok: false, error: '该账号启用了两步验证，暂不支持自动化登录，请稍后再试。' }
        }
      }

      if (!j.session) {
        // read error from html body for a friendlier message
        let err = '用户名或密码错误，或登录被拦截。'
        try {
          const html = await res.text()
          if (/Captcha/i.test(html)) err = '登录要求人机验证（Captcha），请稍后或改用站点页面登录。'
          else if (/incorrect|valid login/i.test(html)) err = '用户名或密码不正确。'
        } catch { /* ignore */ }
        return { host, loggedIn: false, ok: false, error: err }
      }
    } catch (e: any) {
      return { host, loggedIn: false, ok: false, error: `登录请求失败：${e?.message || e}` }
    }

    j.username = username
    this.save()

    // verify session actually works
    const real = await this.whoami(host)
    if (real) j.username = real
    else {
      // session cookie present but API didn't confirm — try the profile page
      const profile = await fetch(`${base}/u/${username}/`, { headers: this.headers(host), redirect: 'follow' })
      this.capture(profile, host)
    }
    this.save()
    return { host, loggedIn: true, username: j.username || username, ok: true }
  }

  async importSession(
    host: string,
    session: string,
    csrf?: string
  ): Promise<AuthStatus & { ok: boolean; error?: string }> {
    const j = this.jarOf(host)
    j.session = session.trim()
    if (csrf) j.csrf = csrf.trim()
    this.save()
    const u = await this.whoami(host)
    if (!u) {
      return { host, loggedIn: true, ok: true, error: '会话已保存，但未能确认用户名（会话可能已过期）。' }
    }
    j.username = u
    this.save()
    return { host, loggedIn: true, username: u, ok: true }
  }

  async importSessionFromText(
    host: string,
    text: string
  ): Promise<AuthStatus & { ok: boolean; error?: string }> {
    const t = (text || '').replace(/^cookie\s*:/i, '').trim()
    if (!t) return { host, loggedIn: false, ok: false, error: 'Cookie 内容为空' }
    let session = ''
    let csrf = ''
    for (const part of t.split(';')) {
      const eq = part.indexOf('=')
      if (eq <= 0) continue
      const name = part.slice(0, eq).trim()
      const val = part.slice(eq + 1).trim()
      if (name === 'LEETCODE_SESSION') session = val
      else if (name === 'csrftoken') csrf = val
    }
    if (!session) {
      return { host, loggedIn: false, ok: false, error: '未找到 LEETCODE_SESSION。请粘贴浏览器里的完整 Cookie。' }
    }
    return this.importSession(host, session, csrf)
  }

  async submit(
    host: string,
    slug: string,
    questionId: string | number,
    lang: Language,
    code: string
  ): Promise<SubmitVerdict> {
    const base = baseOf(host)
    const j = this.jarOf(host)
    if (!j.session) return { ok: false, accepted: false, status: '未登录', error: '请先登录 LeetCode 账号' }
    const lslug = langSlugOf(lang)
    if (!lslug) return { ok: false, accepted: false, status: '不支持的语言', error: '该语言不支持提交' }
    const qid = Number(questionId)
    if (!Number.isInteger(qid) || qid <= 0) {
      return { ok: false, accepted: false, status: '缺少题目 ID', error: '仅支持提交从 LeetCode 拉取的题目或内置示例题。' }
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return { ok: false, accepted: false, status: '缺少题目标识', error: '题目缺少有效的 title slug。' }
    }

    // POST /submit/
    let subId: number
    try {
      const res = await fetch(`${base}/problems/${slug}/submit/`, {
        method: 'POST',
        headers: this.headers(host, {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': j.csrf || '',
          Referer: `${base}/problems/${slug}/`
        }),
        body: JSON.stringify({ lang: lslug, question_id: qid, typed_code: code })
      })
      this.capture(res, host)
      const txt = await res.text()
      let data: any
      try { data = JSON.parse(txt) } catch { data = null }
      if (data?.submission_id != null) subId = Number(data.submission_id)
      else {
        let msg = data?.error || data?.msg || data?.detail || ''
        if (!msg && txt.trim().startsWith('<')) {
          msg = res.status === 403
            ? '请求被拒绝（会话可能已失效），请重新登录后重试。'
            : '服务端返回了异常页面，请稍后重试。'
        }
        if (res.status === 429) return { ok: false, accepted: false, status: '频率限制', error: '提交过于频繁，请稍后再试。' }
        if (!msg) msg = txt.slice(0, 200)
        return { ok: false, accepted: false, status: '提交失败', error: `提交被拒绝：${msg}` }
      }
    } catch (e: any) {
      return { ok: false, accepted: false, status: '网络错误', error: `提交请求失败：${e?.message || e}` }
    }

    // poll judge result
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      await sleep(1200)
      try {
        const res = await fetch(`${base}/submissions/detail/${subId}/check/`, {
          headers: this.headers(host, { Referer: `${base}/problems/${slug}/` })
        })
        this.capture(res, host)
        const data: any = await res.json()
        if (data.state === 'SUCCESS') {
          return buildVerdict(data, subId)
        }
        if (data.state && data.state !== 'PENDING' && data.state !== 'STARTED') {
          return { ok: false, accepted: false, status: data.state, error: JSON.stringify(data).slice(0, 300) }
        }
      } catch (e: any) {
        return { ok: false, accepted: false, status: '网络错误', error: `查询评测结果失败：${e?.message || e}` }
      }
    }
    return { ok: false, accepted: false, status: '超时', error: '评测超时（>60s），请到 LeetCode 网页查看结果。' }
  }
}

function buildVerdict(data: any, submissionId: number): SubmitVerdict {
  const msg: string = data.status_msg || 'Unknown'
  const accepted = msg === 'Accepted'
  const v: SubmitVerdict = {
    ok: true,
    accepted,
    status: msg,
    submissionId,
    totalCases: data.total_testcases,
    passedCases: accepted ? data.total_testcases : data.total_correct
  }
  if (data.runtime != null) v.runtime = String(data.runtime)
  if (data.memory != null) v.memory = String(data.memory)
  if (!accepted) {
    v.lastTestcase = data.last_testcase || undefined
    v.expectedOutput = data.expected_output || undefined
    v.actualOutput = data.code_output || data.output || undefined
    if (msg === 'Compile Error') v.error = data.compile_error || '编译错误'
    else if (msg === 'Runtime Error') v.error = data.runtime_error || '运行错误'
    else if (msg === 'Time Limit Exceeded' || msg === 'Memory Limit Exceeded') v.error = '请在 LeetCode 查看详细堆栈'
  }
  return v
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
