import { expect, it, vi } from 'vitest'
import { keccak256, type Hex } from 'viem'
import { baselineBlock, getDeploymentBaseline, verifyDeployment } from '../src/contracts/deployment-verification'
import { toolboxContracts } from '../src/contracts/toolbox'

const wj = toolboxContracts.find(item => item.key === 'wj')!.address
const unlisted = toolboxContracts.find(item => item.key === 'jvcore')!.address
const knownBaselineAddresses = [
  wj,
  toolboxContracts.find(item => item.key === 'jnsvote')!.address,
  toolboxContracts.find(item => item.key === 'multisig')!.address,
]
function reader(code: Hex | undefined = '0x6000', chainId = 3666, baselineHash: Hex | null = baselineBlock.hash) {
  return {
    getChainId: vi.fn(async () => chainId),
    getBlock: vi.fn(async () => ({ hash: baselineHash })),
    getBlockNumber: vi.fn(async () => 123n),
    getCode: vi.fn(async () => code),
  }
}

it('不向错误网络查询基线区块、高度或代码', async () => {
  const rpc = reader('0x6000', 1)
  expect(await verifyDeployment(wj, rpc)).toEqual({ status: 'wrong-chain' })
  expect(rpc.getBlock).not.toHaveBeenCalled()
  expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  expect(rpc.getCode).not.toHaveBeenCalled()
})

it('必须先核对固定基线区块哈希，错误时停止后续查询', async () => {
  const rpc = reader('0x6000', 3666, '0x' + '11'.repeat(32) as Hex)
  expect(await verifyDeployment(wj, rpc)).toEqual({ status: 'baseline-mismatch' })
  expect(rpc.getBlock).toHaveBeenCalledExactlyOnceWith({ blockNumber: baselineBlock.number })
  expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  expect(rpc.getCode).not.toHaveBeenCalled()
})

it('基线区块正确后才读取当前代码，并且摘要不同不得报告一致', async () => {
  const rpc = reader()
  expect(await verifyDeployment(wj, rpc)).toEqual({
    status: 'mismatch',
    blockNumber: 123n,
    codeHash: keccak256('0x6000'),
  })
  expect(rpc.getBlock).toHaveBeenCalledExactlyOnceWith({ blockNumber: baselineBlock.number })
  expect(rpc.getCode).toHaveBeenCalledExactlyOnceWith({ address: wj, blockNumber: 123n })
})

it('三个登记合约各自具有独立基线，未登记地址不获得匹配结论', async () => {
  for (const address of knownBaselineAddresses) expect(getDeploymentBaseline(address)).toBeDefined()
  expect(getDeploymentBaseline(unlisted)).toBeUndefined()
  expect((await verifyDeployment(unlisted, reader())).status).toBe('unverified')
})

it('无代码、非法代码与查询失败分别处理', async () => {
  expect((await verifyDeployment(wj, reader('0x'))).status).toBe('no-code')
  expect((await verifyDeployment(wj, reader('0x1'))).status).toBe('error')
  const rpc = reader()
  rpc.getCode.mockRejectedValueOnce(new Error('节点不可用'))
  expect((await verifyDeployment(wj, rpc)).status).toBe('error')
})
