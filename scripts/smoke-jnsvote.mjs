#!/usr/bin/env node
// scripts/smoke-jnsvote.mjs
// ─────────────────────────────────────────────────────────────
// JNSVote 冒烟测试（手动触发 · 抽样 · 只读 · RPC 零负担）
//
// 用途：一条命令验证「当前代码的配置」能否真的连上 Jouleverse 主网、
//       读到提案与徽章、并建立 WS 实时订阅。
//
// 刻意遵守 repo 的「RPC 节点零负担」原则：
//   · 不做全量扫描、不做大范围 eth_getLogs、不做循环探测
//   · 提案/徽章均「抽样」少量目标，且用 multicall 聚合
//   · 全程只读（eth_call / eth_subscribe），不广播任何交易
//
// 配置来源（避免与代码漂移）：从 src/config/chain.ts、src/config/client.ts、
//   src/contracts/jnsvote.ts 读取 chainId / RPC / WS / multicall3 / 合约地址。
//   RPC、WS 可用环境变量覆盖。
//
// 用法：
//   npm run smoke
//   SMOKE_RPC=https://... SMOKE_WS=wss://... npm run smoke
//   SMOKE_WS_BLOCKS=1 SMOKE_TIMEOUT_MS=45000 npm run smoke
//
// 退出码：0 = 全部通过；1 = 有失败项（便于手动/CI 判断）
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, http, webSocket, parseAbi } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const WS_BLOCKS = Number(process.env.SMOKE_WS_BLOCKS ?? 2)
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 60000)

// ── 从项目源码读取配置（缺失即用兜底默认）──
function readSrc(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}
function pick(src, re, fallback) {
  const m = src.match(re)
  return m ? m[1] : fallback
}

const chainSrc = readSrc('src/config/chain.ts')
const clientSrc = readSrc('src/config/client.ts')
const voteSrc = readSrc('src/contracts/jnsvote.ts')

const CHAIN_ID = Number(pick(chainSrc, /id:\s*(\d+)/, '3666'))
const HTTP_RPC = process.env.SMOKE_RPC || pick(chainSrc, /http:\s*\['([^']+)'\]/, 'https://rpc.jnsdao.com:8503')
const WS_RPC = process.env.SMOKE_WS || pick(clientSrc, /webSocket\(\s*'([^']+)'/, 'wss://rpc.jnsdao.com:8505')
const MULTICALL3 = pick(chainSrc, /multicall3:\s*\{\s*address:\s*'([^']+)'/, '0x52E8BB61d20259F0434Aefe0C2EfB48fDe77f9C2')
const JNSVOTE = pick(voteSrc, /JNSVOTE_ADDRESS\s*=\s*'([^']+)'/, '0xEf1f38e95dd7F4FB564535F9317ecB3Bd419DA50')

const chain = {
  id: CHAIN_ID,
  name: 'Jouleverse Mainnet',
  nativeCurrency: { name: 'J', symbol: 'J', decimals: 18 },
  rpcUrls: { default: { http: [HTTP_RPC] } },
  contracts: { multicall3: { address: MULTICALL3 } },
}

const abi = parseAbi([
  'function _totalProposals() view returns (uint256)',
  'function _proposals(uint256) view returns (string title, string link, uint256 timeBegin, uint256 timeEnd, uint256 countVotesFor, uint256 countVotesAgainst, uint256 countJNSvoted, uint256 countJNSvotedFor, uint256 totalJNS, bool disabled)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function tokenURI(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
])

