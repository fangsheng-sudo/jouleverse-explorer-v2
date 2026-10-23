<template>
  <div class="core-assets-panel">
    <JvLoading v-if="isLoading" :label="t('assetsLoading')" />
    <JvPageState
      v-else-if="error"
      type="network-error"
      :description="error"
      :action="t('retry')"
      @action="load"
    />
    <JvPageState
      v-else-if="isEmpty"
      type="empty"
      :title="t('noAssetsTitle')"
      :description="t('noAssetsDesc')"
    />
    <template v-else>
      <!-- 余额类（native / erc20）+ NFT 数量概览：一次 multicall 结果 -->
      <div class="asset-list">
        <template
          v-for="item in balances"
          :key="item.asset.key"
        >
          <div class="asset-row">
            <span class="asset-icon" :style="iconStyle(item.asset.icon)" role="img" :aria-label="item.asset.name" :title="item.asset.name"></span>
            <div class="asset-main">
              <span class="asset-name">{{ item.asset.name }}</span>
              <span class="asset-symbol muted">{{ item.asset.symbol }}</span>
            </div>
            <div class="asset-value">
              <JvAmount
                v-if="isFungible(item.asset) && item.value !== null"
                :value="item.value"
                :decimals="item.asset.decimals ?? 18"
                :unit="item.asset.symbol"
              />
              <span v-else-if="isFungible(item.asset)" class="muted">—</span>
              <span v-else class="asset-count">
                {{ item.value === null ? '—' : `${formatCount(item.value)} ${t('countUnit')}` }}
              </span>
            </div>
            <!-- 可枚举 NFT：持有 > 0 时提供「展开」入口（二级懒加载） -->
            <button
              v-if="isEnumerableNft(item.asset.key) && item.value !== null && item.value > 0n"
              class="btn-expand"
              :class="{ active: expandedKey === item.asset.key }"
              @click="toggleExpand(item.asset.key)"
            >
              {{ expandedKey === item.asset.key ? t('collapse') : t('expand') }}
            </button>
          </div>

          <!-- 展开后的 NFT 枚举（分页懒加载，首屏 RPC 不受影响） -->
          <div v-if="expandedKey === item.asset.key" class="nft-enum-panel">
            <div class="nft-enum-head muted">
              {{ t('nftDetailSuffix', { name: item.asset.name }) }}
            </div>
            <JvLoading v-if="nftEnumLoading && nftEnumItems.length === 0" :label="t('loadingText')" />
            <div v-else-if="nftEnumError" class="nft-enum-error muted">
              {{ t('enumError', { err: nftEnumError }) }}
              <button class="btn-load-more" @click="nftEnumLoadMore">{{ t('retry') }}</button>
            </div>
            <div v-else class="nft-enum-list">
              <div v-for="(it, index) in nftEnumItems" :key="`${it.tokenId}-${index}`" class="nft-enum-item">
                <img v-if="it.image" :src="it.image" :alt="it.name" class="nft-enum-img" loading="lazy" />
                <div v-else class="nft-enum-img nft-enum-fallback">🖼️</div>
                <span class="nft-enum-name" :title="it.name">{{ it.name }}</span>
              </div>
            </div>
            <div v-if="nftEnumLoaded < enumTotalCount" class="nft-enum-more">
              <button class="btn-load-more" :disabled="nftEnumLoading" @click="nftEnumLoadMore">
                {{ nftEnumLoading ? t('loadingText') : t('loadMoreProgress', { loaded: nftEnumLoaded, total: enumTotalCount }) }}
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- JNS 域名枚举：分页懒加载，首屏只出前几个 -->
      <div v-if="jnsTotal !== 0 || loadingJns" class="jns-detail">
        <div class="jns-detail-head">
          <span class="muted">{{ t('jnsHoldingDetail') }}</span>
        </div>
        <JvLoading v-if="loadingJns && jnsNames.length === 0" :label="t('loadingText')" />
        <div v-else-if="jnsTotal === null" class="jns-unknown muted">
          {{ t('jnsCountUnknown') }}
        </div>
        <div v-else>
          <div class="jns-list">
            <span v-for="name in jnsNames" :key="name" class="jns-tag" @click="goJnsDetail(name)">{{ name }}.j</span>
          </div>
          <div v-if="jnsLoaded < Math.min(jnsTotalNum, JNS_MAX_DISPLAY)" class="jns-more">
            <button class="btn-load-more" :disabled="loadingJns" @click="loadMoreJns">
              {{ loadingJns ? t('loadingText') : t('loadMoreProgress', { loaded: jnsLoaded, total: Math.min(jnsTotalNum, JNS_MAX_DISPLAY) }) }}
            </button>
          </div>
          <p v-if="jnsTotalNum > JNS_MAX_DISPLAY" class="jns-overflow-hint muted">
            {{ t('jnsOverflowPrefix') }}<a @click.prevent="$router.push('/jns')" href="#">{{ t('jnsQueryLink') }}</a>{{ t('jnsOverflowSuffix') }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchJnsHoldingBatch } from '../utils/jns-holdings'
