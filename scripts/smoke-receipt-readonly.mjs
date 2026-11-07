#!/usr/bin/env node
/** Node >=24. 只读5请求（已打包交易），零gas；默认不写文件，不扫描链。 */
import { createPublicClient, http } from 'viem'
import { writeFile } from 'node:fs/promises'
import { jouleverseChain } from '../src/config/chain.ts'
import { parseTransactionHash, verifyReceipt, serializeReceiptReport } from '../src/services/receipt-verifier.ts'

const [hashInput, flag, fixturePath] = process.argv.slice(2)
if (!hashInput || (flag && (flag !== '--save-fixture' || !fixturePath))) {
  console.error('用法：node scripts/smoke-receipt-readonly.mjs <交易哈希> [--save-fixture <保存路径>]')
  process.exit(1)
}
try {
  const hash = parseTransactionHash(hashInput)
  const rpcUrl = jouleverseChain.rpcUrls.default.http[0]
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }) })
  const responses = []
  const report = await verifyReceipt(async request => {
    const result = await client.request(request)
    responses.push({ request, result })
    return result
  }, hash, { expectedChainId: jouleverseChain.id, rpcUrl })
  if (fixturePath) await writeFile(fixturePath, JSON.stringify({ recordedAt: report.source.observedAt, rpcUrl, responses }, null, 2) + '\n')
  console.log(serializeReceiptReport(report))
  console.error(`只读请求：${responses.length}；交易状态：${report.state}；未发送交易。`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
