<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { formatEther, parseEther, type Hex } from 'viem'
import { useWalletStore } from '../stores/wallet'
import { useMultisig, MULTISIG_PAGE_SIZE } from '../composables/useMultisig'
import { JvActionButton, JvLoading, JvPageState } from '../design-system'
import { describePayload, selector, validatePayload, walletAddress, type MultisigTx } from '../utils/multisig'
import { safeErrorMessage } from '../utils/error'

const wallet = useWalletStore()
const api = useMultisig()
const { info, transactions, loading, writing, error, notice, broadcast } = api
const address = ref('')
const offset = ref(0n)
const executed = ref(false)
const destination = ref('')
const value = ref('0')
const data = ref('0x')
const formError = ref('')
const acknowledged = ref(false)
const lastHash = ref(broadcast.value?.hash ?? '')
type Review = { kind: 'submit'; wallet: Hex; destination: Hex; value: bigint; data: Hex; actor: string }
  | { kind: 'act'; action: 'confirmTransaction' | 'revokeConfirmation' | 'executeTransaction'; tx: MultisigTx; actor: string }
const review = ref<Review | null>(null)
const locked = computed(() => writing.value || !!broadcast.value)
const signer = computed(() => !!wallet.address && !!info.value?.owners.includes(wallet.address.toLowerCase()))
const labels = { confirmTransaction: '确认（达到门槛可能立即执行）', revokeConfirmation: '撤回自己的确认', executeTransaction: '执行交易' }
const reviewTx = computed(() => review.value?.kind === 'act' ? review.value.tx : review.value)
async function connectWallet() {
  try { await wallet.connect() } catch { /* 根节点通过 connectionError 展示连接错误 */ }
}
watch(address, () => { api.reset(); review.value = null; offset.value = 0n })
watch(() => wallet.address, () => { review.value = null; acknowledged.value = false })
watch(broadcast, (v) => { if (v) lastHash.value = v.hash })
onUnmounted(api.reset)
async function load(next = 0n) {
  if (locked.value) return
  review.value = null; acknowledged.value = false; offset.value = next
  await api.load(address.value.trim(), next, executed.value)
}
function prepareSubmit() {
  formError.value = ''
  try {
    if (!info.value || !wallet.address || !signer.value) throw new Error('请先加载多签并连接签名人账户')
    if (!/^\d+(\.\d{1,18})?$/.test(value.value)) throw new Error('金额须为非负十进制数，最多18位小数')
    const amount = parseEther(value.value)
    const to = walletAddress(destination.value.trim())
    const payload = data.value.trim() as Hex
    validatePayload(to, amount, payload)
    review.value = { kind: 'submit', wallet: info.value.address, destination: to, value: amount, data: payload, actor: wallet.address }
    acknowledged.value = false
  } catch (e) { formError.value = safeErrorMessage(e) }
}
function prepareAction(tx: MultisigTx, action: 'confirmTransaction' | 'revokeConfirmation' | 'executeTransaction') {
  if (!wallet.address || !signer.value || locked.value) return
  review.value = { kind: 'act', action, tx: { ...tx, confirmations: [...tx.confirmations] }, actor: wallet.address }
  acknowledged.value = false
}
async function approve() {
  if (!review.value || !acknowledged.value || locked.value) return
  const selected = review.value
  review.value = null
  try {
    if (selected.kind === 'submit') await api.submit(selected.wallet, selected.destination, selected.value, selected.data, selected.actor)
    else await api.act(selected.tx, selected.action, selected.actor)
  } catch (e) { formError.value = safeErrorMessage(e) }
}
</script>

