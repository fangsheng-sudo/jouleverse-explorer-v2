// 钱包交互错误的确定性分类：不依赖任何错误文案，只用类型 + EIP-155 数值。
//
// 为什么不用 networkId：`networkId` 在 EIP-155 时代已废弃（许多 RPC 恒返回 1 或
// 干脆不实现），唯一可信的链标识是 chainId。本文件里判定一律走 chainId 数值。
//
// 为什么不用 message 字符串匹配：文案会随库升级 / i18n 变更，且「连接到了错误的
// 网络」与「请在钱包中切换」并不共享稳定的子串——用文案判定必然漏判。

import { BaseError, UserRejectedRequestError } from 'viem'

/** 连接到了预期之外的链。携带实际 chainId（数值），供上层决定是否自动切换。 */
export class ChainMismatchError extends Error {
  readonly actualChainId: number
  readonly expectedChainId: number
  readonly expectedChainName: string

  constructor(actualChainId: number, expected: { id: number; name: string }) {
    // 面向用户的文案仍要可读；但**判定绝不用这段文案**（见下方 isChainMismatch）
    super(`连接到了错误的网络 (chainId=${actualChainId})，请切换到 ${expected.name}（chainId=${expected.id}）`)
    this.name = 'ChainMismatchError'
    this.actualChainId = actualChainId
    this.expectedChainId = expected.id
    this.expectedChainName = expected.name
  }
}

/**
 * 判定「链不匹配」。首选 instanceof；跨模块副本 / 跨 realm 时回退到
 * name + actualChainId 数值双条件（仍不碰文案自由文本，只认契约化的 name 与数字）。
 */
export function isChainMismatch(error: unknown): error is ChainMismatchError {
  if (error instanceof ChainMismatchError) return true
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: unknown; actualChainId?: unknown; expectedChainId?: unknown }
    return e.name === 'ChainMismatchError'
      && typeof e.actualChainId === 'number'
      && typeof e.expectedChainId === 'number'
  }
  return false
}

/**
 * 用户主动拒绝（在钱包里点了「取消」）。
 * 判定依据：viem 的 UserRejectedRequestError 类型，或 EIP-1193 数值码 4001
 * （取自 UserRejectedRequestError.code 常量，不写字面量）。
 * viem 把原始 provider 错误包在 cause 链里，所以用 BaseError.walk 逐层找。
 */
export function isUserRejected(error: unknown): boolean {
  const hit = (e: unknown): boolean => {
    if (e instanceof UserRejectedRequestError) return true
    if (typeof e === 'object' && e !== null) {
      const code = (e as { code?: unknown }).code
      // EIP-1193: user rejected request = 4001
      if (code === UserRejectedRequestError.code || code === String(UserRejectedRequestError.code)) return true
    }
    return false
  }
  if (error instanceof BaseError) return error.walk(hit) !== null
  return hit(error)
}

/** 从错误链中找 EIP-1193 数值错误码（-32603、4902 等），拿不到返回 undefined。 */
export function extractRpcCode(error: unknown): number | undefined {
  const pick = (e: unknown): boolean => {
    if (typeof e === 'object' && e !== null) {
      const code = (e as { code?: unknown }).code
      if (typeof code === 'number') return true
    }
    return false
  }
  const found = error instanceof BaseError ? error.walk(pick) : pick(error) ? error : null
  if (found && typeof found === 'object') {
    const code = (found as { code?: unknown }).code
    if (typeof code === 'number') return code
  }
  return undefined
}
