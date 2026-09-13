// 轻量 Markdown 渲染：只覆盖 LeetCode 题解实际用到的语法。
// 内容来自网络，必须先转义 HTML 再做标记替换，避免注入。

import hljs from 'highlight.js/lib/core'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import java from 'highlight.js/lib/languages/java'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import csharp from 'highlight.js/lib/languages/csharp'
import kotlin from 'highlight.js/lib/languages/kotlin'
import swift from 'highlight.js/lib/languages/swift'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import plaintext from 'highlight.js/lib/languages/plaintext'

for (const [name, lang] of Object.entries({
  cpp, c, java, python, javascript, typescript, go, rust, csharp, kotlin, swift, ruby, php, sql, bash, plaintext
})) {
  hljs.registerLanguage(name, lang as any)
}

/** 题解里常见的语言别名 → highlight.js 的语言名 */
const LANG_ALIAS: Record<string, string> = {
  'c++': 'cpp', cplusplus: 'cpp', cpp11: 'cpp', 'cpp17': 'cpp',
  c: 'c', java: 'java', 'java8': 'java', py: 'python', python3: 'python', python: 'python',
  js: 'javascript', javascript: 'javascript', node: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  go: 'go', golang: 'go', rs: 'rust', rust: 'rust',
  cs: 'csharp', 'c#': 'csharp', kt: 'kotlin', kotlin: 'kotlin', swift: 'swift',
  rb: 'ruby', ruby: 'ruby', php: 'php', sql: 'sql', mysql: 'sql',
  sh: 'bash', shell: 'bash', bash: 'bash', zsh: 'bash',
  text: 'plaintext', plaintext: 'plaintext', txt: 'plaintext'
}

/** 高亮一段代码；语言未知时用一小撮常见语言自动推断，失败就原样转义 */
function highlightCode(code: string, rawLang: string): { html: string; langClass: string } {
  const key = (rawLang || '').trim().toLowerCase()
  const name = LANG_ALIAS[key] || key
  if (name && hljs.getLanguage(name)) {
    try {
      return { html: hljs.highlight(code, { language: name, ignoreIllegals: true }).value, langClass: name }
    } catch {
      /* 落到自动推断 */
    }
  }
  if (!name) {
    try {
      const auto = hljs.highlightAuto(code, ['cpp', 'java', 'python', 'c', 'javascript', 'go', 'sql', 'bash'])
      return { html: auto.value, langClass: auto.language || 'plaintext' }
    } catch {
      /* 落到纯文本 */
    }
  }
  return { html: escapeHtml(code), langClass: 'plaintext' }
}

/** 语言的显示名（tab 与代码块标题都用它） */
const LANG_LABEL: Record<string, string> = {
  cpp: 'C++', c: 'C', java: 'Java', python: 'Python3', javascript: 'JavaScript',
  typescript: 'TypeScript', go: 'Go', rust: 'Rust', csharp: 'C#', kotlin: 'Kotlin',
  swift: 'Swift', ruby: 'Ruby', php: 'PHP', sql: 'SQL', bash: 'Bash', plaintext: '代码'
}

function normLang(rawLang: string): string {
  const key = (rawLang || '').trim().toLowerCase()
  return LANG_ALIAS[key] || key
}

/**
 * tab 标签：优先「语言名 + 备注里的额外信息」。
 * 备注形如 sol1-Java / sol2-C++ / Python3 写法二：去掉 solN- 前缀后，
 * 剩下的如果又只是语言名就丢掉，否则作为后缀（如「Java 写法二」）。
 */
