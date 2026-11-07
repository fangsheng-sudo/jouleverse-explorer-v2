import { encodeFunctionData, keccak256, type Hex } from 'viem'

export interface ReadinessProfile {
  schema: 'jouleverse.integration-profile/v1'
  chainId: number
  name: string
  rpcUrl: string
  explorerUrl: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  multicall3: Hex
  expectedGenesisHash?: Hex
}
export type ProbeRequest =
  | { method: 'eth_chainId' | 'web3_clientVersion' | 'eth_blockNumber' | 'eth_gasPrice' }
  | { method: 'eth_getBlockByNumber'; params: [Hex, false] }
  | { method: 'eth_getCode'; params: [Hex, Hex] }
  | { method: 'eth_call'; params: [{ to: Hex; data: Hex }, Hex] }
export type ProbeReader = (request: ProbeRequest) => Promise<unknown>
export interface ProbeCheck { key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface ReadinessReport {
  schema: 'jouleverse.integration-observation/v1'
  profile: ReadinessProfile
  observedAt: string
  result: 'observed' | 'blocked'
  requestCount: number
  observedHead: string
  genesisHash: Hex | null
  headHash: Hex | null
  baseFeePerGasWei: string | null
  gasPriceWei: string | null
  multicallCodeHash: Hex | null
  checks: ProbeCheck[]
  limitations: string[]
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('区块对象无效')
  return value as Record<string, unknown>
}
function qty(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value) || value.length > 66) throw new Error('数量字段无效')
  return BigInt(value)
}
function bytes(value: unknown, count?: number): Hex {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (count !== undefined && value.length !== count * 2 + 2)) throw new Error('字节字段无效')
  return value.toLowerCase() as Hex
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const chainIdAbi = [{ type: 'function', name: 'getChainId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const

/** 整轮最多8个请求、并发至多2；没有自动重试或轮询。 */
export async function probeNetwork(read: ProbeReader, profile: ReadinessProfile, now = () => new Date()): Promise<ReadinessReport> {
  profile = structuredClone(profile)
  check(profile.schema === 'jouleverse.integration-profile/v1' && Number.isSafeInteger(profile.chainId) && profile.chainId > 0, '接入清单网络编号无效')
  bytes(profile.multicall3, 20)
  if (profile.expectedGenesisHash !== undefined) bytes(profile.expectedGenesisHash, 32)
  let requestCount = 0
  const request = async (req: ProbeRequest) => { requestCount++; return read(req) }
  const chainId = qty(await request({ method: 'eth_chainId' }))
  check(chainId === BigInt(profile.chainId), '网络编号不匹配，停止检测')
  // 先确定固定高度；其他可选能力失败独立记录，不能当作支持。
  const [headResult, clientResult] = await Promise.allSettled([
    request({ method: 'eth_blockNumber' }), request({ method: 'web3_clientVersion' }),
  ])
  if (headResult.status === 'rejected') throw new Error('无法取得最新区块高度，停止检测')
  const head = qty(headResult.value)
  const headTag = `0x${head.toString(16)}` as Hex
  const report: ReadinessReport = {
    schema: 'jouleverse.integration-observation/v1', profile: structuredClone(profile), observedAt: '', result: 'observed', requestCount: 0,
    observedHead: String(head), genesisHash: null, headHash: null, baseFeePerGasWei: null, gasPriceWei: null, multicallCodeHash: null,
    checks: [{ key: 'chainId', label: '网络编号', status: 'pass', detail: String(chainId) }],
    limitations: [
      '单一RPC（节点接口）时间点观察，不独立验证共识、区块签名或节点运营者。',
      '未配置可信创世哈希时只记录节点声称的创世区块，不构成独立网络身份认证。',
      '不验证写交易、钱包、WebSocket（长连接）、历史回执、事件流或完整FireFly（萤火虫）兼容性。',
      'gasPrice（建议燃料价格）是节点建议值，不是最终手续费报价；baseFee（基础费用）存在也不等于完整费用政策已确认。',
      '多调用仅检查代码存在及getChainId（读取网络编号）接口，不保证全部ABI（合约接口）语义或部署来源。',
      '瞬时检测不是在线率/服务等级承诺，不自动轮询；观察时间来自本地时钟。',
    ],
  }
  const add = (key: string, label: string, status: ProbeCheck['status'], detail: string) => report.checks.push({ key, label, status, detail })
  if (clientResult.status === 'fulfilled' && typeof clientResult.value === 'string' && clientResult.value.length > 0 && clientResult.value.length < 512) add('client', '节点自报版本', 'pass', clientResult.value)
  else add('client', '节点自报版本', 'warn', '版本接口失败或返回格式无效；未据此推断EVM兼容性')
  const jobs: (() => Promise<void>)[] = [
    async () => {
      try {
        const block = record(await request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }))
        check(qty(block.number) === 0n, '返回的不是创世区块')
        report.genesisHash = bytes(block.hash, 32)
        if (profile.expectedGenesisHash) {
          check(report.genesisHash === profile.expectedGenesisHash.toLowerCase(), '创世哈希与预设锚点不一致')
          add('genesis', '创世区块锚点', 'pass', report.genesisHash)
        } else add('genesis', '创世区块锚点', 'warn', `${report.genesisHash}；未配置官方确认的预期哈希，仅作观察`)
      } catch (error) { add('genesis', '创世区块锚点', 'fail', error instanceof Error ? error.message : '读取失败') }
    },
    async () => {
      try {
        const block = record(await request({ method: 'eth_getBlockByNumber', params: [headTag, false] }))
        check(qty(block.number) === head, '区块高度不匹配')
        report.headHash = bytes(block.hash, 32)
        qty(block.timestamp)
        if (block.baseFeePerGas != null) report.baseFeePerGasWei = String(qty(block.baseFeePerGas))
        add('block', '固定高度区块读取', 'pass', `${head} / ${report.headHash}`)
      } catch (error) { add('block', '固定高度区块读取', 'fail', error instanceof Error ? error.message : '读取失败') }
    },
    async () => {
      try { report.gasPriceWei = String(qty(await request({ method: 'eth_gasPrice' }))); add('gas', '节点建议燃料价格', 'pass', `${report.gasPriceWei} 最小单位；不是最终报价`) }
      catch { add('gas', '节点建议燃料价格', 'warn', '查询失败或返回格式无效，未以0替代') }
    },
    async () => {
      try {
        const code = bytes(await request({ method: 'eth_getCode', params: [profile.multicall3, headTag] }))
        check(code !== '0x' && code.length <= 262146, '代码为空或超过128KiB上限')
        report.multicallCodeHash = keccak256(code)
        add('multicallCode', '多调用地址代码', 'pass', `代码摘要 ${report.multicallCodeHash}；未验证部署来源`)
      } catch (error) { add('multicallCode', '多调用地址代码', 'fail', error instanceof Error ? error.message : '读取失败') }
    },
  ]
  let cursor = 0
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < jobs.length) await jobs[cursor++]!()
  }))
  if (report.multicallCodeHash && report.headHash) {
    try {
      const value = bytes(await request({ method: 'eth_call', params: [{ to: profile.multicall3, data: encodeFunctionData({ abi: chainIdAbi, functionName: 'getChainId' }) }, headTag] }), 32)
      check(BigInt(value) === chainId, 'getChainId结果不匹配')
      add('multicallCall', '多调用只读接口', 'pass', `getChainId（读取网络编号） = ${chainId}`)
    } catch (error) { add('multicallCall', '多调用只读接口', 'fail', error instanceof Error ? error.message : '读取失败') }
  } else add('multicallCall', '多调用只读接口', 'warn', '前置代码或区块检查失败，未调用')
  const order = ['chainId','client','genesis','block','gas','multicallCode','multicallCall']
  report.checks.sort((a,b) => order.indexOf(a.key) - order.indexOf(b.key))
  report.result = report.checks.some(c => c.status === 'fail') ? 'blocked' : 'observed'
  report.requestCount = requestCount
  report.observedAt = now().toISOString()
  return report
}

export function createNetworkProbe(read: ProbeReader, profile: ReadinessProfile, now = Date.now) {
  let cached: { report: ReadinessReport; expires: number } | undefined
  let pending: Promise<{ report: ReadinessReport; cached: boolean }> | undefined
  const fixedProfile = structuredClone(profile)
  return async () => {
    if (cached && now() < cached.expires) return { report: structuredClone(cached.report), cached: true }
    if (pending) return pending.then(r => ({ ...r, report: structuredClone(r.report) }))
    pending = probeNetwork(read, fixedProfile, () => new Date(now())).then(report => {
      // 有fail的结果不缓存；warn是明确披露的部分观测。
      if (report.result !== 'blocked') cached = { report: structuredClone(report), expires: now() + 60_000 }
      return { report, cached: false }
    }).finally(() => { pending = undefined })
    return pending
  }
}
