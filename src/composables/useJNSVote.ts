// JNSVote 数据层：提案列表 / 资格检查 / 徽章
// v1 参考: docs/reference/jnsvote/jnsVoteInfoController.js

import { ref } from 'vue'
import { writeContract, switchChain, waitForTransactionReceipt, simulateContract } from 'wagmi/actions'
import { publicClient } from '../config/client'
import { jouleverseChain } from '../config/chain'
import { config as wagmiConfig } from '../stores/wallet'
import { JNSVOTE_ADDRESS, JTI_ADDRESS, jnsVoteABI, jtiABI } from '../contracts/jnsvote'
import { JNS_ADDRESS, jnsABI } from '../contracts/jns'
import { jnsvoteDecision, approvalRate, representativeRate } from '../utils/jnsvote-decision'
import { safeErrorMessage } from '../utils/error'

const BLOCK_TIME_SEC = 15 // Jouleverse 平均出块时间（v1 用 15s 估算倒计时）

// 切链失败（钱包不支持自动切换，需用户手动切换）
export class SwitchChainError extends Error {
  constructor() {
    super('钱包未切换到 Jouleverse 网络')
    this.name = 'SwitchChainError'
  }
}

// 将合约 revert reason / 钱包错误映射为友好中文提示
// require 文案见 docs/reference/jnsvote/jns_vote.sol 中 vote() 的五条约束
export function mapVoteError(error: unknown): string {
  // 优先取 viem 的 shortMessage（干净文案），同时兼顾 message（含 reason）与 reason 字段
  const msg = safeErrorMessage(error)
  const raw = String(
    (error as { shortMessage?: string } | null)?.shortMessage ??
    (error as { reason?: string } | null)?.reason ??
    msg,
  )
  // 用户拒绝签名（MetaMask 4001 / wagmi UserRejectedRequestError）
  if (/user rejected|denied|rejected the request|cancelled|4001/i.test(msg + ' ' + raw)) {
    return '已取消投票'
  }
  if (/not yet started/i.test(raw)) return '提案尚未开始投票'
  if (/already ended/i.test(raw)) return '提案投票已结束'
  if (/already voted/i.test(raw)) return '您已投过票，无法重复投票'
  if (/not a qualified voter|without having jti/i.test(raw)) return '您未持有 JTI，无投票资格'
  if (/not having a jns/i.test(raw)) return '您未持有 JNS 域名，无投票资格'
  // 兜底：返回干净信息（可能含技术细节，但比吞掉错误更利于排查）
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
    const voted = new Set<number>()
    // 提案列表为空时跳过（例如钱包恢复早于提案加载的竞态窗口）
    if (proposalIds.length === 0) {
      votedProposals.value = voted
      return voted
    }
    try {
      const calls = proposalIds.map((id) => ({
        address: JNSVOTE_ADDRESS as `0x${string}`,
        abi: jnsVoteABI,
        functionName: '_jti_voted' as const,
        args: [BigInt(id), address as `0x${string}`] as const,
      }))
      const results = await publicClient.multicall({ contracts: calls, allowFailure: true })
      results.forEach((res, idx) => {
        if (res.result && (res.result as readonly unknown[])[0] !== 0n) {
          voted.add(proposalIds[idx])
        }
      })
    } catch {
      // RPC 失败：保持空集合，不阻塞页面
    }
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

    // 3. 等待链上确认
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })

    // 4. 校验 receipt.status：viem 不会在 revert 时抛错，需显式检查
    //    （模拟与上链之间状态可能变化，如并发标签页重复投票 → already voted）
    if (receipt.status === 'reverted') {
      // 交易已挖出但被 revert：重放同参数模拟以拿到精确 require reason
      throw await resolveRevertReason(proposalId, isFor)
    }

    return hash
  }

  // revert 后重放 simulate 以还原合约 require reason（供 mapVoteError 映射）
  async function resolveRevertReason(proposalId: number, isFor: boolean): Promise<Error> {
    try {
      await simulateContract(wagmiConfig, {
        address: JNSVOTE_ADDRESS,
        abi: jnsVoteABI,
        functionName: isFor ? 'voteFor' : 'voteAgainst',
        args: [BigInt(proposalId)],
      })
      // 模拟通过（说明 revert 由并发时序造成，现已无碍）→ 抛通用错误
      return new Error('交易已回滚')
    } catch (e) {
      // 模拟失败：e 携带合约 revert reason，交给 mapVoteError 映射
      return e instanceof Error ? e : new Error(String(e))
    }
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