function codeLabel(rawLang: string, note: string): string {
  const name = normLang(rawLang)
  const base = LANG_LABEL[name] || (rawLang ? rawLang.trim() : '代码')
  if (!note) return base
  const cleaned = note.replace(/^sol[-\d]*/i, '').trim()
  if (!cleaned) return base
  const asLang = normLang(cleaned.replace(/\s.*$/, ''))
  if (asLang === name || LANG_LABEL[asLang] === base) return base
  if (/^(java|c\+\+|cpp|python\d?|py\d?|c|go|rust|javascript|js|typescript|ts|c#|cs|kotlin|swift|ruby|php|sql|bash|sh)$/i.test(cleaned)) return base
  return `${base} ${cleaned}`
}

/** 把同一段代码的多语言版本渲染成一个带 tab 的卡片 */
function renderCodeTabs(
  blocks: { lang: string; note: string; code: string; key: string }[],
  preferredLang?: string
): string {
  const labels = blocks.map((b) => codeLabel(b.lang, b.note))
  // 同语言多个版本时补序号，避免两个「Java」分不清
  const seen = new Map<string, number>()
  const finalLabels = labels.map((l) => {
    const n = (seen.get(l) || 0) + 1
    seen.set(l, n)
    return n > 1 ? `${l} ${n}` : l
  })

  const want = preferredLang ? normLang(preferredLang) : ''
  let active = blocks.findIndex((b) => normLang(b.lang) === want)
  if (active < 0) active = 0

  const tabs = blocks
    .map((b, idx) =>
      `<button class="md-tab${idx === active ? ' active' : ''}" data-tab="${idx}" ` +
      `title="${escapeHtml(finalLabels[idx])}">${escapeHtml(finalLabels[idx])}</button>`
    )
    .join('')

  const panels = blocks
    .map((b, idx) => {
      const hl = highlightCode(b.code, b.lang)
      return (
        `<div class="md-tabpanel${idx === active ? ' active' : ''}" data-panel="${idx}">` +
        `<button class="md-copy md-copy-float" data-key="${b.key}" data-copy="${escapeHtml(b.code)}">复制</button>` +
        `<pre class="hljs"><code class="hljs language-${hl.langClass}">${hl.html}</code></pre></div>`
      )
    })
    .join('')

  return `<div class="md-code md-tabs"><div class="md-tabbar" role="tablist">${tabs}</div><div class="md-tabpanels">${panels}</div></div>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 题解里的图片是相对 key（视频/图片）时补全为 leetcode.cn 资源地址
function resolveAsset(url: string): { src: string; isVideo: boolean } {
  const u = url.trim()
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:')) return { src: u, isVideo: /\.(mp4|mov|webm)$/i.test(u) }
  const isVideo = /\.(mp4|mov|webm)$/i.test(u)
  return { src: `https://pic.leetcode.cn/${u.replace(/^\/+/, '')}`, isVideo }
}

// 数学公式：没有 KaTeX，做一次轻量 LaTeX → 近似可读文本
function texToText(tex: string): string {
  let s = tex
  s = s.replace(/\\(?:math(?:cal|it|bf|rm|tt|sf)|text(?:bf|it|rm|tt|sf)?|operatorname|mathrm)\s*\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, '')
  s = s.replace(/\\(?:times|cdot)\b/g, '×')
  s = s.replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥')
  s = s.replace(/\\neq\b/g, '≠').replace(/\\approx\b/g, '≈')
  s = s.replace(/\\infty\b/g, '∞').replace(/\\pi\b/g, 'π')
  s = s.replace(/\\sum\b/g, 'Σ').replace(/\\log\b/g, 'log')
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  s = s.replace(/\\(?:quad|qquad|,|;|!|\s)/g, ' ')
  s = s.replace(/\\[a-zA-Z]+/g, '')
  s = s.replace(/[{}]/g, '')
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, p1) => sup(p1))
  s = s.replace(/\^(\w)/g, (_m, p1) => sup(p1))
  s = s.replace(/_\{([^{}]*)\}/g, (_m, p1) => sub(p1))
  s = s.replace(/_(\w)/g, (_m, p1) => sub(p1))
  return s.trim()
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', i: 'ⁱ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', n: 'ₙ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ' }

function sup(s: string): string {
  return [...s].map((c) => SUP[c] ?? '^' + c).join('')
}
function sub(s: string): string {
  return [...s].map((c) => SUB[c] ?? '_' + c).join('')
}

// 行内标记（输入片段已转义）
function inline(src: string): string {
  let s = src
  // 行内数学（先处理，避免 $ 内的 * _ 被当成强调）
  const maths: string[] = []
  s = s.replace(/\$([^$\n]+)\$/g, (_m, tex) => {
    maths.push(texToText(tex))
    return `\u0000M${maths.length - 1}\u0000`
  })
  // 行内代码
  const codes: string[] = []
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push(c)
    return `\u0000C${codes.length - 1}\u0000`
  })
  // 图片 / 链接
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, url) => {
    const { src: u, isVideo } = resolveAsset(url)
    if (isVideo) {
      return `<a class="md-video" href="${u}" target="_blank" rel="noreferrer">▶ ${alt || '视频讲解'}</a>`
    }
    return `<img src="${u}" alt="${alt}" loading="lazy" />`
  })
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text, url) => {
    const href = /^(https?:)?\/\//i.test(url) ? url : `https://leetcode.cn/${url.replace(/^\/+/, '')}`
    return `<a href="${href}" target="_blank" rel="noreferrer">${text || href}</a>`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s（(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`)
  s = s.replace(/\u0000M(\d+)\u0000/g, (_m, i) => `<span class="md-math">${maths[Number(i)]}</span>`)
  return s
}

/** Markdown → HTML（仅用于展示，已做 HTML 转义）
 *  preferredLang：题解里同一段代码给了多种语言时，优先选中与当前刷题语言一致的那个 tab
 */
export function renderMarkdown(md: string, preferredLang?: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let para: string[] = []
  let codeIdx = 0

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(escapeHtml(para.join('\n'))).replace(/\n/g, '<br/>')}</p>`)
      para = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    const fence = /^\s*```+\s*(.*)$/.exec(line)
    if (fence) {
      flushPara()
      // 连续（中间只有空行）的多个代码块 = 同一段代码的多语言版本 → 合并成 tab
      const blocks: { lang: string; note: string; code: string; key: string }[] = []
      while (i < lines.length) {
        const f = /^\s*```+\s*(.*)$/.exec(lines[i])
        if (!f) break
        const info = f[1].trim()
        // 形如 "Java [sol1-Java]" / "py [sol-Python3]"：语言名 + 可选标注
        const lang = (info.split(/[\s[]/)[0] || '').toLowerCase()
        const note = /\[([^\]]+)\]/.exec(info)?.[1] || ''
        const body: string[] = []
        i++
        while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
          body.push(lines[i])
          i++
        }
        i++ // 跳过结束围栏
        blocks.push({ lang, note, code: body.join('\n'), key: 'code' + codeIdx++ })
        // 跳过空行后如果还是围栏，就继续并入同一组
        let j = i
        while (j < lines.length && lines[j].trim() === '') j++
        if (j < lines.length && /^\s*```+\s*\S/.test(lines[j])) { i = j; continue }
        break
      }

      if (blocks.length === 1) {
        const b = blocks[0]
        const hl = highlightCode(b.code, b.lang)
        out.push(
          `<div class="md-code"><div class="md-code-head"><span>${escapeHtml(codeLabel(b.lang, b.note))}</span>` +
          `<button class="md-copy" data-key="${b.key}" data-copy="${escapeHtml(b.code)}">复制</button></div>` +
          `<pre class="hljs"><code class="hljs language-${hl.langClass}">${hl.html}</code></pre></div>`
        )
      } else {
        out.push(renderCodeTabs(blocks, preferredLang))
      }
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      const lvl = Math.min(h[1].length + 1, 6) // # → h2，避免与外部标题冲突
      out.push(`<h${lvl}>${inline(escapeHtml(h[2].trim()))}</h${lvl}>`)
      i++
      continue
    }

    // 分隔线
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushPara()
      out.push('<hr/>')
      i++
      continue
    }

    // 引用
    if (/^\s*>/.test(line)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${inline(escapeHtml(quote.join('\n'))).replace(/\n/g, '<br/>')}</blockquote>`)
      continue
    }

    // 表格（| a | b | / |---|---|）
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      flushPara()
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(cells(lines[i]))
        i++
      }
      out.push(
        '<table class="md-table"><thead><tr>' +
        head.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      )
      continue
    }

    // 列表（有序/无序，支持一层缩进）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushPara()
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '')
        i++
        // 续行（缩进且不是新条目）
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          text += ' ' + lines[i].trim()
          i++
        }
        items.push(`<li>${inline(escapeHtml(text))}</li>`)
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }

    // 独立公式块
    if (/^\s*\$\$/.test(line)) {
      flushPara()
      const body: string[] = []
      const same = /\$\$(.+?)\$\$/.exec(line)
      if (same) {
        body.push(same[1])
        i++
      } else {
        i++
        while (i < lines.length && !/\$\$/.test(lines[i])) {
          body.push(lines[i])
          i++
        }
        i++
      }
      out.push(`<div class="md-math-block">${escapeHtml(texToText(body.join(' ')))}</div>`)
      continue
    }

    if (!line.trim()) {
      flushPara()
      i++
      continue
    }

    para.push(line)
    i++
  }
  flushPara()
  return out.join('\n')
}
