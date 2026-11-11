// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createPublicClient, http, keccak256, encodeFunctionResult } from 'viem'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { jouleverseChain } from '../src/config/chain'
import { startLocalReadonlyRpc, type LocalRpcRequest } from './support/local-readonly-rpc'

import { baselineBlock } from '../src/contracts/deployment-verification'
import codeFixture from './fixtures/wj-runtime-code.json'
const height = baselineBlock.number + 1n

let server: Awaited<ReturnType<typeof startLocalReadonlyRpc>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function setup(options: { chainId?: string; failCode?: boolean; empty?: boolean; match?: boolean } = {}) {
  server = await startLocalReadonlyRpc(({ method, params }: LocalRpcRequest) => {
    if (method === 'eth_chainId') return options.chainId ?? `0x${jouleverseChain.id.toString(16)}`
    if (method === 'eth_getBlockByNumber') return { hash: baselineBlock.hash, number: params[0], transactions: [] }
    if (method === 'eth_blockNumber') return `0x${height.toString(16)}`
    if (method === 'eth_call') return encodeFunctionResult({ abi: [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }], functionName: 'totalSupply', result: 42n })
    if (method === 'eth_getCode' && !options.failCode) return options.empty ? '0x' : options.match ? codeFixture.code : '0x6000'
    throw new Error('模拟节点异常')
  })
  const reader = createPublicClient({
    chain: jouleverseChain, transport: http(server.url, { retryCount: 0, timeout: 2000 }), cacheTime: 0,
  })
  return { kit: createJouleverseKit({ deploymentReader: reader, readContract: request => reader.readContract(request) }), rpc: server }
}

it('真实 HTTP 传输：目录不请求节点，核验绑定合约地址及区块', async () => {
  const { kit, rpc } = await setup()
  const contract = kit.listContracts().find(item => item.key === 'wj')!
  expect(rpc.requests).toEqual([])
  expect(await kit.verifyContract('wj')).toMatchObject({
    status: 'mismatch', blockNumber: height.toString(), codeHash: keccak256('0x6000'),
  })
  expect(rpc.requests).toEqual([
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: [`0x${baselineBlock.number.toString(16)}`, false] },
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_getCode', params: [contract.address, `0x${height.toString(16)}`] },
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


it('完整读取路径经本地 HTTP/ABI 解码且仅发白名单方法', async () => {
  const { kit, rpc } = await setup({ match: true })
  expect((await kit.readContract('wj', 'totalSupply')).value).toBe(42n)
  expect(rpc.requests.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getCode', 'eth_call'])
  expect(rpc.requests.at(-1)!.params[1]).toBe(`0x${height.toString(16)}`)
})

it('畸形协议、批量请求、超大正文和写方法不进入响应适配器', async () => {
  let called = 0
  server = await startLocalReadonlyRpc(() => { called++; return '0x1' })
  const post = (body: string) => fetch(server!.url, { method: 'POST', body })
  expect(await (await post('{')).json()).toMatchObject({ error: { code: -32700 } })
  expect(await (await post('[]')).json()).toMatchObject({ error: { code: -32600 } })
  expect((await post('中'.repeat(6000))).status).toBe(413)
  expect(await (await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'personal_sign' }))).json())
    .toMatchObject({ error: { code: -32601 } })
  expect(called).toBe(0)
})

it('异步响应会等待，挂起与异常被截止并脱敏，关闭操作幂等', async () => {
  server = await startLocalReadonlyRpc(async ({ method }) => {
    if (method === 'eth_chainId') return '0xe52'
    if (method === 'eth_blockNumber') return new Promise(() => {})
    throw new Error('private node detail')
  }, { responseTimeoutMs: 20 })
  const post = (method: string) => fetch(server!.url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) }).then(x => x.json())
  expect(await post('eth_chainId')).toMatchObject({ result: '0xe52' })
  expect(await post('eth_blockNumber')).toMatchObject({ error: { code: -32000, message: 'fixture-unavailable' } })
  expect(JSON.stringify(await post('eth_getCode'))).not.toContain('private')
  await server.close(); await server.close()
})

it('手续费预检可复用余额只读方法，不需打开写接口', async () => {
  server = await startLocalReadonlyRpc(({ method }) => {
    if (method === 'eth_getBalance') return '0x2'
    throw new Error('unexpected')
  })
  const client = createPublicClient({ transport: http(server.url, { retryCount: 0 }) })
  expect(await client.getBalance({ address: '0x1111111111111111111111111111111111111111', blockNumber: 100n })).toBe(2n)
  expect(server.requests).toEqual([{ method: 'eth_getBalance', params: ['0x1111111111111111111111111111111111111111', '0x64'] }])
})
