<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import type { Address } from 'viem'
import { baselineBlock, getDeploymentBaseline, verifyDeployment, type DeploymentResult } from '../contracts/deployment-verification'

const props = defineProps<{ address: Address }>()
const baseline = computed(() => getDeploymentBaseline(props.address))
const result = ref<DeploymentResult>()
const busy = ref(false)
const labels: Record<DeploymentResult['status'], string> = {
  match: '与观测基线一致',
  mismatch: '与观测基线不一致，请复核后再接入',
  unverified: '已读取链上代码，暂无比对基线',
  'no-code': '该区块上此地址没有合约代码',
  'wrong-chain': '节点返回的网络编号不符',
  'baseline-mismatch': '基线区块哈希不一致或无法确认，已停止核验',
  error: '查询失败，请稍后重试',
}

async function verify() {
  if (busy.value) return
  busy.value = true
  result.value = undefined
  try {
    result.value = await verifyDeployment(props.address)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <details class="deployment">
    <summary>部署档案与代码核验</summary>
    <dl>
      <dt>源码版本与部署交易</dt><dd>未核实</dd>
      <dt>管理权限、升级权限及停用状态</dt><dd>未核实</dd>
      <dt>运行时代码观测基线</dt>
      <dd v-if="baseline">
        <code>{{ baseline }}</code>
        <br />观测区块：{{ baselineBlock.number.toString() }}<br />
        区块哈希：<code>{{ baselineBlock.hash }}</code>
      </dd>
      <dd v-else>未核实</dd>
    </dl>
    <NButton size="small" :loading="busy" :disabled="busy" @click="verify">只读核验链上代码</NButton>
    <p v-if="result" role="status">
      {{ labels[result.status] }}
      <template v-if="'blockNumber' in result"><br />查询区块：{{ result.blockNumber.toString() }}</template>
      <template v-if="'codeHash' in result"><br />代码摘要：<code>{{ result.codeHash }}</code></template>
    </p>
    <p>核验先确认固定基线区块哈希，再检查当前最新高度的代码。结果仅反映配置节点所返回的数据，不证明源码对应关系、安全性或代理合约的实现版本。</p>
  </details>
</template>

<style scoped>
.deployment { margin-top: 12px; overflow-wrap: anywhere; }
summary { cursor: pointer; color: var(--jv-link); }
dt { font-weight: 600; margin-top: 8px; }
dd { margin-inline-start: 0; }
p, dd { color: var(--jv-text-secondary); }
</style>
