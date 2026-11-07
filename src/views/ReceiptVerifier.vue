<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { NAlert, NInput } from 'naive-ui'
import { JvActionButton, JvHashText, JvStatusTag } from '../design-system'
import { verifyJouleverseReceipt } from '../services/jouleverse-receipt'
import { parseTransactionHash, serializeReceiptReport, type ReceiptReport } from '../services/receipt-verifier'

const hash = ref('')
const loading = ref(false)
const error = ref('')
const report = shallowRef<ReceiptReport>()
const cached = ref(false)
watch(hash, () => { report.value = undefined; error.value = ''; cached.value = false })
let disposed = false
onScopeDispose(() => { disposed = true })
const valid = computed(() => { try { parseTransactionHash(hash.value); return true } catch { return false } })
const labels = { 'not-found': '节点未找到', pending: '待打包', success: '顶层调用成功', reverted: '链上执行失败' } as const
const tag = computed(() => report.value?.state === 'success' ? 'info' : report.value?.state === 'reverted' ? 'error' : 'warning')
async function verify() {
  if (loading.value || !valid.value) return
  loading.value = true
  error.value = ''
  report.value = undefined
  try {
    const result = await verifyJouleverseReceipt(hash.value)
    if (!disposed) { report.value = result.report; cached.value = result.cached }
  } catch (e) { if (!disposed) error.value = e instanceof Error ? e.message : '核验失败，请稍后重试' }
  finally { if (!disposed) loading.value = false }
}
function download() {
  if (!report.value) return
  const url = URL.createObjectURL(new Blob([serializeReceiptReport(report.value)], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `jouleverse-observation-${report.value.transactionHash}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <main class="verifier" :aria-busy="loading">
    <RouterLink to="/tools">← 工具集</RouterLink>
    <h1>交易核验与导出</h1>
    <p class="introduction">核对链上交易记录的一致性，导出可供人工、业务系统和智能体复用的查询结果。</p>
    <p>Jouleverse 主网 · 网络编号 3666 · 只读查询，无需钱包，不消耗 J</p>
    <NAlert type="info" :show-icon="false">适合业务接入前核对链上记录。顶层调用成功不等于付款或履约成功，导出文件也不是链上包含性证明。</NAlert>
    <form class="query" @submit.prevent="verify">
      <label for="receipt-hash">交易哈希（0x 开头的 64 位十六进制）</label>
      <NInput id="receipt-hash" v-model:value="hash" :disabled="loading" placeholder="粘贴交易哈希" autocomplete="off" aria-label="交易哈希" />
      <JvActionButton :disabled="!valid" :loading="loading" @click="verify">核验交易</JvActionButton>
    </form>
    <div v-if="error" role="alert"><h2>无法完成核验</h2><NAlert type="error" :show-icon="false">{{ error }}</NAlert></div>
    <section v-if="report" class="result" aria-live="polite">
      <h2>本次观察结果 <JvStatusTag :status="tag" :label="labels[report.state]" /></h2>
      <p>{{ cached ? '命中30秒缓存，以下为原观察时间的快照' : '本次从节点读取' }}：{{ report.source.observedAt }}</p>
      <p v-if="report.state === 'not-found'">该节点此时未返回交易；可能尚未传播、已被丢弃、网络不符或历史数据不可用。不能据此断言交易不存在。</p>
      <p v-if="report.state === 'pending'">节点已返回交易，但尚无打包回执。没有计算手续费或确认数。</p>
      <dl>
        <dt>交易哈希</dt><dd><JvHashText :value="report.transactionHash" type="tx" :truncate="12" /></dd>
        <template v-if="report.transaction">
          <dt>发送方</dt><dd><JvHashText :value="report.transaction.from" type="address" :truncate="10" /></dd>
          <dt>目标地址</dt><dd><JvHashText v-if="report.transaction.to" :value="report.transaction.to" type="address" :truncate="10" /><span v-else>合约创建</span></dd>
          <dt>交易原生金额（最小单位）</dt><dd>{{ report.transaction.valueWei }}（不是代币转账金额）</dd>
        </template>
        <template v-if="report.inclusion">
          <dt>区块高度</dt><dd><JvHashText :value="report.inclusion.blockNumber" type="block" :truncate="0" /></dd>
          <dt>区块哈希</dt><dd><JvHashText :value="report.inclusion.blockHash" type="plain" :truncate="12" /></dd>
          <dt>观察时链高度</dt><dd>{{ report.inclusion.observedHead }}</dd>
          <dt>确认数（含所在区块）</dt><dd>{{ report.inclusion.confirmations }}，不代表最终确认</dd>
        </template>
        <template v-if="report.execution">
          <dt>手续费（最小单位）</dt><dd>{{ report.execution.feeWei ?? '未知，不以0代替' }}</dd>
          <dt>回执事件日志数</dt><dd>{{ report.logs.length }}（未核验业务语义）</dd>
        </template>
      </dl>
      <JvActionButton @click="download">下载链上交易观察记录（JSON 数据文件）</JvActionButton>
    </section>
    <section class="limits">
      <h2>核验范围</h2>
      <ul>
        <li>核对网络编号、交易哈希、交易/回执/规范链区块的一致性及日志归属；不扫描事件日志或遍历区块。</li>
        <li>一次最多5个只读节点请求，同时最多2个；无自动轮询，无自动重试；30秒缓存会显示原观察时间。</li>
        <li>信任单一节点，不独立验证共识或包含性，不保证不可逆。网络错误与节点数据矛盾均不生成观察记录。</li>
        <li>未验证内部调用是否成功、代币收款金额是否正确或订单是否履约；请勿直接据此自动放货或结算。</li>
        <li>文件摘要只用于完整性比对，任何人都可重新计算，不是签名或官方认证。文件含公开交易及调用数据，请按业务需求保存。</li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.verifier { max-width: 1000px; margin: auto; padding: 28px 24px; color: var(--jv-text-primary); }
a { color: var(--jv-link); }
p, li { color: var(--jv-text-secondary); line-height: 1.8; }
.query { display: grid; gap: 12px; margin: 24px 0; }
.query :deep(button) { justify-self: start; }
.result, .limits { margin-top: 24px; padding: 20px; border: 1px solid var(--jv-border); border-radius: var(--jv-radius-lg); background: var(--jv-bg-surface); }
dl { display: grid; grid-template-columns: minmax(130px, 1fr) 2fr; gap: 12px; }
dt { color: var(--jv-text-secondary); } dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 640px) { .verifier { padding: 20px 14px; } dl { grid-template-columns: 1fr; gap: 8px; } dd { padding-bottom: 12px; } }
</style>
