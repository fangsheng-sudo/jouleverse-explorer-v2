<script setup lang="ts">
import { computed, ref } from 'vue'
import { NInput, NTag } from 'naive-ui'
import { JvHashText, JvPageState } from '../design-system'
import ContractDeployment from '../components/ContractDeployment.vue'
import { toolboxContracts } from '../contracts/toolbox'

const search = ref('')
const groups = computed(() => (['core', 'eco'] as const).map(category => ({
  category,
  label: category === 'core' ? '核心合约' : '生态合约',
  contracts: toolboxContracts.filter(c => c.category === category &&
    `${c.name} ${c.tag} ${c.key} ${c.address}`.toLowerCase().includes(search.value.trim().toLowerCase())),
})))
const count = computed(() => groups.value.reduce((sum, group) => sum + group.contracts.length, 0))
</script>

<template>
  <main class="registry">
    <RouterLink to="/tools">← 工具集</RouterLink>
    <h1>生态合约注册目录</h1>
    <p>Jouleverse 主网 · 网络编号 3666 · 已登记 {{ toolboxContracts.length }} 个合约</p>
    <p class="notice">来源：本地 toolboxContracts 部署清单。默认不查询节点。展开部署档案并主动点击，可比对单个合约的链上运行时代码。</p>
    <NInput v-model:value="search" clearable placeholder="搜索名称、标签或地址" aria-label="搜索合约" />
    <p aria-live="polite">找到 {{ count }} 个合约</p>
    <JvPageState v-if="!count" type="search-empty" />
    <section v-for="group in groups.filter(g => g.contracts.length)" :key="group.category">
      <h2>{{ group.label }}（{{ group.contracts.length }}）</h2>
      <div class="grid">
        <article v-for="contract in group.contracts" :key="contract.key" class="contract" :data-contract="contract.key">
          <h3><span aria-hidden="true">{{ contract.icon }}</span> {{ contract.name }}</h3>
          <NTag size="small" :bordered="false">{{ group.label }}</NTag>
          <p>{{ contract.tag }}</p>
          <JvHashText :value="contract.address" type="address" :truncate="0" />
          <ContractDeployment :address="contract.address" />
          <RouterLink class="tool-link" :to="`/tools/contract/${contract.key}`">打开工具 →</RouterLink>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.registry { max-width: 1100px; margin: auto; padding: 28px 24px; color: var(--jv-text-primary); }
p { color: var(--jv-text-secondary); line-height: 1.7; }
a { color: var(--jv-link); }
.notice { padding: 16px; background: var(--jv-bg-subtle); border-radius: var(--jv-radius-md); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; }
.contract { min-width: 0; padding: 20px; border: 1px solid var(--jv-border); border-radius: var(--jv-radius-lg); background: var(--jv-bg-surface); }
h3 { margin: 0 0 10px; }
.tool-link { display: block; margin-top: 18px; }
@media (max-width: 640px) { .registry { padding: 20px 14px; } }
</style>
