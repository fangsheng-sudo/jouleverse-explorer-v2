<template>
  <div class="address-detail">
    <div class="page-header">
      <button @click="$router.push('/')" class="back-btn">← 返回首页</button>
      <h1>地址详情</h1>
    </div>

    <JvPageState
      v-if="error"
      type="network-error"
      :description="error"
      action="返回首页"
      @action="$router.push('/')"
    />

    <div v-else class="address-info">
      <!-- 地址信息 -->
      <div class="panel">
        <h2>📍 地址信息</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">地址</span>
            <span
              class="value address-formats"
              role="button"
              tabindex="0"
              @click="cycleFormat"
              :title="formatLabelTitle + '（点击切换格式）'"
              @keydown.enter.prevent="cycleFormat"
              @keydown.space.prevent="cycleFormat"
            >
              <span class="format-badge">{{ formatLabel }}</span>
              {{ formatAddress(displayAddress) }}
            </span>
          </div>
          <div class="info-item all-formats">
            <span class="label">所有格式</span>
            <div class="format-list">
              <div
                class="format-row"
                role="button"
                tabindex="0"
                :class="{ active: inputFormat === 'hex' }"
                :title="FORMAT_HINTS.hex"
                :aria-describedby="'fmt-hint-hex'"
                @click="selectFormat('hex')"
                @keydown.enter.prevent="selectFormat('hex')"
                @keydown.space.prevent="selectFormat('hex')"
              >
                <span class="fmt-badge hex">HEX</span>
                <span class="fmt-value">{{ hexAddress }}</span>
              </div>
              <span :id="'fmt-hint-hex'" class="sr-only">{{ FORMAT_HINTS.hex }}</span>
              <div
                class="format-row"
                role="button"
                tabindex="0"
                :class="{ active: inputFormat === 'b32' }"
                :title="FORMAT_HINTS.b32"
                :aria-describedby="'fmt-hint-b32'"
                @click="selectFormat('b32')"
                @keydown.enter.prevent="selectFormat('b32')"
                @keydown.space.prevent="selectFormat('b32')"
              >
                <span class="fmt-badge b32">B32</span>
                <span class="fmt-value">{{ b32Address }}</span>
              </div>
              <span :id="'fmt-hint-b32'" class="sr-only">{{ FORMAT_HINTS.b32 }}</span>
              <div
                class="format-row"
                role="button"
                tabindex="0"
                :class="{ active: inputFormat === 'full' }"
                :title="FORMAT_HINTS.full"
                :aria-describedby="'fmt-hint-full'"
                @click="selectFormat('full')"
                @keydown.enter.prevent="selectFormat('full')"
                @keydown.space.prevent="selectFormat('full')"
              >
                <span class="fmt-badge full">JVA</span>
                <span class="fmt-value">{{ fullAddress }}</span>
              </div>
              <span :id="'fmt-hint-full'" class="sr-only">{{ FORMAT_HINTS.full }}</span>
            </div>
          </div>
          <div v-if="jnsName" class="info-item">
            <span class="label">JNS 域名</span>
            <span class="value jns-name">{{ jnsName }}.j</span>
          </div>
        </div>
      </div>

      <!-- 资产（配置驱动统一视图：J / WJ / NFT 余额 + JNS 明细） -->
      <div class="panel">
        <h2>💼 资产</h2>
        <CoreAssetsPanel :address="hexAddress" @wj-balance="wjBalance = $event" />
      </div>

      <!-- WJ 信息 -->
      <div class="panel">
        <h2>💰 Wrapped Joule (wJ)</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">合约地址</span>
            <JvHashText :value="WJ_ADDRESS" type="address" :truncate="8" />
          </div>
        </div>
        <div class="info-note">
          <p>ℹ️ wJ 是 Joule 的 ERC20 代币包装版本。1 wJ = 1 J，可以自由转账。</p>
        </div>
        <WJOperations :address="hexAddress" :wjBalance="wjBalance" :formatAddress="formatAddress" :formatBalance="formatBalance" />
      </div>

      <!-- Core ID -->
      <div class="panel">
        <h2>🆔 Core ID 与签到</h2>
        <CoreIdSection :address="hexAddress" :formatAddress="formatAddress" />
      </div>

      <!-- 代币转账记录 -->
      <div class="panel">
        <h2>📜 代币转账记录</h2>
        <div class="tx-toolbar">
          <span v-if="txLogsLoaded && !txLoadError" class="tx-count">{{ totalTxs }} 笔记录（仅代币转账，不含原生 J）</span>
          <span v-else-if="txLoadError" class="tx-count error">加载失败</span>
          <span v-else class="tx-count muted">查询中...</span>
          <div class="pagination">
            <button @click="prevYear" :disabled="!hasPrevYear || loadingTxs" class="page-btn">←</button>
            <span class="page-info"><strong>{{ currentYear }}</strong></span>
            <button @click="nextYear" :disabled="!hasNextYear || loadingTxs" class="page-btn">→</button>
          </div>
        </div>
        <p class="tx-scope-note">查询 {{ currentYear }} 年内的 ERC-20/ERC-721 代币转账记录</p>

        <JvLoading v-if="loadingTxs" label="加载中..." />

        <div v-else-if="transactions.length > 0" class="tx-list">
          <div
            v-for="(tx, index) in transactions"
            :key="index"
            class="tx-card"
            @click="$router.push(`/tx/${tx.hash}`)"
          >
            <div class="tx-card-head">
              <div class="tx-hash-row">
                <span class="muted">交易哈希</span>
                <JvHashText :value="tx.hash" type="tx" :truncate="10" :linkable="false" />
              </div>
              <span class="muted">{{ tx.age }}</span>
            </div>
            <div class="tx-card-body">
              <div class="meta-row">
                <span class="muted">区块</span>
                <span>#{{ tx.blockNumber }}</span>
              </div>
              <div class="meta-row">
                <span class="muted">发送者</span>
                <JvHashText :value="tx.from" type="address" :truncate="8" :linkable="false" />
              </div>
              <div class="meta-row">
                <span class="muted">接收者</span>
                <JvHashText v-if="tx.to" :value="tx.to" type="address" :truncate="8" :linkable="false" />
                <span v-else class="muted">合约创建</span>
              </div>
            </div>
          </div>
        </div>

        <JvPageState
          v-else-if="txLogsLoaded"
          :type="txLoadError ? 'network-error' : 'empty'"
          :title="txLoadError ? '转账记录加载失败' : '暂无代币转账记录'"
          :description="txLoadError ? '请刷新页面重试' : '该地址在最近的区块中无交易记录'"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatEther } from 'viem'
