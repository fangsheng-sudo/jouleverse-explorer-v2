import { expect, it, vi } from 'vitest'
import { createJouleverseKit } from '../src/integration/jouleverse-kit'
import { baselineBlock } from '../src/contracts/deployment-verification'
import { toolboxContracts } from '../src/contracts/toolbox'

it('创建和读取目录不联网，快照修改不污染目录', () => {
  const getChainId = vi.fn(async () => 3666)
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId, getBlock: async () => ({ hash: baselineBlock.hash }), getBlockNumber: async () => baselineBlock.number, getCode: async () => '0x',
  } })
  const list = kit.listContracts()
  expect(list).toHaveLength(toolboxContracts.length)
  expect(Object.isFrozen(list)).toBe(true)
  expect(Object.isFrozen(list[0])).toBe(true)
  expect(Reflect.set(list[0]!, 'name', '修改副本')).toBe(false)
  expect(kit.listContracts()[0]!.name).not.toBe('修改副本')
  expect(getChainId).not.toHaveBeenCalled()
})
it('仅核验登记地址，结果可直接序列化', async () => {
  const getCode = vi.fn(async () => '0x' as const)
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId: async () => 3666, getBlock: async () => ({ hash: baselineBlock.hash }), getBlockNumber: async () => baselineBlock.number, getCode,
  } })
  await expect(kit.verifyContract('unknown')).rejects.toMatchObject({ code: 'unknown-contract' })
  expect(getCode).not.toHaveBeenCalled()
  const report = await kit.verifyContract('wj')
  expect(getCode).toHaveBeenCalledExactlyOnceWith({ address: toolboxContracts.find(x => x.key === 'wj')!.address, blockNumber: baselineBlock.number })
  expect(JSON.parse(JSON.stringify(report))).toMatchObject({ status: 'no-code', blockNumber: baselineBlock.number.toString() })
})
it('未配置适配器时明确拒绝', async () => {
  const kit = createJouleverseKit()
  expect(kit.capabilities).toMatchObject({ readiness: false, receipt: false })
  await expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'adapter-unavailable' })
  await expect(kit.observeTransaction('0x' + '12'.repeat(32))).rejects.toMatchObject({ code: 'adapter-unavailable' })
})
it('委托既有适配器并保留执行结果，不把执行成功改写成付款成功', async () => {
  const readiness = { checks: ['sample'] }
  const checkReadiness = vi.fn(async () => readiness)
  const result = { report: { state: 'success' }, cached: false }
  const observeReceipt = vi.fn(async () => result)
  const kit = createJouleverseKit({ checkReadiness, observeReceipt })
  await expect(kit.observeTransaction('0x1234')).rejects.toMatchObject({ code: 'invalid-transaction-hash' })
  expect(observeReceipt).not.toHaveBeenCalled()
  expect(await kit.checkReadiness()).toBe(readiness)
  expect(await kit.observeTransaction('0x' + 'AB'.repeat(32))).toBe(result)
  expect(observeReceipt).toHaveBeenCalledExactlyOnceWith('0x' + 'ab'.repeat(32), expect.any(AbortSignal))
})

it('公开网络身份不可改写，只读 ABI 副本不污染后续调用', () => {
  const kit = createJouleverseKit()
  expect(kit.network).toMatchObject({ chainId: 3666, name: 'Jouleverse Mainnet', baseline: { blockHash: baselineBlock.hash } })
  expect(Object.isFrozen(kit)).toBe(true)
  expect(Object.isFrozen(kit.network.nativeCurrency)).toBe(true)
  const methods = kit.listReadMethods('wj')
  expect(methods.length).toBeGreaterThan(0)
  expect(methods.every(x => x.type === 'function' && ['view', 'pure'].includes(x.stateMutability))).toBe(true)
  methods.length = 0
  expect(kit.listReadMethods('wj').length).toBeGreaterThan(0)
})

it('写方法、未知方法、无效 ABI 参数在联网前拒绝', async () => {
  const getChainId = vi.fn(async () => 3666)
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId, getBlock: async () => ({ hash: baselineBlock.hash }), getBlockNumber: async () => baselineBlock.number,
    getCode: async () => '0x',
  }, readContract: vi.fn() })
  for (const fn of ['transfer', 'approve', 'missing']) {
    await expect(kit.readContract('wj', fn, [])).rejects.toMatchObject({ code: 'read-not-allowed' })
  }
  await expect(kit.readContract('wj', 'balanceOf', [])).rejects.toMatchObject({ code: 'invalid-argument' })
  await expect(kit.readContract('wj', 'balanceOf', ['not-an-address'])).rejects.toMatchObject({ code: 'invalid-argument' })
  expect(getChainId).not.toHaveBeenCalled()
})

it.each([
  [1, baselineBlock.hash, '0x6000', 'wrong-chain'],
  [3666, '0x' + '11'.repeat(32), '0x6000', 'baseline-mismatch'],
  [3666, baselineBlock.hash, '0x', 'no-code'],
  [3666, baselineBlock.hash, '0x6000', 'mismatch'],
  [3666, baselineBlock.hash, '0x1', 'error'],
] as const)('不可信部署 %s/%s/%s 不会执行 eth_call', async (chainId, hash, code, status) => {
  const readContract = vi.fn()
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId: async () => chainId, getBlock: async () => ({ hash: hash as `0x${string}` }),
    getBlockNumber: async () => baselineBlock.number, getCode: async () => code,
  }, readContract })
  expect((await kit.verifyContract('wj')).status).toBe(status)
  await expect(kit.readContract('wj', 'totalSupply')).rejects.toMatchObject({ code: 'deployment-untrusted' })
  expect(readContract).not.toHaveBeenCalled()
})

