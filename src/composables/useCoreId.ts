import { ref, unref, computed } from 'vue'
import { isAddress } from 'viem'
import { publicClient } from '../config/client'
import { JVCORE_ADDRESS, jvcoreABI } from '../contracts/jvcore'
import { POPBADGE_ADDRESS, popbadgeABI } from '../contracts/popbadge'
import { parseTokenURI } from '../utils/nftMetadata'
import type { CoreIdInfo, PopHistoryEntry } from '../types/coreid'

// 超过此数量只显示最近的，按 tokenId 降序取高位 index（最新先入）
const MAX_POP_DISPLAY = 50
const POP_BATCH_SIZE = 10

export function useCoreId(address: string) {
  const addr = unref(address)
  const coreIds = ref<CoreIdInfo[]>([])
  const popHistory = ref<PopHistoryEntry[]>([])
  const popHistoryTotal = ref(0)
  const popHistoryTruncated = ref(false)
  const popDisplayCount = ref(POP_BATCH_SIZE)
  const hasMorePop = computed(() => popDisplayCount.value < Math.min(popHistory.value.length, MAX_POP_DISPLAY))
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 我的Core ID：port自 v1 getAllJVCore（addressInfoController.js 第808-843行）
  const loadMyCoreIds = async () => {
    // multicall 聚合：balanceOf + tokenOfOwnerByIndex×10（越界自动过滤）→ 1 次
    // 注：Core ID 每人一般 0-1 个，上限 10 覆盖极端情况
    const aResults = await publicClient.multicall({
      contracts: [
        { address: JVCORE_ADDRESS, abi: jvcoreABI, functionName: 'balanceOf', args: [addr as `0x${string}`] },
        ...Array.from({ length: 10 }, (_, i) => ({
          address: JVCORE_ADDRESS, abi: jvcoreABI, functionName: 'tokenOfOwnerByIndex', args: [addr as `0x${string}`, BigInt(i)],
        })),
      ],
      allowFailure: true,
    })

    const tokenIds = aResults
      .slice(1)
      .filter((r) => r.status === 'success')
      .map((r) => r.result as bigint)

    // multicall：tokenURI × N → 1 次
    const bResults = await publicClient.multicall({
      contracts: tokenIds.map((tokenId) => ({
        address: JVCORE_ADDRESS, abi: jvcoreABI, functionName: 'tokenURI', args: [tokenId],
      })),
      allowFailure: true,
    })
    const tokenURIs: (string | null)[] = bResults.map((r) =>
      (r.status === 'success' ? (r.result as unknown as string) : null)
    )

    coreIds.value = tokenIds.map((tokenId, i) => ({
      tokenId,
      metadata: tokenURIs[i] ? parseTokenURI(tokenURIs[i] as string) : null,
    }))
  }

  // 我的POP签到历史：port自 v1 getAllPOP（addressInfoController.js 第845-891行）
  const loadMyPopHistory = async () => {
    // 当前地址自己的Core ID，用于"代打卡"判断；地址本身没有Core ID则全部置灰
    const coreId = coreIds.value.length > 0 ? coreIds.value[0].tokenId : null

    const balance = await publicClient.readContract({
      address: POPBADGE_ADDRESS,
      abi: popbadgeABI,
      functionName: 'balanceOf',
      args: [addr as `0x${string}`],
    })

    const total = Number(balance)
    popHistoryTotal.value = total
    popHistoryTruncated.value = total > MAX_POP_DISPLAY
    // tokenOfOwnerByIndex 按持有顺序排列（index 0=最旧，index total-1=最新）
    // 超上限时从高位取最近 MAX_POP_DISPLAY 条
    const startIndex = popHistoryTruncated.value ? total - MAX_POP_DISPLAY : 0
    const indices = Array.from({ length: total - startIndex }, (_, i) => BigInt(startIndex + i))

    // multicall 步骤A：tokenOfOwnerByIndex × N → 1 次
    const aResults = await publicClient.multicall({
      contracts: indices.map((i) => ({
        address: POPBADGE_ADDRESS, abi: popbadgeABI, functionName: 'tokenOfOwnerByIndex', args: [addr as `0x${string}`, i],
      })),
      allowFailure: true,
    })
    const tokenIds = aResults
      .filter((r) => r.status === 'success')
      .map((r) => r.result as bigint)

    // multicall 步骤B：tokenURI × N → 1 次
    const bResults = await publicClient.multicall({
      contracts: tokenIds.map((tokenId) => ({
        address: POPBADGE_ADDRESS, abi: popbadgeABI, functionName: 'tokenURI', args: [tokenId],
      })),
      allowFailure: true,
    })
    const tokenURIs: (string | null)[] = bResults.map((r) =>
      (r.status === 'success' ? (r.result as unknown as string) : null)
    )

    const result: PopHistoryEntry[] = tokenIds.map((tokenId, i) => {
      const metadata = tokenURIs[i] ? parseTokenURI(tokenURIs[i] as string) : null
      // v1: var is_valid = tokenInfo.coreId == core_id (松类型比较)；这里桥接number/bigint
      const isValid = coreId !== null && metadata !== null && BigInt(metadata.coreId ?? -1) === coreId
      // 失效成因在加载时刻持久化（快照 coreId），避免渲染期用实时 coreId 反推导致时序错位误报
      const invalidReason: PopHistoryEntry['invalidReason'] = isValid
        ? null
        : metadata === null
          ? 'metadata'
          : coreId === null
            ? 'no-core-id'
            : 'mismatch'

      let monthLabel: string
      if (metadata === null) {
        monthLabel = '未知'
      } else {
        const ts = metadata.checkInTimestamp ?? 0
        if (ts === 0) {
          monthLabel = '未知'
        } else {
          const date = new Date(ts * 1000)
          const yy = date.getFullYear().toString().slice(-2)
          const mm = date.getMonth() + 1
          const dd = date.getDate()
          monthLabel = `${yy}.${mm}.${dd}`
        }
      }

      return { tokenId, metadata, monthLabel, isValid, invalidReason }
    })

    // 按tokenId降序排序（最新在前），方便用户查看近期签到
    result.sort((a, b) => (a.tokenId > b.tokenId ? -1 : a.tokenId < b.tokenId ? 1 : 0))
    popHistory.value = result
  }

  const load = async (silent = false) => {
    if (!isAddress(addr)) {
      error.value = '地址格式无效'
      return
    }
    // silent：软重载（如签到后）不置 isLoading，避免模板 v-if 切换到加载态
    // 卸载 CoreIdCheckIn 组件——否则签到成功提示与乐观状态会随卸载一并丢失。
    if (!silent) isLoading.value = true
    error.value = null
    try {
      await loadMyCoreIds()
      await loadMyPopHistory()
    } catch (err) {
      console.error('[useCoreId] 加载失败:', err)
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (!silent) isLoading.value = false
    }
  }

  function loadMorePop() {
    const next = popDisplayCount.value + POP_BATCH_SIZE
    popDisplayCount.value = Math.min(next, popHistory.value.length, MAX_POP_DISPLAY)
  }

  return {
    coreIds,
    popHistory,
    popHistoryTotal,
    popHistoryTruncated,
    popDisplayCount,
    hasMorePop,
    loadMorePop,
    isLoading,
    error,
    load,
  }
}