import { formatAddress } from '../utils/format'
import { WJ_ADDRESS } from '../contracts/wj'
import { JNS_ADDRESS, jnsABI } from '../contracts/jns'
import CoreAssetsPanel from '../components/CoreAssetsPanel.vue'
import WJOperations from './WJOperations.vue'
import CoreIdSection from './CoreIdSection.vue'
import { publicClient } from '../config/client'
import { encodeJVA, detectAddressFormat, normalizeToHex } from '../utils/jvaddress'
import { JvLoading, JvPageState, JvHashText } from '../design-system'
import { initTimeCache, getYearBlockRange, getAvailableYears, getAvgBlockTime } from '../utils/timestamp-to-block'

const router = useRouter()

interface Props { address: string }
const props = defineProps<Props>()

const error = ref<string | null>(null)
const inputFormat = ref<'hex' | 'b32' | 'full'>('hex')
const hexAddress = ref('')
const b32Address = ref('')
const fullAddress = ref('')

function initAddress(raw: string) {
  const format = detectAddressFormat(raw)
  if (format === 'unknown') { error.value = '无效的地址格式'; return false }
  inputFormat.value = format
  const hex = normalizeToHex(raw)
  if (!hex) { error.value = '地址格式无效'; return false }
  hexAddress.value = hex
  const encoded = encodeJVA(hex)
  if (encoded.success) { b32Address.value = encoded.b32Address; fullAddress.value = encoded.fullAddress }
  error.value = null
  return true
}

const jnsName = ref<string | null>(null)

// WJ 余额：由 CoreAssetsPanel 统一读取后通过 @wj-balance 事件回传，
// 消除此处与 useCoreAssets 的重复 balanceOf 读取
const wjBalance = ref<bigint | null>(null)

// 世代号：地址切换时作废在途请求，避免「B 的地址 + A 的余额」这类过期响应回写。
let loadSeq = 0
const isStale = (seq: number) => seq !== loadSeq

const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as `0x${string}`

const transactions = ref<any[]>([])
const loadingTxs = ref(false)
const currentYear = ref(new Date().getFullYear())
const totalTxs = ref(0)
const availableYears = ref<number[]>([])
const txLogsLoaded = ref(false)
const txLoadError = ref(false)

const hasPrevYear = computed(() => availableYears.value.length > 0 && currentYear.value > availableYears.value[0])
const hasNextYear = computed(() => availableYears.value.length > 0 && currentYear.value < availableYears.value[availableYears.value.length - 1])

