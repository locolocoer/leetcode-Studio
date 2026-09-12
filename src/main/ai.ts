import type { AiChatRequest, AiContext, AiMessage, AiTestResult, Settings } from '../shared/types'

/**
 * AI 做题助手：OpenAI 兼容接口（DeepSeek / OpenAI / Moonshot / 本地 Ollama 等）。
 *
 * 产品约束（由主进程强制写在 system prompt 里）：
 *  - 只给思路与引导，不直接给答案；
 *  - 提示分级递进，一次只推进一步；
 *  - 「纠错」模式只定位问题、讲清原因，不重写整个函数。
 */

const MAX_CONTENT = 2400
const MAX_CODE = 4000

function clip(s: string | undefined, n: number): string {
  if (!s) return ''
  const t = s.replace(/\r/g, '').trim()
  return t.length > n ? t.slice(0, n) + `\n…（已截断，共 ${t.length} 字）` : t
}

/** 题面是 HTML，粗转纯文本，省 token */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function contextBlock(ctx: AiContext): string {
  const parts: string[] = []
  if (ctx.problemTitle) parts.push(`题目：${ctx.problemTitle}`)
  if (ctx.problemContent) parts.push(`题面（可能被截断）：\n${clip(htmlToText(ctx.problemContent), MAX_CONTENT)}`)
  if (ctx.signature) parts.push(`题目要求的签名：\n${clip(ctx.signature, 400)}`)
  if (ctx.language) parts.push(`当前语言：${ctx.language}`)
  if (ctx.code) parts.push(`用户当前代码：\n\`\`\`\n${clip(ctx.code, MAX_CODE)}\n\`\`\``)
  if (ctx.runResult) parts.push(`最近一次运行结果：\n${clip(ctx.runResult, 1200)}`)
  if (ctx.debugState) parts.push(`调试现场：\n${clip(ctx.debugState, 1200)}`)
  return parts.join('\n\n')
}

const HINT_LADDER = `提示分级（用户每要一次「提示」只允许上升一级，且必须从用户当前实际进度出发，不要重复他已经说过的内容）：
- 第 1 级：复述/澄清题目的关键条件与目标，点出需要留意的输入规模、边界或特殊用例；不给任何算法方向。
- 第 2 级：指出可以观察的数据特征、不变量或一个反例，并提出一个引导性问题（例如「暴力做法的时间花在哪里？」）。
- 第 3 级：给出思路方向（例如「考虑用哈希表把查找降到 O(1)」），但不给具体步骤，让用户自己补细节。
- 第 4 级：给出步骤级骨架（自然语言描述每一步做什么，不给可提交代码）。
- 第 5 级：只针对他卡住的那一点给出不超过 3 行的关键代码片段，并说明这 3 行解决了什么；仍然不给完整实现。
- 第 5 级之后不再提升：改为换角度解释、给更小的子问题、或让他复述自己的思路。`

function systemPrompt(req: AiChatRequest): string {
  const strict = req.noAnswer
  const modeLine =
    req.mode === 'hint'
      ? `本轮是「给提示」：请给出第 ${Math.min(req.hintLevel + 1, 5)} 级提示（他此前已获得 ${req.hintLevel} 个提示）。只给这一级的内容，不要越级剧透。`
      : req.mode === 'debug'
        ? '本轮是「纠错」：目标是帮他找到并理解自己代码/思路里的问题。请先复述你判断他「想做什么」，再指出第一处会导致错误的地方（位置与原因），解释为什么错、会触发什么反例；然后提一个问题让他自己确认。不要重写整个函数。'
        : '本轮是自由问答：围绕这道题与他的代码回答。'

  return `你是 LeetCode Studio 内置的算法学习助教，中文回答。你的目标是让用户**自己想出**解法，而不是替他做题。

${strict ? `硬性规则（严格模式，任何情况都不得违反）：
1. 绝不输出完整题解代码；不要给出可以直接复制提交的完整函数实现。
2. 不要给出「算法名 + 完整流程」式的答案（例如「用哈希表：遍历数组，对每个 x 查 target-x，在就返回下标」——这等于报答案）。
3. 不要一次性列出所有步骤；每次回复只推进一小步，并尽量以一个问题结尾，把思考交还给他。
4. 允许出现代码的场景仅限：指出出错的那一行、说明语法/边界问题、或第 5 级提示里不超过 3 行的关键片段。
5. 如果用户直接索要答案或完整代码，礼貌拒绝，并把问题拆成一个更小的、他可以自己回答的问题。
6. 先判断他卡在哪一步：如果他还没有思路，就走提示分级；如果他已经有代码，就先读懂他的思路再指问题。` : `规则：可以给出较完整的解释与代码，但仍然优先解释为什么。`}

${HINT_LADDER}

风格要求：简洁、口语化、直接给结论再给理由；不要写长篇教科书式讲解；不要重复题面原文；少用列表堆砌，除非确实在给分步骨架。

${modeLine}

以下是当前题目与用户状态，请以此为唯一事实来源（不要臆造题目内容）：
${contextBlock(req.context) || '（未提供上下文）'}`
}

