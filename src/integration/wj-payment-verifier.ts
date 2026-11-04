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
  | { status: 'wrong-chain' | 'invalid-observation' | 'not-found' | 'pending' | 'reverted' | 'no-match' | 'ambiguous' }
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

function validParty(value: string) {
  return address.test(value) && !/^0x0{40}$/i.test(value)
}
function quantity(value: string) {
  if (!uint.test(value)) return null
  const number = BigInt(value)
  return number <= maxUint ? number : null
}

/** Pure comparison: no node calls, wallet, storage or settlement side effects. */
export function verifyWjPayment(observation: PaymentReceiptObservation, expected: WjPaymentExpectation): WjPaymentResult {
  const amount = quantity(expected.amountAtomic)
  if (!word.test(expected.transactionHash) || !validParty(expected.payer) ||
      !validParty(expected.recipient) || expected.payer.toLowerCase() === expected.recipient.toLowerCase() ||
      amount === null || amount === 0n || !Number.isSafeInteger(expected.minConfirmations) ||
      expected.minConfirmations < 1 || (expected.logIndex !== undefined && quantity(expected.logIndex) === null)) {
    throw new Error('付款核验条件无效：请核对交易哈希、双方地址、最小单位金额和确认门槛')
  }
  if (observation.schema !== 'jouleverse.transaction-observation/v1' ||
      observation.transactionHash.toLowerCase() !== expected.transactionHash.toLowerCase()) {
    return { status: 'invalid-observation' }
  }
  const chainId = jouleverseChain.id
  if (observation.source.expectedChainId !== String(chainId) || observation.source.observedChainId !== String(chainId)) {
    return { status: 'wrong-chain' }
  }
  if (observation.state !== 'success') return { status: observation.state }
  const inclusion = observation.inclusion
  if (!inclusion || observation.execution?.status !== 'success' || !word.test(inclusion.blockHash)) {
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
  for (const log of observation.logs) {
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
