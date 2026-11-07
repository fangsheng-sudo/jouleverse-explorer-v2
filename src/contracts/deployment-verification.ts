import { createPublicClient, http, isHex, keccak256, type Address, type Hex } from 'viem'
import { jouleverseChain } from '../config/chain'

export const baselineBlock = {
  number: 0x82fccfn,
  hash: '0xfde447d13d6c229d85cbbc64c670b0cd61d57b593b2dee91b3ef5d507d6e261f',
} as const

// Observed runtime code, not an independent build from verified source.
const baselines: Readonly<Record<string, Hex>> = Object.freeze({
  '0x7fba9bb966189db8c4fe33b7bf67bfa24203c6ad': '0xd47bc13f940046cf192da0775023564547e32cdece98640d54a410969ecf1e89',
  '0xef1f38e95dd7f4fb564535f9317ecb3bd419da50': '0xdb3421c9f43f65a90de4d2a92c185e03135bfe065b8885844a5d242f0baa27b4',
  '0x3b717119878e2db1aa7df46f5adcf9766a01706f': '0xdcd452304d548971cf06567fd12d253e486bf6cb2f4209fe81ca56a976ab915d',
})

export function getDeploymentBaseline(address: Address): Hex | undefined {
  return baselines[address.toLowerCase()]
}

export interface DeploymentReader {
  getChainId(): Promise<number>
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hex | null }>
  getBlockNumber(): Promise<bigint>
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
}

export type DeploymentResult =
  | { status: 'match' | 'mismatch' | 'unverified'; blockNumber: bigint; codeHash: Hex }
  | { status: 'no-code'; blockNumber: bigint }
  | { status: 'wrong-chain' | 'baseline-mismatch' | 'error' }

export async function verifyDeployment(address: Address, reader?: DeploymentReader): Promise<DeploymentResult> {
  try {
    const rpc = reader ?? createPublicClient({
      chain: jouleverseChain,
      transport: http(undefined, { timeout: 8000, retryCount: 0 }),
      cacheTime: 0,
    })

    // 先验证固定基线区块仍是预期区块；失败时停止，不能继续给出代码匹配结论。
    if (await rpc.getChainId() !== jouleverseChain.id) return { status: 'wrong-chain' }
    const baseline = await rpc.getBlock({ blockNumber: baselineBlock.number })
    if (!baseline.hash || baseline.hash.toLowerCase() !== baselineBlock.hash.toLowerCase()) {
      return { status: 'baseline-mismatch' }
    }

    // 再单独检查当前最新高度的运行时代码；最多 4 次只读 RPC 请求。
    const blockNumber = await rpc.getBlockNumber()
    const code = await rpc.getCode({ address, blockNumber })
    if (code === undefined || code === '0x') return { status: 'no-code', blockNumber }
    if (!isHex(code, { strict: true }) || code.length % 2 !== 0) return { status: 'error' }
    const codeHash = keccak256(code)
    const expected = getDeploymentBaseline(address)
    return { status: expected ? (codeHash === expected ? 'match' : 'mismatch') : 'unverified', blockNumber, codeHash }
  } catch {
    return { status: 'error' }
  }
}
