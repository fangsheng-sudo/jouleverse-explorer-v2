<template>
  <div class="wj-operations">
    <JvPageState
      v-if="!walletStore.isConnected"
      type="wallet-disconnected"
      description="WJ 操作功能需要连接钱包，请先在右上角连接 MetaMask。"
    />

    <div v-else-if="walletStore.address?.toLowerCase() !== address.toLowerCase()" class="info-section wallet-warning">
      <h2>⚠️ 地址不匹配</h2>
      <p>当前连接的钱包地址不是此页面地址，无法操作。</p>
      <p>连接地址：<span class="addr-mono">{{ walletStore.formatAddress(walletStore.address) }}</span></p>
      <p>页面地址：<span class="addr-mono">{{ formatAddress(address) }}</span></p>
    </div>

    <div v-else class="info-section wj-panel">
      <h2>🔧 WJ 操作</h2>
      <div class="wallet-info-badge">
        <span class="badge-connected">✓ 钱包已连接</span>
        <span class="balance">可用 WJ：{{ formatBalance(wjBalance) }} WJ</span>
      </div>

      <div class="operation-tabs">
        <button :class="{ active: activeTab === 'withdraw' }" @click="activeTab = 'withdraw'" class="tab-btn">💰 释放 J</button>
        <button :class="{ active: activeTab === 'transfer' }" @click="activeTab = 'transfer'" class="tab-btn">➡️ 转账 WJ</button>
      </div>

      <div v-if="activeTab === 'withdraw'" class="operation-form">
        <div class="form-group">
          <label>目标地址（将 J 释放到此地址）</label>
          <input v-model="withdrawForm.to" placeholder="0x..." class="form-input">
        </div>
        <div class="form-group">
          <label>数量 (WJ)</label>
          <input v-model="withdrawForm.amount" type="text" placeholder="0.0" class="form-input"
            @input="handleAmountInput('withdraw', $event)">
          <span class="balance-hint">可用：{{ formatBalance(wjBalance) }} WJ</span>
        </div>
        <JvActionButton
          :loading="loadingOperation"
          :disabled="!withdrawForm.to || !withdrawForm.amount"
          style="width: 100%; margin-top: 8px"
          @click="handleWithdraw"
        >
          释放 J
        </JvActionButton>
        <p v-if="operationSuccess" class="success-message">{{ operationSuccess }}</p>
        <p v-if="operationError" class="error-message">{{ operationError }}</p>
      </div>

      <div v-if="activeTab === 'transfer'" class="operation-form">
        <div class="form-group">
          <label>接收地址</label>
          <input v-model="transferForm.to" placeholder="0x..." class="form-input">
        </div>
        <div class="form-group">
          <label>数量 (WJ)</label>
          <input v-model="transferForm.amount" type="text" placeholder="0.0" class="form-input"
            @input="handleAmountInput('transfer', $event)">
          <span class="balance-hint">可用：{{ formatBalance(wjBalance) }} WJ</span>
        </div>
        <JvActionButton
          :loading="loadingOperation"
          :disabled="!transferForm.to || !transferForm.amount"
          style="width: 100%; margin-top: 8px"
          @click="handleTransfer"
        >
          转账
        </JvActionButton>
        <p v-if="operationSuccess" class="success-message">{{ operationSuccess }}</p>
        <p v-if="operationError" class="error-message">{{ operationError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { parseEther } from 'viem'
import { useWalletStore } from '../stores/wallet'
import { WJ_ADDRESS, wjABI } from '../contracts/wj'
import { jouleverseChain } from '../config/chain'
import { JvPageState, JvActionButton } from '../design-system'
import { safeErrorMessage } from '../utils/error'

interface Props {
  address: string
  wjBalance: bigint | null
  formatAddress: (addr: string) => string
  formatBalance: (bal: bigint | null) => string
}

const props = defineProps<Props>()
const walletStore = useWalletStore()

const activeTab = ref<'withdraw' | 'transfer'>('withdraw')
const loadingOperation = ref(false)
const operationError = ref<string | null>(null)
const operationSuccess = ref<string | null>(null)
const withdrawForm = ref({ to: '', amount: '' })
const transferForm = ref({ to: '', amount: '' })

const handleAmountInput = (type: 'withdraw' | 'transfer', event: Event) => {
  const target = event.target as HTMLInputElement
  let value = target.value.replace(/[^\d.]/g, '')
  const parts = value.split('.')
  if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('')
  if (type === 'withdraw') withdrawForm.value.amount = value
  else transferForm.value.amount = value
}

const handleWithdraw = async () => {
  if (!walletStore.address) { operationError.value = '钱包未连接'; return }
  loadingOperation.value = true
  operationError.value = null
  operationSuccess.value = null
  try {
    const to = withdrawForm.value.to
    const amountStr = String(withdrawForm.value.amount || '0')
    if (!/^\d*\.?\d+$/.test(amountStr) && amountStr !== '0') throw new Error(`无效的数量: "${amountStr}"`)
    const amount = parseEther(amountStr)
    const { writeContract, switchChain } = await import('wagmi/actions')
    const { config: wagmiConfig } = await import('../stores/wallet')
    try { await switchChain(wagmiConfig, { chainId: jouleverseChain.id }) } catch {
      operationError.value = '请先在钱包中手动切换到 Jouleverse 网络（Chain ID: 3666，RPC: https://rpc.jnsdao.com:8503）'
      loadingOperation.value = false
      return
    }
    const hash = await writeContract(wagmiConfig, { address: WJ_ADDRESS, abi: wjABI, functionName: 'withdrawTo', args: [to as `0x${string}`, amount] })
    operationSuccess.value = `释放 J 交易已提交！哈希: ${hash.slice(0, 10)}...`
    await walletStore.refreshBalances()
    withdrawForm.value = { to: '', amount: '' }
  } catch (error) {
    operationError.value = '释放 J 失败: ' + safeErrorMessage(error)
  } finally { loadingOperation.value = false }
}

const handleTransfer = async () => {
  if (!walletStore.address) { operationError.value = '钱包未连接'; return }
  loadingOperation.value = true
  operationError.value = null
  operationSuccess.value = null
  try {
    const to = transferForm.value.to
    const amountStr = String(transferForm.value.amount || '0')
    if (!/^\d*\.?\d+$/.test(amountStr) && amountStr !== '0') throw new Error(`无效的数量: "${amountStr}"`)
    const amount = parseEther(amountStr)
    const { writeContract, switchChain } = await import('wagmi/actions')
    const { config: wagmiConfig } = await import('../stores/wallet')
    try { await switchChain(wagmiConfig, { chainId: jouleverseChain.id }) } catch {
      operationError.value = '请先在钱包中手动切换到 Jouleverse 网络（Chain ID: 3666，RPC: https://rpc.jnsdao.com:8503）'
      loadingOperation.value = false
      return
    }
    const hash = await writeContract(wagmiConfig, { address: WJ_ADDRESS, abi: wjABI, functionName: 'transfer', args: [to as `0x${string}`, amount] })
    operationSuccess.value = `转账交易已提交！哈希: ${hash.slice(0, 10)}...`
    await walletStore.refreshBalances()
    transferForm.value = { to: '', amount: '' }
  } catch (error) {
    operationError.value = '转账失败: ' + safeErrorMessage(error)
  } finally { loadingOperation.value = false }
}
</script>

<style scoped>
.wj-operations { display: flex; flex-direction: column; gap: 30px; }

.info-section {
  background: var(--jv-bg-surface);
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-lg);
  padding: 24px;
}

.info-section h2 {
  color: var(--jv-text-primary);
  margin: 0 0 20px 0;
  font-size: 1.25rem;
}

.wallet-warning {
  background: var(--jv-warning-bg);
  border-color: var(--jv-warning) !important;
}

.wallet-warning h2 { color: var(--jv-warning); }
.wallet-warning p { margin: 8px 0; color: var(--jv-warning); }

.addr-mono {
  font-family: var(--jv-font-mono);
  font-size: 0.9rem;
}

.wj-panel { background: var(--jv-bg-surface); }

.wallet-info-badge {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--jv-success-bg);
  border: 1px solid var(--jv-success);
  border-radius: var(--jv-radius-md);
  padding: 8px 16px;
  margin-bottom: 20px;
}

