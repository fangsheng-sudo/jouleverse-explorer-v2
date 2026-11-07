import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeEventTopics, encodeFunctionData, type Hex } from 'viem'
import { abi_multisig } from '../src/contracts/toolbox'
import { assertSameTx, describePayload, validatePayload, type MultisigTx } from '../src/utils/multisig'

const mocks = vi.hoisted(() => ({
  getChainId: vi.fn(), getBlockNumber: vi.fn(), getBytecode: vi.fn(), getBalance: vi.fn(),
  readContract: vi.fn(), multicall: vi.fn(), simulateContract: vi.fn(),
  getAccount: vi.fn(), getConnectorClient: vi.fn(), switchChain: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn(),
}))
vi.mock('../src/config/client', () => ({ publicClient: mocks }))
vi.mock('../src/stores/wallet', () => ({ config: {} }))
vi.mock('wagmi/actions', () => mocks)
import { useMultisig } from '../src/composables/useMultisig'
const W = '0x1111111111111111111111111111111111111111' as Hex
const A = '0x2222222222222222222222222222222222222222' as Hex
const B = '0x3333333333333333333333333333333333333333' as Hex
const HASH = `0x${'ab'.repeat(32)}` as Hex
const tx = (overrides = {}): MultisigTx => ({ wallet: W, id: 0n, destination: B, value: 0n, data: '0x12345678',
  executed: false, confirmed: true, confirmations: [B], ...overrides })
