<template>
  <div class="core-id-checkin">
    <JvPageState
      v-if="!walletStore.isConnected"
      type="wallet-disconnected"
      description="签到操作需要连接钱包，请先在右上角连接 MetaMask。"
    />

    <div v-else-if="walletStore.address?.toLowerCase() !== address.toLowerCase()" class="checkin-block wallet-warning">
      <h3>⚠️ 地址不匹配</h3>
      <p>当前连接的钱包地址不是此页面地址，无法代为签到。</p>
      <p>连接地址：<span class="addr-mono">{{ walletStore.formatAddress(walletStore.address) }}</span></p>
      <p>页面地址：<span class="addr-mono">{{ formatAddress(address) }}</span></p>
    </div>

    <div v-else class="checkin-block checkin-panel">
      <div class="wallet-info-badge">
        <span class="badge-connected">✓ 钱包已连接</span>
        <JvStatusTag :status="isLive ? 'active' : 'expired'" />
      </div>

      <div class="checkin-stats">
        <div class="stat-row">
          <span class="stat-label">Core ID</span>
          <span class="stat-value">#{{ coreId.toString() }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">距上次签到</span>
          <span class="stat-value">{{ sinceLastCheckInText }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">最小签到间隔</span>
          <span class="stat-value">{{ formatDuration(minCheckInInterval) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">签到有效期</span>
          <span class="stat-value">{{ formatDuration(expireDuration) }}</span>
        </div>
      </div>

      <JvActionButton
        :loading="loadingCheckIn"
        :disabled="!canCheckIn"
        size="large"
        style="width: 100%"
        @click="handleCheckIn"
      >
        {{ checkInButtonText }}
      </JvActionButton>
      <p v-if="checkInStatus" class="status-message">{{ checkInStatus }}</p>
      <p v-if="checkInError" class="error-message">{{ checkInError }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useWalletStore } from '../stores/wallet'
import { jouleverseChain } from '../config/chain'
import { publicClient } from '../config/client'
import { JVCORE_ADDRESS, jvcoreABI } from '../contracts/jvcore'
import { writeContract, switchChain, waitForTransactionReceipt } from 'wagmi/actions'
import { config as wagmiConfig } from '../stores/wallet'
import { JvPageState, JvStatusTag, JvActionButton } from '../design-system'
import { safeErrorMessage } from '../utils/error'
import type { NFTMetadata } from '../types/coreid'

interface Props {
  address: string
  coreId: bigint
  metadata: NFTMetadata | null
  formatAddress: (addr: string) => string
}

const props = defineProps<Props>()
const emit = defineEmits<{ checkedIn: [] }>()
const walletStore = useWalletStore()

const minCheckInInterval = ref(0n)
const expireDuration = ref(0n)
const now = ref(Math.floor(Date.now() / 1000))
const loadingCheckIn = ref(false)
const checkInError = ref<string | null>(null)
const checkInStatus = ref<string | null>(null)

const lastCheckInTime = computed(() => props.metadata?.lastCheckInTime ?? 0)
const isLive = computed(() => props.metadata?.liveness ?? false)
const sinceLastCheckIn = computed(() => Math.max(0, now.value - lastCheckInTime.value))
const canCheckIn = computed(() => sinceLastCheckIn.value >= Number(minCheckInInterval.value))

const sinceLastCheckInText = computed(() => {
  if (!lastCheckInTime.value) return '从未签到'
  return formatDuration(sinceLastCheckIn.value) + '前'
})

const checkInButtonText = computed(() => {
  if (loadingCheckIn.value) return '签到中...'
  if (canCheckIn.value) return '本月签到'
  const remaining = Number(minCheckInInterval.value) - sinceLastCheckIn.value
  return `还需等待 ${formatDuration(remaining)}`
})

const formatDuration = (seconds: number | bigint): string => {
  const s = Number(seconds)
  if (s <= 0) return '0分钟'
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (days > 0) return `${days}天${hours}小时`
  if (hours > 0) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

const loadCheckInParams = async () => {
  try {
    // multicall 聚合：2 次 RPC → 1 次
    const [interval, expire] = await publicClient.multicall({
      contracts: [
        { address: JVCORE_ADDRESS, abi: jvcoreABI, functionName: 'minCheckInInterval' },
        { address: JVCORE_ADDRESS, abi: jvcoreABI, functionName: 'expireDuration' },
      ],
      allowFailure: false,
    })
    minCheckInInterval.value = interval
    expireDuration.value = expire
  } catch (err) {
    console.error('[CoreIdCheckIn] 读取签到参数失败:', err)
  }
}

const handleCheckIn = async () => {
  if (!walletStore.address) { checkInError.value = '钱包未连接'; return }
  loadingCheckIn.value = true
  checkInError.value = null
  checkInStatus.value = null
  try {
    try { await switchChain(wagmiConfig, { chainId: jouleverseChain.id }) } catch {
      checkInError.value = '请先在钱包中手动切换到 Jouleverse 网络（Chain ID: 3666，RPC: https://rpc.jnsdao.com:8503）'
      loadingCheckIn.value = false
      return
    }
    const hash = await writeContract(wagmiConfig, {
      address: JVCORE_ADDRESS, abi: jvcoreABI, functionName: 'checkIn', args: [props.coreId],
    })
    checkInStatus.value = `交易已提交，等待链上确认... (${hash.slice(0, 10)}...)`
    await waitForTransactionReceipt(wagmiConfig, { hash })
    checkInStatus.value = '签到成功！状态已更新。'
    now.value = Math.floor(Date.now() / 1000)
    emit('checkedIn')
  } catch (error) {
    checkInError.value = '签到失败: ' + safeErrorMessage(error)
  } finally {
    loadingCheckIn.value = false
  }
}

onMounted(() => { loadCheckInParams() })
</script>

<style scoped>
.core-id-checkin { margin-top: 16px; }

.checkin-block {
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  padding: 20px;
}

.checkin-block h3 {
  margin: 0 0 12px 0;
  font-size: 1.05rem;
  color: var(--jv-text-primary);
}

.wallet-warning {
  background: var(--jv-warning-bg);
  border-color: var(--jv-warning) !important;
}

.wallet-warning h3 { color: var(--jv-warning); }
.wallet-warning p { margin: 8px 0; color: var(--jv-warning); }

.addr-mono {
  font-family: var(--jv-font-mono);
  font-size: 0.9rem;
}

.checkin-panel { background: var(--jv-bg-page); }

.wallet-info-badge {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--jv-success-bg);
  border: 1px solid var(--jv-success);
  border-radius: var(--jv-radius-md);
  padding: 8px 16px;
  margin-bottom: 16px;
}

.badge-connected {
  color: var(--jv-success);
  font-weight: 600;
}

.checkin-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--jv-border);
  font-size: 0.9rem;
}

.stat-label { color: var(--jv-text-muted); }
.stat-value { color: var(--jv-text-primary); font-weight: 500; }

.status-message {
  color: var(--jv-success);
  font-size: 0.85rem;
  margin: 8px 0 0 0;
}

.error-message {
  color: var(--jv-error);
  font-size: 0.85rem;
  margin: 8px 0 0 0;
}
</style>
