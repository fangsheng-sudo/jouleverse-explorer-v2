import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { jouleverseChain } from '../config/chain'
import { WJ_ADDRESS, wjABI } from '../contracts/wj'

export interface GasReader {
  getChainId(): Promise<number>
  getBlockNumber(args: { cacheTime: number }): Promise<bigint>
  getBalance(args: { address: Address; blockNumber: bigint }): Promise<bigint>
  readContract(args: {
    address: typeof WJ_ADDRESS
    abi: typeof wjABI
    functionName: 'balanceOf'
    args: readonly [Address]
    blockNumber: bigint
  }): Promise<bigint>
}

export interface GasReplenishmentPolicy {
  sponsor: string
  recipient: string
  /** Replenish strictly below this threshold. */
  triggerJ: bigint
  targetJ: bigint
  maxReleaseWj: bigint
  /** Operator-supplied fee allowance, not an estimate. */
  sponsorFeeAllowanceJ: bigint
  sponsorReserveJ: bigint
}

export type GasDecision =
  | { status: 'invalid-policy' | 'wrong-chain' | 'unavailable' | 'busy' }
  | { status: 'no-top-up'; blockNumber: bigint; recipientJ: bigint }
  | {
    status: 'over-cap' | 'insufficient-wj' | 'insufficient-sponsor-j' | 'review-required'
    chainId: typeof jouleverseChain.id
    blockNumber: bigint
    recipientJ: bigint
    releaseAmountWj: bigint
    recipient: ReturnType<typeof getAddress>
    sponsor: ReturnType<typeof getAddress>
    contract: typeof WJ_ADDRESS
  }

const maxUint = (1n << 256n) - 1n
const isQuantity = (value: unknown): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value <= maxUint

export interface GasPreflightOptions { timeoutMs?: number; signal?: AbortSignal }
const pending = new WeakMap<GasReader, number>()
export function serializeGasDecision(decision: GasDecision): string {
  return JSON.stringify(decision, (_, value) => typeof value === 'bigint' ? value.toString() : value)
}

/** Read-only observation for manual review. Does not authorize or prepare a wallet request. */
export async function inspectGasReplenishment(
  reader: GasReader, policy: Readonly<GasReplenishmentPolicy>, options: GasPreflightOptions = {},
): Promise<GasDecision> {
  if (!policy || typeof policy !== 'object') return { status: 'invalid-policy' }
  const { sponsor, recipient, triggerJ, targetJ, maxReleaseWj, sponsorFeeAllowanceJ, sponsorReserveJ } = policy
  if (typeof sponsor !== 'string' || typeof recipient !== 'string' || !isAddress(sponsor) || !isAddress(recipient) ||
      ![triggerJ, targetJ, maxReleaseWj, sponsorFeeAllowanceJ, sponsorReserveJ].every(isQuantity) ||
      triggerJ === 0n || targetJ < triggerJ || maxReleaseWj === 0n || sponsorFeeAllowanceJ === 0n ||
      sponsorFeeAllowanceJ + sponsorReserveJ > maxUint) return { status: 'invalid-policy' }

  const from = getAddress(sponsor)
  const to = getAddress(recipient)
  if (from === zeroAddress || to === zeroAddress || from === to || to === getAddress(WJ_ADDRESS)) {
    return { status: 'invalid-policy' }
  }

  const timeoutMs = options.timeoutMs ?? 5000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return { status: 'invalid-policy' }
  if (options.signal?.aborted) return { status: 'unavailable' }
  if ((pending.get(reader) ?? 0) >= 2) return { status: 'busy' }
  pending.set(reader, (pending.get(reader) ?? 0) + 1)
  const controller = new AbortController()
  const invoke = async <T>(read: () => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw new Error('cancelled')
    const value = await read()
    if (controller.signal.aborted) throw new Error('cancelled')
    return value
  }
  const task = (async (): Promise<GasDecision> => {
  try {
    if (await invoke(() => reader.getChainId()) !== jouleverseChain.id) return { status: 'wrong-chain' }
    const blockNumber = await invoke(() => reader.getBlockNumber({ cacheTime: 0 }))
    if (!isQuantity(blockNumber)) return { status: 'unavailable' }
    const recipientJ = await invoke(() => reader.getBalance({ address: to, blockNumber }))
    if (!isQuantity(recipientJ)) return { status: 'unavailable' }
    if (recipientJ >= triggerJ) return { status: 'no-top-up', blockNumber, recipientJ }

    const releaseAmountWj = targetJ - recipientJ
    const evidence = {
      chainId: jouleverseChain.id, blockNumber, recipientJ, releaseAmountWj,
      recipient: to, sponsor: from, contract: WJ_ADDRESS,
    }
    if (releaseAmountWj > maxReleaseWj) return { status: 'over-cap', ...evidence }

    const [sponsorJ, sponsorWj] = await Promise.all([
      invoke(() => reader.getBalance({ address: from, blockNumber })),
      invoke(() => reader.readContract({ address: WJ_ADDRESS, abi: wjABI, functionName: 'balanceOf', args: [from], blockNumber })),
    ])
    if (!isQuantity(sponsorJ) || !isQuantity(sponsorWj)) return { status: 'unavailable' }
    if (sponsorWj < releaseAmountWj) return { status: 'insufficient-wj', ...evidence }
    if (sponsorJ < sponsorFeeAllowanceJ + sponsorReserveJ) return { status: 'insufficient-sponsor-j', ...evidence }
    return { status: 'review-required', ...evidence }
  } catch {
    return { status: 'unavailable' }
  }
  })().finally(() => pending.set(reader, (pending.get(reader) ?? 1) - 1))
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const stopped = new Promise<GasDecision>(resolve => {
    abort = () => { controller.abort(); resolve({ status: 'unavailable' }) }
    timer = setTimeout(abort, timeoutMs)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
  })
  try { return await Promise.race([task, stopped]) }
  finally { clearTimeout(timer); if (abort) options.signal?.removeEventListener('abort', abort) }

}
