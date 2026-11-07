import { ref } from 'vue'
import { getAccount, getConnectorClient, switchChain, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import { decodeEventLog, type Abi, type Hex } from 'viem'
import { publicClient } from '../config/client'
import { config } from '../stores/wallet'
import { abi_multisig } from '../contracts/toolbox'
import { assertSameTx, validatePayload, walletAddress, type MultisigTx } from '../utils/multisig'
import { safeErrorMessage } from '../utils/error'

const ABI: Abi = abi_multisig
export const MULTISIG_PAGE_SIZE = 20
interface WalletInfo { address: Hex; owners: string[]; required: bigint; total: bigint; count: bigint; balance: bigint; block: bigint }
type Action = 'confirmTransaction' | 'revokeConfirmation' | 'executeTransaction'
interface Broadcast { hash: Hex; wallet: Hex; action: Action | 'submitTransaction'; id?: bigint; actor?: Hex }
const PENDING_KEY = 'jv-multisig-pending-v1-3666'
function savedBroadcast(): Broadcast | null {
  try {
    const item = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null')
    if (!item || !/^0x[0-9a-f]{64}$/i.test(item.hash)
      || !['submitTransaction', 'confirmTransaction', 'revokeConfirmation', 'executeTransaction'].includes(item.action)) return null
    walletAddress(item.wallet)
    if (item.actor !== undefined) walletAddress(item.actor)
    if (item.id !== undefined && !/^\d+$/.test(item.id)) return null
    return { ...item, id: item.id === undefined ? undefined : BigInt(item.id) }
  } catch { return null }
}
function persistBroadcast(item: Broadcast | null) {
  try {
    if (item) sessionStorage.setItem(PENDING_KEY, JSON.stringify(item, (_, v) => typeof v === 'bigint' ? String(v) : v))
    else sessionStorage.removeItem(PENDING_KEY)
  } catch { /* 禁用存储时仍由当前页面内存锁保护，并提示用户保留交易哈希 */ }
}

async function batch(address: Hex, blockNumber: bigint, calls: { functionName: string; args?: readonly unknown[] }[]) {
  if (!calls.length) return []
  return await publicClient.multicall({
    contracts: calls.map((call) => ({ address, abi: ABI, ...call })), blockNumber, allowFailure: false,
  }) as unknown[]
}
async function readTx(address: Hex, id: bigint, blockNumber: bigint): Promise<MultisigTx> {
  return (await readTxs(address, [id], blockNumber))[0]!
}
async function readTxs(address: Hex, ids: readonly bigint[], blockNumber: bigint): Promise<MultisigTx[]> {
  const results = await batch(address, blockNumber, ids.flatMap((id) => [
    { functionName: 'transactions', args: [id] }, { functionName: 'isConfirmed', args: [id] },
    { functionName: 'getConfirmations', args: [id] },
  ]))
  return ids.map((id, index) => {
  const [raw, confirmed, confirmations] = results.slice(index * 3, index * 3 + 3)
  const [destination, value, data, executed] = raw as [Hex, bigint, Hex, boolean]
  validatePayload(destination, value, data)
  return { wallet: address, id, destination, value, data, executed, confirmed: Boolean(confirmed),
    confirmations: (confirmations as string[]).map((a) => a.toLowerCase()) }
  })
}
async function walletInfo(address: Hex, executed: boolean, block: bigint): Promise<WalletInfo> {
  const code = await publicClient.getBytecode({ address, blockNumber: block })
  if (!code || code === '0x') throw new Error('该地址没有合约代码')
  const [raw, balance] = await Promise.all([
    batch(address, block, [ { functionName: 'getOwners' }, { functionName: 'required' },
      { functionName: 'transactionCount' }, { functionName: 'getTransactionCount', args: [!executed, executed] } ]),
    publicClient.getBalance({ address, blockNumber: block }),
  ])
  const [owners, required, total, count] = raw as [string[], bigint, bigint, bigint]
  if (!owners.length || required < 1n || required > BigInt(owners.length) || count > total) throw new Error('不是兼容的经典多签合约')
  return { address, owners: owners.map((a) => a.toLowerCase()), required, total, count, balance, block }
}
// 钱包实际网络与账号二次核验，不仅依赖展示层连接状态。
async function session(expected?: string): Promise<Hex> {
  const account = getAccount(config)
  if (!account.address || account.status !== 'connected') throw new Error('请先连接钱包')
  if (expected && expected.toLowerCase() !== account.address.toLowerCase()) throw new Error('钱包账户已改变，请重新审阅')
  const client = await getConnectorClient(config)
  const chain = await client.request({ method: 'eth_chainId' })
  const accounts = await client.request({ method: 'eth_accounts' })
  if (BigInt(chain) !== 3666n) throw new Error('钱包仍在错误网络，请切换到焦耳链')
  if (!accounts[0] || accounts[0].toLowerCase() !== account.address.toLowerCase()) throw new Error('钱包账户不一致，请重新连接')
  return account.address
}

export function useMultisig() {
  const info = ref<WalletInfo | null>(null)
  const transactions = ref<MultisigTx[]>([])
  const loading = ref(false)
  const writing = ref(false)
  const error = ref('')
  const notice = ref('')
  const broadcast = ref<Broadcast | null>(savedBroadcast())
  function setBroadcast(item: Broadcast | null) { broadcast.value = item; persistBroadcast(item) }
  let seq = 0
  function reset() { seq++; info.value = null; transactions.value = []; loading.value = false; error.value = '' }

  async function load(input: string, offset = 0n, executed = false) {
    const request = ++seq
    loading.value = true; error.value = ''; info.value = null; transactions.value = []
    try {
      const address = walletAddress(input)
      if (offset < 0n) throw new Error('分页位置无效')
      if (await publicClient.getChainId() !== 3666) throw new Error('节点网络不正确')
      const block = await publicClient.getBlockNumber()
      const state = await walletInfo(address, executed, block)
      if (offset > 0n && offset >= state.count) throw new Error('列表已变化，请返回第一页')
      const size = Number(state.count - offset < BigInt(MULTISIG_PAGE_SIZE) ? state.count - offset : BigInt(MULTISIG_PAGE_SIZE))
      const raw = size ? await publicClient.readContract({ address, abi: ABI, functionName: 'getTransactionIds',
        args: [offset, offset + BigInt(size), !executed, executed], blockNumber: block }) as readonly bigint[] : []
      // 分页位置基于过滤后的列表；按本页数量截断，保留合法交易编号0。
      const ids = raw.slice(0, size)
      if (ids.length !== size || new Set(ids).size !== ids.length || ids.some((id) => id < 0n || id >= state.total)) {
        throw new Error('编号返回不完整或分页语义不兼容，停止展示操作按钮')
      }
      // 一次只读一页，聚合详情/确认读取，不逐笔发出网络请求。
      const list = await readTxs(address, ids, block)
      if (list.some((tx) => tx.executed !== executed)) throw new Error('交易状态与分页不一致，请刷新')
      if (request !== seq) return
      info.value = state; transactions.value = list
    } catch (e) { if (request === seq) error.value = safeErrorMessage(e) }
    finally { if (request === seq) loading.value = false }
  }

  async function finishBroadcast() {
    const pending = broadcast.value
    if (!pending) return
    const receipt = await waitForTransactionReceipt(config, { hash: pending.hash, chainId: 3666, timeout: 60_000 })
    if (receipt.transactionHash && receipt.transactionHash.toLowerCase() !== pending.hash.toLowerCase()) {
      setBroadcast(null); throw new Error('原交易已被替换或取消，请核查替代交易，不能视为原操作成功')
    }
    if (receipt.status !== 'success') { setBroadcast(null); throw new Error('交易已回滚') }
    let executionFailed = false
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pending.wallet.toLowerCase()) continue
      try { if (decodeEventLog({ abi: ABI, data: log.data, topics: log.topics }).eventName === 'ExecutionFailure') executionFailed = true } catch { /* 非本合约已知事件 */ }
    }
    if (executionFailed) { setBroadcast(null); throw new Error('多签交易已上链，但内部目标执行失败；不能当作执行成功') }
    if (pending.id !== undefined) {
      const tx = await readTx(pending.wallet, pending.id, receipt.blockNumber ?? await publicClient.getBlockNumber())
      if (pending.action === 'executeTransaction' && !tx.executed) {
        setBroadcast(null); throw new Error('回执成功但多签交易未执行，请核查合约状态')
      }
      const ownConfirmation = pending.actor && tx.confirmations.includes(pending.actor.toLowerCase())
      if (pending.action === 'confirmTransaction' && pending.actor && !tx.executed && !ownConfirmation) {
        setBroadcast(null); throw new Error('回执成功但确认状态未生效，请核查合约状态')
      }
      if (pending.action === 'revokeConfirmation' && pending.actor && ownConfirmation) {
        setBroadcast(null); throw new Error('回执成功但确认未撤回，请核查合约状态')
      }
    }
    setBroadcast(null)
    notice.value = pending.action === 'submitTransaction' ? '多签提交已上链，请刷新列表核查编号与执行状态'
      : '操作已上链，请刷新查看最新确认及执行状态'
  }
  async function run(task: () => Promise<void>) {
    if (writing.value || broadcast.value) return
    writing.value = true; error.value = ''; notice.value = ''
    try { await task(); await finishBroadcast() }
    catch (e) { error.value = safeErrorMessage(e) + (broadcast.value ? '；交易已广播，暂时禁止新操作，请查询回执，勿重复发送' : '') }
    finally { writing.value = false }
  }
  async function act(expected: MultisigTx, action: Action, expectedActor: string) {
    const request = seq
    const reviewed = { ...expected, confirmations: [...expected.confirmations] }
    await run(async () => {
      await switchChain(config, { chainId: 3666 })
      const actor = await session(expectedActor)
      const block = await publicClient.getBlockNumber()
      const state = await walletInfo(reviewed.wallet, false, block)
      if (!state.owners.includes(actor.toLowerCase())) throw new Error('当前账户不是该多签的签名人')
      if (reviewed.id >= state.total) throw new Error('交易编号不属于该多签')
      const actual = await readTx(reviewed.wallet, reviewed.id, block)
      assertSameTx(reviewed, actual)
      const already = actual.confirmations.includes(actor.toLowerCase())
      if (action === 'executeTransaction' && !actual.confirmed) throw new Error('确认数尚未达到执行门槛')
      if (action === 'confirmTransaction' && already) throw new Error('该账户已确认，请刷新')
      if (action === 'revokeConfirmation' && !already) throw new Error('该账户尚未确认，无法撤回')
      await publicClient.simulateContract({ address: reviewed.wallet, abi: ABI, functionName: action, args: [reviewed.id], account: actor })
      await session(actor)
      if (request !== seq) throw new Error('页面或多签地址已变化，已取消发送')
      const hash = await writeContract(config, { address: reviewed.wallet, abi: ABI, functionName: action,
        args: [reviewed.id], account: actor, chainId: 3666 })
      setBroadcast({ hash, wallet: reviewed.wallet, action, id: reviewed.id, actor })
    })
  }
  async function submit(addressInput: string, destination: string, value: bigint, data: Hex, expectedActor: string) {
    const request = seq
    const address = walletAddress(addressInput)
    validatePayload(destination, value, data)
    await run(async () => {
      await switchChain(config, { chainId: 3666 })
      const actor = await session(expectedActor)
      const state = await walletInfo(address, false, await publicClient.getBlockNumber())
      if (!state.owners.includes(actor.toLowerCase())) throw new Error('当前账户不是该多签的签名人')
      const args = [walletAddress(destination), value, data] as const
      await publicClient.simulateContract({ address, abi: ABI, functionName: 'submitTransaction', args, account: actor })
      await session(actor)
      if (request !== seq) throw new Error('页面或多签地址已变化，已取消发送')
      const hash = await writeContract(config, { address, abi: ABI, functionName: 'submitTransaction', args, account: actor, chainId: 3666 })
      setBroadcast({ hash, wallet: address, action: 'submitTransaction', actor })
    })
  }
  async function checkReceipt() {
    if (writing.value) return
    writing.value = true; error.value = ''
    try { await finishBroadcast() } catch (e) { error.value = safeErrorMessage(e) }
    finally { writing.value = false }
  }
  return { info, transactions, loading, writing, error, notice, broadcast, load, reset, act, submit, checkReceipt }
}
