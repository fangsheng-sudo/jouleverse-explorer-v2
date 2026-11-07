<script setup lang="ts">
// JNSVote 治理端面板：创建提案（多签流程）+ 待确认交易管理
// 仅对「多签签名人」展示；普通投票者看不到本面板（isOwner 前置短路，零额外 RPC 负担）。
// 流程：签名人填表 → submitProposal（自动成为首确认人）→ 其余签名人 confirm → 任一签名人 execute。

import { ref, computed, onMounted, watch } from 'vue'
import { NButton, NInput, NTag, NSpin, NDivider } from 'naive-ui'
import { useMessage } from 'naive-ui'
import { useWalletStore } from '../stores/wallet'
import { useJNSVoteGovernance, type PendingProposalTx } from '../composables/useJNSVoteGovernance'
import { publicClient } from '../config/client'
import { JvHashText } from '../design-system'

const BLOCK_TIME_SEC = 15 // Jouleverse 平均出块时间（与 useJNSVote 一致）

const walletStore = useWalletStore()
const message = useMessage()
const gov = useJNSVoteGovernance()

// 解构 ref，供模板顶层自动解包（gov 是普通对象，模板访问 gov.xxx 不会自动解包）
const { isSigner, pendingTxs, isLoading, signers, loadError, reset } = gov

// 表单
const form = ref({
  title: '',
  link: '',
  timeBegin: '',
  timeEnd: '',
})
const submitting = ref(false)
// per-tx 写操作 loading（防连点：确认/执行签名上链需十几秒）
const txBusyId = ref<number | null>(null)

// 当前区块高度（用于校验「开始区块须晚于当前」+ 提示起止区块合理值）
const currentBlock = ref(0n)

// 表单校验
const formValid = computed(() => {
  const tb = parseBlockHeight(form.value.timeBegin)
  const te = parseBlockHeight(form.value.timeEnd)
  return (
    form.value.title.trim().length > 0 &&
    tb !== null &&
    te !== null &&
    // 阻塞 3：开始区块必须晚于当前区块，否则提案创建即「already ended」，无人能投票
    tb > currentBlock.value &&
    te > tb
  )
})

function parseBlockHeight(s: string): bigint | null {
  const t = s.trim()
  if (!/^\d+$/.test(t)) return null
  try {
    return BigInt(t)
  } catch {
    return null
  }
}

// 区块差 → 人类可读天数提示（建议 6：避免签名人自己心算区块对应哪天）
function blockDeltaHint(block: bigint): string {
  if (block <= currentBlock.value || currentBlock.value === 0n) return ''
  const seconds = Number(block - currentBlock.value) * BLOCK_TIME_SEC
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return hours > 0 ? `≈ ${days} 天 ${hours} 小时后` : `≈ ${days} 天后`
  if (hours > 0) return `≈ ${hours} 小时后`
  return '即将'
}

async function refresh() {
  if (!walletStore.address) return
  await gov.loadGovernance(walletStore.address)
}

async function handleSubmit() {
  if (!walletStore.address) return
  // 提交前重取最新块高（避免页面挂久后 currentBlock 漂移，导致「开始区块已过去」被放行）。
  // 取块高失败则阻断提交：否则 currentBlock 停在 0n 会绕过 tb > currentBlock 校验，
  // 可能造出 timeBegin/timeEnd 均已过去的永久死提案（合约无法补救）
  try {
    currentBlock.value = await publicClient.getBlockNumber()
  } catch {
    message.error('无法获取当前区块高度，已取消提交（请检查网络后重试）')
    return
  }
  if (!formValid.value) {
    message.error('开始区块须晚于当前区块，且结束区块须晚于开始区块，请调整后重试')
    return
  }
  submitting.value = true
  try {
    const txId = await gov.submitProposal({
      title: form.value.title.trim(),
      link: form.value.link.trim(),
      timeBegin: parseBlockHeight(form.value.timeBegin)!,
      timeEnd: parseBlockHeight(form.value.timeEnd)!,
    })
    if (txId >= 0) {
      message.success(`已提交多签交易 #${txId}（您已自动确认），等待其他签名人确认`)
    } else {
      message.success('已提交多签交易，请刷新查看')
    }
    form.value = { title: '', link: '', timeBegin: '', timeEnd: '' }
    await refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    submitting.value = false
  }
}

async function handleConfirm(tx: PendingProposalTx) {
  if (txBusyId.value !== null) return
  txBusyId.value = tx.txId
  try {
    await gov.confirmTx(tx.txId)
    message.success(`已确认交易 #${tx.txId}`)
    await refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    txBusyId.value = null
  }
}

