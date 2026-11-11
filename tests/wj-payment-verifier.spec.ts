import { expect, it } from 'vitest'
import { getToolboxContract } from '../src/contracts/toolbox'
import { verifyWjPayment as verifyPayment, type PaymentReceiptObservation } from '../src/integration/wj-payment-verifier'

const freshness = { nowMs: Date.parse('2026-11-04T00:00:01Z'), maxAgeMs: 60000 }
const verifyWjPayment = (input: unknown, expected: Parameters<typeof verifyPayment>[1]) => verifyPayment(input, expected, freshness)

const token = getToolboxContract('wj')!.address
const hash = '0x' + 'ab'.repeat(32)
const payer = '0x' + '12'.repeat(20)
const recipient = '0x' + '34'.repeat(20)
const amount = '9007199254740993'
const expected = { transactionHash: hash, payer, recipient, amountAtomic: amount, minConfirmations: 3 }
const topicAddress = (value: string) => '0x' + '0'.repeat(24) + value.slice(2)
const log = {
  address: token,
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', topicAddress(payer), topicAddress(recipient)],
  data: '0x' + BigInt(amount).toString(16).padStart(64, '0'), logIndex: '5',
}
const observation: PaymentReceiptObservation = {
  schema: 'jouleverse.transaction-observation/v1',
  source: { expectedChainId: '3666', observedChainId: '3666', observedAt: '2026-11-04T00:00:00Z' },
  state: 'success', transactionHash: hash, execution: { status: 'success' },
  inclusion: { blockNumber: '99', blockHash: '0x' + 'cd'.repeat(32), observedHead: '101', confirmations: '3' },
  logs: [log],
}

it('精确比对大额整数、确认边界及证据键', () => {
  const result = verifyWjPayment(observation, expected)
  expect(JSON.parse(JSON.stringify(result))).toMatchObject({ status: 'matched', confirmations: '3', amountAtomic: amount, evidenceKey: '3666:' + hash + ':5' })
  expect(verifyWjPayment(observation, { ...expected, minConfirmations: 4 }).status).toBe('insufficient-confirmations')
})
it.each([
  { address: recipient },
  { topics: [log.topics[0]!, topicAddress(recipient), topicAddress(recipient)] },
  { topics: [log.topics[0]!, topicAddress(payer), topicAddress(payer)] },
  { topics: [log.topics[0]!, topicAddress('0x' + '00'.repeat(20)), topicAddress(recipient)] },
  { data: '0x' + (BigInt(amount) + 1n).toString(16).padStart(64, '0') },
])('错代币、错地址、铸币或错金额不能通过：%o', change => {
  expect(verifyWjPayment({ ...observation, logs: [{ ...log, ...change }] }, expected).status).toBe('no-match')
})
it('同一交易多个匹配日志不能自动选取，明确编号后才能定位', () => {
  const multiple = { ...observation, logs: [log, { ...log, logIndex: '6' }] }
  expect(verifyWjPayment(multiple, expected).status).toBe('ambiguous')
  expect(verifyWjPayment(multiple, { ...expected, logIndex: '6' })).toMatchObject({ status: 'matched', logIndex: '6' })
  expect(verifyWjPayment({ ...observation, logs: [log, log] }, expected).status).toBe('invalid-observation')
})
it('拒绝错链、错交易、异常事件与确认数不一致', () => {
  expect(verifyWjPayment({ ...observation, source: { ...observation.source, observedChainId: '1' } }, expected).status).toBe('wrong-chain')
  expect(verifyWjPayment({ ...observation, transactionHash: '0x' + '00'.repeat(32) }, expected).status).toBe('invalid-observation')
  expect(verifyWjPayment({ ...observation, logs: [{ ...log, data: '0x01' }] }, expected).status).toBe('invalid-observation')
  expect(verifyWjPayment({ ...observation, inclusion: { ...observation.inclusion!, confirmations: '999' } }, expected).status).toBe('invalid-observation')
})
it.each(['pending', 'not-found', 'reverted'] as const)('%s 不得生成付款证据', state => {
  expect(verifyWjPayment({ ...observation, state, logs: [], inclusion: null, execution: null }, expected)).toEqual({ status: state })
})
it('拒绝零金额、浮点金额、自转和零确认策略', () => {
  for (const change of [{ amountAtomic: '0' }, { amountAtomic: '0.1' }, { recipient: payer }, { minConfirmations: 0 }]) {
    expect(() => verifyWjPayment(observation, { ...expected, ...change })).toThrow()
  }
})


it('未知结构、伪造状态、无效时间及过期观察不产生匹配', () => {
  for (const input of [null, {}, { ...observation, logs: null }, { ...observation, state: 'matched' },
    { ...observation, source: null }, { ...observation, logs: [null] },
    { ...observation, source: { ...observation.source, observedAt: 'invalid' } }]) {
    expect(verifyWjPayment(input, expected).status).toBe('invalid-observation')
  }
  expect(verifyPayment(observation, expected, { ...freshness, nowMs: freshness.nowMs + 60000 }).status).toBe('stale-observation')
  expect(verifyPayment(observation, expected, { ...freshness, nowMs: freshness.nowMs - 2000 }).status).toBe('invalid-observation')
  expect(verifyPayment(observation, expected, { ...freshness, nowMs: freshness.nowMs + 59000 }).status).toBe('matched')
})
it('重组后确认数、交易和区块证据必须重新匹配', () => {
  expect(verifyWjPayment({ ...observation, inclusion: { ...observation.inclusion!, observedHead: '98' } }, expected).status).toBe('invalid-observation')
  expect(verifyWjPayment({ ...observation, logs: Array(513).fill(log) }, expected).status).toBe('invalid-observation')
  expect(() => verifyWjPayment(observation, { ...expected, amountAtomic: 1 as never })).toThrow()
})

it('通过实际回执核心核对交易、日志、规范区块和确认数后匹配付款，重组时拒绝', async () => {
  const { verifyReceipt } = await import('../src/services/receipt-verifier')
  const blockHash = observation.inclusion!.blockHash
  const from = payer, to = token
  const data: Record<string, unknown> = {
    eth_chainId: '0xe52', eth_blockNumber: '0x65',
    eth_getTransactionByHash: { hash, from, to, nonce: '0x0', value: '0x0', gas: '0x186a0', input: '0x12345678',
      blockNumber: '0x63', blockHash, transactionIndex: '0x0', chainId: '0xe52' },
    eth_getTransactionReceipt: { transactionHash: hash, from, to, blockNumber: '0x63', blockHash, transactionIndex: '0x0',
      status: '0x1', gasUsed: '0x5208', contractAddress: null, logs: [{ ...log, logIndex: '0x5',
        removed: false, transactionHash: hash, blockHash, blockNumber: '0x63', transactionIndex: '0x0' }] },
    eth_getBlockByNumber: { number: '0x63', hash: blockHash, timestamp: '0x1', transactions: [hash] },
  }
  const calls: string[] = []
  const read = async ({ method }: { method: string }) => { calls.push(method); return structuredClone(data[method]) }
  const options = { expectedChainId: 3666, rpcUrl: 'fixture', now: () => new Date(freshness.nowMs) }
  expect(verifyPayment(await verifyReceipt(read, hash, options), expected, freshness).status).toBe('matched')
  expect(calls).toHaveLength(5)
  data.eth_getBlockByNumber = { number: '0x63', hash: '0x' + 'ef'.repeat(32), timestamp: '0x1', transactions: [hash] }
  await expect(verifyReceipt(read, hash, options)).rejects.toThrow('重组')
})
