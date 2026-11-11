import { describe, expect, it, vi } from 'vitest'
import { createPublicClient, custom, encodeFunctionResult, encodeFunctionData } from 'viem'
import { jouleverseChain } from '../src/config/chain'
import { WJ_ADDRESS, wjABI } from '../src/contracts/wj'
import { inspectGasReplenishment, type GasReplenishmentPolicy } from '../src/integration/gas-replenishment'

const policy: GasReplenishmentPolicy = {
  sponsor: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
  triggerJ: 40n, targetJ: 100n, maxReleaseWj: 100n,
  sponsorFeeAllowanceJ: 5n, sponsorReserveJ: 10n,
}
function reader(recipientJ = 0n, sponsorJ = 15n, sponsorWj = 100n, chainId = 3666) {
  return {
    getChainId: vi.fn(async () => chainId),
    getBlockNumber: vi.fn(async () => 123n),
    getBalance: vi.fn(async ({ address }: { address: string }) => address === policy.recipient ? recipientJ : sponsorJ),
    readContract: vi.fn(async () => sponsorWj),
  }
}
describe('Jouleverse gas replenishment preflight', () => {
  it('checks an empty target and requires review even when balances meet all thresholds', async () => {
    const rpc = reader()
    expect(await inspectGasReplenishment(rpc, policy)).toMatchObject({
      status: 'review-required', chainId: 3666, blockNumber: 123n, releaseAmountWj: 100n,
      recipient: policy.recipient, sponsor: policy.sponsor, contract: WJ_ADDRESS,
    })
    expect(rpc.getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 })
    expect(rpc.getBalance.mock.calls).toEqual([
      [{ address: policy.recipient, blockNumber: 123n }],
      [{ address: policy.sponsor, blockNumber: 123n }],
    ])
    expect(rpc.readContract).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      address: WJ_ADDRESS, functionName: 'balanceOf', args: [policy.sponsor], blockNumber: 123n,
    }))
  })
  it('works with a viem client and emits only the expected read-only RPC methods', async () => {
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_chainId') return '0xe52'
      if (method === 'eth_blockNumber') return '0x7b'
      if (method === 'eth_getBalance') {
        expect(params).toEqual([expect.any(String), '0x7b'])
        return (params as string[])[0] === policy.recipient ? '0x0' : '0xf'
      }
      if (method === 'eth_call') {
        expect(params).toEqual([{
          to: WJ_ADDRESS,
          data: encodeFunctionData({ abi: wjABI, functionName: 'balanceOf', args: [policy.sponsor as `0x${string}`] }),
        }, '0x7b'])
        return encodeFunctionResult({ abi: wjABI, functionName: 'balanceOf', result: 100n })
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    const client = createPublicClient({ chain: jouleverseChain, transport: custom({ request }, { retryCount: 0 }) })
    expect(await inspectGasReplenishment(client, policy)).toMatchObject({ status: 'review-required' })
    expect(request.mock.calls.map(([{ method }]) => method).sort()).toEqual([
      'eth_blockNumber', 'eth_call', 'eth_chainId', 'eth_getBalance', 'eth_getBalance',
    ])
  })
  it('stops at the threshold and does not read sponsor balances', async () => {
    const rpc = reader(40n)
    expect(await inspectGasReplenishment(rpc, policy)).toMatchObject({ status: 'no-top-up' })
    expect(rpc.getBalance).toHaveBeenCalledTimes(1)
    expect(rpc.readContract).not.toHaveBeenCalled()
  })
  it('refuses a release over the cap instead of silently splitting it', async () => {
    const rpc = reader(10n)
    expect(await inspectGasReplenishment(rpc, { ...policy, maxReleaseWj: 89n }))
      .toMatchObject({ status: 'over-cap', releaseAmountWj: 90n })
    expect(rpc.readContract).not.toHaveBeenCalled()
  })
  it.each([
    [15n, 99n, 'insufficient-wj'],
    [14n, 100n, 'insufficient-sponsor-j'],
    [0n, 100n, 'insufficient-sponsor-j'],
  ])('separates J fee and reserve from WJ inventory (%s J, %s WJ)', async (j, wj, status) => {
    expect(await inspectGasReplenishment(reader(0n, j, wj), policy)).toMatchObject({ status })
  })
  it('fails closed for wrong network and unreadable balances', async () => {
    const wrong = reader(0n, 15n, 100n, 1)
    expect(await inspectGasReplenishment(wrong, policy)).toEqual({ status: 'wrong-chain' })
    expect(wrong.getBlockNumber).not.toHaveBeenCalled()
    const failed = reader()
    failed.readContract.mockRejectedValueOnce(new Error('RPC down'))
    expect(await inspectGasReplenishment(failed, policy)).toEqual({ status: 'unavailable' })
    expect(await inspectGasReplenishment(reader(-1n), policy)).toEqual({ status: 'unavailable' })
  })
  it.each([
    { recipient: policy.sponsor },
    { recipient: WJ_ADDRESS },
    { recipient: '0x0000000000000000000000000000000000000000' },
    { targetJ: 39n },
    { sponsorFeeAllowanceJ: 0n },
    { sponsorReserveJ: (1n << 256n) - 1n },
  ])('rejects invalid configuration before RPC (case %#)', async change => {
    const rpc = reader()
    expect(await inspectGasReplenishment(rpc, { ...policy, ...change })).toEqual({ status: 'invalid-policy' })
    expect(rpc.getChainId).not.toHaveBeenCalled()
  })
})