async function handleExecute(tx: PendingProposalTx) {
  if (txBusyId.value !== null) return
  if (isTxExpired(tx)) {
    message.error('该交易的开始区块已过去，执行将生成无法投票的提案')
    return
  }
  txBusyId.value = tx.txId
  try {
    await gov.executeTx(tx.txId)
    message.success(`已执行交易 #${tx.txId}，提案已创建`)
    await refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    txBusyId.value = null
  }
}

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

// 执行端同源风险（审计后续建议）：一笔早已提交、近日才凑够 2/3 确认的 pending 交易，
// 其 timeBegin 可能已过去。此时执行会在链上成功生成提案，但 vote() 恒 revert（block.number
// > timeBegin 不满足），且 modify/disable/reenable 都要求 block < timeBegin，无法补救。
// 因此在执行按钮上叠加「开始区块须晚于当前区块」校验，过期则禁用并提示。
function isTxExpired(tx: PendingProposalTx): boolean {
  // timeBegin == currentBlock 时，下一块 block.number > timeBegin 即成立、其实可以投票，不应禁用；
  // 故用 <（而非 <=）判定「已过去」。
  return currentBlock.value > 0n && tx.timeBegin < currentBlock.value
}

// 地址 → 显示名。
// 以链上 getOwners() 顺序为准（signers 数组），本地 SIGNER_NAMES 只作可选装饰；
// 多签若改成员（如历史 addOwner），未命中映射时回退为「签名人 #N + 地址」，不会静默失效成裸地址（建议 3）
const SIGNER_NAMES: Record<string, string> = {
  '0x5bf50f2931688f886f46f88d5ceede530bb92076': 'Koant (J-0)',
  '0xe369810b1b07d0b82f702667429c3842905c14ff': '剪云为裳 (J-37)',
  '0xf66082f48cbc11ac83cdde11644f4db2f363205a': '明海云 (J-7)',
}
function signerName(a: string): string {
  const lower = a.toLowerCase()
  if (SIGNER_NAMES[lower]) return SIGNER_NAMES[lower]
  // 回退：在链上 signers 里找序号，显示「签名人 #N」；找不到再退化为短地址
  const idx = signers.value.findIndex((s) => s === lower)
  return idx >= 0 ? `签名人 #${idx + 1} ${shortAddr(a)}` : shortAddr(a)
}

onMounted(async () => {
  try {
    currentBlock.value = await publicClient.getBlockNumber()
  } catch { /* 忽略，仅用于提示 */ }
  await refresh()
})

watch(
  () => walletStore.address,
  (addr) => {
    if (addr) {
      refresh()
    } else {
      // 断连时重置治理状态并作废在途请求，避免 in-flight 完成后回写旧账户数据
      reset()
    }
  },
)
</script>

