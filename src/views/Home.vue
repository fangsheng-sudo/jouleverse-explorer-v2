<template>
  <div class="home">
    <div class="page-header">
      <div class="logo-row">
        <svg width="40" height="40" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <circle cx="256" cy="256" r="256" fill="#EB1727"/>
          <path fill="#fefefe" d="M202.4025 130.5h127.195q.2 75-.5 150-5 79.5-82.5 97.5-34.4 6.2-68-3-54.3-18.8-64.5-75.5a133 133 0 0 1-2.5-28h56q3.2 66.9 69 55.5 27-8 33.5-35.5.3-4.3 2-13 .7-49 .5-98a1260 1260 0 0 0-71-1M305.6 226l60 100 60-100"/>
        </svg>
        <h1>Jouleverse</h1>
      </div>

      <div class="status-bar">
        <div class="status-pill" :class="{ online: networkStatus === 'online', offline: networkStatus === 'offline' }">
          <span class="dot"></span>
          <span>{{ networkStatus === 'online' ? '网络在线' : networkStatus === 'offline' ? '网络离线' : '检测中...' }}</span>
        </div>
        <div class="stat-pill" v-if="latestBlock">
          <span class="pill-label">最新区块</span>
          <span class="pill-value">#{{ latestBlock.number }}</span>
        </div>
        <div class="stat-pill" v-if="networkUptime">
          <span class="pill-label">稳定运行</span>
          <span class="pill-value">{{ networkUptime }}</span>
        </div>
        <div class="stat-pill" v-if="wsConnected">
          <span class="pill-label">实时推送</span>
          <span class="pill-value ws-live">✓ 在线</span>
        </div>
      </div>
    </div>

    <div class="content">
      <!-- 搜索框 -->
      <div class="search-section">
        <div class="search-box">
          <input
            v-model="searchQuery"
            @keyup.enter="handleSearch"
            placeholder="搜索区块、交易、地址或 JNS 域名..."
            class="search-input"
          >
          <button @click="handleSearch" class="search-btn">搜索</button>
        </div>
        <div class="search-hints">
          {{ t('quickLinks') }}<router-link to="/jns" class="quick-link">{{ t('navJnsQuery') }}</router-link>
          <router-link to="/domains" class="quick-link">{{ t('navEntry') }}</router-link>
          <router-link to="/tools" class="quick-link">{{ t('navTools') }}</router-link>
        </div>
      </div>

      <!-- Timelock 能量信息 -->
      <div class="panel">
        <div class="panel-header">
          <h2>Timelock 能量信息</h2>
        </div>
        <JvLoading v-if="timelockLoading" label="加载能量数据中..." />
        <div v-else class="timelock-grid">
          <div class="timelock-card" v-if="timelockCore">
            <div class="card-title">核心时间锁</div>
            <div class="card-stats">
              <div class="stat-cell" v-for="(val, label) in timelockCoreStats" :key="label">
                <span class="stat-label">{{ label }}</span>
                <span class="stat-value" :class="{ highlight: label === '可用余额' }">{{ val }}</span>
              </div>
            </div>
          </div>
          <div class="timelock-card" v-if="timelockEco">
            <div class="card-title">生态时间锁</div>
            <div class="card-stats">
              <div class="stat-cell" v-for="(val, label) in timelockEcoStats" :key="label">
                <span class="stat-label">{{ label }}</span>
                <span class="stat-value" :class="{ highlight: label === '可用余额' }">{{ val }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 最新区块列表 -->
      <div class="panel">
        <div class="panel-header">
          <h2>最新区块</h2>
          <button @click="$router.push('/blocks')" class="link-btn">查看全部 →</button>
        </div>
        <JvLoading v-if="loading" label="加载区块数据中..." />
        <div v-else-if="blocks.length > 0" class="blocks-list">
          <div
            v-for="block in blocks"
            :key="block.hash"
            class="block-card"
            :class="{ 'block-card--new': block.isNew }"
            @click="$router.push(`/block/${block.number}`)"
          >
            <div class="block-card-head">
              <div class="block-num-row">
                <span class="muted">区块</span>
                <span class="block-num">#{{ block.number }}</span>
              </div>
              <div class="block-age-row">
                <span v-if="block.isNew" class="new-badge">新</span>
                <span class="muted">{{ formatAge(block.timestamp) }}</span>
              </div>
            </div>
            <div class="block-card-body">
              <div class="meta-row">
                <span class="muted">哈希</span>
                <JvHashText :value="block.hash" type="block" :truncate="8" :linkable="false" :copyable="false" />
              </div>
              <div class="meta-row">
                <span class="muted">交易数</span>
                <span>{{ block.transactions.length }}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Gas</span>
                <span>{{ formatNumber(block.gasUsed) }}</span>
              </div>
            </div>
          </div>
        </div>
        <JvPageState v-else type="empty" title="暂无区块数据" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { isAddress, formatUnits } from 'viem'
import type { Block as ViemBlock } from 'viem'
import { watchBlocks } from 'viem/actions'
import { formatAge, formatNumber } from '../utils/format'
import { timelockABI, TIMELOCK_CORE_ADDRESS, TIMELOCK_ECO_ADDRESS } from '../contracts/timelock'
import type { TimelockData } from '../contracts/timelock'
import { publicClient, wsPublicClient } from '../config/client'
import { detectAddressFormat } from '../utils/jvaddress'
import { JvLoading, JvPageState, JvHashText } from '../design-system'
import { t } from '../i18n'

const router = useRouter()

interface Block {
  number: number
  hash: string
  timestamp: number
  transactions: string[]
  gasUsed: bigint
  isNew?: boolean
}

const networkStatus = ref<'online' | 'offline' | 'unknown'>('unknown')
const blocks = ref<Block[]>([])
const latestBlock = ref<Block | null>(null)
const loading = ref(false)
const searchQuery = ref('')
const networkUptime = ref('')
const wsConnected = ref(false)

let unwatchBlocks: (() => void) | null = null

const timelockCore = ref<TimelockData | null>(null)
const timelockEco = ref<TimelockData | null>(null)
const timelockLoading = ref(false)


const formatUptime = (genesis: number): string => {
  const diff = Math.floor(Date.now() / 1000) - genesis
  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)
  const years = Math.floor(days / 365)
  const remDays = days % 365
  if (years > 0) return `${years}年${remDays}天${hours}小时`
  if (days > 0) return `${days}天${hours}小时`
  return `${hours}小时${Math.floor((diff % 3600) / 60)}分钟`
}


