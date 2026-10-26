// 跑一组「纯 node、无网络、无编译器」的回归脚本（默认集合）。
// 这些不依赖 GUI / Electron / 工具链，适合在 CI 里每次 push 都跑一遍。
// 用法：node scripts/run-regressions.mjs [test1 test2 ...]（不给参数用默认集合）
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(join(fileURLToPath(import.meta.url), '..', '..'))
const DEFAULT_TESTS = ['secrets-test', 'record-test', 'symbols-test']
const tests = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TESTS

const outDir = join(root, '.tmp-t')
// 用 node 直接跑 tsc 的入口，避免 Windows 上 spawn .cmd 需要 shell 的问题
const tscEntry = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

for (const t of tests) {
  const src = join(root, 'scripts', t + '.ts')
  if (!existsSync(src)) {
    console.error(`缺少回归脚本：${src}`)
    process.exit(1)
  }
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const files = tests.map((t) => join('scripts', t + '.ts'))
const compile = spawnSync(
  process.execPath,
  [
    tscEntry,
    ...files,
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--esModuleInterop',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' }
)
if (compile.status !== 0) {
  rmSync(outDir, { recursive: true, force: true })
  process.exit(compile.status || 1)
}

let failed = false
for (const t of tests) {
  console.log(`\n=== ${t} ===`)
  const run = spawnSync(process.execPath, [join(outDir, 'scripts', t + '.js')], { cwd: root, stdio: 'inherit' })
  if (run.status !== 0) failed = true
}

rmSync(outDir, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
