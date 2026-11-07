<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { publicClient } from '../config/client'
import { JvActionButton, JvLoading, JvPageState } from '../design-system'
import { analyticsMetrics, collectAnalytics, readAnalyticsCache, saveAnalyticsCache, type AnalyticsSample } from '../utils/analytics'
import { safeErrorMessage } from '../utils/error'

const sample = ref<AnalyticsSample | null>(null)
const limit = ref(12)
const loading = ref(false)
const error = ref('')
const cached = ref(false)
let alive = true
onUnmounted(() => { alive = false })
const metrics = computed(() => sample.value ? analyticsMetrics(sample.value) : null)
const maxTx = computed(() => Math.max(1, ...sample.value?.blocks.map((b) => b.transactions) ?? []))
async function load() {
  if (loading.value) return
  error.value = ''
  const size = limit.value
  try {
    const hit = readAnalyticsCache(localStorage, size)
    if (hit) { sample.value = hit; cached.value = true; return }
  } catch { /* 浏览器可能禁止本地存储 */ }
  loading.value = true
  sample.value = null
  try {
    const result = await collectAnalytics(publicClient, size)
    if (!alive) return
    sample.value = result
    cached.value = false
    try { saveAnalyticsCache(localStorage, size, result) } catch { /* 存储非必要 */ }
  } catch (e) { if (alive) error.value = safeErrorMessage(e) }
  finally { if (alive) loading.value = false }
}
onMounted(load)
</script>

<template>
  <main class="analytics">
    <router-link to="/tools">← 返回工具集</router-link>
    <h1>数据分析面板</h1>
    <p>近期区块抽样分析，不代表全网历史统计。纯前端计算，不扫描事件日志。</p>
    <div class="controls">
      <label>样本范围 <select v-model.number="limit" :disabled="loading" @change="load"><option :value="12">最近12个区块</option><option :value="24">最近24个区块</option></select></label>
      <JvActionButton :loading="loading" @click="load">刷新样本</JvActionButton>
    </div>
    <JvLoading v-if="loading" label="正在读取有界区块样本…" />
    <JvPageState v-else-if="error" type="network-error" :description="error" action="重试" @action="load" />
    <template v-else-if="sample && metrics">
      <p class="scope">区块 {{ sample.blocks[0]?.number }}—{{ sample.blocks[sample.blocks.length - 1]?.number }} · {{ new Date(sample.fetchedAt).toLocaleString() }} · {{ cached ? '60秒内缓存快照' : '节点读取快照' }}</p>
      <p v-if="!metrics.transactions" class="empty-note">当前样本区间无交易，链上活动较少，以下指标与图表为空属正常现象。</p>
      <section class="cards" aria-label="样本指标">
        <article><span>样本交易数</span><strong>{{ metrics.transactions }}</strong></article>
        <article><span>样本活跃地址（非新增地址）</span><strong>{{ sample.activeAddresses }}</strong></article>
        <article><span>交易速率（笔／秒）</span><strong>{{ metrics.tps?.toFixed(3) ?? '无法估算' }}</strong></article>
        <article><span>平均出块间隔（秒）</span><strong>{{ metrics.secondsPerBlock?.toFixed(2) ?? '无法估算' }}</strong></article>
        <article><span>区块燃料使用率</span><strong>{{ metrics.gasPercent === null ? '无法估算' : `${metrics.gasPercent.toFixed(2)}%` }}</strong></article>
        <article><span>合约创建交易数</span><strong>{{ sample.creations }}</strong></article>
      </section>
      <section class="panel"><h2>每个区块的交易数</h2>
        <div v-for="block in sample.blocks" :key="block.hash" class="bar-row">
          <router-link :to="`/block/${block.number}`">#{{ block.number }}</router-link>
          <div class="track"><div class="bar" :style="{ width: `${block.transactions / maxTx * 100}%` }"></div></div>
          <span>{{ block.transactions }}</span>
        </div>
      </section>
      <section class="panel"><h2>交易目标地址前十名</h2><p>按样本内直接交易次数排序；未识别地址是否为合约，不包含内部调用。</p>
        <JvPageState v-if="!sample.targets.length" type="empty" title="样本没有交易目标地址" />
        <div v-for="target in sample.targets" :key="target.address" class="target"><router-link :to="`/address/${target.address}`">{{ target.address }}</router-link><strong>{{ target.count }}笔</strong></div>
      </section>
    </template>
    <aside>统计口径：活跃地址为样本交易发送方与接收方去重；无法据此判断地址首次出现时间。速率以首尾区块时间差计算，不计首块交易。最多读取24个区块、并发不超过3，结果缓存60秒，不自动轮询。样本区块可能发生重组。</aside>
  </main>
</template>

<style scoped>
.analytics { max-width:1100px; margin:auto; padding:24px; color:var(--jv-text-primary); }
p, aside, .scope { color:var(--jv-text-secondary); line-height:1.7; }
a { color:var(--jv-link); overflow-wrap:anywhere; }
.controls { display:flex; flex-wrap:wrap; gap:16px; align-items:center; margin:24px 0; }
select { background:var(--jv-bg-surface); color:var(--jv-text-primary); border:1px solid var(--jv-border); padding:8px; border-radius:var(--jv-radius-md); }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:16px; }
article,.panel { padding:20px; background:var(--jv-bg-surface); border:1px solid var(--jv-border); border-radius:var(--jv-radius-lg); }
article span { color:var(--jv-text-secondary); } article strong { display:block; font-size:1.8rem; margin-top:8px; }
.panel { margin:24px 0; } h2 { font-size:1.15rem; }
.bar-row { display:grid; grid-template-columns:100px 1fr 36px; gap:12px; align-items:center; margin:10px 0; }
.track { background:var(--jv-bg-subtle); border-radius:var(--jv-radius-sm); height:14px; overflow:hidden; }
.bar { height:100%; background:var(--jv-brand); } .target { display:flex; gap:20px; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--jv-border); } .target strong { white-space:nowrap; }
aside { padding:16px; background:var(--jv-info-bg); border-radius:var(--jv-radius-md); }
.empty-note { padding:12px; background:var(--jv-bg-subtle); border-radius:var(--jv-radius-md); color:var(--jv-text-secondary); }
@media(max-width:600px) { .analytics { padding:16px; } .bar-row { grid-template-columns:88px 1fr 28px; gap:8px; } .target { font-size:.8rem; } }
</style>
