<template>
  <div class="jnsvote-proposal-detail">
    <!-- 加载中 -->
    <JvLoading v-if="isLoading" label="正在读取提案..." />

    <!-- 读取失败（RPC/网络异常，区别于「提案不存在」与「零票」） -->
    <JvPageState
      v-else-if="loadError"
      type="network-error"
      :title="'加载失败'"
      :description="loadError"
      action="重试"
      @action="load"
    />

    <!-- 提案不存在（读取成功但 mapping 返回空标题） -->
    <JvPageState
      v-else-if="notFound"
      type="empty"
      title="提案不存在"
      description="该提案 id 未在链上找到"
    />

    <template v-else-if="proposal">
      <!-- 头部：标题 + 状态 -->
      <div class="detail-header">
        <div class="detail-title-row">
          <span class="proposal-id">#{{ proposal.id }}</span>
          <h1 class="proposal-title">{{ proposal.title }}</h1>
          <JvStatusTag
            :status="proposal.disabled ? 'default' : proposal.status === 'pending' ? 'info' : proposal.status === 'active' ? 'success' : 'default'"
            :label="proposal.disabled ? '已停用' : proposal.status === 'pending' ? '未开始' : proposal.status === 'active' ? '进行中' : '已结束'"
          />
          <JvStatusTag v-if="voted" status="tx-success" label="已投票" />
        </div>

        <!-- CID 链接（提案描述外链） -->
        <a
          v-if="proposal.link"
          :href="proposal.link"
          target="_blank"
          rel="noopener"
          class="cid-link"
        >🔗 提案链接：{{ shortCid(proposal.link) }}</a>
        <span v-else class="cid-link muted">无提案链接</span>
      </div>

      <!-- 时间信息 -->
      <div class="time-row">
        <span>开始区块：{{ proposal.timeBegin.toString() }}</span>
        <span>结束区块：{{ proposal.timeEnd.toString() }}</span>
        <span v-if="proposal.status === 'pending'" class="countdown">
          距开始约 {{ formatCountdown(proposal.timeBegin - currentBlock) }}
        </span>
        <span v-else-if="proposal.status === 'active'" class="countdown">
          距结束约 {{ formatCountdown(proposal.timeEnd - currentBlock) }}
        </span>
      </div>

      <!-- 票数统计 -->
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">赞成票数</div>
          <div class="stat-value">{{ proposal.countVotesFor.toString() }} <span v-if="proposal.ar !== null" class="stat-pct">({{ proposal.ar }}%)</span></div>
        </div>
        <div class="stat">
          <div class="stat-label">反对票数</div>
          <div class="stat-value">{{ proposal.countVotesAgainst.toString() }} <span v-if="proposal.ar !== null" class="stat-pct">{{ (100 - proposal.ar).toFixed(2) }}%</span></div>
        </div>
        <div class="stat">
          <div class="stat-label">代表 JNS 持仓</div>
          <div class="stat-value">{{ proposal.countJNSvoted.toString() }} <span v-if="proposal.rr !== null" class="stat-pct">({{ proposal.rr }}%)</span></div>
        </div>
        <div class="stat">
          <div class="stat-label">其中赞成代表持仓</div>
          <div class="stat-value">{{ proposal.countJNSvotedFor.toString() }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">JNS 总量（快照）</div>
          <div class="stat-value">{{ proposal.totalJNS.toString() }}</div>
        </div>
      </div>

      <!-- 支持率进度条 -->
      <div class="progress-row">
        <span class="progress-label">支持率</span>
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="(proposal.ar ?? 0) >= 66.67 ? 'pass' : 'fail'"
            :style="{ width: (proposal.ar ?? 0) + '%' }"
          />
        </div>
        <span class="progress-pct">{{ proposal.ar !== null ? proposal.ar + '%' : '—' }}</span>
      </div>

      <!-- 结果判定 -->
      <div v-if="proposal.status === 'ended' && !proposal.disabled && proposal.decision !== 0" class="decision-row">
        <span class="decision" :class="proposal.decision === 1 ? 'pass' : 'fail'">
          {{ proposal.decision === 1 ? '✅ 通过' : '❌ 未通过' }}
        </span>
        <span class="decision-rule">({{ proposal.id <= 2 ? 'V1 规则' : 'V2 规则' }}：支持率&gt;2/3 {{ proposal.id <= 2 ? '且代表率&gt;1/2' : '且代表率&gt;0.4' }})</span>
      </div>

      <!-- 投票操作 -->
      <div v-if="proposal.status === 'active' && !proposal.disabled" class="vote-section">
        <template v-if="!walletStore.isConnected">
          <span class="vote-hint">🔗 连接钱包后可投票</span>
        </template>
        <template v-else-if="!voted">
          <JvActionButton
            type="success"
            :loading="voteLoading === 'for'"
            :disabled="voteLoading !== null || !isEligible"
            @click="handleVote(true)"
          >
            投赞成票
          </JvActionButton>
          <JvActionButton
            type="error"
            :loading="voteLoading === 'against'"
            :disabled="voteLoading !== null || !isEligible"
            @click="handleVote(false)"
          >
            投反对票
          </JvActionButton>
          <span v-if="!isEligible && eligibilityLoaded" class="vote-hint">无投票资格（需 JTI + JNS 持仓）</span>
        </template>
        <JvStatusTag v-else status="tx-success" label="已投票" />

        <JvHashText v-if="voteTxHash" :value="voteTxHash" type="tx" :truncate="10" />
        <p v-if="voteError" class="vote-error">{{ voteError }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useWalletStore } from '../stores/wallet'
import { useProposalDetail } from '../composables/useProposalDetail'
import { useJNSVote, mapVoteError, SwitchChainError } from '../composables/useJNSVote'
import { JvLoading, JvPageState, JvStatusTag, JvActionButton, JvHashText } from '../design-system'

interface Props {
  proposalId: number
}
const props = defineProps<Props>()

const walletStore = useWalletStore()
const { proposal, isLoading, loadError, notFound, currentBlock, load } = useProposalDetail(() => props.proposalId)

// 复用 useJNSVote 的 vote（内部 voteFor/voteAgainst）与资格/已投检查
const { vote, checkEligibility, checkVoted, eligibility, formatCountdown } = useJNSVote()

const voted = ref(false)
const voteLoading = ref<'for' | 'against' | null>(null)
const voteTxHash = ref<string | null>(null)
const voteError = ref<string | null>(null)

const isEligible = computed(() => eligibility.value?.hasJTI === true && eligibility.value?.hasJNS === true)
// eligibility 为 null 表示仍在异步加载中，非「无资格」
const eligibilityLoaded = computed(() => eligibility.value !== null)

// 竞态守卫：proposalId 切换时丢弃过期响应（vote 状态按当前 id 重查）
let votedSeq = 0

async function refreshVoteStatus() {
  const addr = walletStore.address
  if (!addr || !proposal.value) {
    voted.value = false
    return
  }
  const mySeq = ++votedSeq
  const res = await checkVoted(addr, [proposal.value.id])
  if (mySeq !== votedSeq) return
  voted.value = res.has(proposal.value.id)
}

function shortCid(link: string): string {
  if (!link) return ''
  const clean = link.startsWith('ipfs://') ? link.slice(7) : link
  return clean.length > 40 ? clean.slice(0, 20) + '…' + clean.slice(-16) : clean
}

async function handleVote(isFor: boolean) {
  if (!walletStore.address || !proposal.value) return
  voteLoading.value = isFor ? 'for' : 'against'
  voteError.value = null
  voteTxHash.value = null
  try {
    const hash = await vote(proposal.value.id, isFor)
    voteTxHash.value = hash
    await refreshVoteStatus()
    // 投票后静默刷新票数
    await load()
  } catch (error) {
    voteError.value = error instanceof SwitchChainError
      ? '请先在钱包中手动切换到 Jouleverse 网络（Chain ID: 3666，RPC: https://rpc.jnsdao.com:8503）'
      : mapVoteError(error)
  } finally {
    voteLoading.value = null
  }
}

onMounted(async () => {
  await load()
  // 钱包恢复后重查资格与已投状态
  walletStore.restoreConnection().then(async () => {
    if (walletStore.address) {
      await checkEligibility(walletStore.address)
      await refreshVoteStatus()
    }
  })
})

// proposalId 切换：重载提案 + 重查已投状态
watch(() => props.proposalId, async () => {
  voteError.value = null
  voteTxHash.value = null
  await load()
  await refreshVoteStatus()
})
</script>

<style scoped>
.jnsvote-proposal-detail {
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.proposal-id { color: var(--jv-text-muted); font-size: 14px; }
.proposal-title { margin: 0; font-size: 22px; color: var(--jv-text-primary); word-break: break-all; }

.cid-link { color: var(--jv-link); font-size: 14px; text-decoration: none; word-break: break-all; }
.cid-link:hover { text-decoration: underline; }
.muted { color: var(--jv-text-muted); }

.time-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--jv-text-secondary);
}
.countdown { color: var(--jv-warning); }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.stat {
  background: var(--jv-bg-subtle);
  border-radius: var(--jv-radius-md);
  padding: 12px 14px;
}

