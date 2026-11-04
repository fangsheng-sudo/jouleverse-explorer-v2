import { expect, it } from 'vitest'
import { getToolboxContract } from '../src/contracts/toolbox'
import { verifyWjPayment, type PaymentReceiptObservation } from '../src/integration/wj-payment-verifier'

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
