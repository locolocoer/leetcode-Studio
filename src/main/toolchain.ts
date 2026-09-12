import { execFileSync, spawnSync } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import type { Language, Settings, ToolchainStatus } from '../shared/types'

const isWindows = process.platform === 'win32'

function exeName(base: string): string {
  return isWindows ? `${base}.exe` : base
}

function searchPath(): string[] {
  const path = process.env.PATH ?? ''
  return path.split(';').filter(Boolean)
}

function findOnPath(binaries: string[]): string | null {
  for (const dir of searchPath()) {
    // WindowsApps 里的 python/java 是"应用商店别名"，执行会打开商店，必须跳过
    if (dir.toLowerCase().includes('windowsapps')) continue
    for (const b of binaries) {
      const candidate = join(dir, exeName(b))
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function findInDirs(dirs: string[], bins: string[]): string | null {
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue
    // direct
    for (const sub of ['', 'bin']) {
      const found = resolveExe(sub ? join(dir, sub) : dir, bins)
      if (found) return found
    }
    // nested version dirs (e.g. Program Files\Java\jdk-17\bin)
    try {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (!statSync(p).isDirectory()) continue
        for (const sub of ['bin', '']) {
          const found = resolveExe(sub ? join(p, sub) : p, bins)
          if (found) return found
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

function javaExtraRoots(): string[] {
  const roots: string[] = []
  if (process.env.JAVA_HOME) roots.push(process.env.JAVA_HOME)
  roots.push('C:\\Program Files\\Java')
  roots.push('C:\\Program Files (x86)\\Java')
  roots.push('C:\\Program Files\\Eclipse Adoptium')
  roots.push('C:\\Program Files\\Microsoft')
  roots.push('C:\\Program Files\\Android\\Android Studio\\jbr')
  roots.push('C:\\Program Files\\Zulu')
  roots.push('C:\\ProgramData\\Oracle\\Java')
  roots.push('C:\\Users\\' + (process.env.USERNAME || '') + '\\.jdks')
  return roots
}

function pythonExtraRoots(): string[] {
  const home = process.env.USERPROFILE || ''
  const local = process.env.LOCALAPPDATA || join(home, 'AppData\\Local')
  const roots: string[] = []
  if (process.env.PYTHONHOME) roots.push(process.env.PYTHONHOME)
  if (process.env.CONDA_PREFIX) roots.push(process.env.CONDA_PREFIX)
  if (process.env.CONDA_EXE) roots.push(dirname(dirname(process.env.CONDA_EXE)))
  for (const drive of ['C:\\ProgramData', 'D:\\ProgramData', 'C:\\']) {
    roots.push(join(drive, 'anaconda3'))
    roots.push(join(drive, 'miniconda3'))
    roots.push(join(drive, 'Anaconda3'))
  }
  for (const base of [join(home, 'anaconda3'), join(home, 'miniconda3'), join(home, 'Anaconda3')]) roots.push(base)
  roots.push(join(local, 'Programs\\Python'))
  roots.push('C:\\Program Files\\Python312', 'C:\\Program Files\\Python311', 'C:\\Program Files\\Python310', 'C:\\Program Files\\Python313')
  return roots
}

function cxxExtraRoots(): string[] {
  const roots: string[] = []
  for (const drive of ['C:', 'D:']) {
    roots.push(join(drive, '\\mingw64'))
    roots.push(join(drive, '\\msys64\\mingw64'))
    roots.push(join(drive, '\\TDM-GCC-64'))
    roots.push(join(drive, '\\ProgramData\\anaconda3\\Library\\mingw-w64'))
    roots.push(join(drive, '\\ProgramData\\miniconda3\\Library\\mingw-w64'))
  }
  roots.push('C:\\Program Files\\mingw-w64')
  roots.push('C:\\Program Files (x86)\\mingw-w64')
  roots.push('C:\\ProgramData\\chocolatey\\lib\\mingw\\tools\\install\\mingw64')
  roots.push('C:\\ProgramData\\chocolatey\\lib\\mingw')
  return roots
}

function resolveExe(dir: string, binaries: string[]): string | null {
  for (const b of binaries) {
    const c = join(dir, exeName(b))
    if (existsSync(c)) return c
  }
  return null
}

function versionOf(exe: string, args: string[]): string | undefined {
  try {
    const out = execFileSync(exe, args, { timeout: 5000, encoding: 'utf8' })
    return out.split(/\r?\n/)[0].trim() || undefined
  } catch (e: any) {
    try {
      const out = execFileSync(exe, [...args, '-version'], { timeout: 5000, encoding: 'utf8' })
      return out.split(/\r?\n/)[0].trim() || undefined
    } catch {
      return undefined
    }
  }
}

// Bundled toolchain roots, in priority order. Dev: <project>/toolchains.
// Packaged: <resources>/toolchains (see electron-builder extraResources).
function bundleRoots(additionalPath?: string): string[] {
  const roots: string[] = []
  if (additionalPath && existsSync(additionalPath)) roots.push(additionalPath)
  roots.push(join(__dirname, '../../toolchains'))
  try {
    const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
    if (resources) roots.push(join(resources, 'toolchains'))
  } catch {}
  return roots
}

function resolveIn(root: string, bins: string[]): string | null {
  for (const dir of [root, join(root, 'bin')]) {
    const found = resolveExe(dir, bins)
    if (found) return found
  }
  return null
}

const JAVA_BINS = ['java']
const JAVAC_BINS = ['javac']
const GCC_BINS = ['gcc', 'cc', 'clang']
const GXX_BINS = ['g++', 'c++', 'clang++']
const PY_BINS = ['python', 'python3']

// 内置工具链是嵌套目录（python/、jdk17/bin/、w64/w64devkit/bin/…），有限深度递归查找。
const SKIP_DIRS = new Set(['lib', 'include', 'share', 'doc', 'man', 'pkgconfig', 'cmake', 'src', 'ssl', 'licenses', 'tests', 'bin32'])

function findExeDeep(root: string, bins: string[], depth = 0): string | null {
  if (depth > 4) return null
  const direct = resolveExe(root, bins)
  if (direct) return direct
  let entries: string[] = []
  try { entries = readdirSync(root) } catch { return null }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(root, e)
    let isDir = false
    try { isDir = statSync(p).isDirectory() } catch { continue }
    if (!isDir) continue
    const f = findExeDeep(p, bins, depth + 1)
    if (f) return f
  }
  return null
}

function detectBundled(language: Language, override?: string): ToolchainStatus {
  const roots = bundleRoots(override)
  const wants: Record<Language, string[]> = {
    python: PY_BINS, java: JAVAC_BINS, c: GCC_BINS, cpp: GXX_BINS
  }
  const bins = wants[language]
  for (const root of roots) {
    const exe = findExeDeep(root, bins)
    if (!exe) continue
    switch (language) {
      case 'python':
        return sysStatus('python', 'bundled', exe)
      case 'java': {
        const java = join(dirname(exe), exeName('java'))
        return sysStatus('java', 'bundled', exe, existsSync(java) ? java : '')
      }
      case 'c':
        return sysStatus('c', 'bundled', exe)
      case 'cpp':
        return sysStatus('cpp', 'bundled', exe)
    }
  }
  return { language, available: false, source: 'none' }
}

function sysStatus(
  language: Language,
  source: 'bundled' | 'system',
  compilerPath: string,
  runnerPath?: string
): ToolchainStatus {
  const status: ToolchainStatus = {
    language,
    available: true,
    source,
    compilerPath: compilerPath || undefined,
    runnerPath: runnerPath || undefined
  }
  if (language === 'python') {
    status.version = versionOf(compilerPath, ['--version'])
    status.runnerPath = status.runnerPath || compilerPath
  } else if (language === 'java') {
    status.version = versionOf(compilerPath, ['-version'])
  } else {
    status.version = versionOf(compilerPath, ['--version'])
  }
  return status
}

export function detectToolchain(language: Language, settings?: Settings): ToolchainStatus {
  const override = settings?.toolpaths?.[language]

  // 1. explicit override
  if (override && existsSync(override)) {
    switch (language) {
      case 'python': {
        let py = override
        if (existsSync(join(override, exeName('python')))) py = join(override, exeName('python'))
        return sysStatus('python', 'bundled', py)
      }
      case 'java': {
        let javac = override
        if (existsSync(join(override, exeName('javac')))) javac = join(override, exeName('javac'))
        let java = join(dirname(javac), exeName('java'))
        return sysStatus('java', 'bundled', javac, java)
      }
      case 'c': {
        let cc = override
        if (existsSync(join(override, exeName('gcc')))) cc = join(override, exeName('gcc'))
        return sysStatus('c', 'bundled', cc)
      }
      case 'cpp': {
        let cxx = override
        if (existsSync(join(override, exeName('g++')))) cxx = join(override, exeName('g++'))
        return sysStatus('cpp', 'bundled', cxx)
      }
    }
  }

  // 2. bundled
  const bundled = detectBundled(language)
  if (bundled.available) return bundled

  // 3. system PATH
  switch (language) {
    case 'python': {
      const py = findOnPath(PY_BINS)
      if (py) return sysStatus('python', 'system', py)
      const extra = findInDirs(pythonExtraRoots(), PY_BINS)
      if (extra) return sysStatus('python', 'system', extra)
      break
    }
    case 'java': {
      const java = findOnPath(JAVA_BINS)
      const javac = findOnPath(JAVAC_BINS)
      if (java || javac) return sysStatus('java', 'system', javac ?? '', java ?? '')
      // fall back to well-known JDK install roots
      const jh = findInDirs(javaExtraRoots(), JAVAC_BINS)
      if (jh) {
        const javaBin = join(dirname(jh), exeName('java'))
        return sysStatus('java', 'system', jh, existsSync(javaBin) ? javaBin : '')
      }
      break
    }
    case 'c': {
      const cc = findOnPath(GCC_BINS)
      if (cc) return sysStatus('c', 'system', cc)
      const extra = findInDirs(cxxExtraRoots(), GCC_BINS)
      if (extra) return sysStatus('c', 'system', extra)
      break
    }
    case 'cpp': {
      const cxx = findOnPath(GXX_BINS)
      if (cxx) return sysStatus('cpp', 'system', cxx)
      const extra = findInDirs(cxxExtraRoots(), GXX_BINS)
      if (extra) return sysStatus('cpp', 'system', extra)
      break
    }
  }

  return { language, available: false, source: 'none' }
}

export function detectAll(settings?: Settings): Record<Language, ToolchainStatus> {
  const out = {} as Record<Language, ToolchainStatus>
  for (const lang of ['c', 'cpp', 'java', 'python'] as Language[]) {
    out[lang] = detectToolchain(lang, settings)
  }
  return out
}

export function probeCompiler(compilerPath: string, args: string[]): { ok: boolean; output: string } {
  try {
    const r = spawnSync(compilerPath, args, { timeout: 8000, encoding: 'utf8' })
    return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') }
  } catch (e: any) {
    return { ok: false, output: String(e.message || e) }
  }
}
