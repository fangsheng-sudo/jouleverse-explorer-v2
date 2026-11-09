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

/**
 * Verifies a network against an explicitly configured chain ID and genesis hash.
 * The expected genesis hash must come from a separately trusted chain specification.
 * This function performs read-only calls and never signs or broadcasts transactions.
 */
export async function verifyNetworkIdentity(
  reader: NetworkIdentityReader,
  expected: { chainId: number; genesisHash?: Hex },
): Promise<NetworkIdentityResult> {
  if (!Number.isSafeInteger(expected.chainId) || expected.chainId <= 0 ||
      !expected.genesisHash || !/^0x[0-9a-f]{64}$/i.test(expected.genesisHash)) {
    return { status: 'unconfigured' }
  }

  try {
    const observedChainId = await reader.getChainId()
    if (observedChainId !== expected.chainId) {
      return { status: 'wrong-chain', observedChainId }
    }
    const genesis = await reader.getBlock({ blockNumber: 0n })
    const observedGenesisHash = genesis?.hash ?? null
    if (!observedGenesisHash || observedGenesisHash.toLowerCase() !== expected.genesisHash.toLowerCase()) {
      return { status: 'genesis-mismatch', observedGenesisHash }
    }
    return { status: 'verified', chainId: observedChainId, genesisHash: observedGenesisHash }
  } catch {
    return { status: 'unavailable' }
  }
}
