<script setup lang="ts">
import { onScopeDispose, ref, shallowRef } from 'vue'
import { NAlert } from 'naive-ui'
import { JvActionButton, JvStatusTag, JvHashText } from '../design-system'
import { integrationProfile, checkJouleverseReadiness } from '../services/jouleverse-readiness'
import type { ReadinessReport } from '../services/network-readiness'
const loading = ref(false), error = ref(''), cached = ref(false)
const report = shallowRef<ReadinessReport>()
let disposed = false
onScopeDispose(() => { disposed = true })
async function run() {
  if (loading.value) return
  loading.value = true; error.value = ''; report.value = undefined
  try { const result = await checkJouleverseReadiness(); if (!disposed) { report.value = result.report; cached.value = result.cached } }
  catch (e) { if (!disposed) error.value = e instanceof Error ? e.message : '检测失败' }
  finally { if (!disposed) loading.value = false }
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <main class="readiness" :aria-busy="loading">
    <RouterLink to="/tools">← 工具集</RouterLink>
    <h1>生态接入验收</h1>
    <p>导出统一接入清单，以少量只读请求检查应用接入所需的基础接口。</p>
    <NAlert type="info" :show-icon="false">这是有限能力的节点观测，不代表全部生态兼容、共识安全或服务可用率认证。没有写交易，不消耗 J。</NAlert>
    <section class="card">
      <h2>本地接入配置</h2>
      <p>网络编号：{{ integrationProfile.chainId }} · Jouleverse（焦耳链）主网</p>
      <p>节点接口：{{ integrationProfile.rpcUrl }}</p>
      <p>多调用地址：<JvHashText :value="integrationProfile.multicall3" type="address" :truncate="10" /></p>
      <div class="actions">
        <JvActionButton @click="download(integrationProfile, 'jouleverse-integration-profile.json')">下载接入清单</JvActionButton>
        <JvActionButton :loading="loading" @click="run">开始只读检测</JvActionButton>
      </div>
      <p>未命中缓存时最多8个请求，并发最多2个；60秒缓存，无轮询。下载本地清单无需查询节点。</p>
    </section>
    <div v-if="error" role="alert"><h2>检测未完成</h2><NAlert type="error" :show-icon="false">{{ error }}</NAlert></div>
    <section v-if="report" class="card" aria-live="polite">
      <h2>{{ report.result === 'blocked' ? '存在接入阻碍' : '观测完成，请核对限制' }}</h2>
      <p>{{ cached ? '60秒缓存快照' : '本次查询' }} · {{ report.observedAt }} · 本轮 {{ report.requestCount }} 个请求</p>
      <p>观测高度 {{ report.observedHead }} · 基础费用最小单位：{{ report.baseFeePerGasWei ?? '未提供，不以0代替' }}</p>
      <ul class="checks"><li v-for="item in report.checks" :key="item.key">
        <strong>{{ item.label }}</strong>
        <JvStatusTag :status="item.status === 'pass' ? 'success' : item.status === 'fail' ? 'error' : 'warning'" :label="item.status === 'pass' ? '已观测' : item.status === 'fail' ? '未通过' : '待确认'" />
        <p>{{ item.detail }}</p>
      </li></ul>
      <JvActionButton @click="download(report, 'jouleverse-integration-observation.json')">下载检测记录</JvActionButton>
      <h3>能力边界</h3><ul><li v-for="item in report.limitations" :key="item">{{ item }}</li></ul>
    </section>
  </main>
</template>
<style scoped>
.readiness { max-width: 1000px; margin: auto; padding: 28px 24px; color: var(--jv-text-primary); }
a { color: var(--jv-link); } p, li { color: var(--jv-text-secondary); line-height: 1.8; overflow-wrap: anywhere; }
.card { margin-top: 24px; padding: 20px; background: var(--jv-bg-surface); border: 1px solid var(--jv-border); border-radius: var(--jv-radius-lg); }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }
.checks { list-style: none; padding: 0; } .checks li { padding: 12px 0; border-bottom: 1px solid var(--jv-border); } .checks strong { margin-right: 12px; }
@media(max-width:640px) { .readiness { padding: 20px 14px; } }
</style>
