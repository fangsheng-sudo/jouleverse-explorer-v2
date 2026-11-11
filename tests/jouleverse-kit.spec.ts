import { expect, it, vi } from 'vitest'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { toolboxContracts } from '../src/contracts/toolbox'
import { baselineBlock } from '../src/contracts/deployment-verification'

it('创建和读取目录不联网，快照为不可变隔离副本', () => {
  const getChainId = vi.fn(async () => 3666)
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId, getBlockNumber: async () => 10n, getCode: async () => '0x', getBlock: async () => ({ hash: baselineBlock.hash }),
  } })
  const list = kit.listContracts()
  expect(list).toHaveLength(toolboxContracts.length)
  expect(Object.isFrozen(list[0])).toBe(true)
  expect(Object.isFrozen(kit.network)).toBe(true)
  expect(getChainId).not.toHaveBeenCalled()
})
it('仅核验登记地址，结果可直接序列化', async () => {
  const getCode = vi.fn(async () => '0x' as const)
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId: async () => 3666, getBlockNumber: async () => 10n, getCode, getBlock: async () => ({ hash: baselineBlock.hash }),
  } })
  await expect(kit.verifyContract('unknown')).rejects.toMatchObject({ code: 'unknown-contract' })
  expect(getCode).not.toHaveBeenCalled()
  const report = await kit.verifyContract('wj')
  expect(getCode).toHaveBeenCalledExactlyOnceWith({ address: toolboxContracts.find(x => x.key === 'wj')!.address, blockNumber: 10n })
  expect(JSON.parse(JSON.stringify(report))).toMatchObject({ status: 'no-code', blockNumber: '10' })
})
it('未配置适配器时明确拒绝', async () => {
  const kit = createJouleverseKit()
  expect(kit.capabilities).toMatchObject({ readiness: false, receipt: false })
  await expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'adapter-unavailable' })
  await expect(kit.observeTransaction('0x' + '12'.repeat(32))).rejects.toMatchObject({ code: 'adapter-unavailable' })
})
it('委托既有适配器并保留执行结果，不把执行成功改写成付款成功', async () => {
  const readiness = { checks: ['sample'] }
  const checkReadiness = vi.fn(async () => readiness)
  const result = { report: { state: 'success' }, cached: false }
  const observeReceipt = vi.fn(async () => result)
  const kit = createJouleverseKit({ checkReadiness, observeReceipt })
  await expect(kit.observeTransaction('0x1234')).rejects.toMatchObject({ code: 'invalid-transaction-hash' })
  expect(observeReceipt).not.toHaveBeenCalled()
  expect(await kit.checkReadiness()).toBe(readiness)
  expect(await kit.observeTransaction('0x' + 'AB'.repeat(32))).toBe(result)
  expect(observeReceipt).toHaveBeenCalledExactlyOnceWith('0x' + 'ab'.repeat(32))
})
