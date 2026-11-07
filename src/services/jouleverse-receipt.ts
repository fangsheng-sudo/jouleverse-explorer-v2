import { createPublicClient, http } from 'viem'
import { jouleverseChain } from '../config/chain'
import { createReceiptVerifier } from './receipt-verifier'

// 明确关闭重试；每次最多5个只读RPC，同时最多2个。沿用唯一主网配置，不接收任意端点。
const client = createPublicClient({
  chain: jouleverseChain,
  transport: http(jouleverseChain.rpcUrls.default.http[0], { retryCount: 0, timeout: 10_000 }),
})
export const verifyJouleverseReceipt = createReceiptVerifier(request => client.request(request), {
  expectedChainId: jouleverseChain.id,
  rpcUrl: jouleverseChain.rpcUrls.default.http[0],
})