import { useCoreAssets } from '../composables/useCoreAssets'
import { useNftEnumeration } from '../composables/useNftEnumeration'
import { JvLoading, JvPageState, JvAmount } from '../design-system'
import { CORE_ASSETS } from '../config/core-assets'
import type { CoreAsset } from '../config/core-assets'
import { t } from '../i18n'

interface Props { address: string }
const props = defineProps<Props>()

const router = useRouter()

const { balances, isLoading, error, load, getBalance } = useCoreAssets(() => props.address)

const emit = defineEmits<{
  (e: 'wj-balance', value: bigint | null): void
}>()

// 余额加载完成后把 WJ 余额上报父级（AddressDetail 喂给 WJOperations），
// 消除 AddressDetail 里 loadWJBalance 的重复 balanceOf 读取
watch(balances, () => {
  emit('wj-balance', getBalance('wj'))
})

const isFungible = (a: CoreAsset) => a.kind === 'native' || a.kind === 'erc20'

// 资产图标改用 CSS mask 渲染（7 个 SVG 均为单色，fill/stroke 全用 currentColor）：
// mask 取 SVG 的 alpha 通道（轮廓），与内部颜色无关；真正的颜色由宿主 background: currentColor 决定，
// 因此暗/亮色自动跟随 var(--jv-text-primary)，且 SVG 源文件无需任何改动。
// 内联 style 绑定避免 CSS url() 的路径解析问题，需同时给 mask-image 与 -webkit-mask-image（Safari 前缀）。
const iconStyle = (icon: string) => ({
  maskImage: `url("${icon}")`,
  WebkitMaskImage: `url("${icon}")`,
})

// 空态判定：加载完成、无错误、且所有资产余额均为 0n 时才算「暂无资产」。
// 任何一项 value === null（读取失败）都不算空，避免把「读失败」误判为「零资产」
const isEmpty = computed(() =>
  !isLoading.value && !error.value &&
  balances.value.length > 0 &&
  balances.value.every((b) => b.value === 0n),
)

