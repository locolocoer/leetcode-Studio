// 准备内置工具链到 toolchains/：
//   toolchains/python/   Python 3.11.9 embeddable（Windows amd64）
//   toolchains/w64/w64devkit/  w64devkit v2.0.0（GCC 14.2.0 + GDB 15.1，内置 gdb 未编译 Python）
//   toolchains/jdk17/    Temurin 17.0.2 经 jlink 裁剪出的运行时（含 jdb / jdk.jdi / jdk.jdwp.agent）
//
// 用法：
//   node scripts/prepare-toolchains.mjs            # 已存在则跳过
//   node scripts/prepare-toolchains.mjs --force    # 重新下载
//   node scripts/prepare-toolchains.mjs --only=python
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TC = join(root, 'toolchains')
const CACHE = join(root, '.toolchain-cache')

const PY_URL = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
const W64_URL = 'https://github.com/skeeto/w64devkit/releases/download/v2.0.0/w64devkit-x64-2.0.0.exe'
const JDK_URL =
  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.2%2B8/OpenJDK17U-jdk_x64_windows_hotspot_17.0.2_8.zip'

// jlink 模块：jdb 需要 jdk.jdi + jdk.jdwp.agent，编译需要 jdk.compiler
const JLINK_MODULES = [
  'java.base',
  'java.compiler',
  'jdk.internal.jvmstat',
  'jdk.attach',
  'jdk.compiler',
  'jdk.jdwp.agent',
  'jdk.jdi',
  'jdk.zipfs'
]

const force = process.argv.includes('--force')
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null
const want = (name) => !only || only.includes(name)

function log(msg) {
  console.log(`[toolchains] ${msg}`)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
}

async function download(url, dest) {
  if (existsSync(dest) && !force) {
    log(`使用缓存 ${dest}`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  log(`下载 ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  log(`已保存 ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${dest}`)
}

function rimraf(p) {
  rmSync(p, { recursive: true, force: true })
}

/** 解压 zip：优先 tar（Windows 10+ 自带 bsdtar，能解 zip），失败再试 Expand-Archive */
function unzip(zip, outDir) {
  mkdirSync(outDir, { recursive: true })
  const tar = spawnSync('tar', ['-xf', zip, '-C', outDir], { stdio: 'inherit' })
  if (tar.status === 0) return
  log('tar 解压失败，改用 Expand-Archive')
  run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${outDir}' -Force`])
}

/** 解压 7z 自解压 exe（w64devkit 只提供 .exe 分发包） */
function extract7zSfx(exe, outDir) {
  mkdirSync(outDir, { recursive: true })
  const candidates = [
    process.env.SEVEN_ZIP,
    'C:/Program Files/7-Zip/7z.exe',
    'C:/Program Files (x86)/7-Zip/7z.exe',
    '7z'
  ].filter(Boolean)
  for (const sevenZip of candidates) {
    const r = spawnSync(sevenZip, ['x', exe, `-o${outDir}`, '-y'], { stdio: 'inherit', shell: false })
    if (!r.error && r.status === 0) return
  }
  // 兜底：7-Zip SFX 自带 -y -o 参数，可直接静默解压
  log('未找到 7z，改用自解压参数 -y -o')
  run(exe, ['-y', `-o${outDir}`])
}

async function preparePython() {
  const target = join(TC, 'python')
  if (existsSync(join(target, 'python.exe')) && !force) {
    log('python 已就绪，跳过')
    return
  }
  const zip = join(CACHE, 'python-3.11.9-embed-amd64.zip')
  await download(PY_URL, zip)
  rimraf(target)
  unzip(zip, target)
  if (!existsSync(join(target, 'python.exe'))) throw new Error('python.exe 未找到，解压异常')
  log('python 就绪')
}

async function prepareW64() {
  const target = join(TC, 'w64')
  if (existsSync(join(target, 'w64devkit', 'bin', 'gcc.exe')) && !force) {
    log('w64devkit 已就绪，跳过')
    return
  }
  const exe = join(CACHE, 'w64devkit-x64-2.0.0.exe')
  await download(W64_URL, exe)
  rimraf(target)
  extract7zSfx(exe, target)
  const gcc = join(target, 'w64devkit', 'bin', 'gcc.exe')
  if (!existsSync(gcc)) throw new Error('gcc.exe 未找到，解压异常')
  log('w64devkit 就绪（GCC 14.2.0 + GDB 15.1）')
}

async function prepareJdk() {
  const target = join(TC, 'jdk17')
  if (existsSync(join(target, 'bin', 'jdb.exe')) && !force) {
    log('jdk17 已就绪，跳过')
    return
  }
  const zip = join(CACHE, 'OpenJDK17U-jdk_x64_windows_hotspot_17.0.2_8.zip')
  await download(JDK_URL, zip)
  const unpack = join(CACHE, 'jdk-full')
  rimraf(unpack)
  unzip(zip, unpack)
  // zip 内是一层 jdk-17.0.2+8 目录
  const entries = readdirSync(unpack).map((n) => join(unpack, n))
  const jdkHome = entries.find((p) => existsSync(join(p, 'bin', 'jlink.exe')))
  if (!jdkHome) throw new Error('未找到 jdk 解压目录（jlink.exe 缺失）')
  const jlink = join(jdkHome, 'bin', 'jlink.exe')
  rimraf(target)
  log(`jlink 裁剪运行时：${JLINK_MODULES.join(',')}`)
  run(jlink, [
    '--module-path', join(jdkHome, 'jmods'),
    '--add-modules', JLINK_MODULES.join(','),
    '--output', target,
    '--strip-debug',
    '--no-header-files',
    '--no-man-pages',
    '--compress=zip-6'
  ])
  for (const exe of ['java.exe', 'javac.exe', 'jdb.exe']) {
    if (!existsSync(join(target, 'bin', exe))) throw new Error(`jlink 结果缺少 bin/${exe}`)
  }
  log('jdk17 就绪（java / javac / jdb）')
}

async function main() {
  if (process.platform !== 'win32') {
    log(`当前平台 ${process.platform}：内置工具链仅 Windows 需要，跳过`)
    return
  }
  mkdirSync(TC, { recursive: true })
  mkdirSync(CACHE, { recursive: true })
  if (want('python')) await preparePython()
  if (want('w64')) await prepareW64()
  if (want('jdk')) await prepareJdk()
  log('全部完成')
}

main().catch((e) => {
  console.error('[toolchains] 失败：' + (e?.message || e))
  process.exit(1)
})