const formatEnergy = (num: bigint): string => {
  const v = Number(formatUnits(num, 18))
  if (v >= 1e8) return `${(v / 1e8).toFixed(2).replace(/\.00$/, '')}亿 J`
  if (v >= 1e4) return `${(v / 1e4).toFixed(2).replace(/\.00$/, '')}万 J`
  return `${v.toFixed(2).replace(/\.00$/, '')} J`
}

const timelockCoreStats = computed(() => timelockCore.value ? ({
  '月度预算': formatEnergy(timelockCore.value.monthlyBudget),
  '已使用': formatEnergy(timelockCore.value.used),
  '已释放': formatEnergy(timelockCore.value.released),
  '可用余额': formatEnergy(timelockCore.value.available),
}) : {})

const timelockEcoStats = computed(() => timelockEco.value ? ({
  '月度预算': formatEnergy(timelockEco.value.monthlyBudget),
  '已使用': formatEnergy(timelockEco.value.used),
  '已释放': formatEnergy(timelockEco.value.released),
  '可用余额': formatEnergy(timelockEco.value.available),
}) : {})

const fetchTimelockData = async (address: string) => {
  try {
    // multicall 聚合：5 次 RPC → 1 次（multicall3 2026-08-11 自部署）
    const [monthlyBudget, monthlyBlocks, used, released, available] = await publicClient.multicall({
      contracts: [
        { address: address as `0x${string}`, abi: timelockABI, functionName: 'MONTHLY_BUDGET' },
        { address: address as `0x${string}`, abi: timelockABI, functionName: 'MONTHLY_BLOCKS' },
        { address: address as `0x${string}`, abi: timelockABI, functionName: 'used' },
        { address: address as `0x${string}`, abi: timelockABI, functionName: 'released' },
        { address: address as `0x${string}`, abi: timelockABI, functionName: 'available' },
      ],
      allowFailure: false,
    })
    return { monthlyBudget, monthlyBlocks, used, released, available } as TimelockData
  } catch { return null }
}

const fetchAllTimelockData = async () => {
  timelockLoading.value = true
  try {
    const [core, eco] = await Promise.all([
      fetchTimelockData(TIMELOCK_CORE_ADDRESS),
      fetchTimelockData(TIMELOCK_ECO_ADDRESS),
    ])
    timelockCore.value = core
    timelockEco.value = eco
  } finally { timelockLoading.value = false }
}

