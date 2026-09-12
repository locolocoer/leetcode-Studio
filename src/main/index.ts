import { app, BrowserWindow, ipcMain, shell, clipboard, dialog, session, Menu } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import type {
  AiChatRequest, AppInfo, CatalogEntry, Language, Problem, RunResult, Settings, SolutionOrderBy, TestCase, UpdateStatus
} from '../shared/types'
import { detectAll, detectToolchain } from './toolchain'
import { runAll, normalizeManualExpected, type RunnerContext } from './runner'
import { initAiHarnessCache, clearHarnessCache } from './aiHarness'
import {
  fetchProblemList, fetchProblemDetail, fetchDaily, fetchProblemListCatalog,
  fetchSolutionList, fetchSolutionDetail
} from './fetcher'
import { Store } from './store'
import { DebugSession } from './debugger'
import { LeetCodeClient, baseOf } from './leetcode'
import { aiChat, aiTest } from './ai'

declare const __COMMIT__: string

// QA/排查用：设置 LC_UI_DEBUG_PORT 后可用 Chrome DevTools 协议检查打包版界面
if (process.env.LC_UI_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.LC_UI_DEBUG_PORT))
}

let mainWindow: BrowserWindow | null = null
let store: Store
let runtimeDir: string
let debugSession: DebugSession | null = null
let lc: LeetCodeClient

// ---------------------------------------------------------------- 自动更新
// 与 audioPlayer 同一套流程：优先阿里云 OSS（国内快），失败自动回退 GitHub Release。
const OSS_BASE = 'https://leetcode-studio.oss-cn-beijing.aliyuncs.com/'
const GH_OWNER = 'locolocoer'
const GH_REPO = 'leetcode-Studio'

function sendUpdateStatus(payload: UpdateStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', payload)
}

/** 更新日志写到 <runtimeDir>/updater.log，方便排查“检查不到更新”一类问题 */
function logUpdater(msg: string): void {
  try {
    if (runtimeDir) appendFileSync(join(runtimeDir, 'updater.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* ignore */ }
}

let currentFeed: 'oss' | 'github' = 'oss'

function useOssFeed(): void {
  currentFeed = 'oss'
  autoUpdater.setFeedURL({ provider: 'generic', url: OSS_BASE })
}

function useGitHubFeed(): void {
  currentFeed = 'github'
  autoUpdater.setFeedURL({ provider: 'github', owner: GH_OWNER, repo: GH_REPO })
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m: unknown) => logUpdater('INFO  ' + String(m)),
    warn: (m: unknown) => logUpdater('WARN  ' + String(m)),
    error: (m: unknown) => logUpdater('ERROR ' + String(m)),
    debug: (m: unknown) => logUpdater('DEBUG ' + String(m))
  } as never

  useOssFeed()
  logUpdater(`检查更新：feed=${currentFeed} ${OSS_BASE}`)

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    logUpdater(`发现新版本 v${info.version}，开始下载`)
    sendUpdateStatus({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    logUpdater('已是最新版本')
    sendUpdateStatus({ state: 'not-available' })
  })
  autoUpdater.on('download-progress', (p) =>
    sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent), message: `${p.transferred}/${p.total}` }))
  autoUpdater.on('update-downloaded', (info) => {
    logUpdater(`已下载 v${info.version}`)
    sendUpdateStatus({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    const msg = err && err.message ? err.message : String(err)
    logUpdater(`错误（feed=${currentFeed}）：${msg}`)
    if (currentFeed === 'oss') {
      // OSS 未配置 / 网络不通 → 回退到 GitHub Release
      console.log(`[Updater] OSS 源失败，回退到 GitHub：${msg}`)
      useGitHubFeed()
      logUpdater('回退到 GitHub Release')
      autoUpdater.checkForUpdates().catch(() => sendUpdateStatus({ state: 'error', message: msg }))
      return
    }
    sendUpdateStatus({ state: 'error', message: msg })
  })
}

function registerUpdateIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => ({
    name: 'LeetCode Studio',
    version: app.getVersion(),
    commit: typeof __COMMIT__ === 'string' ? __COMMIT__ : undefined,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      sendUpdateStatus({ state: 'dev' })
      return false
    }
    try {
      useOssFeed()
      await autoUpdater.checkForUpdates()
      return true
    } catch (err) {
      sendUpdateStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      return false
    }
  })

  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) return false
    setImmediate(() => autoUpdater.quitAndInstall())
    return true
  })
}

