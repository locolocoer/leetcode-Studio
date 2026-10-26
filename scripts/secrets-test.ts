// 密钥加密 + 脱敏 + 合并逻辑的回归测试（纯 node，不依赖 Electron/safeStorage）。
// 真正调用 safeStorage 的路径在打包应用里生效，这里覆盖纯逻辑与「加密不可用」的退化分支。
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  SECRET_PREFIX,
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  type Cipher,
} from '../src/main/secretCodec'
import { Store } from '../src/main/store'

let failed = 0
function check(name: string, cond: boolean): void {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`)
  if (!cond) failed++
}

// 可逆的“加密”即可（base64），重点测 codec 的格式约定与迁移
const cipher: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(s, 'utf8').toString('base64'),
  decrypt: (c) => Buffer.from(c, 'base64').toString('utf8'),
}

console.log('1) 密钥加解密往返（纯 codec）')
const plain = 'sk-1234567890'
const enc = encryptSecret(plain, cipher)
check('密文带 enc: 前缀', enc.startsWith(SECRET_PREFIX))
check('密文不等于明文', enc !== plain)
check('解密还原', decryptSecret(enc, cipher) === plain)
check('旧明文原样返回', decryptSecret('legacy-plain', cipher) === 'legacy-plain')
check('重复加密不叠加', encryptSecret(enc, cipher) === enc)
check('空串处理', encryptSecret('', cipher) === '' && decryptSecret('', cipher) === '')

console.log('2) 加密不可用时的退化分支')
const noCipher: Cipher = { available: () => false, encrypt: (s) => s, decrypt: (s) => s }
check('encryptSecret 退回明文', encryptSecret(plain, noCipher) === plain)
check('decryptSecret(密文) 返回空', decryptSecret('enc:xxx', noCipher) === '')
check('decryptJson(密文) 返回 null', decryptJson('enc:xxx', noCipher) === null)

console.log('3) JSON 加密往返')
const jenc = encryptJson({ a: 1, b: 'x' }, cipher)
check('JSON 密文带前缀', !!jenc && jenc.startsWith(SECRET_PREFIX))
check('JSON 解密还原', JSON.stringify(decryptJson(jenc, cipher)) === JSON.stringify({ a: 1, b: 'x' }))
check('加密不可用时 encryptJson 返回空', encryptJson({ a: 1 }, noCipher) === '')

console.log('4) Store 合并 / 脱敏（node 下 safeStorage 不可用，走明文分支）')
const dir = mkdtempSync(join(tmpdir(), 'lc-secrets-'))
try {
  const store = new Store(dir)
  const base = store.loadSettings()
  store.saveSettingsFromRenderer({ ...base, aiApiKey: 'sk-new', githubToken: 'ghp-token' })
  let got = store.loadSettings()
  check('保存后能读回明文密钥', got.aiApiKey === 'sk-new' && got.githubToken === 'ghp-token')

  const pub = store.getPublicSettings()
  check('下发脱敏：密钥字段为空', pub.aiApiKey === '' && pub.githubToken === '')
  check('下发脱敏：hasApiKey/hasGithubToken 为真', pub.hasApiKey === true && pub.hasGithubToken === true)

  store.saveSettingsFromRenderer({ ...pub, aiModel: 'new-model' })
  got = store.loadSettings()
  check('留空保存不清掉密钥', got.aiApiKey === 'sk-new' && got.githubToken === 'ghp-token')
  check('其它字段正常更新', got.aiModel === 'new-model')

  store.saveSettingsFromRenderer({ ...pub, aiApiKey: 'sk-replaced' })
  got = store.loadSettings()
  check('新值覆盖旧 Key', got.aiApiKey === 'sk-replaced' && got.githubToken === 'ghp-token')

  store.saveSettingsFromRenderer({ ...pub, clearApiKey: true, clearGithubToken: true })
  got = store.loadSettings()
  check('clear 标志清空密钥', got.aiApiKey === '' && got.githubToken === '')

  const pub2 = store.getPublicSettings()
  check('清除后 hasApiKey/hasGithubToken 为假', pub2.hasApiKey === false && pub2.hasGithubToken === false)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} 项不通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