it('超时不继续余额读取，不响应的节点保留槽位，避免无限后台操作', async () => {
  vi.useFakeTimers()
  try {
    const rpc = reader()
    rpc.getChainId.mockImplementation(() => new Promise(() => {}))
    const attempts = [inspectGasReplenishment(rpc, policy, { timeoutMs: 10 }), inspectGasReplenishment(rpc, policy, { timeoutMs: 10 })]
    await vi.advanceTimersByTimeAsync(10)
    expect((await Promise.all(attempts)).map(x => x.status)).toEqual(['unavailable', 'unavailable'])
    expect((await inspectGasReplenishment(rpc, policy)).status).toBe('busy')
    expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
it('取消后不启动后续调用，政策快照不受异步期间修改影响', async () => {
  const controller = new AbortController()
  const rpc = reader()
  rpc.getChainId.mockImplementationOnce(async () => { controller.abort(); return 3666 })
  expect((await inspectGasReplenishment(rpc, policy, { signal: controller.signal })).status).toBe('unavailable')
  expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  const original = { ...policy }
  const second = reader()
  second.getChainId.mockImplementationOnce(async () => { original.targetJ = 1000n; return 3666 })
  expect(await inspectGasReplenishment(second, original)).toMatchObject({ releaseAmountWj: 100n })
})
it('整数越界、非法节点数据和异常均不生成可送审结果，报告可序列化', async () => {
  const { serializeGasDecision } = await import('../src/integration/gas-replenishment')
  expect(JSON.parse(serializeGasDecision(await inspectGasReplenishment(reader(), policy)))).toMatchObject({ blockNumber: '123', releaseAmountWj: '100' })
  const rpc = reader()
  rpc.getBlockNumber.mockResolvedValueOnce(-1n)
  expect((await inspectGasReplenishment(rpc, policy)).status).toBe('unavailable')
  expect((await inspectGasReplenishment(reader(), { ...policy, targetJ: 1n << 256n })).status).toBe('invalid-policy')
  expect((await inspectGasReplenishment(reader(), policy, { timeoutMs: 0 })).status).toBe('invalid-policy')
})

it('并行余额查询一快失败一挂起时仍保留任务槽位', async () => {
  vi.useFakeTimers()
  try {
    const rpc = reader()
    let hanging = 0
    const settle: ((balance: bigint) => void)[] = []
    rpc.getBalance.mockImplementation(async ({ address }) => {
      if (address === policy.recipient) return 0n
      hanging++
      return new Promise<bigint>(resolve => { settle.push(resolve) })
    })
    rpc.readContract.mockRejectedValue(new Error('failed child request'))
    const first = inspectGasReplenishment(rpc, policy, { timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect((await first).status).toBe('unavailable')
    const second = inspectGasReplenishment(rpc, policy, { timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect((await second).status).toBe('unavailable')
    expect((await inspectGasReplenishment(rpc, policy)).status).toBe('busy')
    expect(hanging).toBe(2)
    expect(rpc.readContract).toHaveBeenCalledTimes(2)
    settle.forEach(resolve => resolve(15n))
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc.readContract).toHaveBeenCalledTimes(2)
    rpc.getBalance.mockImplementation(async ({ address }) => address === policy.recipient ? 0n : 15n)
    rpc.readContract.mockResolvedValue(100n)
    expect((await inspectGasReplenishment(rpc, policy, { timeoutMs: 10 })).status).toBe('review-required')
  } finally { vi.useRealTimers() }
})