// 大额数量缩写：≥1亿 → X.X亿；≥1万 → X.X万；其余原样。
// 精度 1 位小数，去掉尾部 .0，避免过度缩写丢失信息。
const formatCount = (n: bigint): string => {
  let v: number
  try { v = Number(BigInt(n)) } catch { return '—' }
  if (v >= 1e8) return `${(v / 1e8).toFixed(1).replace(/\.0$/, '')}${t('hundredMillion')}`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1).replace(/\.0$/, '')}${t('tenThousand')}`
  return String(v)
}

// ── JNS 域名枚举（分页懒加载）──
const JNS_BATCH_SIZE = 10
const JNS_MAX_DISPLAY = 50
const jnsTotal = ref<number | null>(null)
const jnsTotalNum = computed(() => jnsTotal.value ?? 0)
const jnsNames = ref<string[]>([])
const jnsLoaded = ref(0)
const loadingJns = ref(false)
// 竞态保护：与 useCoreAssets 相同的请求序号，防止旧地址慢响应覆盖新地址
let jnsRequestId = 0

const loadJns = async () => {
  const myReq = ++jnsRequestId
  loadingJns.value = true
  try {
    // 复用 useCoreAssets 已读的 JNS 余额（getBalance('jns')），消除重复 balanceOf
    const jnsBal = getBalance('jns')
    // 失败 ≠ 零：余额读取失败（null）时置 null，UI 显式提示「未知」，绝不用 0 掩盖
    if (jnsBal === null) {
      jnsTotal.value = null
      jnsNames.value = []
      jnsLoaded.value = 0
      return
    }
    const total = Number(jnsBal)
    jnsTotal.value = total
    jnsNames.value = []
    if (total === 0) return
    const end = Math.min(JNS_BATCH_SIZE, Math.min(total, JNS_MAX_DISPLAY))
    // withBalance=false：只枚举 tokenOfOwnerByIndex + _allTokensName，不再重复读 balanceOf
    const { names } = await fetchJnsHoldingBatch(props.address as `0x${string}`, 0, end, false)
    if (myReq !== jnsRequestId) return
    jnsNames.value.push(...names.slice(0, end))
    jnsLoaded.value = Math.min(end, names.length)
  } catch (e) {
    if (myReq !== jnsRequestId) return
    // 请求级失败同样不能掩盖成 0：置 null 提示未知，而非清零
    jnsTotal.value = null
    jnsNames.value = []
    jnsLoaded.value = 0
    console.error('[CoreAssetsPanel] JNS 枚举加载失败:', e)
  } finally {
    if (myReq === jnsRequestId) loadingJns.value = false
  }
}

const goJnsDetail = (name: string) => router.push(`/jns/${encodeURIComponent(name)}`)

const loadMoreJns = async () => {
  if (loadingJns.value) return
  const myReq = ++jnsRequestId
  loadingJns.value = true
  try {
    const start = jnsLoaded.value
    const end = Math.min(start + JNS_BATCH_SIZE, Math.min(jnsTotal.value ?? 0, JNS_MAX_DISPLAY))
    if (start >= end) return
    const { names } = await fetchJnsHoldingBatch(props.address as `0x${string}`, start, end - start, false)
    if (myReq !== jnsRequestId) return
    jnsNames.value.push(...names)
    jnsLoaded.value = Math.min(end, start + names.length)
  } catch (e) {
    if (myReq !== jnsRequestId) return
    console.error('[CoreAssetsPanel] JNS 加载更多失败:', e)
  } finally {
    if (myReq === jnsRequestId) loadingJns.value = false
  }
}

// ── NFT 枚举（二级懒加载：POPBadge / JNSVote / JTI）──
// 首屏只显示「共持有 N 个」，点击「展开」后才枚举该类前 10 个，首屏 RPC 不变。
// 可枚举性由 core-assets.ts 的 enumerable 标志驱动（单一地址源，避免与 NFT_ENUM_CONFIG 双份重复）。
const isEnumerableNft = (key: string) => CORE_ASSETS.some((a) => a.key === key && a.enumerable)

// 展开类的枚举合约地址：从 core-assets 配置读 address，找不到（理论不达）抛错显式失败，
// 不静默兜底零地址（与仓库「失败必须显式」原则一致，useNftEnumeration 会捕获并置 error 态）
const enumerableAddress = (key: string | null): `0x${string}` => {
  const a = key ? CORE_ASSETS.find((x) => x.key === key && x.enumerable) : undefined
  const addr = a?.address as `0x${string}` | undefined
  if (!addr) throw new Error(`枚举合约地址缺失（key=${key}）`)
  return addr
}

// 当前展开的 NFT key（同一时刻只展开一类）
const expandedKey = ref<string | null>(null)

// 展开类的持有总数（来自 useCoreAssets 已读的 balanceOf；null=读取失败，视为 0，UI 不提供展开）
const enumTotalCount = computed(() => {
  const k = expandedKey.value
  if (!k) return 0
  const bal = getBalance(k)
  return bal === null ? 0 : Number(bal)
})

const {
  items: nftEnumItems,
  loading: nftEnumLoading,
  error: nftEnumError,
  loaded: nftEnumLoaded,
  loadMore: nftEnumLoadMore,
  reset: nftEnumReset,
} = useNftEnumeration(
  () => enumerableAddress(expandedKey.value),
  () => props.address,
  () => enumTotalCount.value,
)

function toggleExpand(key: string) {
  if (expandedKey.value === key) {
    expandedKey.value = null
    nftEnumReset()
  } else {
    expandedKey.value = key
    nftEnumReset()
    nftEnumLoadMore()
  }
}

onMounted(async () => {
  await load()
  await loadJns()
})

watch(() => props.address, async () => {
  expandedKey.value = null
  nftEnumReset()
  await load()
  await loadJns()
})
</script>

<style scoped>
.core-assets-panel { display: flex; flex-direction: column; gap: 16px; }

.asset-list { display: flex; flex-direction: column; gap: 8px; }

.asset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--jv-bg-subtle);
  border-radius: var(--jv-radius-md);
}

.asset-icon {
  display: inline-block;
  width: 1.4rem;
  height: 1.4rem;
  flex-shrink: 0;
  color: var(--jv-text-primary);
  background: currentColor;
  -webkit-mask-size: contain;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-size: contain;
  mask-position: center;
  mask-repeat: no-repeat;
}

.asset-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }

.asset-name { color: var(--jv-text-primary); font-size: 0.9rem; }

.asset-symbol { font-size: 0.78rem; }

.asset-value { flex-shrink: 0; }

.btn-expand {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--jv-border);
  color: var(--jv-text-secondary);
  padding: 2px 10px;
  border-radius: var(--jv-radius-full);
  cursor: pointer;
  font-size: 0.75rem;
  transition: border-color var(--jv-duration-fast) var(--jv-ease),
              color var(--jv-duration-fast) var(--jv-ease);
}
.btn-expand:hover { border-color: var(--jv-brand); color: var(--jv-brand); }
.btn-expand.active { border-color: var(--jv-brand); color: var(--jv-brand); }

.nft-enum-panel {
  border-top: 1px dashed var(--jv-border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.nft-enum-head { font-size: 0.82rem; }

.nft-enum-list { display: flex; flex-wrap: wrap; gap: 10px; }

.nft-enum-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 72px;
}

.nft-enum-img {
  width: 56px;
  height: 56px;
  border-radius: var(--jv-radius-md);
  object-fit: cover;
  background: var(--jv-bg-subtle);
}
.nft-enum-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
}

.nft-enum-name {
  font-size: 0.72rem;
  color: var(--jv-text-secondary);
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nft-enum-error { font-size: 0.82rem; display: flex; align-items: center; gap: 8px; }

.nft-enum-more { display: flex; }

.asset-count { color: var(--jv-text-primary); font-weight: 600; font-size: 0.9rem; }

.muted { color: var(--jv-text-muted); font-size: 0.82rem; }

.jns-detail { border-top: 1px dashed var(--jv-border); padding-top: 14px; }

.jns-detail-head { margin-bottom: 8px; }

.jns-unknown { padding: 8px 0; }

.jns-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }

.jns-tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: var(--jv-radius-full);
  background: var(--jv-brand-subtle);
  color: var(--jv-brand);
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
}

.btn-load-more {
  background: none;
  border: 1px solid var(--jv-border);
  color: var(--jv-text-secondary);
  padding: 6px 16px;
  border-radius: var(--jv-radius-md);
  cursor: pointer;
  font-size: 0.85rem;
  transition: border-color var(--jv-duration-fast) var(--jv-ease),
              color var(--jv-duration-fast) var(--jv-ease);
}

.btn-load-more:hover:not(:disabled) { border-color: var(--jv-brand); color: var(--jv-brand); }
.btn-load-more:disabled { opacity: 0.5; cursor: not-allowed; }

.jns-overflow-hint { margin-top: 8px; font-size: 0.85rem; }

.jns-overflow-hint a { color: var(--jv-link); cursor: pointer; text-decoration: none; }
.jns-overflow-hint a:hover { text-decoration: underline; }
</style>
