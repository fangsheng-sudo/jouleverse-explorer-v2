import { expect, it, vi } from 'vitest'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { toolboxContracts } from '../src/contracts/toolbox'

it('creates offline and returns isolated contract snapshots', () => {
  const getChainId = vi.fn(async () => 3666)
  const kit = createJouleverseKit({
    deploymentReader: {
      getChainId,
      getBlockNumber: async () => 10n,
      getCode: async () => '0x',
    },
  })
  const first = kit.listContracts()
  expect(first).toHaveLength(toolboxContracts.length)
  expect(getChainId).not.toHaveBeenCalled()
  expect(Object.isFrozen(kit.network)).toBe(true)
  expect(Object.isFrozen(first[0])).toBe(true)
})

it('rejects unknown contract keys before any RPC request', async () => {
  const getChainId = vi.fn(async () => 3666)
  const kit = createJouleverseKit({
    deploymentReader: {
      getChainId,
      getBlockNumber: async () => 10n,
      getCode: async () => '0x',
    },
  })
  await expect(kit.verifyContract('not-registered')).rejects.toMatchObject({ code: 'unknown-contract' })
  expect(getChainId).not.toHaveBeenCalled()
})

it('returns JSON-serializable deployment observations', async () => {
  const kit = createJouleverseKit({
    deploymentReader: {
      getChainId: async () => 3666,
      getBlockNumber: async () => 10n,
      getCode: async () => '0x',
    },
  })
  const result = await kit.verifyContract('wj')
  expect(JSON.parse(JSON.stringify(result))).toMatchObject({
    contract: { key: 'wj', chainId: 3666 },
    status: 'no-code',
    blockNumber: '10',
  })
})

it('validates transaction hashes before delegating to trusted adapters', async () => {
  const observeReceipt = vi.fn(async (hash: `0x${string}`) => ({ hash }))
  const kit = createJouleverseKit({ observeReceipt })
  await expect(kit.observeTransaction('0x1234')).rejects.toMatchObject({ code: 'invalid-transaction-hash' })
  expect(observeReceipt).not.toHaveBeenCalled()
  await expect(kit.observeTransaction(`0x${'AB'.repeat(32)}`)).resolves.toEqual({
    hash: `0x${'ab'.repeat(32)}`,
  })
})

it('fails closed when optional adapters are absent', async () => {
  const kit = createJouleverseKit()
  expect(kit.capabilities).toEqual({ deployment: true, readiness: false, receipt: false })
  await expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'adapter-unavailable' })
  await expect(kit.observeTransaction(`0x${'12'.repeat(32)}`)).rejects.toMatchObject({ code: 'adapter-unavailable' })
})
