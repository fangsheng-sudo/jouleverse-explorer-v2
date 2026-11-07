import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionData } from 'viem'
import { JNSVOTE_ADDRESS } from '../src/contracts/jnsvote'
import { createProposalABI } from '../src/contracts/jnsvoteGovernance'

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  multicall: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))

vi.mock('../src/config/client', () => ({ publicClient: mocks }))
vi.mock('../src/stores/wallet', () => ({ config: {} }))
vi.mock('wagmi/actions', () => ({
  writeContract: mocks.writeContract,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  switchChain: vi.fn(),
}))

import { useJNSVoteGovernance } from '../src/composables/useJNSVoteGovernance'

const SIGNER = '0x1111111111111111111111111111111111111111'
const OTHER_SIGNER = '0x2222222222222222222222222222222222222222'
const OTHER_TARGET = '0x3333333333333333333333333333333333333333'

type ReadCall = { functionName: string; args?: readonly unknown[] }
type StoredTx = readonly [string, bigint, string, boolean]

function proposal(id: bigint): StoredTx {
  return [JNSVOTE_ADDRESS, 0n, encodeFunctionData({
    abi: createProposalABI,
    functionName: 'createProposal',
    args: [`提案 ${id}`, 'https://example.com/proposal', 100n, 200n],
  }), false]
}

// 只模拟合约读取；编码/解码与 loadGovernance 的筛选、索引关联均使用真实实现。
function arrange(
  count: bigint,
  ids: readonly bigint[],
  transactions = new Map<bigint, StoredTx>(),
  opts: { getConfirmationsFail?: boolean; isConfirmedFail?: boolean } = {},
) {
  mocks.readContract.mockImplementation(async ({ functionName, args }: ReadCall) => {
    if (functionName === 'isOwner') return true
    if (functionName === 'getTransactionCount') return count
    if (functionName === 'getTransactionIds') return ids
    if (functionName === 'transactions') {
      const id = args?.[0] as bigint
      return transactions.get(id) ?? proposal(id)
    }
    throw new Error(`未预期的读取：${functionName}`)
  })
  mocks.multicall.mockImplementation(async ({ contracts }: { contracts: ReadCall[] }) => {
    if (contracts[0]?.functionName === 'getOwners') return [[SIGNER, OTHER_SIGNER], 2n]
    return contracts.map(({ functionName, args }) => {
      const id = args?.[0] as bigint
      if (functionName === 'transactions') {
        return { status: 'success', result: transactions.get(id) ?? proposal(id) }
      }
      if (functionName === 'isConfirmed') {
        return opts.isConfirmedFail
          ? { status: 'failure' }
          : { status: 'success', result: true }
      }
      if (functionName === 'getConfirmations') {
        return opts.getConfirmationsFail
          ? { status: 'failure' }
          : { status: 'success', result: [SIGNER, OTHER_SIGNER] }
      }
      throw new Error(`未预期的批量读取：${functionName}`)
    })
  })
}

function transactionReads(): bigint[] {
  return mocks.multicall.mock.calls.flatMap(([request]) => {
    const { contracts } = request as { contracts: ReadCall[] }
    return contracts.filter((call) => call.functionName === 'transactions').map((call) => call.args?.[0] as bigint)
  })
}