const formatLabel = computed(() => ({ hex: 'HEX', b32: 'B32', full: 'JVA' }[inputFormat.value]))

// 地址格式悬停/无障碍说明：单一常量源（模板与当前格式提示共用，避免双份文案漂移）
const FORMAT_HINTS: Record<'hex' | 'b32' | 'full', string> = {
  hex: 'HEX：十六进制地址（EVM 标准格式）',
  b32: 'B32：Bech32m 编码地址',
  full: 'JVA：中文地址（BIP39 词表编码）',
}

const formatLabelTitle = computed(() => FORMAT_HINTS[inputFormat.value])

const displayAddress = computed(() => {
  if (inputFormat.value === 'hex') return hexAddress.value
  if (inputFormat.value === 'b32') return b32Address.value
  return fullAddress.value
})

initAddress(props.address)

function cycleFormat() {
  if (inputFormat.value === 'hex') inputFormat.value = 'b32'
  else if (inputFormat.value === 'b32') inputFormat.value = 'full'
  else inputFormat.value = 'hex'
}

function selectFormat(fmt: 'hex' | 'b32' | 'full') {
  inputFormat.value = fmt
  const addr = fmt === 'hex' ? hexAddress.value : fmt === 'b32' ? b32Address.value : fullAddress.value
  router.replace({ params: { ...router.currentRoute.value.params, address: addr } })
}

const formatBalance = (bal: bigint | null): string => {
  if (bal === null || bal === 0n) return '0'
  return parseFloat(formatEther(bal)).toFixed(4)
}


const loadJnsName = async (seq = loadSeq) => {
  try {
    const name = await publicClient.readContract({ address: JNS_ADDRESS, abi: jnsABI, functionName: 'addr2name', args: [hexAddress.value as `0x${string}`] }) as string
    if (isStale(seq)) return
    jnsName.value = name || null
  } catch {
    if (isStale(seq)) return
    jnsName.value = null
  }
}

/** 获取某年中与目标地址相关的代币转账日志 */
const loadTransactions = async (year: number, seq = loadSeq) => {
  loadingTxs.value = true
  transactions.value = []
  txLogsLoaded.value = false
  txLoadError.value = false

  try {
    // 初始化时间缓存（用最新区块校准平均出块时间）
    const latestBlock = await publicClient.getBlockNumber()
    const latestData = await publicClient.getBlock({ blockNumber: latestBlock })
    initTimeCache(latestBlock, Number(latestData.timestamp))
    if (isStale(seq)) return
    availableYears.value = getAvailableYears(latestBlock)

    const { fromBlock, toBlock } = getYearBlockRange(year)
    const addr = hexAddress.value.toLowerCase()
    const paddedAddr = ('0x' + '0'.repeat(24) + addr.slice(2)) as `0x${string}`

    // 已知代币合约地址列表（必须指定 address 字段，否则 RPC 全量扫描超时）
    const TOKEN_CONTRACTS = [
      '0x7fba9BB966189Db8C4fE33B7bf67Bfa24203c6AD', // WJ
      '0xf8AbF36Bb2dc525b1E566d6B42F6Fd1BB2035b89', // JNS
      '0x8d214415b9c5F5E4Cf4CbCfb4a5DEd47fb516392', // Core ID
      '0xCb1429da13cE40e75519148e796C6D58dD6b1a8E', // PopBadge
    ]

    // ⚠️ viem 的 getLogs 有 bug：会丢弃 topics[1+] 过滤条件
    // 改用 raw JSON-RPC 请求，确保 topics 参数正确发送
    const rpcRequest = (publicClient.transport as any).request.bind(publicClient.transport)
    const toHex = (n: bigint) => '0x' + n.toString(16)

    const [outResult, inResult] = await Promise.all([
      rpcRequest({
        method: 'eth_getLogs',
        params: [{
          address: TOKEN_CONTRACTS,
          topics: [TRANSFER_SIG, paddedAddr, null],
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
        }],
      }).catch(() => [] as any[]),
      rpcRequest({
        method: 'eth_getLogs',
        params: [{
          address: TOKEN_CONTRACTS,
          topics: [TRANSFER_SIG, null, paddedAddr],
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
        }],
      }).catch(() => [] as any[]),
    ])
    if (isStale(seq)) return
    const outLogs: any[] = outResult
    const inLogs: any[] = inResult

    // 去重（同一笔 tx 可能同时触发转入+转出）
    const seen = new Set<string>()
    const allLogs = [...outLogs, ...inLogs].filter(log => {
      if (seen.has(log.transactionHash)) return false
      seen.add(log.transactionHash)
      return true
    })
    // 按区块号降序排列
    allLogs.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber))

    totalTxs.value = allLogs.length

    if (allLogs.length === 0) {
      txLogsLoaded.value = true
      return
    }

    // 从 log topics 中提取 from/to 地址（不需要 getTransaction）
    // topics[1] = from (32字节左填充地址), topics[2] = to
    // 用区块号差 × 平均出块时间 估算年龄（不需要 getBlock 逐块查时间戳）
    const avgSec = getAvgBlockTime()

    if (isStale(seq)) return
    transactions.value = allLogs.map(log => {
      const fromAddr = ('0x' + (log.topics[1] as string).slice(26)) as string
      const toAddr = ('0x' + (log.topics[2] as string).slice(26)) as string
      const blockN = Number(log.blockNumber)
      const estSec = (Number(latestBlock) - blockN) * avgSec
      const age = formatBlockAgeShort(estSec)
      return {
        hash: log.transactionHash,
        from: fromAddr,
        to: toAddr,
        blockNumber: log.blockNumber,
        age,
      }
    })

    txLogsLoaded.value = true
    txLoadError.value = false
  } catch (e) {
    if (isStale(seq)) return
    console.error('loadTransactions error:', e)
    transactions.value = []
    txLoadError.value = true
    totalTxs.value = 0
  } finally {
    if (!isStale(seq)) loadingTxs.value = false
  }
}

