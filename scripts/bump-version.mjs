// 发版版本号同步：node scripts/bump-version.mjs 1.0.1
// 更新 package.json 的 version，并让 npm 同步 package-lock.json；顺带更新 README / RELEASE 里的版本行。
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/bump-version.mjs <x.y.z>')
  process.exit(1)
}

// package.json：只改根 version 字段
{
  const p = join(root, 'package.json')
  const text = readFileSync(p, 'utf-8')
  const re = /^(\s*"version":\s*")[^"]+(")/m
  if (!re.test(text)) {
    console.error('[package.json] 未找到根 version 字段')
    process.exit(1)
  }
  writeFileSync(p, text.replace(re, `$1${version}$2`))
  console.log('[package.json] ok')
}

// package-lock.json：交给 npm 更新根版本，避免字符串替换误伤依赖版本
try {
  execSync('npm install --package-lock-only', { cwd: root, stdio: 'inherit' })
  console.log('[package-lock.json] ok')
} catch (e) {
  console.error('[package-lock.json] npm 更新失败:', e.message)
  process.exit(1)
}

// README / RELEASE：替换形如 v1.0.0 / 1.0.0 的当前版本行（存在才改）
for (const file of ['README.md', 'RELEASE.md']) {
  const p = join(root, file)
  if (!existsSync(p)) continue
  const text = readFileSync(p, 'utf-8')
  const next = text
    .replace(/(版本：\s*v?)[\d.]+/g, `$1${version}`)
    .replace(/(当前版本：\*\*v?)[\d.]+/g, `$1${version}`)
    .replace(/(LeetCode Studio-)[\d.]+(-setup|-portable)/g, `$1${version}$2`)
  if (next !== text) {
    writeFileSync(p, next)
    console.log(`[${file}] ok`)
  }
}

console.log(`\n版本号已同步为 ${version}。发版步骤：
  1) node scripts/bump-version.mjs ${version}
  2) 更新 RELEASE.md 里的更新说明与哈希（打包后）
  3) git commit -am "release: v${version}" && git tag v${version} && git push --tags
  GitHub Actions 会自动打包并创建 Release（附带 latest.yml 供自动更新使用）。`)
