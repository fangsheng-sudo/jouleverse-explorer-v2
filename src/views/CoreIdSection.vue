<template>
  <div class="core-id-section">
    <JvLoading v-if="isLoading" label="Core ID 加载中..." />
    <JvPageState v-else-if="error" type="network-error" :description="error" />
    <template v-else>
      <JvPageState v-if="coreId === null" type="no-core-id" />

      <template v-else>
        <div class="core-id-card">
          <img v-if="metadata?.image" :src="metadata.image" :alt="metadata?.name" :title="metadata?.name || 'Core ID 头像'" class="core-id-avatar" />
          <div class="core-id-info">
            <div class="core-id-title">Core ID #{{ coreId.toString() }}</div>
            <JvStatusTag :status="metadata?.liveness ? 'active' : 'expired'" />
          </div>
        </div>

        <CoreIdCheckIn
          :address="address"
          :coreId="coreId"
          :metadata="metadata"
          :formatAddress="formatAddress"
          @checkedIn="() => load(true)"
        />
      </template>

      <!-- TODO: D-全网签到统计页，参考 v1 coreCheckInInfo.html + coreCheckInInfoController.js -->
      <div class="pop-history">
        <h3>签到徽章历史</h3>
        <div v-if="popHistory.length === 0" class="empty-state">暂无签到记录</div>
        <div v-else>
          <p class="pop-summary">
            共持有 <strong>{{ popHistoryTotal }}</strong> 个签到徽章{{ popHistoryTruncated ? `，仅显示最近 ${popHistory.length} 个` : '' }}
          </p>
          <div class="pop-badge-list">
            <div
              v-for="entry in popHistory.slice(0, popDisplayCount)"
              :key="entry.tokenId.toString()"
              class="pop-badge"
              :class="{ invalid: !entry.isValid }"
              :title="popBadgeTitle(entry)"
            >
              <img :src="entry.metadata?.image" :alt="entry.metadata?.name" class="pop-badge-img" />
              <div class="pop-month">{{ entry.monthLabel }}</div>
            </div>
          </div>
          <div v-if="hasMorePop" class="pop-more">
            <button class="btn-load-more" @click="loadMorePop">
              加载更多（已显示 {{ Math.min(popDisplayCount, popHistory.length) }} / {{ popHistory.length }}）
            </button>
          </div>
          <p v-if="popHistoryTruncated" class="pop-truncated-hint">
            前往 <a href="#" @click.prevent="$router.push('/core/checkin')">全网签到统计页</a> 可查看全部签到记录
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useCoreId } from '../composables/useCoreId'
import CoreIdCheckIn from './CoreIdCheckIn.vue'
import { JvLoading, JvPageState, JvStatusTag } from '../design-system'
import type { PopHistoryEntry } from '../types/coreid'

interface Props {
  address: string
  formatAddress: (addr: string) => string
}

const props = defineProps<Props>()

const { coreIds, popHistory, popHistoryTotal, popHistoryTruncated, popDisplayCount, hasMorePop, loadMorePop, isLoading, error, load } = useCoreId(props.address)

const coreId = computed(() => (coreIds.value.length > 0 ? coreIds.value[0].tokenId : null))
const metadata = computed(() => (coreIds.value.length > 0 ? coreIds.value[0].metadata : null))

// 签到徽章悬停提示：isValid 是「coreId 非空 且 metadata 非空 且 记录 coreId 匹配」三个条件的与，
// false 有三种不同成因，须分别说明，否则常态场景（本地址无 Core ID 全部置灰）会误导用户。
// 成因已在 useCoreId 加载时刻持久化为 invalidReason（快照 coreId），渲染期直接消费，
// 不用实时 coreId 反推（避免 coreIds/popHistory 加载时序错位导致误报）。
const popBadgeTitle = (entry: PopHistoryEntry): string => {
  const name = entry.metadata?.name || '#' + entry.tokenId.toString()
  if (entry.isValid) return `签到徽章：${name}`
  if (entry.invalidReason === 'metadata') return `签到徽章：${name}（徽章元数据读取失败）`
  if (entry.invalidReason === 'no-core-id') return `签到徽章：${name}（本地址未持有 Core ID）`
  return `签到徽章：${name}（记录中的 Core ID 与本地址不符）`
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.core-id-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.core-id-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--jv-bg-subtle);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  padding: 16px;
}

.core-id-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
  object-position: left center;
}

.core-id-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.core-id-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--jv-text-primary);
}

.pop-history h3 {
  margin: 0 0 12px 0;
  font-size: 1rem;
  color: var(--jv-text-primary);
}

.pop-badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.pop-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  padding: 8px;
  min-width: 56px;
}

.pop-badge-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.pop-month {
  font-size: 0.75rem;
  color: var(--jv-text-muted);
}

.pop-badge.invalid {
  opacity: 0.4;
}

.pop-badge.invalid .pop-badge-img {
  filter: grayscale(1);
}

.pop-truncated-hint {
  margin-top: 8px;
  font-size: 0.82rem;
  color: var(--jv-text-muted);
}

.pop-summary {
  margin: 0 0 12px 0;
  font-size: 0.88rem;
  color: var(--jv-text-primary);
}

.pop-more {
  margin-top: 12px;
  text-align: center;
}

.btn-load-more {
  padding: 6px 16px;
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  background: var(--jv-bg-subtle);
  color: var(--jv-text-primary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.2s;
}

.btn-load-more:hover {
  background: var(--jv-bg-hover);
}
</style>
