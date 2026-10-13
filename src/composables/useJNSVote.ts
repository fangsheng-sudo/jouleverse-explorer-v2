// JNSVote 数据层：提案列表 / 资格检查 / 徽章
// v1 参考: docs/reference/jnsvote/jnsVoteInfoController.js

import { ref } from 'vue'
import { writeContract, switchChain, waitForTransactionReceipt } from 'wagmi/actions'
import { publicClient } from '../config/client'
import { jouleverseChain } from '../config/chain'
import { config as wagmiConfig } from '../stores/wallet'
import { JNSVOTE_ADDRESS, JTI_ADDRESS, jnsVoteABI, jtiABI } from '../contracts/jnsvote'
import { JNS_ADDRESS, jnsABI } from '../contracts/jns'
import { jnsvoteDecision, approvalRate, representativeRate } from '../utils/jnsvote-decision'

const BLOCK_TIME_SEC = 15 // Jouleverse 平均出块时间（v1 用 15s 估算倒计时）

// 切链失败（钱包不支持自动切换，需用户手动切换）
export class SwitchChainError extends Error {
  constructor() {
    super('钱包未切换到 Jouleverse 网络')
    this.name = 'SwitchChainError'
  }
}

// 从任意错误对象安全提取可读信息（兼容 Error / string / viem 错误结构）
function safeErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.shortMessage === 'string') return obj.shortMessage
    if (typeof obj.toString === 'function') {
      try { return String(obj.toString()) } catch { /* 忽略 */ }
    }
  }
  return String(error)
}

// 将合约 revert reason / 钱包错误映射为友好中文提示
// require 文案见 docs/reference/jnsvote/jns_vote.sol 中 vote() 的五条约束
export function mapVoteError(error: unknown): string {
  const msg = safeErrorMessage(error)
  // 用户拒绝签名（MetaMask 4001 / wagmi UserRejectedRequestError）
  if (/user rejected|denied|rejected the request|cancelled|4001/i.test(msg)) {
    return '已取消投票'
  }
  if (/not yet started/i.test(msg)) return '提案尚未开始投票'
  if (/already ended/i.test(msg)) return '提案投票已结束'
  if (/already voted/i.test(msg)) return '您已投过票，无法重复投票'
  if (/not a qualified voter|without having jti/i.test(msg)) return '您未持有 JTI，无投票资格'
  if (/not having a jns/i.test(msg)) return '您未持有 JNS 域名，无投票资格'
  // 兜底：返回原始信息（可能含技术细节，但比吞掉错误更利于排查）
  return msg
}

export type ProposalStatus = 'pending' | 'active' | 'ended'

export interface JNSVoteProposal {
  id: number
  title: string
  link: string
  timeBegin: bigint // 区块高度
  timeEnd: bigint
  countVotesFor: bigint
  countVotesAgainst: bigint
  countJNSvoted: bigint
  countJNSvotedFor: bigint
  totalJNS: bigint
  disabled: boolean
  // 派生状态
  status: ProposalStatus
  decision: 1 | -1 | 0
  ar: number | null // 支持率 %
  rr: number | null // 代表率 %
}

export interface VoteEligibility {
  hasJTI: boolean
  hasJNS: boolean
  jtiCount: bigint
  jnsCount: bigint
}

