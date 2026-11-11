import type { Hex } from 'viem'

export interface NetworkIdentityReader {
  getChainId(): Promise<number>
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hex | null } | null>
}
export type NetworkIdentityResult =
  | { status: 'verified'; chainId: number; genesisHash: Hex }
  | { status: 'wrong-chain'; observedChainId: number }
  | { status: 'genesis-mismatch'; observedGenesisHash: Hex | null }
  | { status: 'unconfigured' | 'unavailable' }

const validHash = (hash: unknown): hash is Hex => typeof hash === 'string' && /^0x[0-9a-f]{64}$/i.test(hash)

/** Expected identity must come from a trusted source independent of the reader.
 * Standalone readers must enforce their own request deadlines. The kit adds an
 * overall deadline and admission limit; this helper checks cancellation between calls.
 */
export async function verifyNetworkIdentity(
  reader: NetworkIdentityReader,
  expected: { chainId: number; genesisHash?: Hex },
  signal?: AbortSignal,
): Promise<NetworkIdentityResult> {
  // Snapshot before awaiting: caller mutations cannot change an in-flight policy.
  const { chainId, genesisHash } = expected
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !validHash(genesisHash)) return { status: 'unconfigured' }
  try {
    if (signal?.aborted) return { status: 'unavailable' }
    const observedChainId = await reader.getChainId()
    if (signal?.aborted || !Number.isSafeInteger(observedChainId) || observedChainId <= 0) return { status: 'unavailable' }
    if (observedChainId !== chainId) return { status: 'wrong-chain', observedChainId }
    const genesis = await reader.getBlock({ blockNumber: 0n })
    if (signal?.aborted) return { status: 'unavailable' }
    const observedGenesisHash = validHash(genesis?.hash) ? genesis.hash : null
    if (!observedGenesisHash || observedGenesisHash.toLowerCase() !== genesisHash.toLowerCase()) {
      return { status: 'genesis-mismatch', observedGenesisHash }
    }
    return { status: 'verified', chainId: observedChainId, genesisHash: observedGenesisHash }
  } catch { return { status: 'unavailable' } }
}