function api() {
  return {
    getProblems: () => store.loadProblems(),
    updateProblem: (p: Problem) => store.upsertProblem(p),
    removeProblem: (id: string) => store.removeProblem(id),
    getSettings: () => store.loadSettings(),
    saveSettings: (s: Settings) => { store.saveSettings(s); return true },
    detectToolchains: (settings?: Settings) => detectAll(settings),
    fetchList: () => fetchProblemList(),
    fetchDetail: (slug: string, host?: string) => fetchProblemDetail(slug, host),
    runTests: (problem: Problem, language: Language, source: string, tests: TestCase[]) =>
      runAll(problem, language, source, tests, ctx(), (cr) => onCase(cr)),
    clipboardText: () => clipboard.readText(),
    openExternal: (url: string) => shell.openExternal(url),
    getRuntimeDir: () => runtimeDir
  }
}

function ctx(): RunnerContext {
  return {
    toolchains: detectAll(store.loadSettings()),
    settings: store.loadSettings(),
    runtimeDir,
    // 让界面能看到「正在让 AI 生成判题模板」这类进度
    onNote: (msg: string) => mainWindow?.webContents.send('run:note', msg)
  }
}

function onCase(_cr: unknown) {
  // broadcast progress if needed
}

function setupDebugIPC() {
  const forward = (e: unknown) => mainWindow?.webContents.send('debug:event', e)
  const forwardOut = (t: string) => mainWindow?.webContents.send('debug:output', t)
  const onDone = () => mainWindow?.webContents.send('debug:done')
  debugSession = new DebugSession({ onEvent: forward, onOutput: forwardOut, onDone })
}

