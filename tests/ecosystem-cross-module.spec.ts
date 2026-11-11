// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createPublicClient, http } from 'viem'
import { startLocalReadonlyRpc } from './support/local-readonly-rpc'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { verifyReceipt } from '../src/services/receipt-verifier'
import { verifyWjPayment } from '../src/integration/wj-payment-verifier'
import { getToolboxContract } from '../src/contracts/toolbox'
import { createAgentReadGateway } from '../src/integration/agent-read-gateway'
import { receiveDelivery } from '../src/integration/delivery-inbox'
import { inspectGasReplenishment } from '../src/integration/gas-replenishment'
import { evaluateBoundServiceQuality } from '../src/integration/bound-service-quality'

let server: Awaited<ReturnType<typeof startLocalReadonlyRpc>> | undefined
afterEach(async () => { await server?.close(); server = undefined })
it('受信授权 → #3 回执 → #4 付款 → #6 去重，并记录 #9 质量，不广播交易', async () => {
  const hash = '0x' + 'ab'.repeat(32), blockHash = '0x' + 'cd'.repeat(32)
  const payer = '0x' + '11'.repeat(20), recipient = '0x' + '22'.repeat(20), token = getToolboxContract('wj')!.address
  const observedAt = Date.parse('2026-11-11T00:00:00Z')
  const rpc: Record<string, unknown> = {
    eth_chainId: '0xe52', eth_blockNumber: '0x66',
    eth_getTransactionByHash: { hash, from: payer, to: token, nonce: '0x0', value: '0x0', gas: '0x186a0', input: '0x12345678', blockNumber: '0x64', blockHash, transactionIndex: '0x0' },
    eth_getTransactionReceipt: { transactionHash: hash, from: payer, to: token, blockNumber: '0x64', blockHash, transactionIndex: '0x0', status: '0x1', gasUsed: '0x5208', contractAddress: null,
      logs: [{ address: token, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '0'.repeat(24) + payer.slice(2), '0x' + '0'.repeat(24) + recipient.slice(2)],
        data: '0x' + '5'.padStart(64, '0'), logIndex: '0x0', removed: false, transactionHash: hash, blockHash, blockNumber: '0x64', transactionIndex: '0x0' }] },
    eth_getBlockByNumber: { number: '0x64', hash: blockHash, timestamp: '0x1', transactions: [hash] },
  }
  server = await startLocalReadonlyRpc(({ method }) => rpc[method])
  const client = createPublicClient({ transport: http(server.url, { retryCount: 0 }), cacheTime: 0 })
  const kit = createJouleverseKit({ observeReceipt: input => verifyReceipt(request => client.request(request), input, { expectedChainId: 3666, rpcUrl: server!.url, now: () => new Date(observedAt) }) })
  const principal = { tenantId: 'integration', agentId: 'reader' }
  const request = { chainId: 3666, operation: 'verify-wj-payment', resource: hash } as const
  const gateway = createAgentReadGateway({ now: () => observedAt, loadGrants: async () => [{ id: 'grant', principal, chainId: 3666, state: 'active', notBeforeMs: 0, expiresAtMs: observedAt + 1000, scope: request }],
    handlers: { 'verify-wj-payment': async resource => verifyWjPayment(await kit.observeTransaction(resource), { transactionHash: hash, payer, recipient, amountAtomic: '5', minConfirmations: 3 }, { nowMs: observedAt, maxAgeMs: 1000 }) } })
  const result = await gateway(principal, request)
  expect(result).toMatchObject({ executed: true, result: { status: 'matched', confirmations: '3' } })
  const payment = 'result' in result ? result.result as { evidenceKey: string } : undefined
  const rows = new Map<string, string>()
  const store = { async record(event: { eventId: string; payload: string }) {
    if (rows.has(event.eventId)) return rows.get(event.eventId) === event.payload ? 'duplicate' as const : 'conflict' as const
    rows.set(event.eventId, event.payload); return 'inserted' as const
  } }
  const event = { source: 'payments', eventId: payment!.evidenceKey, payload: JSON.stringify(payment) }
  expect((await receiveDelivery(store, event)).reason).toBe('recorded')
  expect((await receiveDelivery(store, event)).reason).toBe('duplicate')
  const series = { serviceId: 'fixture', collectorId: 'integration', policyId: 'receipt' }
  const quality = evaluateBoundServiceQuality(series, { startMs: 0, endMs: 1, intervalMs: 1 }, { minCoverageBps: 10000, minAvailabilityBps: 10000, minObservations: 1, minLatencySamples: 1, maxP95Ms: 100 }, [{ ...series, slotMs: 0, outcome: 'success', durationMs: 1 }], 1)
  expect(quality).toMatchObject({ assessment: { status: 'within-target' } })
  expect(server.requests).toHaveLength(5)
  expect(server.requests.every(x => !/send|sign/i.test(x.method))).toBe(true)
})
it('#7 经真实 HTTP 预检缺费钱包，使用同一观察高度且不释放资金', async () => {
  const sponsor = '0x' + '11'.repeat(20), recipient = '0x' + '22'.repeat(20)
  server = await startLocalReadonlyRpc(({ method, params }) => {
    if (method === 'eth_chainId') return '0xe52'
    if (method === 'eth_blockNumber') return '0x64'
    if (method === 'eth_getBalance') return params[0] === recipient ? '0x0' : '0xf'
    if (method === 'eth_call') return '0x' + (100n).toString(16).padStart(64, '0')
    throw new Error('unexpected')
  })
  const client = createPublicClient({ transport: http(server.url, { retryCount: 0 }), cacheTime: 0 })
  expect(await inspectGasReplenishment(client, { sponsor, recipient, triggerJ: 40n, targetJ: 100n, maxReleaseWj: 100n, sponsorFeeAllowanceJ: 5n, sponsorReserveJ: 10n })).toMatchObject({ status: 'review-required', blockNumber: 100n })
  expect(server.requests.map(x => x.method).sort()).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getBalance', 'eth_call'].sort())
})