/** 用区块号差估算年龄（无需 RPC） */
function formatBlockAgeShort(estSec: number): string {
  if (estSec < 60) return `${Math.floor(estSec)} 秒前`
  if (estSec < 3600) return `${Math.floor(estSec / 60)} 分钟前`
  if (estSec < 86400) return `${Math.floor(estSec / 3600)} 小时前`
  return `${Math.floor(estSec / 86400)} 天前`
}

const prevYear = () => {
  if (hasPrevYear.value) {
    const idx = availableYears.value.indexOf(currentYear.value)
    if (idx > 0) {
      currentYear.value = availableYears.value[idx - 1]
      loadTransactions(currentYear.value)
    }
  }
}

const nextYear = () => {
  if (hasNextYear.value) {
    const idx = availableYears.value.indexOf(currentYear.value)
    if (idx < availableYears.value.length - 1) {
      currentYear.value = availableYears.value[idx + 1]
      loadTransactions(currentYear.value)
    }
  }
}

onMounted(() => {
  if (error.value) return
  reloadAddressData()
})

// 同组件路由切换（地址页内点合约地址 / 区块页 miner / 交易页 from-to 跳转）时，
// props.address 变化但组件实例复用，setup 只跑一次 → 必须靠 watch 重建数据。
watch(() => props.address, (v) => {
  // 格式互切（HEX/B32/JVA 三行之间点击）指向同一底层地址时，只更新展示格式，
  // 不重打整轮 RPC。!error.value 不可省：否则「无效地址 → 回到正确地址」会卡在错误页。
  // 注意：B32/JVA 解码出来的 hex 是小写，hexAddress 保留用户输入的 checksum 大小写，
  // 必须小写比较，否则格式互切永远判定为「地址变了」。
  const nextHex = normalizeToHex(v)
  if (!error.value && nextHex && nextHex.toLowerCase() === hexAddress.value.toLowerCase()) return
  if (initAddress(v) === false) return
  reloadAddressData()
})

function reloadAddressData() {
  const seq = ++loadSeq
  jnsName.value = null
  wjBalance.value = null
  transactions.value = []
  totalTxs.value = 0
  currentYear.value = new Date().getFullYear()
  availableYears.value = []
  txLogsLoaded.value = false
  txLoadError.value = false
  loadJnsName(seq)
  loadTransactions(currentYear.value, seq)
}
</script>

<style scoped>
.address-detail {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.page-header { margin-bottom: 24px; }

.back-btn {
  background: var(--jv-bg-subtle);
  color: var(--jv-text-muted);
  border: none;
  padding: 8px 16px;
  border-radius: var(--jv-radius-md);
  cursor: pointer;
  margin-bottom: 16px;
  display: inline-block;
  transition: background var(--jv-duration-fast) var(--jv-ease);
}
.back-btn:hover { background: var(--jv-bg-hover); }

.page-header h1 { color: var(--jv-text-primary); margin: 0; }

.address-info { display: flex; flex-direction: column; gap: 24px; }

/* ── Panel ── */
.panel {
  background: var(--jv-bg-surface);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  padding: 24px;
}

.panel h2 {
  color: var(--jv-text-primary);
  margin: 0 0 18px 0;
  font-size: 1.1rem;
  font-weight: 600;
}

/* ── Info grid ── */
.info-grid { display: grid; gap: 12px; }

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px;
  background: var(--jv-bg-subtle);
  border-radius: var(--jv-radius-md);
  gap: 12px;
}

