// JNSVote 治理端数据层：创建提案（多签流程）+ 待确认交易管理
// 权限模型：createProposal 是 onlyOwner，owner = 2/3 多签。
//   前端仅对「签名人」展示治理入口；创建提案 = submitTransaction（提交者自动成为首确认人），
//   其余签名人 confirm，确认数达标后任一签名人 execute。
// 依赖：wagmi writeContract（签名）/ publicClient readContract（只读）。

import { ref } from 'vue'
import { writeContract, waitForTransactionReceipt, switchChain } from 'wagmi/actions'
import { encodeFunctionData, decodeFunctionData, toFunctionSelector } from 'viem'
import { publicClient } from '../config/client'
import { jouleverseChain } from '../config/chain'
import { config as wagmiConfig } from '../stores/wallet'
import { JNSVOTE_ADDRESS } from '../contracts/jnsvote'
import {
  JNSVOTE_MULTISIG_ADDRESS,
  multisigABI,
  createProposalABI,
} from '../contracts/jnsvoteGovernance'
import { safeErrorMessage } from '../utils/error'

// createProposal(string,string,uint256,uint256) 的 4 字节选择器
// 从签名派生（与 createProposalABI 同源强一致），避免硬编码魔法值与 ABI 静默错位
const CREATE_PROPOSAL_SELECTOR = toFunctionSelector('function createProposal(string,string,uint256,uint256)')

export interface PendingProposalTx {
  txId: number
  destination: string
  executed: boolean
  confirmed: boolean // isConfirmed = 确认数 >= required
  confirmationUnknown: boolean // isConfirmed / getConfirmations 读取失败时无法确定确认状态（避免误显示「确认」按钮）
  confirmationCount: number
  required: number
  confirmations: string[] // 已确认的签名人地址（小写）
  // 解码后的 createProposal 参数
  title: string
  link: string
  timeBegin: bigint
  timeEnd: bigint
}

