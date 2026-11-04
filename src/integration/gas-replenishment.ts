import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { jouleverseChain } from '../config/chain'
import { WJ_ADDRESS, wjABI } from '../contracts/wj'

interface GasReader {
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

type GasDecision =
  | { status: 'invalid-policy' | 'wrong-chain' | 'unavailable' }
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

/** Read-only observation for manual review. Does not authorize or prepare a wallet request. */
export async function inspectGasReplenishment(
  reader: GasReader, policy: Readonly<GasReplenishmentPolicy>,
): Promise<GasDecision> {
  const { sponsor, recipient, triggerJ, targetJ, maxReleaseWj, sponsorFeeAllowanceJ, sponsorReserveJ } = policy
  if (!isAddress(sponsor) || !isAddress(recipient) ||
      ![triggerJ, targetJ, maxReleaseWj, sponsorFeeAllowanceJ, sponsorReserveJ].every(isQuantity) ||
      triggerJ === 0n || targetJ < triggerJ || maxReleaseWj === 0n || sponsorFeeAllowanceJ === 0n ||
      sponsorFeeAllowanceJ + sponsorReserveJ > maxUint) return { status: 'invalid-policy' }

  const from = getAddress(sponsor)
  const to = getAddress(recipient)
  if (from === zeroAddress || to === zeroAddress || from === to || to === getAddress(WJ_ADDRESS)) {
    return { status: 'invalid-policy' }
  }

  try {
    if (await reader.getChainId() !== jouleverseChain.id) return { status: 'wrong-chain' }
    const blockNumber = await reader.getBlockNumber({ cacheTime: 0 })
    if (!isQuantity(blockNumber)) return { status: 'unavailable' }
    const recipientJ = await reader.getBalance({ address: to, blockNumber })
    if (!isQuantity(recipientJ)) return { status: 'unavailable' }
    if (recipientJ >= triggerJ) return { status: 'no-top-up', blockNumber, recipientJ }

    const releaseAmountWj = targetJ - recipientJ
    const evidence = {
      chainId: jouleverseChain.id, blockNumber, recipientJ, releaseAmountWj,
      recipient: to, sponsor: from, contract: WJ_ADDRESS,
    }
    if (releaseAmountWj > maxReleaseWj) return { status: 'over-cap', ...evidence }

    const [sponsorJ, sponsorWj] = await Promise.all([
      reader.getBalance({ address: from, blockNumber }),
      reader.readContract({ address: WJ_ADDRESS, abi: wjABI, functionName: 'balanceOf', args: [from], blockNumber }),
    ])
    if (!isQuantity(sponsorJ) || !isQuantity(sponsorWj)) return { status: 'unavailable' }
    if (sponsorWj < releaseAmountWj) return { status: 'insufficient-wj', ...evidence }
    if (sponsorJ < sponsorFeeAllowanceJ + sponsorReserveJ) return { status: 'insufficient-sponsor-j', ...evidence }
    return { status: 'review-required', ...evidence }
  } catch {
    return { status: 'unavailable' }
  }
}