describe('治理待执行交易编号回归', () => {
  beforeEach(() => vi.resetAllMocks())

  it('保留唯一一笔 id=0 的待执行提案及其达标确认状态', async () => {
    arrange(1n, [0n])
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(transactionReads()).toEqual([0n])
    expect(governance.pendingTxs.value).toMatchObject([
      { txId: 0, title: '提案 0', executed: false, confirmed: true, confirmationCount: 2, required: 2 },
    ])
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'getTransactionIds', args: [0n, 1n, true, false],
    }))
  })

  it('混合编号时保留 id=0、列表顺序及对应的提案内容', async () => {
    arrange(3n, [0n, 9n, 1101n])
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(transactionReads()).toEqual([0n, 9n, 1101n])
    expect(governance.pendingTxs.value.map(({ txId, title }) => [txId, title])).toEqual([
      [0, '提案 0'], [9, '提案 9'], [1101, '提案 1101'],
    ])
  })

  it('返回数组超出请求数量时，只截去末尾补齐位，不误伤真实 id=0', async () => {
    // 正常请求 to=count 不应多返回；本用例验证防御截断分支。
    arrange(2n, [0n, 9n, 0n, 0n])
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(transactionReads()).toEqual([0n, 9n])
    expect(governance.pendingTxs.value.map(({ txId }) => txId)).toEqual([0, 9])
  })

  it('正常非零编号列表不变，不向合约请求原始交易总数范围', async () => {
    arrange(2n, [9n, 1101n])
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(transactionReads()).toEqual([9n, 1101n])
    expect(governance.pendingTxs.value.map(({ txId }) => txId)).toEqual([9, 1101])
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'getTransactionCount', args: [true, false],
    }))
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'getTransactionIds', args: [0n, 2n, true, false],
    }))
  })

  it('id=0 仍须通过目标地址和函数选择器检查，无关交易不混入列表', async () => {
    const zero = proposal(0n)
    arrange(3n, [0n, 9n, 11n], new Map([
      [0n, [OTHER_TARGET, 0n, zero[2], false] as StoredTx],
      [9n, [JNSVOTE_ADDRESS, 0n, '0xb760faf9', false] as StoredTx],
    ]))
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(transactionReads()).toEqual([0n, 9n, 11n])
    expect(governance.pendingTxs.value.map(({ txId }) => txId)).toEqual([11])
    const confirmationIds = mocks.multicall.mock.calls.flatMap(([request]) => {
      const { contracts } = request as { contracts: ReadCall[] }
      return contracts.filter((call) => call.functionName === 'isConfirmed').map((call) => call.args?.[0])
    })
    expect(confirmationIds).toEqual([11n])
  })

  it('pending 数为 0 时清空列表，不请求编号或交易详情', async () => {
    arrange(1n, [0n])
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)
    expect(governance.pendingTxs.value).toHaveLength(1)

    vi.resetAllMocks()
    arrange(0n, [])
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(governance.pendingTxs.value).toEqual([])
    expect(mocks.readContract.mock.calls.map(([call]) => call.functionName)).toEqual([
      'isOwner', 'getTransactionCount',
    ])
    expect(transactionReads()).toEqual([])
  })

  it('目标=JNSVote 且 selector 正确但携带 value > 0 的交易不入列表（本链不支持原生 J 转账）', async () => {
    const withValue = proposal(7n)
    arrange(3n, [7n, 8n, 9n], new Map([
      [7n, [JNSVOTE_ADDRESS, 1000000000000000000n, withValue[2], false] as StoredTx],
    ]))
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(transactionReads()).toEqual([7n, 8n, 9n])
    // 7 号携带 value>0 被过滤，仅 8、9 号（正常零值提案）进入列表
    expect(governance.pendingTxs.value.map(({ txId }) => txId)).toEqual([8, 9])
  })

  it('executeTx 对非「创建提案」类交易（value>0 或非 JNSVote 目标）直接阻断，不触发链上执行', async () => {
    const valid = proposal(5n)
    // 5 号：非 JNSVote 目标；6 号：目标对但 value>0；7 号：目标对但 selector 错误
    const badTxs = new Map<bigint, StoredTx>([
      [5n, [OTHER_TARGET, 0n, valid[2], false] as StoredTx],
      [6n, [JNSVOTE_ADDRESS, 1000000000000000000n, valid[2], false] as StoredTx],
      [7n, [JNSVOTE_ADDRESS, 0n, '0xb760faf9', false] as StoredTx],
    ])
    arrange(1n, [1n], badTxs)
    mocks.writeContract.mockResolvedValue('0xhash')
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    const governance = useJNSVoteGovernance()

    await expect(governance.executeTx(5)).rejects.toThrow('不是「创建提案」')
    await expect(governance.executeTx(6)).rejects.toThrow('不是「创建提案」')
    await expect(governance.executeTx(7)).rejects.toThrow('不是「创建提案」')
    // 三种非法交易均未触链上 executeTransaction
    expect(mocks.writeContract).not.toHaveBeenCalled()
  })

  it('executeTx 对合法「创建提案」交易正常执行', async () => {
    const valid = proposal(5n)
    arrange(1n, [1n], new Map([[5n, [JNSVOTE_ADDRESS, 0n, valid[2], false] as StoredTx]]))
    mocks.writeContract.mockResolvedValue('0xhash')
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    const governance = useJNSVoteGovernance()

    await expect(governance.executeTx(5)).resolves.toBeUndefined()
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      functionName: 'executeTransaction', args: [5n],
    }))
  })

  it('executeTx 对已执行（executed=true）的交易直接阻断，不重复触链', async () => {
    const valid = proposal(5n)
    // 目标/value/selector 都合法，但链上已 executed=true
    arrange(1n, [1n], new Map([[5n, [JNSVOTE_ADDRESS, 0n, valid[2], true] as StoredTx]]))
    mocks.writeContract.mockResolvedValue('0xhash')
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    const governance = useJNSVoteGovernance()

    await expect(governance.executeTx(5)).rejects.toThrow('已被执行')
    expect(mocks.writeContract).not.toHaveBeenCalled()
  })

  it('getConfirmations 读取失败时，交易标记为「确认状态未知」而非「零确认」', async () => {
    arrange(1n, [0n], new Map(), { getConfirmationsFail: true })
    const governance = useJNSVoteGovernance()
    await governance.loadGovernance(SIGNER)

    expect(governance.loadError.value).toBeNull()
    expect(governance.pendingTxs.value[0]).toMatchObject({
      txId: 0,
      confirmationUnknown: true,
      confirmed: false,
    })
  })
})