export function useJNSVote() {
  const proposals = ref<JNSVoteProposal[]>([])
  const totalProposals = ref(0)
  const currentBlock = ref(0n)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  // 资格检查结果（当前连接地址）
  const eligibility = ref<VoteEligibility | null>(null)
  // 已投票的提案 id 集合（基于 _jti_voted 查询）
  const votedProposals = ref<Set<number>>(new Set())

  // 读取当前区块高度
  async function fetchCurrentBlock() {
    currentBlock.value = await publicClient.getBlockNumber()
    return currentBlock.value
  }

  // 加载全部提案（multicall 聚合读取，1 次 RPC 读全部提案；multicall3 已于 2026-08-11 自部署）
  async function loadProposals(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false
    if (!silent) isLoading.value = true
    loadError.value = null
    try {
      const block = await fetchCurrentBlock()

      const [totalRaw] = await publicClient.multicall({
        contracts: [
          { address: JNSVOTE_ADDRESS, abi: jnsVoteABI, functionName: '_totalProposals' },
        ],
        allowFailure: false,
      })

      const total = Number(totalRaw)
      totalProposals.value = total

      if (total === 0) {
        proposals.value = []
        return
      }

      // 并行读取所有提案（v1 逐个串行，这里 multicall 一次聚合）
      const calls = Array.from({ length: total }, (_, i) => ({
        address: JNSVOTE_ADDRESS as `0x${string}`,
        abi: jnsVoteABI,
        functionName: '_proposals' as const,
        args: [BigInt(i + 1)] as const,
      }))

      const results = await publicClient.multicall({ contracts: calls, allowFailure: true })

      const list: JNSVoteProposal[] = []
      results.forEach((res, idx) => {
        const id = idx + 1
        if (!res.result) {
          // 单条失败：仍占位，标记为异常（不阻塞整体）
          list.push({
            id,
            title: '(读取失败)',
            link: '',
            timeBegin: 0n,
            timeEnd: 0n,
            countVotesFor: 0n,
            countVotesAgainst: 0n,
            countJNSvoted: 0n,
            countJNSvotedFor: 0n,
            totalJNS: 0n,
            disabled: true,
            status: 'ended',
            decision: 0,
            ar: null,
            rr: null,
          })
          return
        }
        const p = res.result
        const timeBegin = p[2]
        const timeEnd = p[3]
        const countVotesFor = p[4]
        const countVotesAgainst = p[5]
        const countJNSvoted = p[6]
        const countJNSvotedFor = p[7]
        const totalJNS = p[8]
        const disabled = p[9]

        let status: ProposalStatus
        if (disabled) status = 'ended'
        else if (block < timeBegin) status = 'pending'
        else if (block < timeEnd) status = 'active'
        else status = 'ended'

        const decision = status === 'ended' && !disabled
          ? jnsvoteDecision(id, countVotesFor, countVotesAgainst, countJNSvotedFor, totalJNS)
          : 0

        list.push({
          id,
          title: p[0],
          link: p[1],
          timeBegin,
          timeEnd,
          countVotesFor,
          countVotesAgainst,
          countJNSvoted,
          countJNSvotedFor,
          totalJNS,
          disabled,
          status,
          decision,
          ar: approvalRate(countVotesFor, countVotesAgainst),
          rr: representativeRate(countJNSvotedFor, totalJNS),
        })
      })

      proposals.value = list
    } catch (e) {
      // 静默刷新失败不打断现有展示（保持已有数据）
      if (!silent) loadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (!silent) isLoading.value = false
    }
  }

  // 资格检查：JTI 余额 > 0 且 JNS 余额 > 0
  async function checkEligibility(address: string) {
    try {
      const [jtiCount, jnsCount] = await publicClient.multicall({
        contracts: [
          { address: JTI_ADDRESS, abi: jtiABI, functionName: 'balanceOf', args: [address as `0x${string}`] },
          { address: JNS_ADDRESS, abi: jnsABI, functionName: 'balanceOf', args: [address as `0x${string}`] },
        ],
        allowFailure: false,
      })
      eligibility.value = {
        hasJTI: jtiCount > 0n,
        hasJNS: jnsCount > 0n,
        jtiCount,
        jnsCount,
      }
      return eligibility.value
    } catch {
      eligibility.value = null
      return null
    }
  }

  // 检查某地址在哪些提案已投票（multicall 并行查 _jti_voted）
  async function checkVoted(address: string, proposalIds: number[]) {
    const calls = proposalIds.map((id) => ({
      address: JNSVOTE_ADDRESS as `0x${string}`,
      abi: jnsVoteABI,
      functionName: '_jti_voted' as const,
      args: [BigInt(id), address as `0x${string}`] as const,
    }))
    const results = await publicClient.multicall({ contracts: calls, allowFailure: true })
    const voted = new Set<number>()
    results.forEach((res, idx) => {
      if (res.result && (res.result as readonly unknown[])[0] !== 0n) {
        voted.add(proposalIds[idx])
      }
    })
    votedProposals.value = voted
    return voted
  }

  // 区块差 → 人类可读倒计时（v1 formatTime：天/小时/分钟）
  function formatCountdown(blockDiff: bigint): string {
    const seconds = Number(blockDiff) * BLOCK_TIME_SEC
    if (seconds <= 0) return ''
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    let result = ''
    if (days > 0) result += `${days}天`
    if (hours > 0) result += `${hours}小时`
    if (minutes > 0) result += `${minutes}分钟`
    return result || '即将'
  }

  // 投赞成/反对票（写操作，需钱包签名）
  // 流程：确保链正确 → 发送交易 → 等待链上确认（合约 revert 时抛出，含 require reason）
  async function vote(proposalId: number, isFor: boolean): Promise<`0x${string}`> {
    // 1. 确保钱包在 Jouleverse 链上（已在目标链时 switchChain 直接成功）
    try {
      await switchChain(wagmiConfig, { chainId: jouleverseChain.id })
    } catch {
      throw new SwitchChainError()
    }

    // 2. 发送交易（wagmi 内部先 simulate 预估 gas，合约 revert 会在此阶段抛出）
    const hash = isFor
      ? await writeContract(wagmiConfig, {
          address: JNSVOTE_ADDRESS,
          abi: jnsVoteABI,
          functionName: 'voteFor',
          args: [BigInt(proposalId)],
        })
      : await writeContract(wagmiConfig, {
          address: JNSVOTE_ADDRESS,
          abi: jnsVoteABI,
          functionName: 'voteAgainst',
          args: [BigInt(proposalId)],
        })

    // 3. 等待链上确认（交易被 revert 时抛出）
    await waitForTransactionReceipt(wagmiConfig, { hash })

    return hash
  }

  // 初始化：加载提案 + （可选）资格/已投检查
  async function init(address?: string | null) {
    await loadProposals()
    if (address) {
      await checkEligibility(address)
      await checkVoted(address, proposals.value.map((p) => p.id))
    }
  }

  return {
    proposals,
    totalProposals,
    currentBlock,
    isLoading,
    loadError,
    eligibility,
    votedProposals,
    loadProposals,
    checkEligibility,
    checkVoted,
    vote,
    formatCountdown,
    init,
  }
}