.stat-label { font-size: 12px; color: var(--jv-text-muted); margin-bottom: 4px; }
.stat-value { font-size: 15px; font-weight: 600; color: var(--jv-text-primary); }
.stat-pct { font-size: 12px; font-weight: 400; color: var(--jv-text-secondary); }

.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-label { font-size: 13px; color: var(--jv-text-secondary); flex-shrink: 0; }
.progress-track {
  flex: 1;
  height: 10px;
  background: var(--jv-bg-subtle);
  border-radius: var(--jv-radius-full);
  overflow: hidden;
}
.progress-fill { height: 100%; border-radius: var(--jv-radius-full); transition: width var(--jv-duration-normal) var(--jv-ease); }
.progress-fill.pass { background: var(--jv-success); }
.progress-fill.fail { background: var(--jv-error); }
.progress-pct { font-size: 13px; color: var(--jv-text-secondary); flex-shrink: 0; }

.decision-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.decision { font-weight: 600; }
.decision.pass { color: var(--jv-success); }
.decision.fail { color: var(--jv-error); }
.decision-rule { font-size: 12px; color: var(--jv-text-muted); }

.vote-section {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.vote-hint { font-size: 13px; color: var(--jv-text-muted); }
.vote-error { margin: 0; font-size: 13px; color: var(--jv-error); width: 100%; }
</style>
