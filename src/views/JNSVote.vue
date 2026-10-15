<template>
  <div class="jnsvote-view">
    <div class="back-row">
      <router-link to="/tools" class="back-link">← 返回工具集</router-link>
    </div>

    <div class="jnsvote-header">
      <h1>🗳️ JNSVote 治理投票</h1>
      <p>参与 JNSDAO 治理投票 · 投票资格：持有 JTI 认证 + JNS 域名</p>
      <div class="header-meta">
        <n-tag
          size="small"
          :type="rpcOk ? 'success' : 'error'"
          round
        >
          {{ rpcOk ? '✅ 已连接 Jouleverse' : '❌ RPC 异常' }}
        </n-tag>
        <n-tag v-if="totalProposals > 0" size="small" type="info" round>
          提案总数：{{ totalProposals }}
        </n-tag>
        <n-tag v-if="currentBlock > 0n" size="small" round>
          当前区块：{{ currentBlock.toString() }}
        </n-tag>
      </div>
    </div>

    <!-- 钱包区 -->
    <div v-if="!walletStore.isConnected" class="wallet-connect-box">
      <n-button type="primary" :loading="walletStore.isConnecting" @click="handleConnect">
        🔗 连接钱包（查看投票资格）
      </n-button>
    </div>
    <div v-else class="wallet-info-box">
      <span class="wallet-label">当前账户：</span>
      <JvHashText :value="walletStore.address || ''" type="address" />
      <n-button size="tiny" quaternary @click="walletStore.disconnect()">断开</n-button>
    </div>

    <!-- 资格卡片（已连接） -->
    <div v-if="walletStore.isConnected && eligibility" class="eligibility-box">
      <div class="eligibility-item" :class="eligibility.hasJTI ? 'ok' : 'no'">
        {{ eligibility.hasJTI ? '✅' : '❌' }} JTI 认证
        <span v-if="eligibility.hasJTI" class="eligibility-count">({{ eligibility.jtiCount.toString() }})</span>
      </div>
      <div class="eligibility-item" :class="eligibility.hasJNS ? 'ok' : 'no'">
        {{ eligibility.hasJNS ? '✅' : '❌' }} JNS 持仓 > 0
        <span v-if="eligibility.hasJNS" class="eligibility-count">({{ eligibility.jnsCount.toString() }} 个)</span>
      </div>
    </div>

    <!-- 加载 / 异常 / 空态 -->
    <div v-if="isLoading" class="loading-wrap">
      <JvLoading text="正在读取链上提案..." />
    </div>
    <div v-else-if="loadError" class="error-wrap">
      <JvPageState type="network-error" title="加载失败" :description="loadError">
        <n-button size="small" @click="refresh">重试</n-button>
      </JvPageState>
    </div>
    <div v-else-if="proposals.length === 0" class="empty-wrap">
      <JvPageState type="empty" title="暂无提案" description="链上还没有创建任何治理提案" />
    </div>

    <!-- 提案列表 -->
    <div v-else class="proposal-list">
      <div
        v-for="p in proposals"
        :key="p.id"
        class="proposal-card"
        :class="[`status-${p.status}`, { 'is-disabled': p.disabled }]"
      >
        <div class="proposal-head">
          <div class="proposal-title-row">
            <span class="proposal-id">#{{ p.id }}</span>
            <span class="proposal-title">{{ p.title }}</span>
            <JvStatusTag
              :status="p.disabled ? 'default' : p.status === 'pending' ? 'info' : p.status === 'active' ? 'success' : 'default'"
              :label="p.disabled ? '已停用' : p.status === 'pending' ? '未开始' : p.status === 'active' ? '进行中' : '已结束'"
            />
            <JvStatusTag
              v-if="votedProposals.has(p.id)"
              status="tx-success"
              label="已投票"
            />
          </div>
          <a
            v-if="p.link"
            :href="p.link"
            target="_blank"
            rel="noopener"
            class="proposal-link"
          >🔗 {{ shortCid(p.link) }}</a>
        </div>

        <div class="proposal-body">
          <!-- 时间信息 -->
          <div class="time-row">
            <span>开始区块：{{ p.timeBegin.toString() }}</span>
            <span>结束区块：{{ p.timeEnd.toString() }}</span>
            <span v-if="p.status === 'pending'" class="countdown">
              距开始约 {{ formatCountdown(p.timeBegin - currentBlock) }}
            </span>
            <span v-else-if="p.status === 'active'" class="countdown">
              距结束约 {{ formatCountdown(p.timeEnd - currentBlock) }}
            </span>
          </div>

          <!-- 票数统计 -->
          <div class="stats-row">
            <div class="stat">
              <div class="stat-label">赞成票数</div>
              <div class="stat-value">{{ p.countVotesFor.toString() }} <span v-if="p.ar !== null" class="stat-pct">({{ p.ar }}%)</span></div>
            </div>
            <div class="stat">
              <div class="stat-label">反对票数</div>
              <div class="stat-value">{{ p.countVotesAgainst.toString() }} <span v-if="p.ar !== null" class="stat-pct">{{ (100 - p.ar).toFixed(2) }}%</span></div>
            </div>
            <div class="stat">
              <div class="stat-label">代表 JNS 持仓</div>
              <div class="stat-value">{{ p.countJNSvoted.toString() }} <span v-if="p.rr !== null" class="stat-pct">({{ p.rr }}%)</span></div>
            </div>
            <div class="stat">
              <div class="stat-label">其中赞成代表持仓</div>
              <div class="stat-value">{{ p.countJNSvotedFor.toString() }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">JNS 总量（快照）</div>
              <div class="stat-value">{{ p.totalJNS.toString() }}</div>
            </div>
          </div>

          <!-- 支持率进度条 -->
          <div class="progress-row">
            <span class="progress-label">支持率</span>
            <n-progress
              class="progress-bar"
              type="line"
              :percentage="p.ar ?? 0"
              :color="(p.ar ?? 0) >= 66.67 ? 'var(--jv-success)' : 'var(--jv-error)'"
              :height="10"
              :show-indicator="false"
            />
            <span class="progress-pct">{{ p.ar !== null ? p.ar + '%' : '—' }}</span>
          </div>

          <!-- 结果判定 -->
          <div v-if="p.status === 'ended' && !p.disabled && p.decision !== 0" class="decision-row">
            <span class="decision" :class="p.decision === 1 ? 'pass' : 'fail'">
              {{ p.decision === 1 ? '✅ 通过' : '❌ 未通过' }}
            </span>
            <span class="decision-rule">({{ p.id <= 2 ? 'V1 规则' : 'V2 规则' }}：支持率&gt;2/3 {{ p.id <= 2 ? '且代表率&gt;1/2' : '且代表率&gt;0.4' }})</span>
          </div>

          <!-- 投票操作 -->
          <div v-if="p.status === 'active' && !p.disabled" class="vote-row">
            <template v-if="!walletStore.isConnected">
              <span class="vote-connect-hint">🔗 连接钱包后可投票</span>
            </template>
            <template v-else-if="!votedProposals.has(p.id)">
              <JvActionButton
                type="success"
                size="small"
                :loading="voteState(p.id).loading && voteState(p.id).direction === 'for'"
                :disabled="voteState(p.id).loading || !isEligible"
                @click="handleVote(p, true)"
              >
                投赞成票
              </JvActionButton>
              <JvActionButton
                type="error"
                size="small"
                :loading="voteState(p.id).loading && voteState(p.id).direction === 'against'"
                :disabled="voteState(p.id).loading || !isEligible"
                @click="handleVote(p, false)"
              >
                投反对票
              </JvActionButton>
              <span v-if="!isEligible && eligibilityLoaded" class="vote-connect-hint">无投票资格（需 JTI + JNS 持仓）</span>
            </template>
            <JvStatusTag v-else status="tx-success" label="已投票" />
            <JvHashText
              v-if="voteState(p.id).txHash"
              :value="voteState(p.id).txHash ?? ''"
              type="tx"
              :truncate="10"
            />
            <p v-if="voteState(p.id).error" class="vote-error">{{ voteState(p.id).error }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, computed } from 'vue'
import { useWalletStore, config as wagmiConfig } from '../stores/wallet'
import { watchAccount } from '@wagmi/core'
import { useJNSVote, mapVoteError, SwitchChainError } from '../composables/useJNSVote'
import type { JNSVoteProposal } from '../composables/useJNSVote'
import { JvLoading, JvPageState, JvHashText, JvStatusTag, JvActionButton } from '../design-system'

const walletStore = useWalletStore()
const { proposals, totalProposals, currentBlock, isLoading, loadError, eligibility, votedProposals, loadProposals, checkEligibility, checkVoted, vote, formatCountdown } = useJNSVote()

const rpcOk = ref(true)

// 是否具备投票资格（已连接且持有 JTI + JNS）
const isEligible = computed(() => eligibility.value?.hasJTI === true && eligibility.value?.hasJNS === true)
// 资格是否已加载完成（eligibility 为 null 表示仍在异步加载中）
const eligibilityLoaded = computed(() => eligibility.value !== null)

// 账户切换监听注销函数（在 setup 顶层同步注册，避免 await 后 currentInstance 失效）
let unwatchAccount: (() => void) | undefined
onUnmounted(() => unwatchAccount?.())

async function refresh() {
  await loadProposals()
  rpcOk.value = loadError.value === null
  if (walletStore.address) {
    await checkEligibility(walletStore.address)
    await checkVoted(walletStore.address, proposals.value.map((p) => p.id))
  }
}

async function handleConnect() {
  try {
    await walletStore.connect()
    if (walletStore.address) {
      await checkEligibility(walletStore.address)
      await checkVoted(walletStore.address, proposals.value.map((p) => p.id))
    }
  } catch {
    // 用户取消或失败，保持现状
  }
}

// 简化 CID 展示
function shortCid(link: string): string {
  if (!link) return ''
  const clean = link.startsWith('ipfs://') ? link.slice(7) : link
  return clean.length > 40 ? clean.slice(0, 20) + '…' + clean.slice(-16) : clean
}

// ── 投票状态（按提案 id 隔离，避免一个 loading 挡住全部提案）──
interface VoteState {
  loading: boolean
  direction: 'for' | 'against' | null
  txHash: string | null
  error: string | null
}

const voteStates = reactive(new Map<number, VoteState>())

function voteState(id: number): VoteState {
  let state = voteStates.get(id)
  if (!state) {
    state = reactive({ loading: false, direction: null, txHash: null, error: null })
    voteStates.set(id, state)
  }
  return state
}

async function handleVote(proposal: JNSVoteProposal, isFor: boolean) {
  if (!walletStore.address) return
  const state = voteState(proposal.id)
  state.loading = true
  state.direction = isFor ? 'for' : 'against'
  state.error = null
  state.txHash = null
  try {
    const hash = await vote(proposal.id, isFor)
    state.txHash = hash
    // 投票成功：静默刷新票数与已投票状态（不触发全屏 loading）
    await loadProposals({ silent: true })
    if (walletStore.address) {
      await checkVoted(walletStore.address, proposals.value.map((p) => p.id))
    }
  } catch (error) {
    state.error = error instanceof SwitchChainError
      ? '请先在钱包中手动切换到 Jouleverse 网络（Chain ID: 3666，RPC: https://rpc.jnsdao.com:8503）'
      : mapVoteError(error)
  } finally {
    state.loading = false
    state.direction = null
  }
}

onMounted(async () => {
  // 提案加载先启动，用变量持有 promise；钱包恢复回调与账户切换监听均等待它，
  // 避免「钱包恢复早于提案加载」时 checkVoted 拿到空提案列表的竞态
  const loadPromise = loadProposals()

  // 钱包恢复 + 资格/已投检查（等待提案加载完成后执行）
  walletStore.restoreConnection().then(async () => {
    if (!walletStore.address) return
    await loadPromise
    await checkEligibility(walletStore.address)
    await checkVoted(walletStore.address, proposals.value.map((p) => p.id))
  })

  // 账户切换监听：MetaMask 切换账户后刷新资格与已投状态（合约会兜底拦截，仅体验优化）
  unwatchAccount = watchAccount(wagmiConfig, {
    async onChange(connection) {
      const addr = connection.address
      if (addr) {
        await loadPromise
        checkEligibility(addr)
        checkVoted(addr, proposals.value.map((p) => p.id))
      } else {
        // 断开连接：清空资格与已投状态
        eligibility.value = null
        votedProposals.value = new Set()
      }
    },
  })

  // 等待首次加载完成，联动 RPC 连接状态显示（loadProposals 内部已吞错，需用 loadError 判断）
  await loadPromise
  rpcOk.value = loadError.value === null
})
</script>

<style scoped>
.jnsvote-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 20px 16px 48px;
}
.back-row { margin-bottom: 12px; }
.back-link { color: var(--jv-text-secondary, #475569); font-size: 13px; text-decoration: none; }
.back-link:hover { color: var(--jv-success, #16a34a); }

.jnsvote-header h1 { margin: 0 0 4px; font-size: 24px; }
.jnsvote-header p { margin: 0 0 12px; color: var(--jv-text-secondary, #475569); font-size: 13px; }
.header-meta { display: flex; gap: 8px; flex-wrap: wrap; }

.wallet-connect-box, .wallet-info-box {
  margin: 16px 0;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--jv-bg-subtle, #f1f5f9);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.wallet-label { color: var(--jv-text-secondary, #475569); }

.eligibility-box {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0 0 16px;
}
.eligibility-item {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 14px;
  border: 1px solid transparent;
}
.eligibility-item.ok { background: var(--jv-success-bg, #f0fdf4); color: var(--jv-success, #16a34a); border-color: var(--jv-success, #16a34a); }
.eligibility-item.no { background: var(--jv-error-bg, #fef2f2); color: var(--jv-error, #dc2626); border-color: var(--jv-error, #dc2626); }
.eligibility-count { opacity: 0.7; font-size: 12px; }

.loading-wrap, .error-wrap, .empty-wrap { margin: 40px 0; }

.proposal-list { display: flex; flex-direction: column; gap: 14px; }
.proposal-card {
  border: 1px solid var(--jv-border, #e5e5e5);
  border-radius: 12px;
  padding: 16px 18px;
  background: var(--jv-bg-surface, #fff);
}
.proposal-card.is-disabled { opacity: 0.55; }

.proposal-head { margin-bottom: 12px; }
.proposal-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.proposal-id { font-weight: 700; color: var(--jv-success, #16a34a); font-size: 15px; }
.proposal-title { font-size: 15px; font-weight: 600; }
.proposal-link { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--jv-text-secondary, #475569); word-break: break-all; }

.proposal-body { display: flex; flex-direction: column; gap: 10px; }
.time-row { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--jv-text-secondary, #475569); }
.countdown { color: var(--jv-success, #16a34a); }

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.stat {
  background: var(--jv-bg-subtle, #f1f5f9);
  border-radius: 8px;
  padding: 8px 12px;
}
.stat-label { font-size: 12px; color: var(--jv-text-secondary, #475569); }
.stat-value { font-size: 14px; font-weight: 600; margin-top: 2px; }
.stat-pct { font-size: 12px; font-weight: 400; color: var(--jv-text-secondary, #475569); }

.progress-row { display: flex; align-items: center; gap: 10px; }
.progress-label { font-size: 13px; color: var(--jv-text-secondary, #475569); white-space: nowrap; }
.progress-bar { flex: 1; }
.progress-pct { font-size: 13px; font-weight: 600; min-width: 44px; text-align: right; }

.decision-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.decision { font-size: 14px; font-weight: 700; }
.decision.pass { color: var(--jv-success, #16a34a); }
.decision.fail { color: var(--jv-error, #dc2626); }
.decision-rule { font-size: 12px; color: var(--jv-text-secondary, #475569); }

.vote-row {
  padding-top: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.vote-error {
  color: var(--jv-error);
  font-size: 12px;
  margin: 0;
  flex-basis: 100%;
}

.vote-connect-hint {
  color: var(--jv-text-secondary, #475569);
  font-size: 13px;
}
</style>