function registerIpc() {
  const a = api()
  ipcMain.handle('problems:list', () => a.getProblems())
  ipcMain.handle('problems:update', (_e, p: Problem) => a.updateProblem(p))
  ipcMain.handle('problems:remove', (_e, id: string) => a.removeProblem(id))
  ipcMain.handle('settings:get', () => a.getSettings())
  ipcMain.handle('settings:save', (_e, s: Settings) => a.saveSettings(s))
  ipcMain.handle('toolchains:detect', (_e, s?: Settings) => a.detectToolchains(s))
  ipcMain.handle('toolchains:pick', async (_e, lang: Language) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: `选择 ${lang} 编译器/解释器（exe）`,
      properties: ['openFile'],
      filters: [{ name: '程序', extensions: ['exe'] }]
    })
    if (r.canceled || !r.filePaths.length) return null
    return r.filePaths[0]
  })
  // 题面语言：zh → leetcode.cn（含中文翻译题面）；en → leetcode.com
  const contentHostOf = () => (store.loadSettings().contentLang === 'en' ? 'leetcode.com' : 'leetcode.cn')
  ipcMain.handle('fetch:list', () => a.fetchList())
  ipcMain.handle('fetch:detail', (_e, slug: string, host?: string) => a.fetchDetail(slug, host || contentHostOf()))
  ipcMain.handle('fetch:daily', () => fetchDaily(contentHostOf()))
  // 题单接口只有 leetcode.cn 支持（com 返回空），统一走 cn
  ipcMain.handle('fetch:listProblems', (_e, favoriteSlug: string, _host?: string, title?: string) =>
    fetchProblemListCatalog(favoriteSlug, 'leetcode.cn', title))
  // 题解：只有 leetcode.cn 提供，固定走 cn
  ipcMain.handle('solutions:list', (_e, questionSlug: string, opts?: { first?: number; skip?: number; orderBy?: SolutionOrderBy }) =>
    fetchSolutionList(questionSlug, opts || {}))
  ipcMain.handle('solutions:detail', (_e, slug: string, questionSlug?: string) =>
    fetchSolutionDetail(slug, questionSlug))
  ipcMain.handle('catalog:get', () => store.loadCatalog())
  ipcMain.handle('catalog:set', (_e, entries: CatalogEntry[]) => { store.saveCatalog(entries); return store.loadCatalog() })
  ipcMain.handle('problems:ensure', async (_e, slug: string, host?: string) => {
    const found = store.findProblemBySlug(slug)
    if (found) return found
    const p = await fetchProblemDetail(slug, host || contentHostOf())
    store.upsertProblem(p)
    return p
  })
  // 用当前题面语言重新拉取题面/样例，保留用户已写的代码与自定义用例
  ipcMain.handle('problems:refetch', async (_e, slug: string) => {
    const existing = store.findProblemBySlug(slug)
    const fresh = await fetchProblemDetail(slug, contentHostOf())
    const merged: Problem = {
      ...fresh,
      starters: { ...fresh.starters, ...(existing?.starters || {}) },
      tests: existing?.tests?.length ? existing.tests : fresh.tests
    }
    store.upsertProblem(merged)
    return merged
  })
  ipcMain.handle('run:tests', (_e, p: Problem, lang: Language, src: string, tests: TestCase[]) =>
    a.runTests(p, lang, src, tests))
  ipcMain.handle('debug:start', (_e, p: Problem, lang: Language, src: string, test: TestCase, bps: number[]) => {
    const toolchains = detectAll(store.loadSettings())
    return debugSession!.start(p, src, test, lang, toolchains[lang], runtimeDir, bps)
  })
  ipcMain.handle('debug:step', () => { debugSession?.step(); return debugSession?.snapshot })
  ipcMain.handle('debug:over', () => { debugSession?.stepOver(); return debugSession?.snapshot })
  ipcMain.handle('debug:resume', () => { debugSession?.resume(); return debugSession?.snapshot })
  ipcMain.handle('debug:stop', () => { debugSession?.stop(); return debugSession?.snapshot })
  ipcMain.handle('debug:break', (_e, line: number) => { debugSession?.addBreakpoint(line); return debugSession?.snapshot })
  ipcMain.handle('debug:snapshot', () => debugSession?.snapshot)
  ipcMain.handle('debug:children', (_e, ref: string) => debugSession?.children(ref) ?? [])
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('clipboard:text', () => a.clipboardText())
  ipcMain.handle('open:external', (_e, url: string) => a.openExternal(url))
  ipcMain.handle('runtime:dir', () => runtimeDir)
  // 清掉 AI 生成的判题模板缓存（换模型/结果不对时可手动重来）
  ipcMain.handle('ai:clearHarness', () => { clearHarnessCache(); return true })

  // --- AI 做题助手（主进程持有 Key 并组装「不给答案」的提示词）---
  let aiAbort: (() => void) | null = null
  ipcMain.handle('ai:chat', (_e, req: AiChatRequest) => {
    aiAbort?.()
    const settings = store.loadSettings()
    aiAbort = aiChat(settings, req, {
      onDelta: (t) => mainWindow?.webContents.send('ai:delta', t),
      onDone: (full) => {
        aiAbort = null
        mainWindow?.webContents.send('ai:done', full)
      },
      onError: (message) => {
        aiAbort = null
        mainWindow?.webContents.send('ai:error', message)
      }
    })
    return true
  })
  ipcMain.handle('ai:abort', () => { aiAbort?.(); aiAbort = null })
  ipcMain.handle('ai:test', () => aiTest(store.loadSettings()))

  // --- 无边框窗口的自绘标题栏按钮 ---
  ipcMain.handle('win:minimize', () => { mainWindow?.minimize() })
  ipcMain.handle('win:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('win:close', () => { mainWindow?.close() })
  ipcMain.handle('win:isMaximized', () => !!mainWindow?.isMaximized())

  // --- LeetCode account & submission ---
  const hostOf = (h?: string) => (h || store.loadSettings().lcHost || 'leetcode.com')
  ipcMain.handle('lc:status', (_e, h?: string) => lc.status(hostOf(h)))
  ipcMain.handle('lc:openLogin', async (_e, h: string) => {
    const host = hostOf(h)
    const r = await loginViaWindow(host)
    if (r.ok) {
      const st = lc.status(host)
      store.saveSettings({ ...store.loadSettings(), lcHost: host, lcUsername: st.username })
      return { ...st, ok: true }
    }
    return { host, loggedIn: false, ok: false, error: r.error || '登录未完成' }
  })
  ipcMain.handle('lc:importCookies', async (_e, h: string, text: string) => {
    const host = hostOf(h)
    const r = await lc.importSessionFromText(host, text)
    if (r.ok && r.loggedIn) store.saveSettings({ ...store.loadSettings(), lcHost: host, lcUsername: r.username })
    return r
  })
  ipcMain.handle('lc:logout', async (_e, h?: string) => {
    const host = hostOf(h)
    await lc.logout(host)
    const s = store.loadSettings()
    store.saveSettings({ ...s, lcUsername: undefined })
    return lc.status(host)
  })
  ipcMain.handle('lc:submit', (_e, h: string | undefined, slug: string, qid: string | number, lang: Language, code: string) => {
    return lc.submit(hostOf(h), slug, qid, lang, code)
  })
  ipcMain.handle('lc:whoami', async (_e, h?: string) => {
    const host = hostOf(h)
    const u = await lc.whoami(host)
    return { host, username: u }
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  // Windows 任务栏图标/通知分组用 AppUserModelId，需与 electron-builder 的 appId 一致
  if (process.platform === 'win32') app.setAppUserModelId('com.leetcodestudio.app')
  // 开发模式没有 exe 图标，显式给窗口一个图标（打包版用 exe 内嵌图标）
  const devIcon = !app.isPackaged ? join(app.getAppPath(), 'build', 'icon.png') : undefined
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'LeetCode Studio',
    backgroundColor: '#0d1015',
    ...(devIcon && existsSync(devIcon) ? { icon: devIcon } : {}),
    // Windows/Linux 去掉原生标题栏，改用顶栏里的自绘最小化/最大化/关闭
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : { frame: false }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // 没有菜单栏了，用键盘快捷键补回开发时的刷新 / 开发者工具
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      mainWindow?.webContents.toggleDevTools()
    } else if (input.control && key === 'r' && !app.isPackaged) {
      mainWindow?.webContents.reload()
    }
  })
  // 无边框窗口在最大化/还原时要让渲染层换图标
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))

  // 页面里的外链（如题解正文）一律用系统浏览器打开，不在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const current = mainWindow?.webContents.getURL() || ''
    if (url.split('#')[0] !== current.split('#')[0]) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Open an embedded browser window at the LeetCode login page and capture the
