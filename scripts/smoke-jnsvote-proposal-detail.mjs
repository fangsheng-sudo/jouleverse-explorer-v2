#!/usr/bin/env node
// scripts/smoke-jnsvote-proposal-detail.mjs
// ─────────────────────────────────────────────────────────────
// JNSVote 提案详情页 冒烟测试（手动触发 · 抽样 · 只读 · RPC 零负担）
//
// 用途：验证 useProposalDetail.ts 依赖的两项链上能力：
//   1. _proposals(id) getter 可读，票数字段（countVotesFor/Against 等）可解析为 bigint
//   2. notFound 场景：不存在的 id 返回空标题（mapping 默认值，非 revert），
//      与「读取失败」严格区分
//
// 刻意遵守 repo 的「RPC 节点零负担」原则：只抽样第 1 条提案 + 1 个越界 id，
//   全程只读（eth_call），不广播交易、不做全量枚举。
//
// 配置来源（避免与代码漂移）：从 src/config/chain.ts、src/contracts/jnsvote.ts
//   读取 chainId / RPC / multicall3 / 合约地址。RPC 可用环境变量覆盖。
//
// 用法：
//   node scripts/smoke-jnsvote-proposal-detail.mjs
//   SMOKE_RPC=https://... node scripts/smoke-jnsvote-proposal-detail.mjs
//
// 退出码：0 = 全部通过；1 = 有失败项（便于手动/CI 判断）
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, http, parseAbi } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── 从项目源码读取配置（抽取失败即报错退出，绝不静默兜底）──
function readSrc(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}
function extract(src, re, label, filename) {
  const m = src.match(re)
  if (!m || !m[1]) {
    console.error(`❌ 无法从 ${filename} 抽取 ${label}：正则失配，源码格式可能已变化，请检查后重试。`)
    process.exit(1)
  }
  return m[1]
}

const chainSrc = readSrc('src/config/chain.ts')
const voteSrc = readSrc('src/contracts/jnsvote.ts')

const CHAIN_ID = Number(extract(chainSrc, /id:\s*(\d+)/, 'chainId', 'src/config/chain.ts'))
const HTTP_RPC = process.env.SMOKE_RPC || extract(chainSrc, /http:\s*\['([^']+)'\]/, 'RPC http 端点', 'src/config/chain.ts')
const MULTICALL3 = extract(chainSrc, /multicall3:\s*\{\s*address:\s*'([^']+)'/, 'multicall3 地址', 'src/config/chain.ts')
const JNSVOTE = extract(voteSrc, /JNSVOTE_ADDRESS\s*=\s*'([^']+)'/, 'JNSVOTE_ADDRESS', 'src/contracts/jnsvote.ts')

const chain = {
  id: CHAIN_ID,
  name: 'Jouleverse Mainnet',
  nativeCurrency: { name: 'J', symbol: 'J', decimals: 18 },
  rpcUrls: { default: { http: [HTTP_RPC] } },
  contracts: { multicall3: { address: MULTICALL3 } },
}

// 与 useProposalDetail.ts 同口径：_proposals getter 返回结构（标题/链接/起止块/票数/代表持仓/总JNS/停用）
const abi = parseAbi([
  'function _totalProposals() view returns (uint256)',
  'function _proposals(uint256) view returns (string title, string link, uint256 timeBegin, uint256 timeEnd, uint256 countVotesFor, uint256 countVotesAgainst, uint256 countJNSvoted, uint256 countJNSvotedFor, uint256 totalJNS, bool disabled)',
])

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

console.log('── JNSVote proposal detail smoke ──')
console.log(`chain=${CHAIN_ID} rpc=${HTTP_RPC}`)
console.log(`contract=${JNSVOTE} multicall3=${MULTICALL3}\n`)

const client = createPublicClient({ chain, transport: http(HTTP_RPC) })

try {
  // ── Phase 1：提案详情可读 + 票数可解析（抽样第 1 条）──
  console.log('Phase 1 · 提案详情（抽样 #1）')
  const [totalRaw] = await client.multicall({
    contracts: [{ address: JNSVOTE, abi, functionName: '_totalProposals' }],
    allowFailure: false,
  })
  const total = Number(totalRaw)
  check('_totalProposals 可读', Number.isFinite(total) && total > 0, `${total} 条`)

  const p = await client.readContract({
    address: JNSVOTE,
    abi,
    functionName: '_proposals',
    args: [1n],
  })
  // p 为 tuple：title/link/timeBegin/timeEnd/countVotesFor/countVotesAgainst/countJNSvoted/countJNSvotedFor/totalJNS/disabled
  const title = p[0]
  const countVotesFor = p[4]
  const countVotesAgainst = p[5]
  const totalJNS = p[8]
  check('_proposals(1) 标题非空', typeof title === 'string' && title.length > 0, `「${title.slice(0, 20)}」`)
  check('票数可解析为 bigint（for）', typeof countVotesFor === 'bigint' && countVotesFor >= 0n, `for=${countVotesFor}`)
  check('票数可解析为 bigint（against）', typeof countVotesAgainst === 'bigint' && countVotesAgainst >= 0n, `against=${countVotesAgainst}`)
  check('总 JNS 快照可解析为 bigint', typeof totalJNS === 'bigint' && totalJNS >= 0n, `totalJNS=${totalJNS}`)

  // ── Phase 2：notFound 场景（越界 id 返回空标题，非 revert）──
  console.log('\nPhase 2 · notFound（越界 id）')
  // 越界 id = total + 1000，mapping 默认值应返回空标题，而不是 revert
  const outOfRange = await client.readContract({
    address: JNSVOTE,
    abi,
    functionName: '_proposals',
    args: [BigInt(total + 1000)],
  })
  check('越界 id 返回空标题（notFound 判定依据）', outOfRange[0] === '', `title="${outOfRange[0]}"`)
  check('越界 id 票数为 0（默认值，与「读取失败」区分）', outOfRange[4] === 0n && outOfRange[5] === 0n)
} catch (e) {
  check('运行未抛异常', false, e.shortMessage || e.message)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n── 汇总：通过 ${results.length - failed.length}/${results.length} ──`)
if (failed.length) console.log(failed.map((f) => '  ❌ ' + f.name).join('\n'))
process.exit(failed.length ? 1 : 0)