.info-item .label {
  color: var(--jv-text-muted);
  font-size: 0.88rem;
  min-width: 120px;
  flex-shrink: 0;
}

.info-item .value {
  color: var(--jv-text-primary);
  font-size: 0.9rem;
  word-break: break-all;
  text-align: right;
}

.muted { color: var(--jv-text-muted); font-size: 0.85rem; }

/* ── Address format switcher ── */
.address-formats { cursor: pointer; }

.address-formats:focus-visible {
  outline: 2px solid var(--jv-brand);
  outline-offset: 2px;
}

.format-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--jv-radius-sm);
  margin-right: 6px;
  background: var(--jv-brand);
  color: #fff;
  vertical-align: middle;
}

.all-formats { flex-direction: column; align-items: flex-end; }

.format-list { display: flex; flex-direction: column; gap: 4px; width: auto; align-items: flex-start; }

.format-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--jv-radius-md);
  cursor: pointer;
  font-size: 0.82rem;
  transition: background var(--jv-duration-fast) var(--jv-ease);
  width: auto;
  min-width: fit-content;
}

.format-row:hover { background: var(--jv-bg-hover); }

/* 键盘焦点：比 active 态 1px outline 更重的 2px 焦点环，避免选中行时焦点指示被 active outline 覆盖 */
.format-row:focus-visible {
  outline: 2px solid var(--jv-brand);
  outline-offset: 2px;
}
/* 焦点落在选中行（active+focus 同时命中）时，保证焦点环不被 active 态 1px outline 覆盖：
   主动升特异性，不依赖源码声明顺序 */
.format-row.active:focus-visible {
  outline: 2px solid var(--jv-brand);
  outline-offset: 2px;
}

/* 屏幕阅读器专属隐藏文本（aria-describedby 指向，不占视觉空间） */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.format-row.active {
  background: var(--jv-brand-subtle);
  outline: 1px solid var(--jv-brand);
}

.fmt-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--jv-radius-sm);
  min-width: 34px;
  text-align: center;
  flex-shrink: 0;
}

.fmt-badge.hex { background: var(--jv-info-bg); color: var(--jv-info); }
.fmt-badge.b32 { background: var(--jv-success-bg); color: var(--jv-success); }
.fmt-badge.full { background: var(--jv-warning-bg); color: var(--jv-warning); }

.fmt-value {
  font-family: var(--jv-font-mono);
  color: var(--jv-text-secondary);
  word-break: break-all;
  font-size: 0.8rem;
}

/* ── JNS name ── */
.jns-name { font-weight: 600; color: var(--jv-brand); font-size: 1.05rem; }

/* ── Info note ── */
.info-note {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--jv-info-bg);
  border-radius: var(--jv-radius-md);
  border-left: 3px solid var(--jv-info);
}

.info-note p { margin: 0; color: var(--jv-info); font-size: 0.875rem; }

/* ── TX section ── */
.tx-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--jv-border);
}

.tx-count { font-size: 0.875rem; color: var(--jv-text-secondary); }
.tx-count.error { color: var(--jv-error); }

.tx-scope-note {
  font-size: 0.8rem;
  color: var(--jv-text-muted);
  margin: 0 0 16px 0;
}

.tx-list { display: flex; flex-direction: column; gap: 10px; }

.tx-card {
  padding: 14px 16px;
  background: var(--jv-bg-subtle);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  cursor: pointer;
  transition: background var(--jv-duration-fast) var(--jv-ease),
              border-color var(--jv-duration-fast) var(--jv-ease);
}

.tx-card:hover {
  background: var(--jv-brand-subtle);
  border-color: var(--jv-brand);
}

.tx-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.tx-hash-row { display: flex; align-items: center; gap: 8px; }

.tx-card-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 6px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: var(--jv-text-secondary);
}

/* ── Pagination ── */
.pagination { display: flex; align-items: center; gap: 10px; }

.page-btn {
  background: var(--jv-bg-subtle);
  color: var(--jv-text-secondary);
  border: 1px solid var(--jv-border);
  padding: 5px 12px;
  border-radius: var(--jv-radius-md);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background var(--jv-duration-fast) var(--jv-ease);
}

.page-btn:hover:not(:disabled) { background: var(--jv-brand-subtle); border-color: var(--jv-brand); color: var(--jv-brand); }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-info { color: var(--jv-text-muted); font-size: 0.85rem; }
</style>
