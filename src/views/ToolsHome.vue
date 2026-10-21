<template>
  <div class="tools-home">
    <div class="tools-header">
      <h1>🧰 工具集</h1>
      <p class="tools-subtitle">Jouleverse 生态实用工具 —— 合约交互、空投管理、链上功能</p>
    </div>

    <!-- 核心合约工具 -->
    <section class="tools-category">
      <h2 class="category-title">
        <span class="category-icon">⭐</span>
        核心合约工具
        <span class="category-badge">Core</span>
      </h2>
      <div class="tools-grid">
        <router-link
          v-for="tool in coreContracts"
          :key="tool.key"
          :to="`/tools/contract/${tool.key}`"
          class="tool-card is-core"
        >
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">{{ tool.icon }}</span>
              {{ tool.name }}
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">{{ tool.tag }}</p>
          <div class="tool-card-footer">
            <span class="tool-link">打开 →</span>
          </div>
        </router-link>
      </div>
    </section>

    <!-- 生态合约工具 -->
    <section class="tools-category">
      <h2 class="category-title">
        <span class="category-icon">🌿</span>
        生态合约工具
        <span class="category-badge">Ecosystem</span>
      </h2>
      <div class="tools-grid">
        <router-link
          v-for="tool in ecoContracts"
          :key="tool.key"
          :to="`/tools/contract/${tool.key}`"
          class="tool-card"
        >
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">{{ tool.icon }}</span>
              {{ tool.name }}
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">{{ tool.tag }}</p>
          <div class="tool-card-footer">
            <span class="tool-link">打开 →</span>
          </div>
        </router-link>
      </div>
    </section>

    <!-- 通用工具 -->
    <section class="tools-category">
      <h2 class="category-title">
        <span class="category-icon">🛠️</span>
        通用工具
      </h2>
      <div class="tools-grid">
        <a
          class="tool-card"
          href="https://jscan.jnsdao.com/tools/contractx/index.html"
          target="_blank"
          rel="noopener"
        >
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">🔗</span>
              自定义 ABI 交互
            </h3>
            <span class="tool-status status-pending">V1 待迁移</span>
          </div>
          <p class="tool-desc">粘贴任意合约 ABI + 地址即可交互，支持 calldata 生成（V1 版本）</p>
          <div class="tool-card-footer">
            <span class="tool-link">打开工具 ↗</span>
          </div>
        </a>

        <router-link to="/tools/merkle" class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">🌳</span>
              默克尔证明生成器
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">为 Core 空投生成默克尔证明：数据校验、地址一致性检查、Merkle Root 与 Proofs 下载</p>
          <div class="tool-card-footer">
            <span class="tool-link">打开 →</span>
          </div>
        </router-link>
      </div>
    </section>

    <!-- 链上功能 -->
    <section class="tools-category">
      <h2 class="category-title">
        <span class="category-icon">⛓️</span>
        链上功能
      </h2>
      <div class="tools-grid">
        <router-link to="/jns" class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">🌐</span>
              JNS 域名查询
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">JNS 域名信息查询、记录展示与域名操作（绑定/解绑/发送 J）</p>
          <div class="tool-card-footer">
            <span class="tool-link">进入 →</span>
          </div>
        </router-link>

        <router-link to="/domains" class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">🗂️</span>
              {{ t('navEntry') }}
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">{{ t('subtitle') }}</p>
          <div class="tool-card-footer">
            <span class="tool-link">进入 →</span>
          </div>
        </router-link>

        <router-link to="/core/checkin" class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">📅</span>
              Core ID 签到统计
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">全网 Core ID 按月签到统计，支持月份导航与完整性校验</p>
          <div class="tool-card-footer">
            <span class="tool-link">进入 →</span>
          </div>
        </router-link>

        <router-link to="/jnsvote" class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">🗳️</span>
              JNSVote 治理投票
            </h3>
            <span class="tool-status status-migrated">已迁移</span>
          </div>
          <p class="tool-desc">JNSVote 治理投票专属界面：资格验证、投票列表、投票操作（P3-1）</p>
          <div class="tool-card-footer">
            <span class="tool-link">进入 →</span>
          </div>
        </router-link>
      </div>
    </section>

    <!-- 即将推出 -->
    <section class="tools-category">
      <h2 class="category-title">
        <span class="category-icon">⏳</span>
        即将推出
      </h2>
      <div class="tools-grid">

        <div class="tool-card is-disabled">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">📊</span>
              数据分析面板
            </h3>
            <span class="tool-status status-planned">规划中</span>
          </div>
          <p class="tool-desc">Jouleverse 链上数据可视化：交易量、地址增长、合约活动等关键指标</p>
          <div class="tool-card-footer">
            <span class="tool-link muted">即将推出</span>
          </div>
        </div>

        <div class="tool-card is-disabled">
          <div class="tool-card-header">
            <h3 class="tool-card-title">
              <span class="tool-icon">🔐</span>
              多签钱包管理
            </h3>
            <span class="tool-status status-planned">规划中</span>
          </div>
          <p class="tool-desc">多签钱包创建、管理与交易签名专属界面</p>
          <div class="tool-card-footer">
            <span class="tool-link muted">即将推出</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { toolboxContracts } from '../contracts/toolbox'
