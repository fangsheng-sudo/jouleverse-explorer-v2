import { keccak256, stringToHex } from 'viem'
import { jouleverseChain } from '../config/chain'
import { getToolboxContract } from '../contracts/toolbox'

const transferTopic = keccak256(stringToHex('Transfer(address,address,uint256)'))
const word = /^0x[\da-f]{64}$/i
const address = /^0x[\da-f]{40}$/i
const indexedAddress = /^0x0{24}[\da-f]{40}$/i
const uint = /^(0|[1-9][0-9]{0,77})$/
const maxUint = (1n << 256n) - 1n

/** Subset of the existing receipt verifier report. Accept only from a trusted adapter. */
export interface PaymentReceiptObservation {
  schema: 'jouleverse.transaction-observation/v1'
  source: { expectedChainId: string; observedChainId: string; observedAt: string }
  state: 'not-found' | 'pending' | 'success' | 'reverted'
  transactionHash: string
  inclusion: null | { blockNumber: string; blockHash: string; observedHead: string; confirmations: string }
  execution: null | { status: 'success' | 'reverted' }
  logs: readonly { address: string; topics: readonly string[]; data: string; logIndex: string }[]
}

export interface WjPaymentExpectation {
  transactionHash: string
  payer: string
  recipient: string
  amountAtomic: string
  minConfirmations: number
  logIndex?: string
}

export type WjPaymentResult =
  | { status: 'wrong-chain' | 'invalid-observation' | 'not-found' | 'pending' | 'reverted' | 'no-match' | 'ambiguous' | 'stale-observation' }
  | {
    status: 'matched' | 'insufficient-confirmations'
    chainId: number
    token: string
    transactionHash: string
    logIndex: string
    evidenceKey: string
    blockNumber: string
    blockHash: string
    confirmations: string
    observedAt: string
    payer: string
    recipient: string
    amountAtomic: string
  }

function validParty(value: unknown): value is string {
  return typeof value === 'string' && address.test(value) && !/^0x0{40}$/i.test(value)
}
function quantity(value: unknown) {
  if (typeof value !== 'string' || !uint.test(value)) return null
  const number = BigInt(value)
  return number <= maxUint ? number : null
}

export interface PaymentFreshness { nowMs: number; maxAgeMs: number }
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = (value: unknown): value is string => typeof value === 'string' && word.test(value)

/** Pure comparison: no node calls, wallet, storage or settlement side effects. */
export function verifyWjPayment(input: unknown, expected: WjPaymentExpectation, freshness: Readonly<PaymentFreshness>): WjPaymentResult {
  if (!record(expected) || !record(freshness) || !Number.isSafeInteger(freshness.nowMs) || freshness.nowMs < 0 ||
      !Number.isSafeInteger(freshness.maxAgeMs) || freshness.maxAgeMs < 1) throw new Error('invalid-payment-policy')
  const amount = quantity(expected.amountAtomic)
  if (!hash(expected.transactionHash) || !validParty(expected.payer) ||
      !validParty(expected.recipient) || expected.payer.toLowerCase() === expected.recipient.toLowerCase() ||
      amount === null || amount === 0n || !Number.isSafeInteger(expected.minConfirmations) ||
      expected.minConfirmations < 1 || (expected.logIndex !== undefined && quantity(expected.logIndex) === null)) {
    throw new Error('付款核验条件无效：请核对交易哈希、双方地址、最小单位金额和确认门槛')
  }
  if (!record(input) || !record(input.source) || typeof input.transactionHash !== 'string' ||
      typeof input.state !== 'string' || !['success', 'not-found', 'pending', 'reverted'].includes(input.state)) return { status: 'invalid-observation' }
  const observation = input as unknown as PaymentReceiptObservation
  if (observation.schema !== 'jouleverse.transaction-observation/v1' ||
      observation.transactionHash.toLowerCase() !== expected.transactionHash.toLowerCase()) {
    return { status: 'invalid-observation' }
  }
  const chainId = jouleverseChain.id
  if (observation.source.expectedChainId !== String(chainId) || observation.source.observedChainId !== String(chainId)) {
    return { status: 'wrong-chain' }
  }
  const observedAt = observation.source.observedAt
  const observedMs = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN
  if (!Number.isFinite(observedMs) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(observedAt) ||
      observedMs > freshness.nowMs || new Date(observedMs).toISOString().replace('.000Z', 'Z') !== observedAt.replace('.000Z', 'Z')) return { status: 'invalid-observation' }
  if (freshness.nowMs - observedMs > freshness.maxAgeMs) return { status: 'stale-observation' }
  if (observation.state !== 'success') return { status: observation.state }
  const inclusion = observation.inclusion
  if (!record(inclusion) || !record(observation.execution) || observation.execution.status !== 'success' || !hash(inclusion.blockHash) || !Array.isArray(observation.logs) || observation.logs.length > 512) {
    return { status: 'invalid-observation' }
  }
  const block = quantity(inclusion.blockNumber)
  const head = quantity(inclusion.observedHead)
  const confirmations = quantity(inclusion.confirmations)
  if (block === null || head === null || head < block || confirmations !== head - block + 1n) {
    return { status: 'invalid-observation' }
  }
  const token = getToolboxContract('wj')!.address.toLowerCase()
  const payer = expected.payer.toLowerCase()
  const recipient = expected.recipient.toLowerCase()
  const seen = new Set<string>()
  const matched: string[] = []
  let bytes = 0
  for (const log of observation.logs) {
    if (!record(log) || typeof log.logIndex !== 'string' || typeof log.address !== 'string' || !address.test(log.address) ||
        !Array.isArray(log.topics) || log.topics.length > 4 || !log.topics.every(hash) ||
        typeof log.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)) return { status: 'invalid-observation' }
    bytes += (log.data.length - 2) / 2
    if (bytes > 1048576) return { status: 'invalid-observation' }
    if (quantity(log.logIndex) === null || seen.has(log.logIndex)) return { status: 'invalid-observation' }
    seen.add(log.logIndex)
    if (log.address.toLowerCase() !== token || log.topics[0]?.toLowerCase() !== transferTopic) continue
    const [, from, to] = log.topics
    if (log.topics.length !== 3 || !from || !to || !indexedAddress.test(from) ||
        !indexedAddress.test(to) || !word.test(log.data)) return { status: 'invalid-observation' }
    if (from.slice(-40).toLowerCase() === payer.slice(2) &&
        to.slice(-40).toLowerCase() === recipient.slice(2) && BigInt(log.data) === amount &&
        (expected.logIndex === undefined || expected.logIndex === log.logIndex)) matched.push(log.logIndex)
  }
  if (!matched.length) return { status: 'no-match' }
  if (matched.length > 1) return { status: 'ambiguous' }
  const transactionHash = expected.transactionHash.toLowerCase()
  const logIndex = matched[0]!
  return {
    status: confirmations < BigInt(expected.minConfirmations) ? 'insufficient-confirmations' : 'matched',
    chainId, token, transactionHash, logIndex, evidenceKey: `${chainId}:${transactionHash}:${logIndex}`,
    blockNumber: inclusion.blockNumber, blockHash: inclusion.blockHash.toLowerCase(),
    confirmations: inclusion.confirmations, observedAt: observation.source.observedAt,
    payer, recipient, amountAtomic: expected.amountAtomic,
  }
}