.badge-connected { color: var(--jv-success); font-weight: 600; }
.balance { color: var(--jv-success); }

.operation-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--jv-border);
  padding-bottom: 8px;
}

.tab-btn {
  background: none;
  border: none;
  padding: 10px 20px;
  font-size: 0.95rem;
  color: var(--jv-text-muted);
  cursor: pointer;
  transition: color var(--jv-duration-fast) var(--jv-ease);
  position: relative;
}

.tab-btn:hover { color: var(--jv-brand); }

.tab-btn.active {
  color: var(--jv-brand);
  font-weight: 600;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: -10px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--jv-brand);
}

.operation-form { display: flex; flex-direction: column; gap: 16px; }

.form-group { display: flex; flex-direction: column; gap: 6px; }

.form-group label {
  color: var(--jv-text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
}

.form-input {
  padding: 10px 14px;
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  font-size: 0.95rem;
  background: var(--jv-bg-surface);
  color: var(--jv-text-primary);
  transition: border-color var(--jv-duration-fast) var(--jv-ease);
}

.form-input:focus {
  outline: none;
  border-color: var(--jv-border-focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--jv-brand) 12%, transparent);
}

.balance-hint { font-size: 0.8rem; color: var(--jv-text-muted); }

.success-message { color: var(--jv-success); font-size: 0.85rem; margin: 0; }
.error-message { color: var(--jv-error); font-size: 0.85rem; margin: 0; }
</style>