import { t } from '../i18n'

const coreContracts = computed(() => toolboxContracts.filter((c) => c.category === 'core'))
const ecoContracts = computed(() => toolboxContracts.filter((c) => c.category === 'eco'))
</script>

<style scoped>
.tools-home {
  max-width: 1100px;
  margin: 0 auto;
  padding: 28px 24px;
}

.tools-header {
  margin-bottom: 32px;
}

.tools-header h1 {
  margin: 0 0 8px 0;
  font-size: 1.9rem;
  font-weight: 700;
  color: var(--jv-text-primary);
}

.tools-subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: var(--jv-text-secondary);
}

.tools-category {
  margin-bottom: 36px;
}

.category-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--jv-text-primary);
  margin: 0 0 16px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--jv-brand-subtle);
}

.category-icon {
  font-size: 1.1rem;
}

.category-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: var(--jv-radius-full);
  background: var(--jv-brand-subtle);
  color: var(--jv-brand);
  letter-spacing: 0.5px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
}

.tool-card {
  display: flex;
  flex-direction: column;
  background: var(--jv-bg-surface);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  padding: 18px 20px;
  text-decoration: none;
  color: inherit;
  transition: border-color var(--jv-duration-fast) var(--jv-ease),
              box-shadow var(--jv-duration-fast) var(--jv-ease),
              transform 0.15s ease;
}

a.tool-card:hover {
  border-color: var(--jv-brand);
  box-shadow: var(--jv-shadow-md);
  transform: translateY(-2px);
}

.tool-card.is-core {
  border-left: 3px solid var(--jv-brand);
}

.tool-card.is-disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.tool-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.tool-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 1.02rem;
  font-weight: 600;
  color: var(--jv-text-primary);
}

.tool-icon {
  font-size: 1.1rem;
}

.tool-status {
  flex-shrink: 0;
  font-size: 0.72rem;
  padding: 3px 10px;
  border-radius: var(--jv-radius-full);
  white-space: nowrap;
}

.status-migrated {
  background: var(--jv-success-bg);
  color: var(--jv-success);
}

.status-pending {
  background: var(--jv-warning-bg);
  color: var(--jv-warning);
}

.status-planned {
  background: var(--jv-bg-subtle);
  color: var(--jv-text-muted);
}

.tool-desc {
  margin: 0 0 14px 0;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--jv-text-secondary);
  flex-grow: 1;
}

.tool-card-footer {
  display: flex;
  justify-content: flex-end;
}

.tool-link {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--jv-brand);
}

.tool-link.muted {
  color: var(--jv-text-muted);
  font-weight: 500;
}

@media (max-width: 640px) {
  .tools-home {
    padding: 20px 14px;
  }

  .tools-grid {
    grid-template-columns: 1fr;
  }
}
</style>
