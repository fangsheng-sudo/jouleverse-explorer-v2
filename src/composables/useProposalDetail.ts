// JNSVote 提案详情数据层：单提案只读展示
// 复用 src/contracts/jnsvote.ts 已有的 jnsVoteABI（_proposals getter），不新增合约 ABI。
// 竞态：proposalId 切换时用请求序号守卫，过期响应丢弃；onScopeDispose 卸载后停止写状态。
// 静默兜底：读取失败显式置 loadError + proposal=null（渲染 —/错误态），
//   「提案不存在」（mapping 默认值返回空标题）与「读取失败」严格区分，绝不用 0 或空串掩盖失败。

import { ref, toValue, onScopeDispose, type MaybeRefOrGetter } from 'vue'
import { publicClient } from '../config/client'
import { JNSVOTE_ADDRESS, jnsVoteABI } from '../contracts/jnsvote'
import { safeErrorMessage } from '../utils/error'
import { jnsvoteDecision, approvalRate, representativeRate } from '../utils/jnsvote-decision'

export type ProposalStatus = 'pending' | 'active' | 'ended'

export interface ProposalDetail {
  id: number
  title: string
  link: string
  timeBegin: bigint
  timeEnd: bigint
  countVotesFor: bigint
  countVotesAgainst: bigint
  countJNSvoted: bigint
  countJNSvotedFor: bigint
  totalJNS: bigint
  disabled: boolean
  status: ProposalStatus
  decision: 1 | -1 | 0
  ar: number | null // 支持率 %
  rr: number | null // 代表率 %
}

export function useProposalDetail(proposalId: MaybeRefOrGetter<number>) {
  const proposal = ref<ProposalDetail | null>(null)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)
  /** 提案是否存在（读取成功但该 id 无提案，title 为 mapping 默认空串） */
  const notFound = ref(false)
  const currentBlock = ref(0n)

  // 竞态守卫：每次 load 自增，回填前校验是否仍是本次请求；卸载后不再写状态
  let seq = 0
  let disposed = false
  onScopeDispose(() => { disposed = true })

  async function load() {
    const id = toValue(proposalId)
    const mySeq = ++seq
    isLoading.value = true
    loadError.value = null
    notFound.value = false
    proposal.value = null

    try {
      // 并行读当前区块 + 提案详情（2 次 RPC，复用 _proposals getter）
      const [blockRaw, raw] = await Promise.all([
        publicClient.getBlockNumber(),
        publicClient.readContract({
          address: JNSVOTE_ADDRESS,
          abi: jnsVoteABI,
          functionName: '_proposals',
          args: [BigInt(id)],
        }),
      ])
      if (mySeq !== seq || disposed) return

      // 区块高度只前进不后退，避免不同节点返回旧块导致倒计时回跳
      if (blockRaw > currentBlock.value) currentBlock.value = blockRaw

      const [
        title,
        link,
        timeBegin,
        timeEnd,
        countVotesFor,
        countVotesAgainst,
        countJNSvoted,
        countJNSvotedFor,
        totalJNS,
        disabled,
      ] = raw

      // 提案不存在：mapping 默认值返回空标题（读取成功，但该 id 无提案）
      if (title === '') {
        notFound.value = true
        return
      }

      let status: ProposalStatus
      if (disabled) status = 'ended'
      else if (blockRaw < timeBegin) status = 'pending'
      else if (blockRaw < timeEnd) status = 'active'
      else status = 'ended'

      const decision = status === 'ended' && !disabled
        ? jnsvoteDecision(id, countVotesFor, countVotesAgainst, countJNSvotedFor, totalJNS)
        : 0

      proposal.value = {
        id,
        title,
        link,
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
      }
    } catch (e) {
      if (mySeq !== seq || disposed) return
      // 读取失败：显式暴露错误，绝不伪装成「不存在」或「零票」
      loadError.value = safeErrorMessage(e)
      proposal.value = null
    } finally {
      if (mySeq === seq && !disposed) isLoading.value = false
    }
  }

  return { proposal, isLoading, loadError, notFound, currentBlock, load }
}
