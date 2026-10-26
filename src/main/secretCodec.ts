// 密钥加密的纯函数部分（不 import electron，方便在普通 node 里做回归测试）。
// 规则：
//   - 落盘格式为 `enc:<base64>`；不带前缀的视为旧版明文（读取时直接返回，下次保存时迁移）。
//   - safeStorage 不可用（如无密钥环的 Linux）时退回明文，保证功能不因此失效。

export const SECRET_PREFIX = 'enc:'

export interface Cipher {
  /** 底层加解密是否可用 */
  available(): boolean
  /** 明文 → 密文（结果会被 base64 编码后拼上前缀） */
  encrypt(plain: string): string
  /** 密文 → 明文 */
  decrypt(cipher: string): string
}

export function encryptSecret(plain: string, cipher: Cipher): string {
  const p = (plain ?? '').trim()
  if (!p) return ''
  if (p.startsWith(SECRET_PREFIX)) return p // 已经是密文，不重复加密
  if (!cipher.available()) return p
  try {
    return SECRET_PREFIX + cipher.encrypt(p)
  } catch {
    return p
  }
}

export function decryptSecret(stored: string, cipher: Cipher): string {
  const s = (stored ?? '').trim()
  if (!s) return ''
  if (!s.startsWith(SECRET_PREFIX)) return s // 旧版明文，直接返回
  if (!cipher.available()) return ''
  try {
    return cipher.decrypt(s.slice(SECRET_PREFIX.length))
  } catch {
    return ''
  }
}

/** 整段 JSON 加密成 `enc:` 串；不可用时返回空串（调用方应回退到明文） */
export function encryptJson(value: unknown, cipher: Cipher): string {
  if (!cipher.available()) return ''
  try {
    return SECRET_PREFIX + cipher.encrypt(JSON.stringify(value))
  } catch {
    return ''
  }
}

/** 解密 `enc:` 串并 parse 成 JSON；失败返回 null */
export function decryptJson<T>(payload: string, cipher: Cipher): T | null {
  if (!payload || !cipher.available()) return null
  if (!payload.startsWith(SECRET_PREFIX)) return null
  try {
    return JSON.parse(cipher.decrypt(payload.slice(SECRET_PREFIX.length))) as T
  } catch {
    return null
  }
}
