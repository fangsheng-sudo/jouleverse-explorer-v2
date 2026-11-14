<script setup lang="ts">
// JNSVote 使用指南（页面内可视化引导）
// 仅展示静态教程步骤，不发 RPC、不签名、不广播；与文档 docs/jnsvote-user-guide.md 对应。
// 分两类受众：普通用户（参与投票）与多签签名人（创建提案）。
// 暗色模式：外层容器用 --jv-* 变量；步骤/标签页用 naive-ui 组件，随 NConfigProvider 全局主题自动适配。

import { NCollapse, NCollapseItem, NTabs, NTabPane, NSteps, NStep } from 'naive-ui'
import { computed } from 'vue'
import { useWalletStore } from '../stores/wallet'

const walletStore = useWalletStore()
// 当前账户是否为多签签名人（前端只做轻量判断，不据此授权；真正权限由合约 isOwner 决定）
// 已知签名人地址（与 JNSVoteGovernancePanel 的 SIGNER_NAMES 一致，仅用于引导高亮，非授权依据）
const SIGNER_ADDRESSES = new Set([
  '0x5bf50f2931688f886f46f88d5ceede530bb92076',
  '0xe369810b1b07d0b82f702667429c3842905c14ff',
  '0xf66082f48cbc11ac83cdde11644f4db2f363205a',
])
const isSigner = computed(() => {
  const addr = walletStore.address?.toLowerCase()
  return addr ? SIGNER_ADDRESSES.has(addr) : false
})

// 参与投票步骤（普通用户）
const voteSteps = [
  {
    title: '连接钱包',
    description: '点击页面顶部「🔗 连接钱包」，选择 MetaMask 等钱包登录。',
  },
  {
    title: '确认投票资格',
    description: '需同时持有 JTI 认证 + JNS 域名。页面顶部资格卡片会以 ✅/❌ 实时显示。',
  },
  {
    title: '切换到 Jouleverse 链',
    description: 'Chain ID 3666，RPC https://rpc.jnsdao.com。投票时若不在目标链会提示手动切换。',
  },
  {
    title: '进入进行中的提案',
    description: '在提案列表点击状态为「进行中」的提案卡片，进入详情页。',
  },
  {
    title: '投赞成 / 反对票',
    description: '点击「投赞成票」或「投反对票」，钱包签名确认，等待交易入块。成功后显示「已投票」，并自动铸造 1 枚 SBT 徽章。',
  },
]

// 多签创建提案步骤（签名人）
const createSteps = [
  {
    title: '签名人发起（提交即成为首确认人）',
    description: '签名人连接钱包后，页面出现「🛡️ 治理端」面板。填写提案标题、详情链接（可选）、开始区块、结束区块，点击「提交创建」。',
  },
  {
    title: '其余签名人确认',
    description: '另一签名人在「⏳ 待确认的治理交易」列表核对参数（类型 / 标题 / 区块 / 原生金额为 0）无误后，点击「确认」。',
  },
  {
    title: '确认数达标后执行',
    description: '确认数达到 2/3（即 2 人）后，任一签名人点击「执行」，提案正式上链创建。',
  },
]

// 结果判定规则（背景知识）
const decisionRules = [
  { rule: 'V1', scope: '提案 id ≤ 2', ar: '> 2/3', rr: '> 1/2' },
  { rule: 'V2', scope: '提案 id ≥ 3', ar: '> 2/3', rr: '> 0.4' },
]
</script>

<template>
  <div class="jnsvote-guide">
    <n-collapse :default-expanded-names="[]">
      <n-collapse-item title="📖 使用指南" name="guide">
        <n-tabs type="line" default-value="vote" class="guide-tabs">
          <!-- 参与投票 -->
          <n-tab-pane name="vote" tab="🙋 参与投票">
            <n-steps vertical :current="1" :status="'process'" class="guide-steps">
              <n-step
                v-for="(s, i) in voteSteps"
                :key="i"
                :title="`${i + 1}. ${s.title}`"
                :description="s.description"
              />
            </n-steps>
            <div class="guide-note">
              💡 每个地址对每个提案只能投一次；投票后自动铸造 1 枚不可转移的 JNSVote SBT 徽章。
            </div>
          </n-tab-pane>

          <!-- 多签创建提案 -->
          <n-tab-pane name="create" tab="🛡️ 多签创建提案">
            <div v-if="!isSigner" class="guide-signer-tip">
              ⚠️ 当前账户不是多签签名人，无法看到治理端创建入口。创建提案仅对签名人开放。
            </div>
            <n-steps vertical :current="1" :status="'process'" class="guide-steps">
              <n-step
                v-for="(s, i) in createSteps"
                :key="i"
                :title="`${i + 1}. ${s.title}`"
                :description="s.description"
              />
            </n-steps>
            <div class="guide-note">
              💡 多签为 2/3 门槛；区块约 15 秒/块，创建提案须让开始区块晚于当前区块。确认数恰达门槛时可能立即执行，签名前务必核验参数。
            </div>
          </n-tab-pane>

          <!-- 结果判定 -->
          <n-tab-pane name="decision" tab="⚖️ 结果判定">
            <table class="guide-table">
              <thead>
                <tr>
                  <th>规则</th>
                  <th>适用提案</th>
                  <th>支持率（ar）</th>
                  <th>代表率（rr）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in decisionRules" :key="r.rule">
                  <td>{{ r.rule }}</td>
                  <td>{{ r.scope }}</td>
                  <td>{{ r.ar }}</td>
                  <td>{{ r.rr }}</td>
                </tr>
              </tbody>
            </table>
            <div class="guide-note">
              💡 支持率 ar = 赞成票数 / (赞成 + 反对)；代表率 rr = 赞成票代表 JNS 持仓 / JNS 总量快照。两项同时满足才算「通过」。
            </div>
          </n-tab-pane>
        </n-tabs>
      </n-collapse-item>
    </n-collapse>
  </div>
</template>

<style scoped>
.jnsvote-guide {
  margin: 0 0 16px;
  padding: 0 4px;
}

.guide-tabs {
  padding: 8px 0;
}

.guide-steps {
  padding: 8px 4px;
}

.guide-note {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--jv-text-secondary, #475569);
  background: var(--jv-bg-subtle, #f1f5f9);
}

.guide-signer-tip {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--jv-warning, #b45309);
  background: var(--jv-warning-bg, #fffbeb);
  border: 1px solid var(--jv-warning, #d97706);
}

.guide-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.guide-table th,
.guide-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--jv-border, #e5e5e5);
}

.guide-table th {
  color: var(--jv-text-secondary, #475569);
  font-weight: 600;
  background: var(--jv-bg-subtle, #f1f5f9);
}

.guide-table td {
  color: var(--jv-text-primary, #0f172a);
}
</style>