type Call = { functionName: string; args?: unknown[]; blockNumber?: bigint }
let current: MultisigTx
let total = 2n
let count = 1n
let owners = [A, B]
beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks(); current = tx(); total = 2n; count = 1n; owners = [A, B]
  mocks.getChainId.mockResolvedValue(3666); mocks.getBlockNumber.mockResolvedValue(100n)
  mocks.getBytecode.mockResolvedValue('0x1234'); mocks.getBalance.mockResolvedValue(1n)
  mocks.readContract.mockResolvedValue([0n])
  mocks.multicall.mockImplementation(async ({ contracts }: { contracts: Call[] }) => contracts.map(({ functionName }) => {
    switch (functionName) {
      case 'getOwners': return owners
      case 'required': return 2n
      case 'transactionCount': return total
      case 'getTransactionCount': return count
      case 'transactions': return [current.destination, current.value, current.data, current.executed]
      case 'isConfirmed': return current.confirmed
      case 'getConfirmations': return current.confirmations
      default: throw new Error(functionName)
    }
  }))
  mocks.getAccount.mockReturnValue({ address: A, status: 'connected' })
  mocks.getConnectorClient.mockResolvedValue({ request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0xe52' : [A] })
  mocks.switchChain.mockResolvedValue({ id: 3666 }); mocks.simulateContract.mockResolvedValue({})
  mocks.writeContract.mockResolvedValue(HASH)
  mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] })
})
describe('通用多签读取与写入边界', () => {
  it('保留编号0，并按同一区块读取数量、列表和详情', async () => {
    const api = useMultisig(); await api.load(W)
    expect(api.error.value).toBe('')
    expect(api.transactions.value[0].id).toBe(0n)
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({ args: [0n, 1n, true, false], blockNumber: 100n }))
    expect(mocks.multicall.mock.calls.every(([v]) => v.blockNumber === 100n)).toBe(true)
  })
  it('超长返回只按本页数量截断，保留真实编号0', async () => {
    mocks.readContract.mockResolvedValue([0n, 0n, 0n])
    const api = useMultisig(); await api.load(W)
    expect(api.transactions.value.map((v) => v.id)).toEqual([0n])
  })
  it('分页最多20笔，不丢失超出安全整数范围的编号', async () => {
    count = 25n; total = 2n ** 60n
    const ids = [2n ** 55n, ...Array.from({ length: 19 }, (_, i) => BigInt(i))]
    mocks.readContract.mockResolvedValue(ids)
    const api = useMultisig(); await api.load(W)
    expect(api.transactions.value).toHaveLength(20)
    expect(api.transactions.value[0].id).toBe(2n ** 55n)
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({ args: [0n, 20n, true, false] }))
  })
  it('重复或越界编号时不展示操作列表', async () => {
    count = 2n; mocks.readContract.mockResolvedValue([0n, 0n])
    const api = useMultisig(); await api.load(W)
    expect(api.error.value).toContain('不兼容'); expect(api.info.value).toBeNull()
  })
  it('普通地址不作为多签管理', async () => {
    mocks.getBytecode.mockResolvedValue('0x')
    const api = useMultisig(); await api.load(W)
    expect(api.error.value).toContain('没有合约'); expect(mocks.multicall).not.toHaveBeenCalled()
  })
  it.each([
    { destination: A }, { value: 1n }, { data: '0xaabbccdd' }, { data: '0x1234567801' }, { executed: true },
  ])('发送前阻断内容变化或已执行状态：%s', async (changed) => {
    const reviewed = tx(); current = tx(changed)
    const api = useMultisig(); await api.act(reviewed, 'executeTransaction', A)
    expect(api.error.value).not.toBe(''); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('同一编号不能跨多签地址挪用', () => {
    expect(() => assertSameTx(tx(), tx({ wallet: B }))).toThrow('归属')
  })
  it('非签名人不能操作', async () => {
    owners = [B, W]
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('不是'); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('钱包忽略切链请求时仍阻断发送', async () => {
    mocks.getConnectorClient.mockResolvedValue({ request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x1' : [A] })
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('错误网络'); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('审阅后账户改变时不发送', async () => {
    mocks.getAccount.mockReturnValue({ address: B, status: 'connected' })
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('账户已改变'); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('模拟后实际账户发生变化也不发送', async () => {
    mocks.simulateContract.mockImplementation(async () => { mocks.getAccount.mockReturnValue({ address: B, status: 'connected' }); return {} })
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(mocks.simulateContract).toHaveBeenCalledOnce(); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('切换页面或重置多签后取消尚未发送的操作', async () => {
    const api = useMultisig()
    mocks.simulateContract.mockImplementation(async () => { api.reset(); return {} })
    await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('已取消发送'); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('确认不足不能执行；已确认不能再确认', async () => {
    current.confirmed = false
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('门槛')
    current = tx({ confirmations: [A, B] })
    await api.act(tx(), 'confirmTransaction', A)
    expect(api.error.value).toContain('已确认'); expect(mocks.writeContract).not.toHaveBeenCalled()
  })
  it('确认操作同样核对载荷，避免达到门槛后误执行', async () => {
    current.value = 1n
    const api = useMultisig(); await api.act(tx(), 'confirmTransaction', A)
    expect(api.error.value).toContain('不一致'); expect(mocks.simulateContract).not.toHaveBeenCalled()
  })
  it('已广播但回执超时保留哈希并禁止新增写操作', async () => {
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error('回执超时'))
    const api = useMultisig(); await api.act(tx(), 'confirmTransaction', A)
    expect(api.broadcast.value?.hash).toBe(HASH)
    const reopened = useMultisig()
    expect(reopened.broadcast.value?.hash).toBe(HASH)
    expect(reopened.broadcast.value?.id).toBe(0n)
    await api.act(tx(), 'confirmTransaction', A)
    expect(mocks.writeContract).toHaveBeenCalledOnce()
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] })
    await api.checkReceipt(); expect(api.broadcast.value).toBeNull()
  })
  it('外层回执成功但内部执行失败时明确报错', async () => {
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [{ address: W, data: '0x',
      topics: encodeEventTopics({ abi: abi_multisig, eventName: 'ExecutionFailure', args: { transactionId: 0n } }),
    }] })
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('内部目标执行失败'); expect(api.notice.value).toBe('')
  })
  it('执行回执成功仍需检查 executed 已改变', async () => {
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('未执行')
  })
  it('回执成功但确认未生效时不能报告确认成功', async () => {
    const api = useMultisig(); await api.act(tx(), 'confirmTransaction', A)
    expect(api.error.value).toContain('确认状态未生效'); expect(api.notice.value).toBe('')
  })
  it('取消或替换后的回执不能当作原多签操作成功', async () => {
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', transactionHash: `0x${'cd'.repeat(32)}`, logs: [] })
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toContain('替换或取消'); expect(api.notice.value).toBe('')
  })
  it('成功执行后解除广播锁，发送账号和链显式固定', async () => {
    mocks.waitForTransactionReceipt.mockImplementation(async () => { current.executed = true; return { status: 'success', logs: [] } })
    const api = useMultisig(); await api.act(tx(), 'executeTransaction', A)
    expect(api.error.value).toBe(''); expect(api.broadcast.value).toBeNull()
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ address: W, account: A, chainId: 3666, args: [0n] }))
  })
  it('提交交易固定目标、金额及完整载荷，并阻止双击', async () => {
    let release!: () => void
    mocks.waitForTransactionReceipt.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ status: 'success', logs: [] }) }))
    const api = useMultisig(); const first = api.submit(W, B, 1n, '0x12345678', A)
    await vi.waitFor(() => expect(api.broadcast.value).not.toBeNull())
    await api.submit(W, B, 1n, '0x12345678', A)
    expect(mocks.writeContract).toHaveBeenCalledOnce()
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ functionName: 'submitTransaction', args: [B, 1n, '0x12345678'] }))
    release(); await first
  })
  it('编号与金额保持整数范围，禁止畸形十六进制', () => {
    for (const data of ['0x1', 'oops']) expect(() => validatePayload(B, 0n, data)).toThrow()
    expect(() => validatePayload(B, 0n, '0x1234')).not.toThrow()
    expect(() => validatePayload(B, -1n, '0x')).toThrow()
  })
  it('自管理交易按多签 ABI 解码，不误显为未知调用', () => {
    const self = W
    const addOwner = encodeFunctionData({ abi: abi_multisig, functionName: 'addOwner', args: [A] })
    expect(describePayload(self, addOwner, self)).toContain('addOwner')
    const changeReq = encodeFunctionData({ abi: abi_multisig, functionName: 'changeRequirement', args: [3n] })
    expect(describePayload(self, changeReq, self)).toContain('changeRequirement')
    // 目标不是多签自身时，仍走注册表/未知调用，不套用多签 ABI
    expect(describePayload(B, addOwner, self)).toContain('未知调用')
  })
})
