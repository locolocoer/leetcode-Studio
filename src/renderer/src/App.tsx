import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AiMessage, AuthStatus, CatalogEntry, DebugSnapshot, Language, Problem, RunResult, Settings, SubmitVerdict,
  TestCase, ToolchainStatus, UpdateStatus
} from '../../shared/types'
import Sidebar from './components/Sidebar'
import ProblemPanel from './components/ProblemPanel'
import Editor from './components/Editor'
import RunPanel from './components/RunPanel'
import DebugPanel from './components/DebugPanel'
import SettingsPanel from './components/SettingsPanel'
import FetchModal from './components/FetchModal'
import ListModal from './components/ListModal'
import LoginModal from './components/LoginModal'
import SubmitResultModal from './components/SubmitResultModal'
import SolutionModal from './components/SolutionModal'
import HarnessModal from './components/HarnessModal'
import WindowControls from './components/WindowControls'
import AiPanel from './components/AiPanel'

const LANGS: Language[] = ['python', 'java', 'cpp', 'c']

export default function App() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>('python')
  const [code, setCode] = useState<Record<string, Partial<Record<Language, string>>>>({})
  const [tests, setTests] = useState<TestCase[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState<string | null>(null)
  const [harnessOpen, setHarnessOpen] = useState(false)
  const [toolchains, setToolchains] = useState<Record<Language, ToolchainStatus>>({} as any)
  const [settings, setSettings] = useState<Settings>({ toolpaths: {}, timeLimitMs: 4000, theme: 'dark' })
  const [rightTab, setRightTab] = useState<'run' | 'debug' | 'ai' | 'settings'>('run')
  const [fetchOpen, setFetchOpen] = useState(false)
  const [localOpen, setLocalOpen] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [debugSnap, setDebugSnap] = useState<DebugSnapshot | null>(null)
  const [debugOutput, setDebugOutput] = useState('')
  const [localTitle, setLocalTitle] = useState('')
  // LeetCode account & submit
  const [lcStatus, setLcStatus] = useState<AuthStatus | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [verdict, setVerdict] = useState<SubmitVerdict | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [breakpoints, setBreakpoints] = useState<number[]>([])
  const [cursorLine, setCursorLine] = useState(1)
  // 分类 / 题单
  const [collections, setCollections] = useState<CatalogEntry[]>([])
  const [category, setCategory] = useState<string>('all')
  const [busy, setBusy] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [solutionOpen, setSolutionOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateStatus>({ state: 'idle' })
  // AI 助手对话按题目保存（会话内）
  const [aiChats, setAiChats] = useState<Record<string, AiMessage[]>>({})

  // 编辑器 / 底部面板的分割高度（可拖动）
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const [editorH, setEditorH] = useState(360)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const active = useMemo(() => problems.find((p) => p.id === activeId) || null, [problems, activeId])

  const getCodeFor = useCallback((p: Problem, lang: Language): string => {
    return code[p.id]?.[lang] ?? p.starters?.[lang] ?? ''
  }, [code])

  const activeCode = active ? getCodeFor(active, language) : ''

  // 调试暂停时高亮编辑器当前行
  const pausedLine = debugSnap && debugSnap.status === 'paused' ? (debugSnap.pausedAt ?? null) : null

  // 函数体是否仍是占位符 pass（无可执行代码，单步会立刻结束）
  const pythonPlaceholder = useMemo(() => {
    if (!active || language !== 'python') return false
    const body = activeCode.split('\n').filter((l) => {
      const t = l.trim()
      if (!t || t.startsWith('#') || /^(class|def)\b/.test(t)) return false
      return true
    })
    return body.length > 0 && body.every((l) => /^(pass|\.\.\.)$/.test(l.trim()))
  }, [active, language, activeCode])

  const loadAll = useCallback(async (s?: Settings) => {
    const sett = s || await window.api.settings.get()
    setSettings(sett)
    const [probs, tcs, cols] = await Promise.all([
      window.api.problems.list(), window.api.toolchains.detect(sett), window.api.catalog.get()
    ])
    setProblems(probs)
    setToolchains(tcs)
    setCollections(cols)
    try {
      const st = await window.api.lc.status(sett.lcHost)
      setLcStatus(st)
      if (st.loggedIn && !st.username) {
        const w = await window.api.lc.whoami(sett.lcHost)
        setLcStatus({ host: st.host, loggedIn: true, username: w.username || sett.lcUsername })
      }
    } catch { /* ignore */ }
    if (probs.length > 0) selectProblem(probs[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadAll() }, [])

  // 拖动分割条调整编辑器高度（限制在合理范围，随窗口高度自适应初始值）
  useEffect(() => {
    const pane = rightPaneRef.current
    if (pane) setEditorH(Math.round(Math.max(180, pane.clientHeight * 0.46)))
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d || !rightPaneRef.current) return
      const paneH = rightPaneRef.current.clientHeight
      const next = Math.min(Math.max(d.startH + (e.clientY - d.startY), 140), Math.max(160, paneH - 200))
      setEditorH(next)
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: editorH }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  // 分类被删除/不存在时回退到「全部题目」
  useEffect(() => {
    if (category === 'all' || category === 'local') return
    if (!collections.some((c) => c.id === category)) setCategory('all')
  }, [collections, category])

  // debug event subscription
  useEffect(() => {
    window.api.debug.onEvent((e) => {
      setDebugSnap((snap) => {
        if (!snap) return snap
        const events = [...(snap.events || []), e]
        let status = snap.status
        if (e.kind === 'line' || e.kind === 'breakpoint') status = 'paused'
        else if (e.kind === 'exception') status = 'error'
        return { ...snap, events, status, pausedAt: e.line || snap.pausedAt, frame: e.frame || snap.frame }
      })
    })
    window.api.debug.onOutput((t) => setDebugOutput((o) => o + t))
    window.api.debug.onDone(() => setDebugSnap((snap) => snap ? { ...snap, status: 'finished' } : snap))
  }, [])

  // 自动更新状态订阅（主进程后台检查/下载，这里只负责提示）
  useEffect(() => {
    const off = window.api.updater.onStatus(setUpdateState)
    return off
  }, [])

  const selectProblem = (p: Problem) => {
    setActiveId(p.id)
    setResult(null)
    setDebugSnap(null)
    setDebugOutput('')
    setTests(p.tests || [])
    // ensure code seeds
    setCode((c) => {
      const entry = c[p.id] || {}
      const patched = { ...c, [p.id]: entry }
      for (const lang of LANGS) {
        if (!entry[lang] && p.starters?.[lang]) patched[p.id][lang] = p.starters[lang]
      }
      return patched
    })
  }

  const setActiveCode = (v: string) => {
    if (!active) return
    setCode((c) => ({ ...c, [active.id]: { ...c[active.id], [language]: v } }))
  }

  const runTests = async () => {
    if (!active) return
    setRunning(true)
    setRunNote(null)
    setRightTab('run')
    // 主进程在「AI 生成判题模板」等阶段会推送提示，这里即时显示
    const off = window.api.ai.onRunNote((m) => setRunNote(m))
    try {
      const r = await window.api.run.tests(active, language, activeCode, tests)
      setResult(r)
    } catch (e: any) {
      setResult({ ok: false, cases: [], error: String(e?.message || e) })
    } finally {
      off()
      setRunning(false)
    }
  }

  const startDebug = async () => {
    if (!active) return
    if (!tests.length) { alert('请先添加至少一组测试用例'); return }
    const test = tests[0]
    setRightTab('debug')
    setDebugOutput('')
    setDebugSnap(null)
    // 把当前设置的断点传给调试会话
    const snap = await window.api.debug.start(active, language, activeCode, test, breakpoints)
    setDebugSnap(snap)
  }

  const submitToLeetCode = async () => {
    if (!active) return
    if (!lcStatus?.loggedIn) { setShowLogin(true); return }
    if (!activeCode.trim()) { alert('代码为空'); return }
    setSubmitting(true)
    setVerdict(null)
    try {
      const v = await window.api.lc.submit(lcStatus.host, active.slug, active.id, language, activeCode)
      setVerdict(v)
    } catch (e: any) {
      setVerdict({ ok: false, accepted: false, status: '提交失败', error: String(e?.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  const saveProblem = (p: Problem) => {
    window.api.problems.update(p).then((list) => {
      setProblems(list)
      if (p.id === activeId) setTests(p.tests || [])
    })
  }

  const addLocal = () => {
    const blank: Problem = {
      id: 'local-' + Date.now(),
      slug: 'local-' + Date.now(),
      title: localTitle || '未命名题目',
      difficulty: 'easy',
      tags: [],
      content: '<p>在这里填写题面描述。你可以粘贴 HTML 或纯文本。</p>',
      judgeType: 'function',
      methodName: 'run',
      params: [],
      returnType: 'void',
      tests: [],
      starters: {
        python: 'class Solution:\n    def run(self):\n        pass\n',
        java: 'class Solution {\n    public void run() {}\n}\n',
        cpp: 'class Solution {\npublic:\n    void run() {}\n};\n',
        c: 'void run() {}\n'
      },
      source: 'local'
    }
    window.api.problems.update(blank).then((list) => {
      setProblems(list)
      selectProblem(blank)
      setLocalOpen(false)
      setLocalTitle('')
    })
  }

  const importClipboard = async () => {
    const txt = await window.api.app.clipboardText()
    if (!txt.trim()) { alert('剪贴板为空'); return }
    try {
      const obj = JSON.parse(txt)
      if (!obj || !obj.title) throw new Error('不是有效的题目 JSON')
      const p: Problem = {
        id: obj.id || ('imp-' + Date.now()),
        slug: obj.slug || 'imp-' + Date.now(),
        title: obj.title,
        titleCn: obj.titleCn,
        difficulty: obj.difficulty || 'easy',
        tags: obj.tags || [],
        content: obj.content || '',
        judgeType: obj.judgeType || 'function',
        methodName: obj.methodName || 'run',
        params: obj.params || [],
        returnType: obj.returnType || 'void',
        constructorParams: obj.constructorParams,
        methods: obj.methods,
        tests: (obj.tests || []).map((t: any, i: number) => ({ id: t.id || ('i' + i), input: t.input || [], expected: t.expected || '' })),
        starters: obj.starters || {},
        link: obj.link,
        source: 'imported'
      }
      window.api.problems.update(p).then((list) => {
        setProblems(list)
        selectProblem(p)
      })
    } catch (e: any) {
      alert('导入失败：' + (e?.message || e))
    }
  }

  const removeProblem = (id: string) => {
    window.api.problems.remove(id).then((list) => {
      setProblems(list)
      if (id === activeId) setActiveId(null)
    })
  }

  // 编辑器代码自动持久化：停止输入 900ms 后写入本地题库，避免重启丢失（此前是丢代码的根因之一）
  const saveCodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedCodeRef = useRef<Record<string, string>>({})
  useEffect(() => {
    if (!active) return
    const key = active.id + ':' + language
    if (activeCode === (active.starters?.[language] ?? '')) return
    if (lastSavedCodeRef.current[key] === activeCode) return
    if (saveCodeTimer.current) clearTimeout(saveCodeTimer.current)
    saveCodeTimer.current = setTimeout(() => {
      lastSavedCodeRef.current[key] = activeCode
      window.api.problems.update({
        ...active,
        starters: { ...(active.starters || {}), [language]: activeCode }
      }).then(setProblems)
    }, 900)
    return () => { if (saveCodeTimer.current) clearTimeout(saveCodeTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, language, activeCode])

  const toggleBreakpoint = (line: number) => {
    setBreakpoints((b) => {
      const adding = !b.includes(line)
      // 调试会话暂停时，新增断点实时下发给调试器（驱动保持暂停，等待下一步指令）
      if (adding && debugSnap?.status === 'paused') {
        window.api.debug.setBreak(line)
      }
      return adding ? [...b, line] : b.filter((x) => x !== line)
    })
  }

  const applyDebugSnap = (s: DebugSnapshot | undefined) => setDebugSnap(s ?? null)

  // ---- 分类 / 题单 / 每日一题 ----
  const persistCollections = (c: CatalogEntry[]) => {
    setCollections(c)
    window.api.catalog.set(c)
  }

  const removeCollection = (id: string) => {
    persistCollections(collections.filter((c) => c.id !== id))
    if (category === id) setCategory('all')
  }

  const selectBySlug = async (slug: string, host?: string) => {
    const existing = problems.find((p) => p.slug === slug)
    if (existing) { selectProblem(existing); return }
    setBusy(true)
    try {
      const p = await window.api.problems.ensure(slug, host)
      setProblems((prev) => (prev.some((x) => x.slug === p.slug) ? prev.map((x) => x.slug === p.slug ? p : x) : [...prev, p]))
      selectProblem(p)
    } catch (e: any) {
      alert('加载题目失败：' + String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const addDaily = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const host = settings.lcHost || 'leetcode.com'
      const { problem, date } = await window.api.fetch.daily(host)
      window.api.problems.update(problem)
      setProblems((prev) => (prev.some((x) => x.slug === problem.slug) ? prev.map((x) => x.slug === problem.slug ? problem : x) : [...prev, problem]))
      setCollections((prev) => {
        const item: CatalogEntry['items'][number] = {
          slug: problem.slug, frontendId: problem.id, title: problem.title, difficulty: problem.difficulty
        }
        const old = prev.find((c) => c.id === 'daily')
        const items = old ? [item, ...old.items.filter((i) => i.slug !== problem.slug)] : [item]
        const updated: CatalogEntry = { id: 'daily', kind: 'daily', title: `每日一题 ${date}`, host, date, items }
        const next = [updated, ...prev.filter((c) => c.id !== 'daily')]
        window.api.catalog.set(next)
        return next
      })
      selectProblem(problem)
      setCategory('daily')
      setNotice(`已拉取每日一题（${date}），已切换到「每日一题」分类`)
    } catch (e: any) {
      alert('拉取每日一题失败：' + String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const handleListEntry = (entry: CatalogEntry) => {
    persistCollections([entry, ...collections.filter((c) => c.id !== entry.id)])
    setListOpen(false)
    setCategory(entry.id)
    setNotice(`已拉取「${entry.title}」共 ${entry.items.length} 题，已切换到该题单分类（左侧「分类」区）`)
  }

  // 题面中/英切换：保存设置，并对当前 LeetCode 题目按新语言重新拉取（保留已写代码）
  const switchContentLang = async () => {
    const next: 'zh' | 'en' = (settings.contentLang === 'en') ? 'zh' : 'en'
    const ns = { ...settings, contentLang: next }
    setSettings(ns)
    await window.api.settings.save(ns)
    if (active && active.source === 'leetcode') {
      setBusy(true)
      try {
        const p = await window.api.problems.refetch(active.slug)
        setProblems((prev) => (prev.some((x) => x.slug === p.slug) ? prev.map((x) => x.slug === p.slug ? p : x) : [...prev, p]))
        selectProblem(p)
        setNotice(`题面已切换为${next === 'zh' ? '中文' : 'English'}`)
      } catch (e: any) {
        alert('切换题面失败：' + String(e?.message || e))
      } finally {
        setBusy(false)
      }
    } else {
      setNotice(`题面语言已切换为${next === 'zh' ? '中文' : 'English'}（新拉取的题目生效）`)
    }
  }

  return (
    <div className="app">
      <Sidebar
        problems={problems}
        collections={collections}
        activeId={activeId}
        busy={busy}
        category={category}
        onCategoryChange={setCategory}
        onSelectSlug={selectBySlug}
        onAddDaily={addDaily}
        onAddList={() => setListOpen(true)}
        onAddLocal={() => setLocalOpen(true)}
        onImport={importClipboard}
        onOpenSettings={() => setRightTab('settings')}
        onRemoveProblem={removeProblem}
        onRemoveCollection={removeCollection}
        onOpenFetch={() => setFetchOpen(true)}
      />

      <div className="main">
        <div className="topbar" onDoubleClick={(e) => {
          // 无边框窗口：双击顶栏空白处 = 最大化/还原
          if ((e.target as HTMLElement).closest('button, input, a')) return
          window.api.win.toggleMaximize()
        }}>
          <div className="crumb">
            <h1>{active ? active.title : '欢迎使用 LeetCode Studio'}</h1>
            {active && <span className={`diff-badge diff-${active.difficulty}`}>
              {active.difficulty === 'easy' ? '简单' : active.difficulty === 'medium' ? '中等' : '困难'}
            </span>}
          </div>
          <div className="spacer" />
          <div className="topbar-group">
            <div className="lang-switch">
              {LANGS.map((l) => {
                const tc = toolchains[l]
                const label = l === 'python' ? 'Python' : l === 'java' ? 'Java' : l === 'cpp' ? 'C++' : 'C'
                return (
                  <button key={l}
                    className={`lang-btn ${language === l ? 'active' : ''}`}
                    disabled={!tc?.available}
                    title={`${label}：${tc?.available ? (tc.version || '工具链可用') : '未找到工具链（去设置里指定路径）'}`}
                    onClick={() => setLanguage(l)}>
                    <span className={`tc-dot ${tc?.available ? '' : 'off'}`} />
                    {label}
                  </button>
                )
              })}
            </div>
            <span className="topbar-sep" />
            <button
              className="btn sm ghost"
              onClick={switchContentLang}
              title="切换题面语言：中文（leetcode.cn）/ English（leetcode.com）；切换后自动重新拉取当前题面">
              🌐 {settings.contentLang === 'en' ? 'English' : '中文'}
            </button>
            <button
              className="btn sm ghost"
              disabled={!active}
              onClick={() => setSolutionOpen(true)}
              title="查看 leetcode.cn 上的本题题解（社区解法 / 官方题解）">
              📖 题解
            </button>
          </div>
          <span className="topbar-sep" />
          <div className="topbar-group">
            {lcStatus?.loggedIn ? (
              <button className="btn sm ghost" title={`已登录 ${lcStatus.host}（点击退出）`}
                onClick={async () => {
                  const st = await window.api.lc.logout(lcStatus.host)
                  setLcStatus(st)
                }}>
                <span className="tc-dot" style={{ background: 'var(--green)' }} />
                {lcStatus.username || '已登录'}
              </button>
            ) : (
              <button className="btn sm ghost" onClick={() => setShowLogin(true)} title="登录 LeetCode 账号后可一键提交">
                登录
              </button>
            )}
            <button
              className="btn primary sm"
              disabled={submitting || !active}
              onClick={submitToLeetCode}
              title={lcStatus?.loggedIn ? '提交当前代码到 LeetCode 评测' : '需要先登录 LeetCode 账号'}>
              {submitting ? '评测中…' : '提交'}
            </button>
          </div>
          <WindowControls />
        </div>

        <div className="left-pane">
          {active ? (
            <ProblemPanel
              problem={active}
              tests={tests}
              onTestsChange={setTests}
              onRun={runTests}
              onDebug={startDebug}
              onSolutions={() => setSolutionOpen(true)}
              running={running}
              lang={language}
            />
          ) : (
            <div className="pane-empty" style={{ flex: 1 }}>
              <div className="ico">LC</div>
              <div className="big">打开或拉取一道题目开始练习</div>
              <div className="sub">支持 Python / Java / C++ / C：本地编译运行、逐步调试、查看题解与一键提交。</div>
            </div>
          )}
        </div>

        <div className="right-pane" ref={rightPaneRef}>
          <div className="editor-head">
            <span className="filename">{active ? (active.slug || active.title) : ''}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="hint">F9 / 点击行号切换断点</span>
            <button
              className="btn xs ghost"
              disabled={!active}
              onClick={() => toggleBreakpoint(cursorLine)}
              title="在当前光标行加/移除断点（F9）">
              🔴 第 {cursorLine} 行断点
            </button>
          </div>
          <div className="editor-wrap" style={{ flex: 'none', height: editorH }}>
            <Editor
              value={activeCode}
              language={language}
              problem={active}
              onChange={setActiveCode}
              breakpoints={breakpoints}
              currentLine={pausedLine}
              onToggleBreakpoint={toggleBreakpoint}
              onCursorChange={setCursorLine}
            />
          </div>
          <div className="v-split" onMouseDown={startDrag} title="拖动调整编辑器高度" />
          <div className="right-tabs">
            <div className={`right-tab ${rightTab === 'run' ? 'active' : ''}`} onClick={() => setRightTab('run')}>
              ▶ 测试用例
              {result && <span className="badge">{result.cases.filter((c) => c.passed).length}/{result.cases.length}</span>}
            </div>
            <div className={`right-tab ${rightTab === 'debug' ? 'active' : ''}`} onClick={() => setRightTab('debug')}>
              🐞 逐步调试
              {debugSnap?.status === 'paused' && <span className="badge">第 {debugSnap.pausedAt} 行</span>}
            </div>
            <div className={`right-tab ${rightTab === 'ai' ? 'active' : ''}`} onClick={() => setRightTab('ai')} title="AI 做题助手：只给思路与提示，不直接给答案">
              🤖 AI 助手
              {(() => {
                const n = active ? (aiChats[active.id]?.length || 0) : 0
                return n ? <span className="badge">{Math.ceil(n / 2)}</span> : null
              })()}
            </div>
            <div className={`right-tab ${rightTab === 'settings' ? 'active' : ''}`} onClick={() => setRightTab('settings')}>⚙ 设置</div>
          </div>
          <div className="right-body">
            {rightTab === 'run' && (
            <RunPanel
              result={result}
              running={running}
              note={runNote}
              onEditHarness={active ? () => setHarnessOpen(true) : undefined}
            />
          )}
            {rightTab === 'debug' && (
              <DebugPanel
                snapshot={debugSnap}
                placeholder={pythonPlaceholder}
                onStep={() => {
                  // 乐观置为 running，随后以事件流为准（避免用旧快照覆盖界面）
                  setDebugSnap((s) => (s ? { ...s, status: 'running' } : s))
                  window.api.debug.step()
                }}
                onOver={() => {
                  setDebugSnap((s) => (s ? { ...s, status: 'running' } : s))
                  window.api.debug.over()
                }}
                onResume={() => {
                  setDebugSnap((s) => (s ? { ...s, status: 'running' } : s))
                  window.api.debug.resume()
                }}
                onStop={() => {
                  window.api.debug.stop()
                  setDebugSnap((s) => (s ? { ...s, status: 'finished' } : s))
                }}
                programOutput={debugOutput}
              />
            )}
            {rightTab === 'ai' && (
              <AiPanel
                problem={active}
                language={language}
                code={activeCode}
                result={result}
                debugSnap={debugSnap}
                noAnswer={settings.aiNoAnswer !== false}
                history={active ? (aiChats[active.id] || []) : []}
                onHistory={(m) => {
                  if (!active) return
                  setAiChats((c) => ({ ...c, [active.id]: m }))
                }}
                onOpenSettings={() => setRightTab('settings')}
              />
            )}
            {rightTab === 'settings' && (
              <SettingsPanel
                settings={settings}
                toolchains={toolchains}
                updateStatus={updateState}
                onSave={(s) => { window.api.settings.save(s).then(() => loadAll(s)) }}
                onDetect={(s) => window.api.toolchains.detect(s).then(setToolchains)}
              />
            )}
          </div>
        </div>
      </div>

      <FetchModal
        open={fetchOpen}
        onClose={() => setFetchOpen(false)}
        onAdd={(p) => {
          window.api.problems.update(p).then((list) => {
            setProblems(list)
            selectProblem(p)
            setFetchOpen(false)
          })
        }}
      />

      {localOpen && (
        <div className="modal-overlay" onClick={() => setLocalOpen(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>新增本地题目</h2><button className="btn ghost sm" onClick={() => setLocalOpen(false)}>✕</button></div>
            <div className="modal-body">
              <input placeholder="题目名称" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} autoFocus />
              {localErr && <div className="error-text">{localErr}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setLocalOpen(false)}>取消</button>
              <button className="btn primary" onClick={addLocal}>创建</button>
            </div>
          </div>
        </div>
      )}

      {showLogin && (
        <LoginModal
          defaultHost={settings.lcHost || lcStatus?.host || 'leetcode.com'}
          onClose={() => setShowLogin(false)}
          onSuccess={(host, username) => {
            setSettings((s) => ({ ...s, lcHost: host, lcUsername: username }))
            setLcStatus({ host, loggedIn: true, username })
            setShowLogin(false)
          }}
        />
      )}

      {(verdict || submitting) && (
        <SubmitResultModal
          verdict={verdict}
          submitting={submitting}
          onClose={() => { if (!submitting) setVerdict(null) }}
        />
      )}

      {listOpen && (
        <ListModal
          defaultHost={settings.lcHost || 'leetcode.cn'}
          onClose={() => setListOpen(false)}
          onAdd={handleListEntry}
        />
      )}

      {solutionOpen && active && (
        <SolutionModal problem={active} onClose={() => setSolutionOpen(false)} />
      )}

      {harnessOpen && active && (
        <HarnessModal
          problem={active}
          language={language}
          code={activeCode}
          tests={tests}
          onClose={() => setHarnessOpen(false)}
          onApplied={(r) => { if (r) setResult(r) }}
        />
      )}

      {/* 更新提示条：发现新版本 / 下载完成时显示 */}
  {updateState.state === 'downloaded' && (
    <div className="update-bar">
      <span>🎉 新版本 v{updateState.version} 已下载完成</span>
      <button className="btn xs primary" onClick={() => window.api.updater.install()}>重启并安装</button>
      <button className="btn xs ghost" onClick={() => setUpdateState({ state: 'idle' })}>稍后</button>
    </div>
  )}
  {updateState.state === 'downloading' && (
    <div className="update-bar subtle">
      <span>正在后台下载新版本… {updateState.percent ?? 0}%</span>
      <button className="btn xs ghost" onClick={() => setUpdateState({ state: 'idle' })}>收起</button>
    </div>
  )}

  {notice && (
        <div style={{
          position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: 'var(--bg-3)', border: '1px solid var(--green)', color: 'var(--green)',
          padding: '10px 18px', borderRadius: 8, fontSize: 13, boxShadow: 'var(--shadow)',
          display: 'flex', gap: 12, alignItems: 'center'
        }}>
          {notice}
          <button className="link-btn" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
    </div>
  )
}