const GENESIS_TIMESTAMP = 1664451960

const fetchLatestBlocks = async () => {
  loading.value = true
  try {
    const latest = await publicClient.getBlockNumber()
    networkUptime.value = formatUptime(GENESIS_TIMESTAMP)
    const blockNumbers = Array.from({ length: 10 }, (_, i) => latest - BigInt(i))
    const fetched = await Promise.all(blockNumbers.map(n => publicClient.getBlock({ blockNumber: n })))
    if (fetched[0]) {
      latestBlock.value = {
        number: Number(latest),
        hash: fetched[0].hash || '',
        timestamp: Number(fetched[0].timestamp),
        transactions: fetched[0].transactions as string[],
        gasUsed: fetched[0].gasUsed,
      }
      const diff = Math.floor(Date.now() / 1000) - Number(fetched[0].timestamp)
      networkStatus.value = diff < 300 ? 'online' : 'offline'
    }
    blocks.value = fetched.filter(Boolean).map(b => ({
      number: Number(b!.number),
      hash: b!.hash || '',
      timestamp: Number(b!.timestamp),
      transactions: b!.transactions as string[],
      gasUsed: b!.gasUsed,
    }))
  } catch { networkStatus.value = 'offline' }
  finally { loading.value = false }
}

// viem watchBlocks：WS transport 下自动使用 eth_subscribe('newHeads') 推送
// - 断线自动重连（viem transport 层内置，指数退避）
// - emitOnBegin：连接建立后立即推送一次当前最新块（作为初始帧，不标"新"）
// - 用块号递增判断真实新区块，避免 viem prevBlock 在首帧为 undefined 导致漏标
let lastBlockNumber = 0n
const setupBlockWatch = () => {
  unwatchBlocks = watchBlocks(wsPublicClient, {
    emitOnBegin: true,
    onBlock: (block) => {
      const isNew = lastBlockNumber !== 0n && block.number > lastBlockNumber
      lastBlockNumber = block.number
      handleNewBlock(block, isNew)
    },
    onError: (err) => {
      wsConnected.value = false
      console.error('[Home] 区块推送订阅错误:', err)
    },
  })
}

const handleNewBlock = (b: ViemBlock, markNew: boolean) => {
  const newBlock: Block = {
    number: Number(b.number),
    hash: b.hash || '',
    timestamp: Number(b.timestamp),
    transactions: (b.transactions as string[]) || [],
    gasUsed: b.gasUsed,
    isNew: markNew,
  }
  latestBlock.value = newBlock
  networkStatus.value = 'online'
  wsConnected.value = true
  // 按 hash 去重后插入头部，避免与初始 HTTP 加载重复
  blocks.value = [newBlock, ...blocks.value.filter(x => x.hash !== newBlock.hash)].slice(0, 10)
  if (markNew) {
    setTimeout(() => {
      const blk = blocks.value.find(x => x.hash === newBlock.hash)
      if (blk) blk.isNew = false
    }, 3000)
  }
}

const handleSearch = () => {
  const q = searchQuery.value.trim()
  if (!q) return
  if (q.toLowerCase().endsWith('.j')) { router.push(`/jns?domain=${q}`); return }
  if (/^\d+$/.test(q)) { router.push(`/block/${q}`); return }
  if (q.length === 66 && q.startsWith('0x')) { router.push(`/tx/${q}`); return }
  if (isAddress(q) || detectAddressFormat(q) !== 'unknown') { router.push(`/address/${q}`); return }
  router.push(`/block/${q}`)
}

onMounted(() => { fetchLatestBlocks(); fetchAllTimelockData(); setupBlockWatch() })
onUnmounted(() => { unwatchBlocks?.() })
</script>

<style scoped>
.home {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

/* ── Header ── */
.page-header {
  padding: 28px 0;
  border-bottom: 1px solid var(--jv-border);
  margin-bottom: 28px;
}

.logo-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}

.logo-row h1 {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--jv-text-primary);
}

.status-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.status-pill, .stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--jv-bg-subtle);
  border-radius: var(--jv-radius-full);
  font-size: 0.85rem;
}

.status-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--jv-text-muted);
  flex-shrink: 0;
}

.status-pill { color: var(--jv-text-muted); }