export function useJNSVoteGovernance() {
  const isSigner = ref(false)
  const signers = ref<string[]>([])
  const required = ref(0n)
  const pendingTxs = ref<PendingProposalTx[]>([])
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  // 并发守卫序号：过期请求完成后丢弃写入，避免账户切换/断连时旧数据覆盖新状态
  let govSeq = 0

  // 读取治理状态：当前地址是否签名人 + 待确认的「创建提案」交易列表
  // 安全边界（审计 2026-11-02 三项阻塞）：
  //   1. isOwner 前置短路——非签名人仅 1 次轻量 isOwner 调用即返回，不触发后续多签扫描（原则二）
  //   2. 列表只保留 destination === JNSVote 且 selector === createProposal 的交易，
  //      避免把多签里积压的其它交易（WJ 提现 / ERC-20 划转 / addOwner 等）误展示成「创建提案」并误执行
  async function loadGovernance(address: string) {
    const seq = ++govSeq
    isLoading.value = true
    loadError.value = null
    try {
      // 第一步（也是非签名人唯一付出的一步）：isOwner 检查，非签名人立即返回
      const owner = await publicClient.readContract({
        address: JNSVOTE_MULTISIG_ADDRESS,
        abi: multisigABI,
        functionName: 'isOwner',
        args: [address as `0x${string}`],
      })
      if (!owner) {
        if (seq === govSeq) {
          isSigner.value = false
          signers.value = []
          pendingTxs.value = []
        }
        return
      }
      if (seq === govSeq) isSigner.value = true

      // 签名人：读签名人列表 + 确认门槛
      const [ownersRaw, requiredRaw] = await publicClient.multicall({
        contracts: [
          { address: JNSVOTE_MULTISIG_ADDRESS, abi: multisigABI, functionName: 'getOwners' },
          { address: JNSVOTE_MULTISIG_ADDRESS, abi: multisigABI, functionName: 'required' },
        ],
        allowFailure: false,
      })
      const owners = (ownersRaw as readonly string[]).map((a) => a.toLowerCase())
      if (seq !== govSeq) return
      signers.value = [...owners]
      required.value = BigInt(requiredRaw as bigint)
      const requiredNum = Number(requiredRaw as bigint) // 提到循环外（建议 4）

      // 待执行交易 id 列表（pending=true, executed=false）
      // getTransactionIds(from,to,...) 的 from/to 是「过滤后列表下标」；to 超过过滤后长度时
      // 合约会在末尾用 0 补齐（id=0 本身是合法的第一笔交易，不能按值过滤）。
      // 因此用 pending 数作 to，并只按请求的数量截断返回数组，避免把补齐位当作交易读取。
      const countRaw = await publicClient.readContract({
        address: JNSVOTE_MULTISIG_ADDRESS,
        abi: multisigABI,
        functionName: 'getTransactionCount',
        args: [true, false],
      })
      const count = Number(countRaw)
      if (count === 0) {
        if (seq === govSeq) pendingTxs.value = []
        return
      }
      const idsRaw = await publicClient.readContract({
        address: JNSVOTE_MULTISIG_ADDRESS,
        abi: multisigABI,
        functionName: 'getTransactionIds',
        args: [0n, BigInt(count), true, false],
      })
      const ids = (idsRaw as readonly bigint[]).slice(0, count).map((n) => Number(n))

      // 先只读 transactions（destination/value/data/executed）做过滤，
      // 避免对无关交易额外读 isConfirmed/getConfirmations
      const txCalls = ids.map((id) => ({
        address: JNSVOTE_MULTISIG_ADDRESS,
        abi: multisigABI,
        functionName: 'transactions' as const,
        args: [BigInt(id)] as const,
      }))
      const txResults = await publicClient.multicall({ contracts: txCalls, allowFailure: true })

      // 过滤 + 解码：只保留「JNSVote 目标 + createProposal selector」且能成功解码的交易
      const matched: {
        id: number
        destination: string
        executed: boolean
        title: string
        link: string
        timeBegin: bigint
        timeEnd: bigint
      }[] = []
      ids.forEach((id, i) => {
        const r = txResults[i]
        if (!r.result) return
        const [destination, value, data, executed] = r.result as readonly [string, bigint, string, boolean]
        if (destination.toLowerCase() !== JNSVOTE_ADDRESS.toLowerCase()) return
        // 本链不支持原生 J 转账，携带 value > 0 的创建提案交易执行必 revert，不入列表
        if (value !== 0n) return
        if (!data || data === '0x' || data.slice(0, 10).toLowerCase() !== CREATE_PROPOSAL_SELECTOR) return
        // selector 已匹配，但参数可能畸形；解码失败则不入列表（无法确认是合法创建提案）
        try {
          const decoded = decodeProposalData(data)
          matched.push({ id, destination, executed: Boolean(executed), ...decoded })
        } catch {
          // 跳过无法解码的交易
        }
      })

      // 对过滤后的少数交易读确认状态 + 确认人名单
      const confCalls = matched.flatMap((m) => [
        { address: JNSVOTE_MULTISIG_ADDRESS, abi: multisigABI, functionName: 'isConfirmed' as const, args: [BigInt(m.id)] as const },
        { address: JNSVOTE_MULTISIG_ADDRESS, abi: multisigABI, functionName: 'getConfirmations' as const, args: [BigInt(m.id)] as const },
      ])
      const confResults = await publicClient.multicall({ contracts: confCalls, allowFailure: true })

      const list: PendingProposalTx[] = matched.map((m, i) => {
        const confRes = confResults[i * 2]
        const confsRes = confResults[i * 2 + 1]
        // 确认状态未知：isConfirmed 或 getConfirmations 任一读取失败，都无法判断签名人是否已确认
        // （否则静默降级为空数组会让已确认过的签名人仍看到「确认」按钮，点了合约 revert already confirmed）
        const confirmationUnknown = confRes.result == null || confsRes.result == null
        const confirmed = confirmationUnknown ? false : Boolean(confRes.result as boolean)
        const confirmations = confirmationUnknown
          ? []
          : (confsRes.result as readonly string[]).map((a) => a.toLowerCase())
        return {
          txId: m.id,
          destination: m.destination,
          executed: m.executed,
          confirmed,
          confirmationUnknown,
          confirmationCount: confirmations.length,
          required: requiredNum,
          confirmations,
          title: m.title,
          link: m.link,
          timeBegin: m.timeBegin,
          timeEnd: m.timeEnd,
        }
      })

      if (seq === govSeq) pendingTxs.value = list
    } catch (e) {
      if (seq === govSeq) loadError.value = safeErrorMessage(e)
    } finally {
      if (seq === govSeq) isLoading.value = false
    }
  }

  // 解码 createProposal 的 calldata
  function decodeProposalData(data: string): { title: string; link: string; timeBegin: bigint; timeEnd: bigint } {
    const result = decodeFunctionData({
      abi: createProposalABI,
      data: data as `0x${string}`,
    })
    const args = result.args as readonly [string, string, bigint, bigint]
    return { title: args[0], link: args[1], timeBegin: args[2], timeEnd: args[3] }
  }

  // 创建提案：提交多签交易（提交者自动成为首确认人），返回 transactionId
  async function submitProposal(input: {
    title: string
    link: string
    timeBegin: bigint
    timeEnd: bigint
  }): Promise<number> {
    const data = encodeFunctionData({
      abi: createProposalABI,
      functionName: 'createProposal',
      args: [input.title, input.link, input.timeBegin, input.timeEnd],
    })

    await ensureChain()

    const hash = await writeContract(wagmiConfig, {
      address: JNSVOTE_MULTISIG_ADDRESS,
      abi: multisigABI,
      functionName: 'submitTransaction',
      args: [JNSVOTE_ADDRESS, 0n, data],
    })

    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })
    if (receipt.status === 'reverted') {
      throw new Error('提交多签交易已回滚')
    }

    return parseSubmissionTxId(receipt)
  }

  // 确保钱包在 Jouleverse 链上（与 useJNSVote.vote 一致；已在目标链时 switchChain 直接成功）
  async function ensureChain(): Promise<void> {
    await switchChain(wagmiConfig, { chainId: jouleverseChain.id })
  }

  // 从 receipt 解析 Submission 事件拿 transactionId
  // Gnosis MultiSigWallet 事件：event Submission(uint indexed transactionId)
  // topic0 = keccak256('Submission(uint256)')，topic[1] = indexed transactionId
  function parseSubmissionTxId(receipt: { logs: readonly { address?: string; topics: readonly string[] }[] }): number {
    const SUBMISSION_TOPIC = '0xc0ba8fe4b176c1714197d43b9cc6bcf797a4a7461c5fe8d0ef6e184ae7601e51'
    for (const log of receipt.logs) {
      // 校验发出合约是多签地址，避免同交易内其它合约误发同名事件被错解析
      if (
        log.address?.toLowerCase() === JNSVOTE_MULTISIG_ADDRESS.toLowerCase() &&
        log.topics.length >= 2 &&
        log.topics[0].toLowerCase() === SUBMISSION_TOPIC
      ) {
        return parseInt(log.topics[1], 16)
      }
    }
    // 兜底：无法解析时返回 -1（提交成功但 id 未知，界面提示刷新查看）
    return -1
  }

  // 确认交易（其余签名人）
  async function confirmTx(txId: number): Promise<void> {
    await ensureChain()
    const hash = await writeContract(wagmiConfig, {
      address: JNSVOTE_MULTISIG_ADDRESS,
      abi: multisigABI,
      functionName: 'confirmTransaction',
      args: [BigInt(txId)],
    })
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })
    if (receipt.status === 'reverted') {
      throw new Error('确认多签交易已回滚')
    }
  }

  // 执行交易（确认数达标后任一签名人）
  async function executeTx(txId: number): Promise<void> {
    await ensureChain()
    // 防御深度：执行前先读该交易校验「目标 + value + selector」，不依赖列表过滤。
    // 防止将来有人从别处拿到 txId 直接调本函数而误执行多签里积压的其它交易（如 WJ 提现）。
    const tx = await publicClient.readContract({
      address: JNSVOTE_MULTISIG_ADDRESS,
      abi: multisigABI,
      functionName: 'transactions',
      args: [BigInt(txId)],
    })
    const [destination, value, data, executed] = tx as readonly [string, bigint, string, boolean]
    if (executed) {
      throw new Error('该交易已被执行，请刷新列表')
    }
    if (destination.toLowerCase() !== JNSVOTE_ADDRESS.toLowerCase() || value !== 0n) {
      throw new Error('该交易不是「创建提案」类交易，已阻止执行')
    }
    if (!data || data === '0x' || data.slice(0, 10).toLowerCase() !== CREATE_PROPOSAL_SELECTOR) {
      throw new Error('该交易不是「创建提案」类交易，已阻止执行')
    }
    const hash = await writeContract(wagmiConfig, {
      address: JNSVOTE_MULTISIG_ADDRESS,
      abi: multisigABI,
      functionName: 'executeTransaction',
      args: [BigInt(txId)],
    })
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })
    if (receipt.status === 'reverted') {
      throw new Error('执行多签交易已回滚')
    }
  }

  // 重置治理状态并作废在途请求（断连时调用，避免 in-flight 完成后回写旧账户数据）
  function reset(): void {
    govSeq++ // 使所有在途 loadGovernance 完成后因 seq 过期而丢弃写入
    isSigner.value = false
    signers.value = []
    pendingTxs.value = []
    loadError.value = null
    isLoading.value = false
  }

  return {
    isSigner,
    signers,
    required,
    pendingTxs,
    isLoading,
    loadError,
    loadGovernance,
    reset,
    submitProposal,
    confirmTx,
    executeTx,
  }
}