// session cookie after the user logs in (works through Cloudflare / 2FA).
function loginViaWindow(host: string): Promise<{ ok: boolean; error?: string }> {
  const base = baseOf(host)
  const partition = 'lc-login'
  const ses = session.fromPartition(partition)

  return new Promise((resolve) => {
    let done = false
    const finish = (err?: string) => {
      if (done) return
      done = true
      clearInterval(timer)
      resolve({ ok: false, error: err })
    }
    const timer = setInterval(async () => {
      try {
        const ck = await ses.cookies.get({ name: 'LEETCODE_SESSION' })
        if (ck.length && ck[0].value) {
          done = true
          clearInterval(timer)
          let csrf = ''
          try {
            const cs = await ses.cookies.get({ name: 'csrftoken' })
            csrf = cs[0]?.value || ''
          } catch {}
          await lc.importSession(host, ck[0].value, csrf)
          try { if (!win.isDestroyed()) win.close() } catch {}
          resolve({ ok: true })
        }
      } catch { /* keep polling */ }
    }, 1200)

    const win = new BrowserWindow({
      width: 1000,
      height: 780,
      title: `登录 LeetCode（${host}）`,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition, sandbox: false, contextIsolation: true, nodeIntegration: false }
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^(https?:)?\/\//.test(url) && !url.startsWith(base)) shell.openExternal(url)
      return { action: 'deny' }
    })
    win.on('closed', () => finish('窗口已关闭，未检测到登录。请登录完成后自动跳转，或改用 Cookie 导入。'))
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      if (code === -3) return // aborted
      finish(`登录页加载失败：${desc}（${code}）`)
    })
    win.loadURL(`${base}/accounts/login/`).catch(() => finish('无法打开登录页，请检查网络。'))
    setTimeout(() => finish('登录超时（10 分钟）'), 10 * 60 * 1000)
  })
}