it('不混用注入的核验端点和默认只读端点', async () => {
  const kit = createJouleverseKit({ deploymentReader: {
    getChainId: async () => 3666, getBlock: async () => ({ hash: baselineBlock.hash }),
    getBlockNumber: async () => baselineBlock.number, getCode: async () => '0x',
  } })
  expect(kit.capabilities.contractRead).toBe(false)
  await expect(kit.readContract('wj', 'totalSupply')).rejects.toMatchObject({ code: 'adapter-unavailable' })
})

it('空代码响应或过旧高度不能获得部署匹配结论', async () => {
  const rpc = { getChainId: async () => 3666, getBlock: async () => ({ hash: baselineBlock.hash }),
    getBlockNumber: vi.fn(async (): Promise<bigint> => baselineBlock.number), getCode: vi.fn(async () => undefined) }
  expect((await createJouleverseKit({ deploymentReader: rpc }).verifyContract('wj')).status).toBe('no-code')
  rpc.getBlockNumber.mockResolvedValueOnce(1n)
  rpc.getCode.mockClear()
  expect((await createJouleverseKit({ deploymentReader: rpc }).verifyContract('wj')).status).toBe('error')
  expect(rpc.getCode).not.toHaveBeenCalled()
})

it('适配器异常不会泄漏节点消息、请求或个人信息', async () => {
  const kit = createJouleverseKit({ checkReadiness: () => { throw new Error('private upstream detail') } })
  await expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'adapter-error', message: 'Jouleverse integration: adapter-error' })
})

it('超时会发出取消信号，并阻止不响应取消的适配器积累无限后台请求', async () => {
  vi.useFakeTimers()
  try {
    const signals: AbortSignal[] = []
    let finish!: (value: string) => void
    const kit = createJouleverseKit({ checkReadiness: signal => {
      signals.push(signal)
      return new Promise<string>(resolve => { finish = resolve })
    } }, { timeoutMs: 50 })
    const first = expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50)
    await first
    expect(signals[0]!.aborted).toBe(true)
    const second = expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50)
    await second
    await expect(kit.checkReadiness()).rejects.toMatchObject({ code: 'busy' })
    finish('late result')
    await Promise.resolve()
  } finally { vi.useRealTimers() }
})

it('超时后不继续启动部署核验的后续请求', async () => {
  vi.useFakeTimers()
  try {
    let resolveChain!: (id: number) => void
    const getBlock = vi.fn(async () => ({ hash: baselineBlock.hash }))
    const kit = createJouleverseKit({ deploymentReader: {
      getChainId: () => new Promise<number>(resolve => { resolveChain = resolve }), getBlock,
      getBlockNumber: async () => baselineBlock.number, getCode: async () => '0x',
    } }, { timeoutMs: 50 })
    const check = expect(kit.verifyContract('wj')).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50)
    await check
    resolveChain(3666)
    await vi.advanceTimersByTimeAsync(0)
    expect(getBlock).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it.each([0, -1, NaN, Infinity, 1.5, 30001])('拒绝不合法截止时间 %s', timeoutMs => {
  expect(() => createJouleverseKit({}, { timeoutMs })).toThrow('invalid-argument')
})


it('不允许自定义读取适配器静默搭配默认核验端点', async () => {
  const readContract = vi.fn()
  const kit = createJouleverseKit({ readContract })
  expect(kit.capabilities.contractRead).toBe(false)
  await expect(kit.readContract('wj', 'totalSupply')).rejects.toMatchObject({ code: 'adapter-unavailable' })
  expect(readContract).not.toHaveBeenCalled()
})

it('缺少独立受信创世哈希时明确 unconfigured，零请求且不伪造信任', async () => {
  const kit = createJouleverseKit()
  expect(kit.network.identityPolicy).toBe('checkpoint-only')
  expect(kit.network.genesisHash).toBeNull()
  expect(kit.capabilities.networkIdentity).toBe(false)
  await expect(kit.verifyNetworkIdentity()).resolves.toEqual({ status: 'unconfigured' })
  expect(() => createJouleverseKit({}, { expectedGenesisHash: '0x1' })).toThrow('invalid-argument')
})

it('冻结的目录对象仍不受共享注册表后续修改影响', () => {
  const kit = createJouleverseKit()
  const contract = toolboxContracts[0]!
  const name = contract.name
  try { contract.name = 'changed'; expect(kit.listContracts()[0]!.name).toBe(name) }
  finally { contract.name = name }
})

it('套件网络身份检查受统一超时控制且不会在超时后继续查区块', async () => {
  vi.useFakeTimers()
  try {
    let resolveChain!: (id: number) => void
    const getBlock = vi.fn(async () => ({ hash: baselineBlock.hash }))
    const kit = createJouleverseKit({ deploymentReader: {
      getChainId: () => new Promise<number>(resolve => { resolveChain = resolve }), getBlock,
      getBlockNumber: async () => baselineBlock.number, getCode: async () => '0x',
    } }, { timeoutMs: 50, expectedGenesisHash: `0x${'ab'.repeat(32)}` })
    const check = expect(kit.verifyNetworkIdentity()).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50)
    await check
    resolveChain(3666)
    await vi.advanceTimersByTimeAsync(0)
    expect(getBlock).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
