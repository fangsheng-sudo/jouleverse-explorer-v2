// 有界只读主网检查：12个区块，不扫描日志、不签名、不发送交易。
import { createPublicClient, http } from 'viem'
import { collectAnalytics, analyticsMetrics } from '../src/utils/analytics.ts'
import { abi_multisig } from '../src/contracts/toolbox.ts'
const chain = { id: 3666, name: 'Jouleverse', nativeCurrency: {name: 'J', symbol: 'J', decimals: 18}, rpcUrls: {default: {http: ['https://rpc.jnsdao.com']}} }
const client = createPublicClient({ chain, transport: http('https://rpc.jnsdao.com', { retryCount: 0, timeout: 15_000 }) })
const sample = await collectAnalytics(client, 12)
const metrics = analyticsMetrics(sample)
const address = '0x4eF599b6E39D950D6Ddbd830fF5f95e06770C1B3'
const blockNumber = BigInt(sample.blocks.at(-1).number)
const required = await client.readContract({ address, abi: abi_multisig, functionName: 'required', blockNumber })
const pending = await client.readContract({ address, abi: abi_multisig, functionName: 'getTransactionCount', args: [true, false], blockNumber })
const count = Number(pending < 5n ? pending : 5n)
const rawIds = count ? await client.readContract({ address, abi: abi_multisig, functionName: 'getTransactionIds', args: [0n, BigInt(count), true, false], blockNumber }) : []
const ids = rawIds.slice(0, count)
const preview = []
for (const id of ids) {
 const [destination, value, data, executed] = await client.readContract({ address, abi: abi_multisig, functionName: 'transactions', args: [id], blockNumber })
 if (executed) throw new Error('Pending list contains executed transaction')
 preview.push({id,destination,value,selector:data.slice(0,10),executed})
}
console.log(JSON.stringify({ chainId: 3666, range: [sample.blocks[0].number, sample.blocks.at(-1).number], sampledBlocks: sample.blocks.length, ...metrics, activeAddresses: sample.activeAddresses, multisig: address, required, pending, preview }, (_,v) => typeof v === 'bigint' ? String(v) : v, 2))