app.whenReady().then(() => {
  // 去掉默认的 File / Edit / View 菜单栏：本应用没有用到这些菜单项
  // macOS 保留一个最小菜单（否则 Cmd+Q / Cmd+C 等系统行为会缺失）
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
    ]))
  } else {
    Menu.setApplicationMenu(null)
  }

  const base = app.isPackaged ? app.getPath('userData') : app.getAppPath()
  runtimeDir = join(base, '.runtime')
  try { writeFileSync(join(runtimeDir, '.keep'), '') } catch {}
  store = new Store(join(base, '.leetcode-studio'))
  lc = new LeetCodeClient(join(base, '.leetcode-studio'))
  // AI 生成的判题模板缓存（按题目 + 语言 + 签名保存，验证通过才会写入）
  initAiHarnessCache(join(base, '.leetcode-studio'))
  if (!existsSync(join(base, '.leetcode-studio', 'seeded'))) {
    seedStore()
    try { writeFileSync(join(base, '.leetcode-studio', 'seeded'), '1') } catch {}
  }
  migrateSampleStarters()
  migrateManualExpected()
  setupDebugIPC()
  registerIpc()
  registerUpdateIpc()
  createWindow()

  // 启动后延迟检查更新（打包版才生效）
  if (app.isPackaged) {
    setupAutoUpdater()
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 8000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  debugSession?.dispose()
  if (process.platform !== 'darwin') app.quit()
})

// Seed a few bundled sample problems so the app is useful immediately.
function seedStore() {
  for (const p of sampleProblems()) {
    store.upsertProblem(p)
  }
}

// 手动判题题的期望值是自然语言（"Intersected at '8'" / "No intersection"），
// 启动时把本地旧数据里的期望值归一化为数字，避免已存题目判定失败。
function migrateManualExpected() {
  try {
    const problems = store.loadProblems()
    let changed = false
    for (const p of problems) {
      if (!p.tests?.length) continue
      const next = p.tests.map((t) => {
        const n = normalizeManualExpected(t.expected)
        if (n !== t.expected) { changed = true; return { ...t, expected: n } }
        return t
      })
      if (changed) p.tests = next
    }
    if (changed) store.saveProblems(problems)
  } catch { /* ignore */ }
}

// 老版本内置示例题的 starter 是占位符 pass，调试时无可执行代码。
// 启动时检测到仍是占位符（且没有用户实现痕迹）就换成可直接运行/调试的参考实现。
function migrateSampleStarters() {
  try {
    const samples = sampleProblems()
    const bySlug = new Map(samples.map((p) => [p.slug, p]))
    const problems = store.loadProblems()
    let changed = false
    for (const p of problems) {
      if (p.source !== 'local') continue
      const ref = bySlug.get(p.slug)
      if (!ref || !ref.starters.python) continue
      const cur = p.starters?.python || ''
      // 占位符判定：去掉 class/def/注释/空行后，只剩 pass 或 ...
      const bodyLines = cur.split('\n').filter((l) => {
        const t = l.trim()
        if (!t || t.startsWith('#') || /^(class|def)\b/.test(t)) return false
        return true
      })
      const isPlaceholder = bodyLines.length > 0 && bodyLines.every((l) => /^(pass|\.\.\.)$/.test(l.trim()))
      if (isPlaceholder) {
        p.starters = { ...ref.starters }
        changed = true
      }
    }
    if (changed) store.saveProblems(problems)
  } catch { /* ignore */ }
}

