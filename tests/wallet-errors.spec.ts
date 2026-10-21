// 钱包错误分类单测：断言判定只依赖「类型 + EIP-155 数值」，不依赖任何文案。
// 回归点：旧实现用 `msg.includes('Jouleverse 网络')` 判链不匹配，而实际抛出的
// 文案是「连接到了错误的网络 (chainId=N)」，两者不共享子串 → 必然漏判、连弹两个
// 互相矛盾的 toast。下面用例覆盖该回归。
import { describe, it, expect } from 'vitest'
import { BaseError, UserRejectedRequestError } from 'viem'
import { ChainMismatchError, isChainMismatch, isUserRejected, extractRpcCode } from '../src/utils/wallet-errors'

const CHAIN = { id: 3666, name: 'Jouleverse' }

describe('ChainMismatchError', () => {
  it('携带实际与期望 chainId 数值', () => {
    const err = new ChainMismatchError(1, CHAIN)
    expect(err.actualChainId).toBe(1)
    expect(err.expectedChainId).toBe(CHAIN.id)
    expect(err.expectedChainName).toBe(CHAIN.name)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ChainMismatchError')
  })

  it('文案变化不影响判定', () => {
    const err = new ChainMismatchError(137, CHAIN)
    err.message = '完全不同的文案'
    expect(isChainMismatch(err)).toBe(true)
    expect(err.actualChainId).toBe(137)
  })

  it('跨副本场景：仅凭 name + 数值也能判定（不依赖 instanceof）', () => {
    const alien = Object.assign(new Error('别的副本抛的'), {
      name: 'ChainMismatchError', actualChainId: 56, expectedChainId: CHAIN.id,
    })
    expect(alien instanceof ChainMismatchError).toBe(false)
    expect(isChainMismatch(alien)).toBe(true)
  })

  it('只有名字没有数值不算（防误判）', () => {
    expect(isChainMismatch(Object.assign(new Error('x'), { name: 'ChainMismatchError' }))).toBe(false)
    expect(isChainMismatch(new Error('x'))).toBe(false)
    expect(isChainMismatch(null)).toBe(false)
  })
})

describe('isUserRejected', () => {
  it('识别 viem 的 UserRejectedRequestError', () => {
    expect(isUserRejected(new UserRejectedRequestError(new Error('denied')))).toBe(true)
  })

  it('识别钱包抛的原始 EIP-1193 对象（code=4001）', () => {
    expect(isUserRejected(Object.assign(new Error('User rejected'), { code: 4001 }))).toBe(true)
    expect(isUserRejected({ code: 4001 })).toBe(true)
  })

  it('识别被 viem 包在 cause 链深处的 4001', () => {
    const wrapped = new BaseError('connect failed', {
      cause: new UserRejectedRequestError(new Error('denied')),
    })
    expect(isUserRejected(wrapped)).toBe(true)
  })

  it('普通错误 / 其他错误码不算用户拒绝', () => {
    expect(isUserRejected(new Error('boom'))).toBe(false)
    expect(isUserRejected(Object.assign(new Error('rpc'), { code: -32603 }))).toBe(false)
    expect(isUserRejected(null)).toBe(false)
    expect(isUserRejected(undefined)).toBe(false)
  })
})

describe('extractRpcCode', () => {
  it('取出 EIP-1193 数值码（含 cause 链）', () => {
    expect(extractRpcCode(Object.assign(new Error('x'), { code: 4902 }))).toBe(4902)
    const wrapped = new BaseError('outer', { cause: Object.assign(new Error('x'), { code: 4902 }) })
    expect(extractRpcCode(wrapped)).toBe(4902)
  })

  it('无 code 返回 undefined（不猜）', () => {
    expect(extractRpcCode(new Error('boom'))).toBeUndefined()
    expect(extractRpcCode('boom')).toBeUndefined()
  })
})

describe('回归：字符串守卫为什么会漏判', () => {
  it('链不匹配的错误文案不含「Jouleverse 网络」子串', () => {
    const mismatch = new ChainMismatchError(1, CHAIN)
    // 这正是旧实现 `!msg.includes('Jouleverse 网络')` 失效的根因
    expect(mismatch.message.includes('Jouleverse 网络')).toBe(false)
    // 但类型判定是可靠的
    expect(mismatch instanceof ChainMismatchError).toBe(true)
  })
})
