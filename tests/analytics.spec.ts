import { describe, it, expect, vi } from 'vitest'
import { analyticsMetrics, collectAnalytics, readAnalyticsCache, saveAnalyticsCache, ANALYTICS_TTL, type AnalyticsBlock } from '../src/utils/analytics'
import type { Address, Hash } from 'viem'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
function block(n: bigint): AnalyticsBlock {
  return { number: n, hash: hash(Number(n)), parentHash: hash(Number(n) - 1), timestamp: n * 10n,
    gasUsed: 100n, gasLimit: 1000n, transactions: [{ from: addr(1), to: addr(2) }] }
}
function client(latest = 100n) {
  return { getChainId: vi.fn(async () => 3666), getBlockNumber: vi.fn(async () => latest),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint; includeTransactions: true }) => block(blockNumber)) }
}
describe('有界链上分析', () => {
  it('只读取指定近期区块，不调用日志接口，正确去重地址与汇总', async () => {
    const rpc = client()
    const sample = await collectAnalytics(rpc, 12)
    expect(rpc.getBlock).toHaveBeenCalledTimes(12)
    expect(rpc.getBlock.mock.calls.map(([a]) => a.blockNumber).sort()).toEqual(Array.from({ length: 12 }, (_, i) => BigInt(i + 89)).sort())
    expect(sample.blocks.map((b) => b.number)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 89)))
    expect(sample.activeAddresses).toBe(2)
    expect(sample.targets).toEqual([{ address: addr(2), count: 12 }])
    expect(analyticsMetrics(sample)).toMatchObject({ transactions: 12, gasUsed: 1200n, gasPercent: 10, secondsPerBlock: 10, tps: 0.1 })
  })
  it('并发最多3个区块请求', async () => {
    const rpc = client()
    let active = 0, max = 0
    rpc.getBlock.mockImplementation(async ({ blockNumber }) => {
      active++; max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--; return block(blockNumber)
    })
    await collectAnalytics(rpc, 24)
    expect(max).toBeLessThanOrEqual(3)
  })
  it.each([0, -1, 25, 1.5, NaN])('拒绝越界样本 %s', async (size) => {
    const rpc = client()
    await expect(collectAnalytics(rpc, size)).rejects.toThrow()
    expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  })
  it('错误网络立即停止', async () => {
    const rpc = client(); rpc.getChainId.mockResolvedValue(1)
    await expect(collectAnalytics(rpc)).rejects.toThrow('网络')
    expect(rpc.getBlock).not.toHaveBeenCalled()
  })
  it('拒绝交易哈希冒充完整明细，不静默产生错误地址指标', async () => {
    const rpc = client(); rpc.getBlock.mockResolvedValue({ ...block(100n), transactions: [hash(1)] })
    await expect(collectAnalytics(rpc, 1)).rejects.toThrow('完整交易')
  })
  it('拒绝跨重组或不连续区块样本', async () => {
    const rpc = client(); rpc.getBlock.mockImplementation(async ({ blockNumber }) => ({ ...block(blockNumber), parentHash: hash(1) }))
    await expect(collectAnalytics(rpc, 2)).rejects.toThrow('不连续')
  })
  it('创世附近不请求负数区块，单区块速率未知，燃料上限0不除零', async () => {
    const rpc = client(0n)
    rpc.getBlock.mockResolvedValue({ ...block(0n), gasLimit: 0n, transactions: [] })
    const sample = await collectAnalytics(rpc)
    expect(rpc.getBlock).toHaveBeenCalledTimes(1)
    expect(analyticsMetrics(sample)).toMatchObject({ tps: null, secondsPerBlock: null, gasPercent: null, transactions: 0 })
  })
  it('合约创建不误作目标地址，活跃地址不包含空地址', async () => {
    const rpc = client(); rpc.getBlock.mockResolvedValue({ ...block(100n), transactions: [{ from: addr(1), to: null }] })
    const sample = await collectAnalytics(rpc, 1)
    expect(sample.creations).toBe(1); expect(sample.activeAddresses).toBe(1); expect(sample.targets).toEqual([])
  })
  it('任一节点读取失败则拒绝整个样本', async () => {
    const rpc = client(); rpc.getBlock.mockRejectedValue(new Error('节点中断'))
    await expect(collectAnalytics(rpc)).rejects.toThrow('节点中断')
  })
  it('缓存包含网络、范围和时效；损坏或未来缓存被忽略', async () => {
    const sample = await collectAnalytics(client(), 12)
    const memory = new Map<string, string>()
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) } }
    saveAnalyticsCache(storage, 12, sample)
    expect(readAnalyticsCache(storage, 12)).toEqual(sample)
    expect(readAnalyticsCache(storage, 24)).toBeNull()
    const key = [...memory.keys()][0]
    memory.set(key, JSON.stringify({ ...sample, fetchedAt: Date.now() - ANALYTICS_TTL }))
    expect(readAnalyticsCache(storage, 12)).toBeNull()
    memory.set(key, JSON.stringify({ ...sample, fetchedAt: Date.now() + 60_000 }))
    expect(readAnalyticsCache(storage, 12)).toBeNull()
    memory.set(key, '{bad json'); expect(readAnalyticsCache(storage, 12)).toBeNull()
    memory.set(key, JSON.stringify({ ...sample, blocks: [{ ...sample.blocks[0], gasUsed: 'bad' }] }))
    expect(readAnalyticsCache(storage, 12)).toBeNull()
  })
  it('浏览器禁用存储不影响统计交付', async () => {
    const storage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readAnalyticsCache(storage, 12)).toBeNull()
    expect(() => saveAnalyticsCache(storage, 12, {} as Awaited<ReturnType<typeof collectAnalytics>>)).not.toThrow()
  })
})
