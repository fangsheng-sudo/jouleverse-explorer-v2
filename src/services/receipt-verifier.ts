/** 只读交易核验核心。不依赖 Vue/钱包，不读取日志范围，不轮询。 */
import { getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem'

export type RpcReadRequest =
  | { method: 'eth_chainId' | 'eth_blockNumber' }
  | { method: 'eth_getTransactionByHash' | 'eth_getTransactionReceipt'; params: [Hex] }
  | { method: 'eth_getBlockByNumber'; params: [Hex, false] }
export type RpcReader = (request: RpcReadRequest) => Promise<unknown>
export type ReceiptState = 'not-found' | 'pending' | 'success' | 'reverted'
export interface ReceiptReport {
  schema: 'jouleverse.transaction-observation/v1'
  source: { rpc: string; expectedChainId: string; observedChainId: string; observedAt: string }
  state: ReceiptState
  transactionHash: Hex
  transaction: null | { from: Address; to: Address | null; nonce: string; valueWei: string; input: Hex }
  inclusion: null | { blockNumber: string; blockHash: Hex; transactionIndex: string; observedHead: string; confirmations: string; timestampSeconds: string }
  execution: null | { status: 'success' | 'reverted'; gasUsed: string; gasPriceWei: string | null; feeWei: string | null; contractAddress: Address | null }
  logs: { address: Address; topics: Hex[]; data: Hex; logIndex: string }[]
  limitations: readonly string[]
}
export const RECEIPT_LIMITATIONS = [
  '这是单一RPC的时间点观察，不是独立区块签名或Merkle包含性证明。',
  '确认数包含交易所在区块，不代表不可逆最终确认；重组后需重新核验。',
  '回执成功只表示顶层EVM调用成功，不保证内部调用、代币支付或商业履约成功。',
  '未进行合约语义解码、收款方/金额匹配或线下证据核实；不可直接据此自动放货或结算。',
] as const

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 格式无效`)
  return value as Record<string, unknown>
}
function hex(value: unknown, bytes?: number): Hex {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (bytes !== undefined && value.length !== 2 + bytes * 2)) throw new Error('十六进制字段格式无效')
  return value.toLowerCase() as Hex
}
export function parseTransactionHash(value: string): Hex { return hex(value.trim(), 32) }
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value) || value.length > 66) throw new Error('节点数量字段无效')
  return BigInt(value)
}
function address(value: unknown): Address { return getAddress(hex(value, 20)) }
function nullableAddress(value: unknown): Address | null { return value === null ? null : address(value) }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function sameHex(a: unknown, b: Hex, bytes = 32) { return hex(a, bytes) === b }

export async function verifyReceipt(
  read: RpcReader,
  transactionHash: string,
  options: { expectedChainId: number; rpcUrl: string; now?: () => Date },
): Promise<ReceiptReport> {
  const hash = parseTransactionHash(transactionHash)
  assert(Number.isSafeInteger(options.expectedChainId) && options.expectedChainId > 0, '预期网络编号无效')
  const chainId = quantity(await read({ method: 'eth_chainId' }))
  assert(chainId === BigInt(options.expectedChainId), '节点网络编号不匹配，已停止核验')
  const [txRaw, receiptRaw] = await Promise.all([
    read({ method: 'eth_getTransactionByHash', params: [hash] }),
    read({ method: 'eth_getTransactionReceipt', params: [hash] }),
  ])
  const report: ReceiptReport = {
    schema: 'jouleverse.transaction-observation/v1',
    source: { rpc: options.rpcUrl, expectedChainId: String(options.expectedChainId), observedChainId: String(chainId), observedAt: '' },
    state: 'not-found', transactionHash: hash, transaction: null, inclusion: null, execution: null, logs: [], limitations: [...RECEIPT_LIMITATIONS],
  }
  const finish = () => { report.source.observedAt = (options.now ?? (() => new Date()))().toISOString(); return report }
  if (txRaw === null) {
    assert(receiptRaw === null, '节点交易与回执不一致，请稍后重新核验')
    return finish()
  }
  const tx = object(txRaw, '交易')
  assert(sameHex(tx.hash, hash), '节点返回了其他交易')
  if (tx.chainId != null) assert(quantity(tx.chainId) === chainId, '交易网络编号与节点不一致')
  const input = hex(tx.input)
  assert(input.length <= 524290, '调用数据超过本工具256KiB上限，未生成核验结果')
  report.transaction = { from: address(tx.from), to: nullableAddress(tx.to), nonce: String(quantity(tx.nonce)), valueWei: String(quantity(tx.value)), input }
  const txGas = quantity(tx.gas)
  if (tx.blockNumber === null) {
    assert(tx.blockHash === null && receiptRaw === null, '待打包交易与区块或回执不一致，请重新核验')
    report.state = 'pending'
    return finish()
  }
  assert(receiptRaw !== null, '交易有区块但缺失回执，暂不能核验')
  const receipt = object(receiptRaw, '回执')
  const blockNumber = quantity(receipt.blockNumber)
  const blockHash = hex(receipt.blockHash, 32)
  const index = quantity(receipt.transactionIndex)
  assert(sameHex(receipt.transactionHash, hash) && sameHex(tx.blockHash, blockHash) && quantity(tx.blockNumber) === blockNumber && quantity(tx.transactionIndex) === index, '交易与回执归属不一致，可能发生重组')
  assert(address(receipt.from) === report.transaction.from && nullableAddress(receipt.to) === report.transaction.to, '交易与回执参与地址不一致')
  const status = quantity(receipt.status)
  assert(status === 0n || status === 1n, '回执执行状态未知，不能视为成功')
  const gasUsed = quantity(receipt.gasUsed)
  assert(gasUsed <= txGas, '回执燃料用量超过交易限制')
  // 仅旧式/访问列表交易允许回退gasPrice；1559回执缺有效价格时不估算实际费率。
  const legacyPricing = tx.type == null || quantity(tx.type) <= 1n
  const price = receipt.effectiveGasPrice == null
    ? (legacyPricing && tx.gasPrice != null ? quantity(tx.gasPrice) : null)
    : quantity(receipt.effectiveGasPrice)
  const logs = receipt.logs
  assert(Array.isArray(logs) && logs.length <= 512, '回执日志缺失或超过本工具512条上限')
  let logBytes = 0
  const indexes = new Set<string>()
  report.logs = logs.map(raw => {
    const log = object(raw, '日志')
    assert(log.removed === false, '日志已移除或状态未知，请重新核验')
    assert(sameHex(log.transactionHash, hash) && sameHex(log.blockHash, blockHash) && quantity(log.blockNumber) === blockNumber && quantity(log.transactionIndex) === index, '日志不属于本次交易及区块')
    const logIndex = String(quantity(log.logIndex))
    assert(!indexes.has(logIndex), '回执存在重复日志编号')
    indexes.add(logIndex)
    assert(Array.isArray(log.topics) && log.topics.length <= 4, '日志主题格式无效')
    const data = hex(log.data)
    logBytes += (data.length - 2) / 2
    assert(logBytes <= 1_048_576, '日志数据超过本工具1MiB上限')
    return { address: address(log.address), topics: log.topics.map(t => hex(t, 32)), data, logIndex }
  })
  assert(status === 1n || report.logs.length === 0, '执行失败的回执不应保留事件日志')
  const [blockRaw, headRaw] = await Promise.all([
    read({ method: 'eth_getBlockByNumber', params: [`0x${blockNumber.toString(16)}`, false] }),
    read({ method: 'eth_blockNumber' }),
  ])
  const block = object(blockRaw, '规范链区块')
  assert(quantity(block.number) === blockNumber && sameHex(block.hash, blockHash), '该高度的规范链区块已改变，疑似重组，请重新核验')
  const head = quantity(headRaw)
  assert(head >= blockNumber, '节点最新高度落后于回执区块，暂不能核验')
  assert(Array.isArray(block.transactions) && index < BigInt(block.transactions.length) && sameHex(block.transactions[Number(index)], hash), '区块交易列表与回执编号不一致')
  report.state = status === 1n ? 'success' : 'reverted'
  report.inclusion = { blockNumber: String(blockNumber), blockHash, transactionIndex: String(index), observedHead: String(head), confirmations: String(head - blockNumber + 1n), timestampSeconds: String(quantity(block.timestamp)) }
  report.execution = { status: report.state, gasUsed: String(gasUsed), gasPriceWei: price === null ? null : String(price), feeWei: price === null ? null : String(gasUsed * price), contractAddress: nullableAddress(receipt.contractAddress) }
  return finish()
}

/** 固定字段顺序由本模块生成；摘要仅用于文件完整性比对，不是签名/真实性认证。 */
export function serializeReceiptReport(report: ReceiptReport): string {
  const payload = JSON.stringify(report)
  return JSON.stringify({ integrity: { algorithm: 'keccak256', scope: 'UTF-8 JSON.stringify(report)', digest: keccak256(stringToHex(payload)) }, report }, null, 2)
}

/** 无自动轮询、无后台重试；成功/失败均不跨调用持久化。相同hash并发去重，成功结果30秒缓存。 */
export function createReceiptVerifier(read: RpcReader, options: { expectedChainId: number; rpcUrl: string }, now = Date.now) {
  let cache: { hash: Hex; report: ReceiptReport; expires: number } | undefined
  const pending = new Map<Hex, Promise<{ report: ReceiptReport; cached: boolean }>>()
  return async (input: string): Promise<{ report: ReceiptReport; cached: boolean }> => {
    const hash = parseTransactionHash(input)
    if (cache?.hash === hash && cache.expires > now()) return { report: structuredClone(cache.report), cached: true }
    const existing = pending.get(hash)
    if (existing) return existing.then(result => ({ ...result, report: structuredClone(result.report) }))
    assert(pending.size === 0, '已有核验任务进行中，请稍候')
    const task = verifyReceipt(read, hash, { ...options, now: () => new Date(now()) }).then(report => {
      // not-found/pending 也只表示当时状态；缓存明确显示原始观察时间。
      cache = { hash, report: structuredClone(report), expires: now() + 30_000 }
      return { report, cached: false }
    }).finally(() => pending.delete(hash))
    pending.set(hash, task)
    return task
  }
}