<template>
  <main class="multisig">
    <router-link to="/tools">← 返回工具集</router-link><h1>多签钱包管理</h1>
    <p>管理已有的经典 Gnosis（格诺西斯）多签钱包。支持提交、确认、撤回确认与执行，不创建新钱包，不保证兼容现代 Safe（安全钱包）或任意同名合约。</p>
    <form class="address-form" @submit.prevent="load()">
      <label for="multisig-address">多签合约地址</label><input id="multisig-address" v-model="address" placeholder="0x…" :disabled="locked" autocomplete="off" spellcheck="false" />
      <JvActionButton :loading="loading" :disabled="locked" @click="load()">加载多签</JvActionButton>
    </form>
    <JvLoading v-if="loading" label="正在核验合约并读取本页交易…" />
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <p v-if="lastHash">最近广播：<router-link :to="`/tx/${lastHash}`">{{ lastHash }}</router-link></p>
    <JvActionButton v-if="broadcast" :loading="writing" @click="api.checkReceipt">查询已广播交易回执</JvActionButton>
    <section v-if="info" class="panel">
      <h2>多签状态</h2><p class="mono">{{ info.address }}</p>
      <div class="stats"><span>门槛：{{ info.required }}/{{ info.owners.length }}</span><span>总交易：{{ info.total }}</span><span>余额：{{ formatEther(info.balance) }} J</span><span>快照区块：{{ info.block }}</span></div>
      <details><summary>查看签名人</summary><p v-for="owner in info.owners" :key="owner" class="mono">{{ owner }}</p></details>
      <JvActionButton v-if="!wallet.isConnected" @click="connectWallet">连接钱包</JvActionButton>
      <p v-else>{{ signer ? '当前账户是签名人' : '当前账户仅可查看，不是该多签签名人' }}</p>
    </section>
    <section v-if="info" class="panel">
      <div class="row"><h2>交易列表</h2><label>状态 <select v-model="executed" :disabled="locked || loading" @change="load()"><option :value="false">待执行</option><option :value="true">已执行</option></select></label><JvActionButton :disabled="locked" :loading="loading" @click="load(offset)">刷新本页</JvActionButton></div>
      <p>当前筛选共{{ info.count }}笔，每页最多{{ MULTISIG_PAGE_SIZE }}笔。快照可能过期，发送前会重新读取链上内容。签名期间请勿关闭页面；广播后请保留交易哈希。</p>
      <JvPageState v-if="!transactions.length" type="empty" title="当前筛选没有交易" />
      <article v-for="tx in transactions" :key="String(tx.id)" class="tx">
        <h3>#{{ tx.id }} · {{ tx.executed ? '已执行' : '待执行' }} · {{ tx.confirmations.length }}/{{ info.required }}确认</h3>
        <p>目标：<router-link :to="`/address/${tx.destination}`">{{ tx.destination }}</router-link></p>
        <p>附带原生金额：<strong>{{ formatEther(tx.value) }} J</strong> · 最小单位 {{ tx.value }}</p>
        <p>函数选择器：<code>{{ selector(tx.data) }}</code></p><p>{{ describePayload(tx.destination, tx.data, info?.address) }}</p>
        <details><summary>完整调用数据与确认人</summary><pre>{{ tx.data }}</pre><p v-for="owner in tx.confirmations" :key="owner" class="mono">{{ owner }}</p></details>
        <div v-if="!tx.executed && signer" class="row">
          <JvActionButton v-if="!tx.confirmations.includes(wallet.address!.toLowerCase())" :disabled="locked || loading" @click="prepareAction(tx, 'confirmTransaction')">审阅并确认</JvActionButton>
          <JvActionButton v-else :disabled="locked || loading" @click="prepareAction(tx, 'revokeConfirmation')">审阅并撤回确认</JvActionButton>
          <JvActionButton :disabled="locked || loading || !tx.confirmed" @click="prepareAction(tx, 'executeTransaction')">审阅并执行</JvActionButton>
        </div>
      </article>
      <div class="row"><JvActionButton :disabled="locked || loading || offset === 0n" @click="load(offset - BigInt(MULTISIG_PAGE_SIZE))">上一页</JvActionButton><span>第{{ offset / BigInt(MULTISIG_PAGE_SIZE) + 1n }}页</span><JvActionButton :disabled="locked || loading || offset + BigInt(MULTISIG_PAGE_SIZE) >= info.count" @click="load(offset + BigInt(MULTISIG_PAGE_SIZE))">下一页</JvActionButton></div>
    </section>
    <section v-if="info && signer" class="panel">
      <h2>提交多签交易</h2><p class="warning">提交者自动确认；门槛为1时提交可能立即执行。原生J的普通转账受链规则限制，不保证该用途可执行。代币转账应调用相应代币合约。</p>
      <form @submit.prevent="prepareSubmit">
        <label>目标地址<input v-model="destination" :disabled="locked" placeholder="0x…" autocomplete="off" /></label>
        <label>附带原生J金额<input v-model="value" :disabled="locked" inputmode="decimal" /></label>
        <label>完整调用数据<textarea v-model="data" :disabled="locked" rows="4" spellcheck="false"></textarea></label>
        <JvActionButton :disabled="locked || loading" @click="prepareSubmit">准备并审阅</JvActionButton>
      </form>
    </section>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <section v-if="review && reviewTx" class="review" aria-label="交易审阅">
      <h2>{{ review.kind === 'submit' ? '提交新交易' : labels[review.action] }}</h2>
      <p>付款／操作多签：{{ reviewTx.wallet }}</p><p>签名账户：{{ review.actor }}</p>
      <p>目标：{{ reviewTx.destination }}</p><p>原生金额：{{ formatEther(reviewTx.value) }} J（{{ reviewTx.value }}最小单位）</p>
      <p>选择器：{{ selector(reviewTx.data) }}</p><p>{{ describePayload(reviewTx.destination, reviewTx.data, info?.address) }}</p><pre>{{ reviewTx.data }}</pre>
      <p class="warning">确认交易达到门槛时也可能立即执行。请核对目标、金额与全部参数；未知函数不能仅凭选择器判定用途。</p>
      <label><input v-model="acknowledged" type="checkbox" />我已核对上述多签、目标、金额和完整调用数据，并理解执行风险</label>
      <div class="row"><JvActionButton :disabled="!acknowledged || locked" :loading="writing" @click="approve">在钱包中签名</JvActionButton><JvActionButton :disabled="locked" @click="review = null">取消</JvActionButton></div>
    </section>
  </main>
