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
