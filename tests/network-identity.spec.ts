import { expect, it, vi } from 'vitest'
import { verifyNetworkIdentity } from '../src/integration/network-identity'

const expectedHash = `0x${'ab'.repeat(32)}` as `0x${string}`

function reader(chainId = 3666, hash: `0x${string}` | null = expectedHash) {
  return {
    getChainId: vi.fn(async () => chainId),
    getBlock: vi.fn(async () => ({ hash })),
  }
}

it('缺少受信创世配置时 fail-closed，不发请求', async () => {
  const rpc = reader()
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666 })).resolves.toEqual({ status: 'unconfigured' })
  expect(rpc.getChainId).not.toHaveBeenCalled()
})

it('链编号不符时先拒，不再请求创世区块', async () => {
  const rpc = reader(1)
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toEqual({ status: 'wrong-chain', observedChainId: 1 })
  expect(rpc.getBlock).not.toHaveBeenCalled()
})

it('链编号匹配后核验创世区块哈希', async () => {
  const rpc = reader(3666, `0x${'cd'.repeat(32)}`)
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toMatchObject({ status: 'genesis-mismatch' })
})

it('链编号与创世哈希均匹配时 verified', async () => {
  const rpc = reader()
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toEqual({ status: 'verified', chainId: 3666, genesisHash: expectedHash })
})

it('RPC 不可用时记为 unavailable，不当成匹配', async () => {
  const rpc = reader()
  rpc.getBlock.mockRejectedValueOnce(new Error('unavailable'))
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toEqual({ status: 'unavailable' })
})