</template>

<style scoped>
.multisig { max-width:1050px; padding:24px; margin:auto; color:var(--jv-text-primary); }
p { line-height:1.7; overflow-wrap:anywhere; color:var(--jv-text-secondary); } a { color:var(--jv-link); overflow-wrap:anywhere; }
.panel,.review { margin:24px 0; padding:20px; border:1px solid var(--jv-border); border-radius:var(--jv-radius-lg); background:var(--jv-bg-surface); }
.review { border-color:var(--jv-warning); } .tx { border-top:1px solid var(--jv-border); padding:16px 0; }
.row,.stats { display:flex; gap:16px; flex-wrap:wrap; align-items:center; margin:16px 0; }
.address-form label,form>label { display:block; margin:16px 0 8px; }
input:not([type=checkbox]),textarea,select { background:var(--jv-bg-page); border:1px solid var(--jv-border); border-radius:var(--jv-radius-md); padding:10px; color:var(--jv-text-primary); max-width:100%; box-sizing:border-box; }
input:not([type=checkbox]),textarea { display:block; width:100%; margin:8px 0 16px; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; padding:12px; background:var(--jv-bg-subtle); font-family:var(--jv-font-mono); max-height:220px; overflow:auto; }
.mono { font-family:var(--jv-font-mono); } .error { color:var(--jv-error); padding:12px; background:var(--jv-error-bg); } .notice { color:var(--jv-success); } .warning { color:var(--jv-warning); }
@media(max-width:600px) { .multisig { padding:16px; } .panel,.review { padding:14px; } }
</style>