function sampleProblems(): Problem[] {
  return [
    {
      id: '1',
      slug: 'two-sum',
      title: '两数之和',
      titleCn: '两数之和',
      difficulty: 'easy',
      tags: ['数组', '哈希表'],
      content: '<p>给定一个整数数组 <code>nums</code> 和一个整数目标值 <code>target</code>，请你在该数组中找出和为目标值 <code>target</code> 的那两个整数，并返回它们的数组下标。你可以假设每种输入只会对应一个答案。</p>',
      judgeType: 'function',
      methodName: 'twoSum',
      params: [{ name: 'nums', type: 'integer[]' }, { name: 'target', type: 'integer' }],
      returnType: 'integer[]',
      tests: [
        { id: 'ex1', input: ['[2,7,11,15]', '9'], expected: '[0,1]', isExample: true },
        { id: 'ex2', input: ['[3,2,4]', '6'], expected: '[1,2]', isExample: true },
        { id: 'ex3', input: ['[3,3]', '6'], expected: '[0,1]', isExample: true }
      ],
      starters: {
        python: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        m = {}\n        for i, x in enumerate(nums):\n            if target - x in m:\n                return [m[target - x], i]\n            m[x] = i\n        return []\n',
        java: 'import java.util.*;\nclass Solution {\n    public int[] twoSum(int[] nums, int target) {\n        Map<Integer, Integer> m = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            int need = target - nums[i];\n            if (m.containsKey(need)) return new int[]{m.get(need), i};\n            m.put(nums[i], i);\n        }\n        return new int[]{};\n    }\n}\n',
        cpp: '#include <vector>\n#include <unordered_map>\nusing namespace std;\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int, int> m;\n        for (int i = 0; i < (int)nums.size(); i++) {\n            int need = target - nums[i];\n            if (m.count(need)) return {m[need], i};\n            m[nums[i]] = i;\n        }\n        return {};\n    }\n};\n',
        c: '#include <stdlib.h>\nint* twoSum(int* nums, int numsSize, int target, int* returnSize){\n    int* r = (int*)malloc(2 * sizeof(int));\n    for (int i = 0; i < numsSize; i++) {\n        for (int j = i + 1; j < numsSize; j++) {\n            if (nums[i] + nums[j] == target) { r[0] = i; r[1] = j; *returnSize = 2; return r; }\n        }\n    }\n    *returnSize = 0;\n    return NULL;\n}\n'
      },
      link: 'https://leetcode.com/problems/two-sum/',
      source: 'local'
    },
    {
      id: '155',
      slug: 'min-stack',
      title: '最小栈',
      titleCn: '最小栈',
      difficulty: 'medium',
      tags: ['栈', '设计'],
      content: '<p>设计一个支持 <code>push</code>、<code>pop</code>、<code>top</code> 操作，并能在常数时间内检索到最小元素的栈。</p>',
      judgeType: 'class',
      methodName: 'MinStack',
      params: [],
      returnType: 'void',
      constructorParams: [],
      methods: [
        { name: 'push', params: [{ name: 'val', type: 'integer' }], returnType: 'void' },
        { name: 'pop', params: [], returnType: 'void' },
        { name: 'top', params: [], returnType: 'integer' },
        { name: 'getMin', params: [], returnType: 'integer' }
      ],
      tests: [
        {
          id: 'ex1',
          input: ['["MinStack","push","push","push","getMin","pop","top","getMin"]', '[[],[-2],[0],[-3],[],[],[],[]]'],
          expected: '[null,null,null,null,-3,null,0,-2]',
          isExample: true
        }
      ],
      starters: {
        python: 'class MinStack:\n    def __init__(self):\n        self.st = []\n        self.mn = []\n\n    def push(self, val: int) -> None:\n        self.st.append(val)\n        if not self.mn or val <= self.mn[-1]:\n            self.mn.append(val)\n\n    def pop(self) -> None:\n        if self.st.pop() == self.mn[-1]:\n            self.mn.pop()\n\n    def top(self) -> int:\n        return self.st[-1]\n\n    def getMin(self) -> int:\n        return self.mn[-1]\n',
        java: 'import java.util.*;\nclass MinStack {\n    Deque<Integer> st = new ArrayDeque<>();\n    Deque<Integer> mn = new ArrayDeque<>();\n    public MinStack() {}\n    public void push(int val) { st.push(val); if (mn.isEmpty() || val <= mn.peek()) mn.push(val); }\n    public void pop() { if (st.pop().equals(mn.peek())) mn.pop(); }\n    public int top() { return st.peek(); }\n    public int getMin() { return mn.peek(); }\n}\n',
        cpp: '#include <stack>\nusing namespace std;\nclass MinStack {\n    stack<int> st, mn;\npublic:\n    MinStack() {}\n    void push(int val) { st.push(val); if (mn.empty() || val <= mn.top()) mn.push(val); }\n    void pop() { if (st.top() == mn.top()) mn.pop(); st.pop(); }\n    int top() { return st.top(); }\n    int getMin() { return mn.top(); }\n};\n',
        c: ''
      },
      link: 'https://leetcode.com/problems/min-stack/',
      source: 'local'
    }
  ]
}
