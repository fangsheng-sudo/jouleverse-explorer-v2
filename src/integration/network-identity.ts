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
 * 校验网络身份：同时核对链编号与创世区块哈希。
 * 期望的创世哈希必须来自独立于被检测 RPC 的受信链规范，本函数不内置任何值。
 * 只读、fail-closed，不签名、不广播交易。
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