<template>
  <div v-if="isSigner" class="gov-panel">
    <NDivider title-placement="left">🛡️ 治理端（多签签名人专属）</NDivider>

    <div v-if="loadError" class="gov-load-error">⚠️ {{ loadError }}</div>

    <NSpin :show="isLoading">
      <!-- 创建提案表单 -->
      <div class="gov-form">
        <h3 class="gov-form-title">📝 创建新提案</h3>
        <div class="gov-form-row">
          <label class="gov-label">提案标题 *</label>
          <NInput v-model:value="form.title" placeholder="例如：批准 X 项治理决议" />
        </div>
        <div class="gov-form-row">
          <label class="gov-label">提案详情链接</label>
          <NInput v-model:value="form.link" placeholder="https://…（可选，指向完整提案文档）" />
        </div>
        <div class="gov-form-row">
          <label class="gov-label">开始区块 *</label>
          <NInput v-model:value="form.timeBegin" placeholder="如 8600000（须 > 当前区块）" />
          <div v-if="parseBlockHeight(form.timeBegin) !== null" class="gov-form-hint">
            开始区块 ≈ {{ blockDeltaHint(parseBlockHeight(form.timeBegin)!) }}
          </div>
        </div>
        <div class="gov-form-row">
          <label class="gov-label">结束区块 *</label>
          <NInput v-model:value="form.timeEnd" placeholder="如 8800000（须 > 开始区块）" />
          <div v-if="parseBlockHeight(form.timeEnd) !== null" class="gov-form-hint">
            结束区块 ≈ {{ blockDeltaHint(parseBlockHeight(form.timeEnd)!) }}
          </div>
        </div>
        <div v-if="currentBlock > 0n" class="gov-form-hint">
          当前区块：{{ currentBlock.toString() }}（约 {{ BLOCK_TIME_SEC }}s/块）
        </div>
        <NButton
          type="primary"
          :disabled="!formValid || submitting"
          :loading="submitting"
          @click="handleSubmit"
        >
          提交创建（成为首确认人）
        </NButton>
      </div>

      <!-- 待确认交易列表（仅「创建提案」类交易，见 useJNSVoteGovernance 过滤） -->
      <div class="gov-pending">
        <h3 class="gov-form-title">⏳ 待确认的「创建提案」交易（{{ pendingTxs.length }}）</h3>
        <div v-if="pendingTxs.length === 0" class="gov-empty">
          暂无待执行的创建提案交易
        </div>
        <div v-for="tx in pendingTxs" :key="tx.txId" class="gov-tx">
          <div class="gov-tx-head">
            <span class="gov-tx-id">#{{ tx.txId }}</span>
            <NTag size="small" :type="tx.confirmed ? 'success' : 'warning'">
              {{ tx.confirmationUnknown ? '确认状态未知' : (tx.confirmed ? `${tx.confirmationCount}/${tx.required} 已确认` : `${tx.confirmationCount}/${tx.required} 确认中`) }}
            </NTag>
          </div>
          <div class="gov-tx-title">{{ tx.title }}</div>
          <div class="gov-tx-meta">
            目标：<JvHashText :value="tx.destination" type="address" :truncate="12" />
            ｜区块 {{ tx.timeBegin.toString() }} → {{ tx.timeEnd.toString() }}
          </div>
          <div class="gov-tx-confirmers">
            已确认：<span v-for="c in tx.confirmations" :key="c" class="gov-signer">{{ signerName(c) }}</span>
          </div>
          <div v-if="isTxExpired(tx)" class="gov-tx-expired">
            ⚠️ 该交易的开始区块已过去（#{{ tx.timeBegin.toString() }}），执行将生成无法投票的提案
          </div>
          <div class="gov-tx-actions">
            <NButton
              v-if="!tx.confirmationUnknown && !tx.confirmed && !tx.confirmations.includes((walletStore.address || '').toLowerCase())"
              size="small"
              type="primary"
              ghost
              :loading="txBusyId === tx.txId"
              :disabled="txBusyId !== null && txBusyId !== tx.txId"
              @click="handleConfirm(tx)"
            >
              确认
            </NButton>
            <NButton
              v-if="!tx.confirmationUnknown && tx.confirmed"
              size="small"
              type="success"
              :loading="txBusyId === tx.txId"
              :disabled="(txBusyId !== null && txBusyId !== tx.txId) || isTxExpired(tx)"
              @click="handleExecute(tx)"
            >
              执行（创建提案）
            </NButton>
          </div>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.gov-panel {
  margin: 20px 0;
  padding: 16px 18px;
  border: 1px solid var(--jv-border, #e5e5e5);
  border-radius: 12px;
  background: var(--jv-bg-surface, #fff);
}
.gov-form-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.gov-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}
.gov-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gov-label {
  font-size: 13px;
  color: var(--jv-text-secondary, #475569);
}
.gov-form-hint {
  font-size: 12px;
  color: var(--jv-text-muted, #64748b);
}
.gov-load-error {
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--jv-error, #dc2626);
  background: var(--jv-error-bg, #fef2f2);
  border-radius: 8px;
}
.gov-pending {
  border-top: 1px solid var(--jv-border, #e5e5e5);
  padding-top: 16px;
}
.gov-empty {
  font-size: 13px;
  color: var(--jv-text-muted, #64748b);
}
.gov-tx {
  border: 1px solid var(--jv-border, #e5e5e5);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.gov-tx-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.gov-tx-id {
  font-weight: 700;
  color: var(--jv-success, #16a34a);
}
.gov-tx-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
}
.gov-tx-meta {
  font-size: 12px;
  color: var(--jv-text-secondary, #475569);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.gov-tx-confirmers {
  font-size: 12px;
  color: var(--jv-text-secondary, #475569);
  margin: 6px 0;
}
.gov-signer {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 8px;
  border-radius: 6px;
  background: var(--jv-bg-subtle, #f1f5f9);
}
.gov-tx-expired {
  font-size: 12px;
  color: var(--jv-warning, #d97706);
  margin: 6px 0;
}
.gov-tx-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
