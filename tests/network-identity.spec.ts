import { expect, it, vi } from 'vitest'
import { verifyNetworkIdentity } from '../src/integration/network-identity'

const expectedHash = `0x${'ab'.repeat(32)}` as `0x${string}`

function reader(chainId = 3666, hash: `0x${string}` | null = expectedHash) {
  return {
    getChainId: vi.fn(async () => chainId),
    getBlock: vi.fn(async () => ({ hash })),
  }
}

it('fails closed when trusted genesis configuration is missing', async () => {
  const rpc = reader()
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666 })).resolves.toEqual({ status: 'unconfigured' })
  expect(rpc.getChainId).not.toHaveBeenCalled()
})

it('rejects a wrong chain before requesting the genesis block', async () => {
  const rpc = reader(1)
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toEqual({ status: 'wrong-chain', observedChainId: 1 })
  expect(rpc.getBlock).not.toHaveBeenCalled()
})

it('checks the genesis block hash after matching chain ID', async () => {
  const rpc = reader(3666, `0x${'cd'.repeat(32)}`)
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toMatchObject({ status: 'genesis-mismatch' })
})

it('verifies both chain ID and genesis hash', async () => {
  const rpc = reader()
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toEqual({ status: 'verified', chainId: 3666, genesisHash: expectedHash })
})

it('reports unavailable RPC without treating it as a match', async () => {
  const rpc = reader()
  rpc.getBlock.mockRejectedValueOnce(new Error('unavailable'))
  await expect(verifyNetworkIdentity(rpc, { chainId: 3666, genesisHash: expectedHash }))
    .resolves.toEqual({ status: 'unavailable' })
})
