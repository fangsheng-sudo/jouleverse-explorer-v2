// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createPublicClient, encodeFunctionResult, http, keccak256 } from 'viem'
import { createJouleverseKit, type ReadContractRequest } from '../src/integration/jouleverse-kit'
import { baselineBlock, getDeploymentBaseline } from '../src/contracts/deployment-verification'
import fixture from './fixtures/wj-runtime-code.json'

let server: Server
let endpoint: string
let methods: { method: string; params: unknown[] }[] = []
let chainId = '0xe52'
let code = fixture.code
const genesisHash = `0x${'ab'.repeat(32)}` as const
let observedGenesisHash: string = genesisHash
const height = baselineBlock.number + 1n
const totalSupplyAbi = [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const

beforeAll(async () => {
  server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const rpc = JSON.parse(body) as { id: number; method: string; params: unknown[] }
    methods.push(rpc)
    const results: Record<string, unknown> = {
      eth_chainId: chainId,
      eth_getBlockByNumber: { hash: rpc.params?.[0] === '0x0' ? observedGenesisHash : baselineBlock.hash, number: '0x82fccf', transactions: [], timestamp: '0x1' },
      eth_blockNumber: `0x${height.toString(16)}`,
      eth_getCode: code,
      eth_call: encodeFunctionResult({ abi: totalSupplyAbi, functionName: 'totalSupply', result: 42n }),
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: results[rpc.method] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  endpoint = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
beforeEach(() => { methods = []; chainId = '0xe52'; code = fixture.code; observedGenesisHash = genesisHash })

function kit(expectedGenesisHash?: `0x${string}`) {
  const client = createPublicClient({ transport: http(endpoint, { retryCount: 0 }), cacheTime: 0 })
  return createJouleverseKit({
    deploymentReader: client,
    readContract: (request: ReadContractRequest) => client.readContract(request),
  }, { expectedGenesisHash })
}

it('真实 HTTP/JSON-RPC、代码摘要核验、ABI 编解码在同一固定高度完成只读调用', async () => {
  expect(keccak256(fixture.code as `0x${string}`)).toBe(getDeploymentBaseline('0x7fba9BB966189Db8C4fE33B7bf67Bfa24203c6AD'))
  const result = await kit().readContract('wj', 'totalSupply')
  expect(result).toMatchObject({ chainId: 3666, blockNumber: height.toString(), value: 42n })
  expect(methods.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getCode', 'eth_call'])
  expect(methods[3]!.params[1]).toBe(`0x${height.toString(16)}`)
  expect(methods[4]!.params[1]).toBe(`0x${height.toString(16)}`)
  expect(methods[4]!.params[0]).toEqual({ to: result.address, data: '0x18160ddd' })
})

it('通过真实 transport 检测错误网络并在一次请求后停止', async () => {
  chainId = '0x1'
  expect((await kit().verifyContract('wj')).status).toBe('wrong-chain')
  expect(methods.map(x => x.method)).toEqual(['eth_chainId'])
})

it('代码摘要改变时拒绝合约读取，不会发出 eth_call', async () => {
  code = '0x6000'
  await expect(kit().readContract('wj', 'totalSupply')).rejects.toMatchObject({ code: 'deployment-untrusted' })
  expect(methods.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getCode'])
})

it('完整无代码响应与 JSON 可序列化核验结果', async () => {
  code = '0x'
  const result = await kit().verifyContract('wj')
  expect(JSON.parse(JSON.stringify(result))).toMatchObject({ status: 'no-code', blockNumber: height.toString(), codeHash: null })
})


it('默认 transport 同样通过完整核验，并仅请求配置中的公共 RPC', async () => {
  const nativeFetch = globalThis.fetch
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    urls.push(request.url)
    return nativeFetch(endpoint, { method: request.method, headers: request.headers,
      body: await request.text(), signal: request.signal })
  })
  try {
    expect((await createJouleverseKit().readContract('wj', 'totalSupply')).value).toBe(42n)
    expect(urls).toHaveLength(5)
    expect(urls.every(url => url === 'https://rpc.jnsdao.com/')).toBe(true)
  } finally { vi.unstubAllGlobals() }
})


it('受信创世策略进入真实读取前置检查，链 ID 只请求一次', async () => {
  expect((await kit(genesisHash).readContract('wj', 'totalSupply')).value).toBe(42n)
  expect(methods.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getCode', 'eth_call'])
  expect(methods[1]!.params).toEqual(['0x0', false])
  expect(methods[2]!.params).toEqual(['0x82fccf', false])
})

it('创世不匹配停止后续部署与合约读取', async () => {
  observedGenesisHash = '0x' + 'cd'.repeat(32)
  const client = kit(genesisHash)
  expect((await client.verifyContract('wj')).status).toBe('genesis-mismatch')
  expect(methods.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber'])
  methods = []
  await expect(client.readContract('wj', 'totalSupply')).rejects.toMatchObject({ code: 'deployment-untrusted' })
  expect(methods.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber'])
})

it('显式创世核验仅发两次请求，报告不可改写', async () => {
  const report = await kit(genesisHash).verifyNetworkIdentity()
  expect(report).toMatchObject({ status: 'verified', chainId: 3666, genesisHash })
  expect(Object.isFrozen(report)).toBe(true)
  expect(methods.map(x => x.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber'])
})
