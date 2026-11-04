import { expect, it, vi } from 'vitest'
import { keccak256, type Hex } from 'viem'
import { getDeploymentBaseline, verifyDeployment } from '../src/contracts/deployment-verification'
import { toolboxContracts } from '../src/contracts/toolbox'

const wj = toolboxContracts.find(item => item.key === 'wj')!.address
const unlisted = toolboxContracts.find(item => item.key === 'jvcore')!.address
function reader(code: Hex | undefined = '0x6000', chainId = 3666) {
  return { getChainId: vi.fn(async () => chainId), getBlockNumber: vi.fn(async () => 123n), getCode: vi.fn(async () => code) }
}

it('不向错误网络查询高度或代码', async () => {
  const rpc = reader('0x6000', 1)
  expect(await verifyDeployment(wj, rpc)).toEqual({ status: 'wrong-chain' })
  expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  expect(rpc.getCode).not.toHaveBeenCalled()
})
it('只读指定地址和区块，摘要不同不得报告一致', async () => {
  const rpc = reader()
  expect(await verifyDeployment(wj, rpc)).toEqual({ status: 'mismatch', blockNumber: 123n, codeHash: keccak256('0x6000') })
  expect(rpc.getCode).toHaveBeenCalledExactlyOnceWith({ address: wj, blockNumber: 123n })
  expect(getDeploymentBaseline(wj)).toBeDefined()
})
it('无基线、无代码与查询失败分别处理', async () => {
  expect((await verifyDeployment(unlisted, reader())).status).toBe('unverified')
  expect((await verifyDeployment(wj, reader('0x'))).status).toBe('no-code')
  expect((await verifyDeployment(wj, reader('0x1'))).status).toBe('error')
  const rpc = reader()
  rpc.getCode.mockRejectedValueOnce(new Error('节点不可用'))
  expect((await verifyDeployment(wj, rpc)).status).toBe('error')
})
