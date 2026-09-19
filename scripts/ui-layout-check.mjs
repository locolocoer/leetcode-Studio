/**
 * 界面布局回归：窗口「最大化 → 还原」后整页不该被撑宽，编辑器要跟着回收宽度。
 *
 * 背景：`.right-pane` 这类栅格/弹性项默认 `min-width: auto`，下限会被 Monaco 当前宽度顶住，
 * 于是还原后右栏不回缩、整页出现横向溢出，顶栏的「提交」等按钮被挤出可视区。
 * 纯逻辑回归脚本覆盖不到这类问题，所以单独用 CDP 量真实窗口的几何。
 *
 * 用法（需要先启动应用并开调试端口）：
 *   "…\LeetCode Studio.exe" --remote-debugging-port=9222
 *   node scripts/ui-layout-check.mjs 9222
 *
 * 只依赖 Node 内置的 fetch / WebSocket（Node ≥ 22）。
 */

const PORT = process.argv[2] || '9222'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function httpJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return await res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let seq = 0
    const pending = new Map()
    ws.addEventListener('open', () =>
      resolve({
        send(method, params) {
          const id = ++seq
          ws.send(JSON.stringify({ id, method, params }))
          return new Promise((res, rej) => pending.set(id, { res, rej }))
        },
        close() { ws.close() }
      })
    )
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败：' + wsUrl)))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const slot = msg.id && pending.get(msg.id)
      if (!slot) return
      pending.delete(msg.id)
      msg.error ? slot.rej(new Error(JSON.stringify(msg.error))) : slot.res(msg.result)
    })
  })
}

/** 量页面几何：整页是否横向溢出、各栏宽度、溢出到窗口外的元素 */
const MEASURE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), right: Math.round(r.right) }
  }
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.right <= window.innerWidth + 1) continue
    // Monaco 自己管理编辑器内部的裁剪（虚拟滚动占位、overlay 层都会超宽但被 overflow 裁掉），
    // 这里只关心应用自身的布局，编辑器容器宽度由上面的断言单独把关。
    if (el.closest('.monaco-editor')) continue
    const cls = (el.className || '').toString()
    over.push(el.tagName.toLowerCase() + '.' + cls.slice(0, 48) + ' right=' + Math.round(r.right))
  }
  const lastBtn = document.querySelector('.topbar .win-controls') || document.querySelector('.win-controls')
  return JSON.stringify({
    innerWidth: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    pane: box('.right-pane'),
    editor: box('.monaco-editor'),
    topbar: box('.topbar'),
    winControls: lastBtn ? Math.round(lastBtn.getBoundingClientRect().right) : null,
    overflowing: over.slice(0, 6),
    overflowCount: over.length
  })
})()`

function fail(msg) {
  console.log('  ✗ ' + msg)
  failures++
}
let failures = 0

const targets = await httpJson('/json/list').catch(() => null)
const page = targets && targets.find((t) => t.type === 'page' && /LeetCode|index\.html/.test(t.title + t.url))
if (!page) {
  console.log(`没找到应用页面（127.0.0.1:${PORT}）。请先用 --remote-debugging-port=${PORT} 启动应用。`)
  process.exit(1)
}
const ws = await connect(page.webSocketDebuggerUrl)
const evaluate = async (expression, awaitPromise = false) =>
  (await ws.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })).result.value
const measure = async () => JSON.parse(await evaluate(MEASURE))
const toggleMaximize = () => evaluate('window.api.win.toggleMaximize()', true)
const isMaximized = () => evaluate('window.api.win.isMaximized()', true)

if (await isMaximized()) {
  await toggleMaximize()
  await sleep(1200)
}

console.log('1) 基准（未最大化，窗口 ' + (await measure()).innerWidth + 'px 宽）')
const base = await measure()
console.log(`  右栏 ${base.pane.w}px，编辑器 ${base.editor.w}px，整页 ${base.docScrollW}px / 窗口 ${base.innerWidth}px`)
if (base.docScrollW > base.innerWidth + 1) fail(`基准状态就有横向溢出（${base.docScrollW} > ${base.innerWidth}）`)
if (base.overflowCount) fail('基准状态就有元素超出窗口：' + base.overflowing.join('; '))
if (!failures) console.log('  ✓ 基准正常')

console.log('2) 最大化 → 还原（连做 2 轮）')
for (let i = 1; i <= 2; i++) {
  await toggleMaximize()
  await sleep(1800)
  const max = await measure()
  if (max.docScrollW > max.innerWidth + 1) fail(`第 ${i} 轮最大化后横向溢出（${max.docScrollW} > ${max.innerWidth}）`)
  await toggleMaximize()
  await sleep(1800)
  const back = await measure()
  const paneOk = Math.abs(back.pane.w - base.pane.w) <= 2
  const editorOk = Math.abs(back.editor.w - base.editor.w) <= 3
  const pageOk = back.docScrollW <= back.innerWidth + 1
  const noOverflow = back.overflowCount === 0
  console.log(`  第 ${i} 轮：右栏 ${back.pane.w}px（基准 ${base.pane.w}），编辑器 ${back.editor.w}px（基准 ${base.editor.w}），整页 ${back.docScrollW}px / 窗口 ${back.innerWidth}px`)
  if (!paneOk) fail(`第 ${i} 轮还原后右栏没回到基准宽度（${back.pane.w} vs ${base.pane.w}）`)
  if (!editorOk) fail(`第 ${i} 轮还原后编辑器没回到基准宽度（${back.editor.w} vs ${base.editor.w}）`)
  if (!pageOk) fail(`第 ${i} 轮还原后整页仍被撑宽（${back.docScrollW} > ${back.innerWidth}）`)
  if (!noOverflow) fail(`第 ${i} 轮还原后有元素超出窗口：` + back.overflowing.join('; '))
  if (back.winControls !== null && back.winControls > back.innerWidth + 1) {
    fail(`第 ${i} 轮还原后窗口按钮在可视区外（right=${back.winControls}，窗口 ${back.innerWidth}）`)
  }
}
if (!failures) console.log('  ✓ 两轮都恢复到基准')

// 最小窗口宽度附近再确认一次：栅格第一列有 400px 下限，第二列必须还能被压缩
console.log('3) 视口压到 1100x720（最小窗口宽度）')
try {
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false })
  await sleep(1400)
  const narrow = await measure()
  console.log(`  右栏 ${narrow.pane.w}px，编辑器 ${narrow.editor.w}px，整页 ${narrow.docScrollW}px / 视口 ${narrow.innerWidth}px`)
  if (narrow.docScrollW > narrow.innerWidth + 1) fail(`窄视口下横向溢出（${narrow.docScrollW} > ${narrow.innerWidth}）`)
  if (narrow.overflowCount) fail('窄视口下有元素超出可视区：' + narrow.overflowing.join('; '))
  if (!failures) console.log('  ✓ 窄视口正常')
  await ws.send('Emulation.clearDeviceMetricsOverride')
} catch (e) {
  console.log('  · 跳过（当前环境不支持视口模拟：' + e.message + '）')
}

ws.close()
if (failures) {
  console.log(`\n${failures} 项不通过`)
  process.exit(1)
}
console.log('\n全部通过')
