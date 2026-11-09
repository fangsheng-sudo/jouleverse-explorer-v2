import { expect, it, vi } from 'vitest'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { toolboxContracts } from '../src/contracts/toolbox'

const baselineHash = '0xfde447d13d6c229d85cbbc64c670b0cd61d57b593b2dee91b3ef5d507d6e261f' as const

function deploymentReader() {
  return {
    getChainId: vi.fn(async () => 3666),
    getBlock: vi.fn(async () => ({ hash: baselineHash })),
    getBlockNumber: vi.fn(async () => 10n),
    getCode: vi.fn(async () => '0x' as const),
  }
}

it('creates offline and returns isolated contract snapshots', () => {
  const reader = deploymentReader()
  const kit = createJouleverseKit({ deploymentReader: reader })
  const first = kit.listContracts()
  expect(first).toHaveLength(toolboxContracts.length)
  expect(reader.getChainId).not.toHaveBeenCalled()
  expect(Object.isFrozen(kit.network)).toBe(true)
  expect(Object.isFrozen(first[0])).toBe(true)
})

it('rejects unknown contract keys before any RPC request', async () => {
  const reader = deploymentReader()
  const kit = createJouleverseKit({ deploymentReader: reader })
  await expect(kit.verifyContract('not-registered')).rejects.toMatchObject({ code: 'unknown-contract' })
  expect(reader.getChainId).not.toHaveBeenCalled()
})

it('returns JSON-serializable deployment observations after baseline verification', async () => {
  const reader = deploymentReader()
  const kit = createJouleverseKit({ deploymentReader: reader })
  const result = await kit.verifyContract('wj')
  expect(JSON.parse(JSON.stringify(result))).toMatchObject({
    contract: { key: 'wj', chainId: 3666 },
    status: 'no-code',
    blockNumber: '10',
  })
  expect(reader.getBlock).toHaveBeenCalledWith({ blockNumber: 0x82fccfn })
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