.status-pill.online { background: var(--jv-success-bg); color: var(--jv-success); }
.status-pill.online .dot { background: var(--jv-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--jv-success) 25%, transparent); }
.status-pill.offline { background: var(--jv-error-bg); color: var(--jv-error); }
.status-pill.offline .dot { background: var(--jv-error); }

.pill-label { color: var(--jv-text-muted); }
.pill-value { color: var(--jv-text-primary); font-weight: 600; }
.ws-live { color: var(--jv-success); }

/* ── Content ── */
.content { display: flex; flex-direction: column; gap: 24px; }

/* ── Search ── */
.search-section { }

.search-box {
  display: flex;
  gap: 10px;
  max-width: 640px;
}

.search-input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  font-size: 0.95rem;
  background: var(--jv-bg-surface);
  color: var(--jv-text-primary);
  outline: none;
  transition: border-color var(--jv-duration-fast) var(--jv-ease);
}

.search-input::placeholder { color: var(--jv-text-muted); }
.search-input:focus {
  border-color: var(--jv-border-focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--jv-brand) 12%, transparent);
}

.search-btn {
  padding: 12px 22px;
  background: var(--jv-brand);
  color: #fff;
  border: none;
  border-radius: var(--jv-radius-lg);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--jv-duration-fast) var(--jv-ease), transform var(--jv-duration-fast);
  white-space: nowrap;
}

.search-btn:hover { background: var(--jv-brand-hover); transform: translateY(-1px); }
.search-btn:active { background: var(--jv-brand-pressed); transform: translateY(0); }

.search-hints {
  margin-top: 10px;
  font-size: 0.82rem;
  color: var(--jv-text-muted);
}

.quick-link {
  color: var(--jv-link);
  text-decoration: none;
  margin-left: 6px;
}
.quick-link:hover { text-decoration: underline; color: var(--jv-link-hover); }

/* ── Panel ── */
.panel {
  background: var(--jv-bg-surface);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  padding: 20px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--jv-text-primary);
}

.link-btn {
  background: none;
  border: none;
  color: var(--jv-link);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: var(--jv-radius-md);
  transition: background var(--jv-duration-fast) var(--jv-ease);
}
.link-btn:hover { background: var(--jv-brand-subtle); }

/* ── Timelock ── */
.timelock-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.timelock-card {
  background: var(--jv-bg-subtle);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  padding: 16px;
}

.card-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--jv-text-primary);
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--jv-border);
}

.card-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--jv-bg-surface);
  border-radius: var(--jv-radius-md);
  border: 1px solid var(--jv-border);
}

.stat-label { color: var(--jv-text-muted); font-size: 0.78rem; }
.stat-value { color: var(--jv-text-primary); font-size: 0.95rem; font-weight: 600; }
.stat-value.highlight { color: var(--jv-brand); }

/* ── Blocks list ── */
.blocks-list { display: flex; flex-direction: column; gap: 10px; }

.block-card {
  padding: 14px 16px;
  background: var(--jv-bg-subtle);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  cursor: pointer;
  transition: background var(--jv-duration-fast) var(--jv-ease),
              border-color var(--jv-duration-fast) var(--jv-ease),
              transform var(--jv-duration-fast) var(--jv-ease);
}

.block-card:hover {
  background: var(--jv-brand-subtle);
  border-color: var(--jv-brand);
  transform: translateY(-2px);
}

.block-card--new {
  background: var(--jv-success-bg) !important;
  border-color: var(--jv-success) !important;
  animation: slideIn var(--jv-duration-normal) var(--jv-ease) both;
}

@keyframes slideIn {
  from { transform: translateY(-8px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.block-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.block-num-row { display: flex; align-items: center; gap: 6px; }
.block-num { font-size: 1.1rem; font-weight: 700; color: var(--jv-text-primary); }
.block-age-row { display: flex; align-items: center; gap: 6px; }
.muted { color: var(--jv-text-muted); font-size: 0.85rem; }

.block-card-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 6px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: var(--jv-text-secondary);
}

.new-badge {
  display: inline-block;
  padding: 2px 7px;
  background: var(--jv-success);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: var(--jv-radius-sm);
  animation: pulse 1.8s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.65; }
}

@media (max-width: 768px) {
  .page-header { padding: 18px 0; }
  .logo-row h1 { font-size: 1.4rem; }
  .status-bar { gap: 8px; }
  .search-box { max-width: 100%; }
  .timelock-grid { grid-template-columns: 1fr; }
  .block-card-body { grid-template-columns: 1fr; }
}
</style>
