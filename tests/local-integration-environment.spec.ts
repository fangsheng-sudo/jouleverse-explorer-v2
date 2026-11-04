// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createPublicClient, http, keccak256 } from 'viem'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { jouleverseChain } from '../src/config/chain'
import { startLocalReadonlyRpc, type LocalRpcRequest } from './support/local-readonly-rpc'

let server: Awaited<ReturnType<typeof startLocalReadonlyRpc>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function setup(options: { chainId?: string; failCode?: boolean; empty?: boolean } = {}) {
  server = await startLocalReadonlyRpc(({ method }: LocalRpcRequest) => {
    if (method === 'eth_chainId') return options.chainId ?? `0x${jouleverseChain.id.toString(16)}`
    if (method === 'eth_blockNumber') return '0x64'
    if (method === 'eth_getCode' && !options.failCode) return options.empty ? '0x' : '0x6000'
    throw new Error('模拟节点异常')
  })
  const reader = createPublicClient({
    chain: jouleverseChain, transport: http(server.url, { retryCount: 0, timeout: 2000 }), cacheTime: 0,
  })
  return { kit: createJouleverseKit({ deploymentReader: reader }), rpc: server }
}

it('真实 HTTP 传输：目录不请求节点，核验绑定合约地址及区块', async () => {
  const { kit, rpc } = await setup()
  const contract = kit.listContracts().find(item => item.key === 'wj')!
  expect(rpc.requests).toEqual([])
  expect(await kit.verifyContract('wj')).toMatchObject({
    status: 'mismatch', blockNumber: '100', codeHash: keccak256('0x6000'),
  })
  expect(rpc.requests).toEqual([
    { method: 'eth_chainId', params: [] },
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_getCode', params: [contract.address, '0x64'] },
  ])
})
it('网络不符时只查网络编号', async () => {
  const { kit, rpc } = await setup({ chainId: '0x1' })
  expect((await kit.verifyContract('wj')).status).toBe('wrong-chain')
  expect(rpc.requests.map(item => item.method)).toEqual(['eth_chainId'])
})
it('无代码与节点异常各自返回明确状态，节点异常不重试', async () => {
  const empty = await setup({ empty: true })
  expect((await empty.kit.verifyContract('wj')).status).toBe('no-code')
  await empty.rpc.close()
  server = undefined
  const failing = await setup({ failCode: true })
  expect((await failing.kit.verifyContract('wj')).status).toBe('error')
  expect(failing.rpc.requests.filter(item => item.method === 'eth_getCode')).toHaveLength(1)
})
it('测试服务拒绝发送交易且不会转发', async () => {
  const { rpc } = await setup()
  const response = await fetch(rpc.url, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x'] }),
  })
  expect(await response.json()).toMatchObject({ id: 1, error: { code: -32601 } })
})
