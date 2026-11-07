import type { Address, Hash } from 'viem'

export const ANALYTICS_LIMIT = 24
export const ANALYTICS_TTL = 60_000
const CACHE_KEY = 'jv-analytics-v1-3666'

export interface AnalyticsBlock {
  number: bigint | null
  hash: Hash | null
  parentHash: Hash
  timestamp: bigint
  gasUsed: bigint
  gasLimit: bigint
  transactions: readonly (Hash | { from: Address; to: Address | null })[]
}
export interface AnalyticsClient {
  getChainId(): Promise<number>
  getBlockNumber(): Promise<bigint>
  getBlock(args: { blockNumber: bigint; includeTransactions: true }): Promise<AnalyticsBlock>
}
export interface AnalyticsSample {
  version: 1
  chainId: 3666
  fetchedAt: number
  blocks: { number: string; hash: string; timestamp: number; transactions: number; gasUsed: string; gasLimit: string }[]
  activeAddresses: number
  creations: number
  targets: { address: string; count: number }[]
}

// 有界并发；无日志查询、全链遍历或自动轮询。
export async function collectAnalytics(client: AnalyticsClient, limit = 12): Promise<AnalyticsSample> {
  if (!Number.isInteger(limit) || limit < 1 || limit > ANALYTICS_LIMIT) throw new Error('样本范围必须为1至24个区块')
  if (await client.getChainId() !== 3666) throw new Error('节点返回了错误的网络编号')
  const latest = await client.getBlockNumber()
  const count = Number(latest + 1n < BigInt(limit) ? latest + 1n : BigInt(limit))
  const blocks: AnalyticsBlock[] = new Array(count)
  let cursor = 0
  let failed = false
  await Promise.all(Array.from({ length: Math.min(3, count) }, async () => {
    while (!failed) {
      const i = cursor++
      if (i >= count) return
      try {
        const block = await client.getBlock({ blockNumber: latest - BigInt(i), includeTransactions: true })
        if (block.number !== latest - BigInt(i) || !block.hash) throw new Error('区块返回不完整，请重新加载')
        if (block.transactions.some((tx) => typeof tx === 'string')) throw new Error('节点未返回完整交易，无法统计地址')
        blocks[i] = block
      } catch (e) { failed = true; throw e }
    }
  }))
  const addresses = new Set<string>()
  const targets = new Map<string, number>()
  let creations = 0
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (i && (blocks[i - 1].parentHash !== block.hash || blocks[i - 1].timestamp < block.timestamp)) {
      throw new Error('样本区块不连续或链状态发生变化，请稍后重试')
    }
    for (const tx of block.transactions) {
      if (typeof tx === 'string') throw new Error('缺少交易明细')
      addresses.add(tx.from.toLowerCase())
      if (tx.to) {
        const to = tx.to.toLowerCase()
        addresses.add(to)
        targets.set(to, (targets.get(to) ?? 0) + 1)
      } else creations++
    }
  }
  return {
    version: 1, chainId: 3666, fetchedAt: Date.now(),
    blocks: blocks.reverse().map((b) => ({ number: String(b.number), hash: b.hash!, timestamp: Number(b.timestamp),
      transactions: b.transactions.length, gasUsed: String(b.gasUsed), gasLimit: String(b.gasLimit) })),
    activeAddresses: addresses.size, creations,
    targets: [...targets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
      .map(([address, count]) => ({ address, count })),
  }
}

export function analyticsMetrics(sample: AnalyticsSample) {
  const transactions = sample.blocks.reduce((n, b) => n + b.transactions, 0)
  const gasUsed = sample.blocks.reduce((n, b) => n + BigInt(b.gasUsed), 0n)
  const gasLimit = sample.blocks.reduce((n, b) => n + BigInt(b.gasLimit), 0n)
  const elapsed = sample.blocks.length > 1
    ? sample.blocks[sample.blocks.length - 1].timestamp - sample.blocks[0].timestamp : 0
  // 交易速率不计首个区块，分子与首尾时间间隔对应，单区块或零间隔不估算。
  const intervalTxs = transactions - (sample.blocks[0]?.transactions ?? 0)
  return { transactions, gasUsed,
    gasPercent: gasLimit > 0n ? Number(gasUsed * 10_000n / gasLimit) / 100 : null,
    secondsPerBlock: elapsed > 0 ? elapsed / (sample.blocks.length - 1) : null,
    tps: elapsed > 0 ? intervalTxs / elapsed : null,
  }
}

export function readAnalyticsCache(storage: Pick<Storage, 'getItem'>, limit: number): AnalyticsSample | null {
  try {
    const value = JSON.parse(storage.getItem(`${CACHE_KEY}-${limit}`) ?? 'null') as AnalyticsSample | null
    if (!value || value.version !== 1 || value.chainId !== 3666 || !Number.isFinite(value.fetchedAt)
      || value.fetchedAt > Date.now() || Date.now() - value.fetchedAt >= ANALYTICS_TTL
      || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > limit
      || !Number.isSafeInteger(value.activeAddresses) || value.activeAddresses < 0
      || !Number.isSafeInteger(value.creations) || value.creations < 0 || !Array.isArray(value.targets)) return null
    for (const b of value.blocks) {
      if (!/^\d+$/.test(b.number) || !/^0x[0-9a-f]{64}$/i.test(b.hash) || !Number.isSafeInteger(b.timestamp)
        || !Number.isSafeInteger(b.transactions) || b.transactions < 0 || !/^\d+$/.test(b.gasUsed)
        || !/^\d+$/.test(b.gasLimit)) return null
    }
    if (value.targets.some((t) => !/^0x[0-9a-f]{40}$/i.test(t.address) || !Number.isSafeInteger(t.count) || t.count < 0)) return null
    return value
  } catch { return null }
}
export function saveAnalyticsCache(storage: Pick<Storage, 'setItem'>, limit: number, sample: AnalyticsSample) {
  try { storage.setItem(`${CACHE_KEY}-${limit}`, JSON.stringify(sample)) } catch { /* 禁用存储不影响页面 */ }
}