function apiUrl(base: string): string {
  const b = (base || '').trim().replace(/\/+$/, '')
  if (!b) return 'https://api.deepseek.com/chat/completions'
  if (/\/chat\/completions$/.test(b)) return b
  return `${b}/chat/completions`
}

export interface AiStreamHandlers {
  onDelta: (text: string) => void
  onDone: (full: string) => void
  onError: (message: string) => void
}

/** 发一次流式对话请求；返回 abort 函数 */
export function aiChat(
  settings: Settings,
  req: AiChatRequest,
  handlers: AiStreamHandlers
): () => void {
  const controller = new AbortController()

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt(req) },
    ...req.history.slice(-12),
    ...(req.input && req.input.trim() ? [{ role: 'user' as const, content: req.input.trim() }] : [])
  ]
  // 兜底：最后一条必须是用户消息，否则模型没有可回应的诉求
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    const ask =
      req.mode === 'hint'
        ? `我卡住了，给我第 ${Math.min(req.hintLevel + 1, 5)} 级提示，不要给答案。`
        : req.mode === 'debug'
          ? '帮我看看我的代码/思路哪里有问题，先别直接给正确写法。'
          : '请针对当前题目和我的代码，提一个问题引导我继续思考。'
    messages.push({ role: 'user', content: ask })
  }

  const run = async () => {
    const key = (settings.aiApiKey || '').trim()
    if (!key) {
      handlers.onError('还没有配置 API Key：请在「设置 → AI 助手」里填写后再试。')
      return
    }
    let full = ''
    try {
      const res = await fetch(apiUrl(settings.aiBaseUrl || ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: settings.aiModel || 'deepseek-chat',
          messages,
          stream: true,
          temperature: 0.6
        }),
        signal: controller.signal
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        handlers.onError(describeHttpError(res.status, text))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const raw of lines) {
          const line = raw.trim()
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const json = JSON.parse(payload)
            const delta = json?.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) {
              full += delta
              handlers.onDelta(delta)
            }
          } catch { /* 忽略心跳/半包 */ }
        }
      }
      handlers.onDone(full)
    } catch (e: any) {
      if (controller.signal.aborted) {
        handlers.onDone(full)
        return
      }
      handlers.onError(describeHttpError(0, String(e?.message || e)))
    }
  }

  void run()
  return () => controller.abort()
}

function describeHttpError(status: number, body: string): string {
  const brief = (body || '').replace(/\s+/g, ' ').slice(0, 300)
  if (status === 401 || status === 403) return `API Key 无效或没有权限（HTTP ${status}）。${brief}`
  if (status === 404) return `接口地址不对（HTTP 404）。检查「设置 → AI 助手」里的 Base URL（应形如 https://api.deepseek.com）。${brief}`
  if (status === 402 || status === 429) return `额度不足或请求过于频繁（HTTP ${status}）。${brief}`
  if (status === 0) return `请求失败：${brief}`
  return `请求失败（HTTP ${status}）。${brief}`
}

/** 一次性（非流式）补全，用于生成判题适配模板这类后台任务 */
export async function aiComplete(
  settings: Settings,
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const key = (settings.aiApiKey || '').trim()
  if (!key) return { ok: false, message: '未配置 API Key' }
  try {
    const res = await fetch(apiUrl(settings.aiBaseUrl || ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.aiModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        stream: false,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 4096
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, message: describeHttpError(res.status, body) }
    }
    const json: any = await res.json().catch(() => null)
    const text = json?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, message: '模型返回为空' }
    }
    return { ok: true, text }
  } catch (e: any) {
    return { ok: false, message: describeHttpError(0, String(e?.message || e)) }
  }
}

/** 连通性自检：发一条极短请求 */
export async function aiTest(settings: Settings): Promise<AiTestResult> {
  const key = (settings.aiApiKey || '').trim()
  if (!key) return { ok: false, message: '未填写 API Key' }
  try {
    const res = await fetch(apiUrl(settings.aiBaseUrl || ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.aiModel || 'deepseek-chat',
        messages: [{ role: 'user', content: '回复"ok"两个字符即可' }],
        stream: false,
        max_tokens: 8
      })
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, message: describeHttpError(res.status, text) }
    let content = ''
    try { content = JSON.parse(text)?.choices?.[0]?.message?.content || '' } catch { /* ignore */ }
    return { ok: true, message: `连接成功${content ? `，模型回复：${content.slice(0, 40)}` : ''}`, model: settings.aiModel }
  } catch (e: any) {
    return { ok: false, message: describeHttpError(0, String(e?.message || e)) }
  }
}
