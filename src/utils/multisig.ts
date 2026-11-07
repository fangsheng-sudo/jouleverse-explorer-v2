import { decodeFunctionData, getAddress, isAddress, isHex, zeroAddress, type Abi, type Hex } from 'viem'
import { abi_multisig, toolboxContracts } from '../contracts/toolbox'

export interface MultisigTx {
  wallet: Hex
  id: bigint
  destination: Hex
  value: bigint
  data: Hex
  executed: boolean
  confirmed: boolean
  confirmations: string[]
}
export function walletAddress(value: string): Hex {
  if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error('请输入有效的非零多签地址')
  return getAddress(value)
}
export function validatePayload(destination: string, value: bigint, data: string) {
  walletAddress(destination)
  if (value < 0n || value >= 2n ** 256n) throw new Error('原生金额超出范围')
  if (!isHex(data) || data.length % 2 !== 0) {
    throw new Error('调用数据必须为偶数长度十六进制字节串，空数据使用0x')
  }
  if (data.length > 131074) throw new Error('调用数据过长（最多64 KiB）')
}
export function selector(data: Hex): string {
  return data.length >= 10 ? data.slice(0, 10).toLowerCase() : data === '0x' ? '无（空数据）' : '不足4字节（回退调用）'
}
export function assertSameTx(expected: MultisigTx, actual: MultisigTx) {
  if (actual.executed) throw new Error('该交易已经执行，禁止重复操作')
  if (actual.wallet.toLowerCase() !== expected.wallet.toLowerCase() || actual.id !== expected.id
    || actual.destination.toLowerCase() !== expected.destination.toLowerCase()
    || actual.value !== expected.value || selector(actual.data) !== selector(expected.data)
    || actual.data.toLowerCase() !== expected.data.toLowerCase()) {
    throw new Error('链上交易归属或内容与已审阅快照不一致，请刷新后重新审阅')
  }
}
const MULTISIG_ABI: Abi = abi_multisig

export function describePayload(destination: Hex, data: Hex, multisigSelf?: Hex): string {
  if (data === '0x') return '空调用数据：可能为转账或接收函数，请确认目标用途'
  const decodeCandidates: { label: string; abi: Abi }[] = []
  const contract = toolboxContracts.find((c) => c.address.toLowerCase() === destination.toLowerCase())
  if (contract) decodeCandidates.push({ label: contract.name, abi: contract.abi })
  // 自管理交易：目标即当前多签本身，即使未登记进 toolbox 注册表，也按经典 Gnosis 多签 ABI 解码（addOwner/changeRequirement 等）
  if (multisigSelf && destination.toLowerCase() === multisigSelf.toLowerCase()) {
    decodeCandidates.push({ label: '多签自管理', abi: MULTISIG_ABI })
  }
  for (const { label, abi } of decodeCandidates) {
    try {
      const decoded = decodeFunctionData({ abi, data })
      return `${label} · ${decoded.functionName} · ${JSON.stringify(decoded.args, (_, v) => typeof v === 'bigint' ? String(v) : v)}`
    } catch { /* 尝试下一候选解码 */ }
  }
  return `未知调用 · 选择器 ${selector(data)}（未核验实际语义，必须独立核对完整调用数据）`
}
