// 密钥加密的 Electron 侧封装：safeStorage（Windows 用 DPAPI，等价于“本机当前用户”可解密）。
// 所有落盘的密钥——AI API Key、GitHub Token、LeetCode 会话——都走这里。
import { safeStorage } from 'electron'
import { SECRET_PREFIX, decryptJson, decryptSecret, encryptJson, encryptSecret, type Cipher } from './secretCodec'
import type { Settings } from '../shared/types'

const cipher: Cipher = {
  available: () => !!safeStorage && safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, 'base64')),
}

/** 落盘前：把设置里的两个密钥字段加密（空值保持空；不可用时退回明文） */
export function protectSettings(settings: Settings): Settings {
  return {
    ...settings,
    aiApiKey: encryptSecret(settings.aiApiKey ?? '', cipher),
    githubToken: encryptSecret(settings.githubToken ?? '', cipher),
  }
}

/** 读盘后：把设置里的两个密钥字段解密回明文（供主进程内部使用） */
export function revealSettings(settings: Settings): Settings {
  return {
    ...settings,
    aiApiKey: decryptSecret(settings.aiApiKey ?? '', cipher),
    githubToken: decryptSecret(settings.githubToken ?? '', cipher),
  }
}

/** 下发给渲染层之前：剥掉明文密钥，只留「是否已配置」的标记 */
export function publicSettings(settings: Settings): Settings {
  const pub = { ...settings }
  ;(pub as any).hasApiKey = !!(settings.aiApiKey || '').trim()
  ;(pub as any).hasGithubToken = !!(settings.githubToken || '').trim()
  pub.aiApiKey = ''
  pub.githubToken = ''
  return pub
}

/** 整段 JSON 加密（LeetCode 会话文件用）；返回空串表示当前环境不可用 */
export function encryptSessionJson(value: unknown): string {
  return encryptJson(value, cipher)
}

/** 解密整段 JSON（LeetCode 会话文件用）；失败返回 null */
export function decryptSessionJson<T>(payload: string): T | null {
  return decryptJson<T>(payload, cipher)
}

export { SECRET_PREFIX }