// ── 镜像 useJNSVote.ts 的 tokenURI 解析（含 data:image/ 白名单）──
function decodeBase64(b64) {
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
function parseBadgeMetadata(tokenId, tokenURI) {
  try {
    const meta = JSON.parse(decodeBase64(tokenURI.replace(/^data:application\/json;base64,/, '')))
    return {
      tokenId,
      proposal: Number(meta.proposal ?? 0),
      image: typeof meta.image === 'string' && meta.image.startsWith('data:image/') ? meta.image : null,
    }
  } catch {
    return { tokenId, proposal: -1, image: null }
  }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

console.log('── JNSVote smoke ──')
console.log(`chain=${CHAIN_ID} rpc=${HTTP_RPC} ws=${WS_RPC}`)
console.log(`contract=${JNSVOTE} multicall3=${MULTICALL3}\n`)

const client = createPublicClient({ chain, transport: http(HTTP_RPC) })

try {
  // ── Phase 1：提案读取（抽样：第 1 条 + 最后一条；multicall 聚合，共 2 次 eth_call）──
  console.log('Phase 1 · 提案（抽样）')
  const block = await client.getBlockNumber()
  const [totalRaw] = await client.multicall({
    contracts: [{ address: JNSVOTE, abi, functionName: '_totalProposals' }],
    allowFailure: false,
  })
  const total = Number(totalRaw)
  check('_totalProposals 可读', Number.isFinite(total), `${total} 条`)

  if (total > 0) {
    const sampleIds = [...new Set([1, total])] // 抽样：首尾各一条
    const res = await client.multicall({
      contracts: sampleIds.map((id) => ({ address: JNSVOTE, abi, functionName: '_proposals', args: [BigInt(id)] })),
      allowFailure: true,
    })
    const okCount = res.filter((r) => r.result).length
    check(`_proposals 抽样可读 (${sampleIds.join(',')})`, okCount === sampleIds.length, `${okCount}/${sampleIds.length}`)
    res.forEach((r, i) => {
      if (!r.result) return
      const p = r.result
      let status = p[9] ? 'ended' : block < p[2] ? 'pending' : block < p[3] ? 'active' : 'ended'
      console.log(`   #${sampleIds[i]} [${status}] ${String(p[0]).slice(0, 24)} | for=${p[4]} against=${p[5]}`)
    })
  }

  // ── Phase 2：徽章读取（抽样：首尾 tokenId 各取 1，反查 owner 后读 metadata）──
  console.log('\nPhase 2 · 徽章（抽样）')
  const supply = await client.readContract({ address: JNSVOTE, abi, functionName: 'totalSupply' })
  check('totalSupply 可读', supply >= 0n, `${supply} 枚`)

  if (supply > 0n) {
    // 抽样首尾 tokenId，各查一次 ownerOf（≤2 次调用，不循环探测）
    const tokenSamples = [...new Set([1n, supply])]
    const owners = []
    for (const tid of tokenSamples) {
      try {
        owners.push({ tid, owner: await client.readContract({ address: JNSVOTE, abi, functionName: 'ownerOf', args: [tid] }) })
      } catch { /* tokenId 不存在，忽略 */ }
    }
    check('抽样 tokenId 存在 ownerOf', owners.length > 0, owners.map((o) => `#${o.tid}`).join(' '))

    if (owners.length > 0) {
      const { owner, tid } = owners[owners.length - 1]
      const bal = await client.readContract({ address: JNSVOTE, abi, functionName: 'balanceOf', args: [owner] })
      check('balanceOf(owner) > 0', bal > 0n, `owner ${owner} 持 ${bal} 枚`)
      const first = await client.readContract({ address: JNSVOTE, abi, functionName: 'tokenOfOwnerByIndex', args: [owner, 0n] })
      const last = await client.readContract({ address: JNSVOTE, abi, functionName: 'tokenOfOwnerByIndex', args: [owner, bal - 1n] })
      check('tokenOfOwnerByIndex(首/末) 可读', first > 0n && last > 0n, `首=${first} 末=${last}`)
      const uri = await client.readContract({ address: JNSVOTE, abi, functionName: 'tokenURI', args: [tid] })
      check('tokenURI 为 data:application/json;base64', uri.startsWith('data:application/json;base64,'))
      const badge = parseBadgeMetadata(Number(tid), uri)
      check('tokenURI 解析出 proposal 且 image 过 data:image 白名单', Number.isFinite(badge.proposal) && badge.proposal >= 0 && !!badge.image, `proposal=${badge.proposal}`)
    }
  }

  // ── Phase 3：实时更新（WS watchBlockNumber，等 N 个块；1 次订阅）──
  console.log(`\nPhase 3 · 实时更新（WS，等 ${WS_BLOCKS} 块）`)
  const wsClient = createPublicClient({ chain, transport: webSocket(WS_RPC, { retryCount: 5, retryDelay: 3000 }) })
  const times = []
  await new Promise((resolve) => {
    const timer = setTimeout(() => { console.log(`   超时（${TIMEOUT_MS}ms 内未收满 ${WS_BLOCKS} 块）`); resolve() }, TIMEOUT_MS)
    let unwatch = () => {}
    unwatch = wsClient.watchBlockNumber({
      onBlockNumber(bn) {
        const t = Date.now()
        const iv = times.length ? ((t - times[times.length - 1].t) / 1000).toFixed(1) + 's' : '-'
        times.push({ bn, t })
        console.log(`   区块 #${times.length}: ${bn} (间隔 ${iv})`)
        if (times.length >= WS_BLOCKS) { clearTimeout(timer); unwatch(); resolve() }
      },
      onError(e) { console.log('   WS 错误:', e.shortMessage || e.message) },
    })
  })
  check(`WS 收到 ≥${WS_BLOCKS} 个区块`, times.length >= WS_BLOCKS, `收到 ${times.length}`)
  check('块号单调递增', times.every((x, i) => i === 0 || x.bn > times[i - 1].bn))
} catch (e) {
  check('运行未抛异常', false, e.shortMessage || e.message)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n── 汇总：通过 ${results.length - failed.length}/${results.length} ──`)
if (failed.length) console.log(failed.map((f) => '  ❌ ' + f.name).join('\n'))
process.exit(failed.length ? 1 : 0)
