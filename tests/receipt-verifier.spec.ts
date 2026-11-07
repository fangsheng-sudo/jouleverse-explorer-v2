import { describe, expect, it, vi } from 'vitest'
import { keccak256, stringToHex } from 'viem'
import mainnet from './fixtures/receipt-mainnet.json'
import { createReceiptVerifier, parseTransactionHash, serializeReceiptReport, verifyReceipt, type RpcReadRequest } from '../src/services/receipt-verifier'

const hash = `0x${'ab'.repeat(32)}`
const blockHash = `0x${'cd'.repeat(32)}`
const from = `0x${'11'.repeat(20)}`
const to = `0x${'22'.repeat(20)}`
const options = { expectedChainId: 3666, rpcUrl: 'https://rpc.jnsdao.com', now: () => new Date('2026-11-03T10:00:00Z') }
function fixture() {
  return {
    eth_chainId: '0xe52', eth_blockNumber: '0x66',
    eth_getTransactionByHash: { hash, from, to, nonce: '0x0', value: '0x0', gas: '0x186a0', gasPrice: '0x3b9aca00', input: '0x12345678', blockNumber: '0x64', blockHash, transactionIndex: '0x0' },
    eth_getTransactionReceipt: { transactionHash: hash, from, to, blockNumber: '0x64', blockHash, transactionIndex: '0x0', status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', contractAddress: null, logs: [] as unknown[] },
    eth_getBlockByNumber: { number: '0x64', hash: blockHash, timestamp: '0x10', transactions: [hash] },
  }
}
function reader(data: ReturnType<typeof fixture>) {
  return vi.fn(async (request: RpcReadRequest): Promise<unknown> => structuredClone(data[request.method]))
}
describe('基础核验与精度', () => {
  it('现场真链五请求回放经实际生产核心核验', async () => {
    const read = vi.fn(async (request: RpcReadRequest) => {
      const pair = mainnet.responses.find(item => JSON.stringify(item.request) === JSON.stringify(request))
      if (!pair) throw new Error('没有对应现场请求')
      return pair.result
    })
    const raw = mainnet.responses.find(item => item.request.method === 'eth_getTransactionByHash')!.result as { hash: string }
    const r = await verifyReceipt(read, raw.hash, options)
    expect(r.state).toBe('success')
    expect(r.inclusion).not.toBeNull()
    expect(read).toHaveBeenCalledTimes(5)
  })
  it('1559回执缺有效价格时不使用maxFee估算实际手续费', async () => {
    const d=fixture();Object.assign(d.eth_getTransactionByHash,{type:'0x2'});Reflect.deleteProperty(d.eth_getTransactionReceipt,'effectiveGasPrice')
    expect((await verifyReceipt(reader(d),hash,options)).execution?.feeWei).toBeNull()
  })
  it('交易携带其他chainId时拒绝', async () => {
    const d=fixture();Object.assign(d.eth_getTransactionByHash,{chainId:'0x1'})
    await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow('交易网络编号')
  })
  it('五个只读请求核对归属、确认数及手续费，不损失大整数', async () => {
    const data = fixture(); data.eth_getTransactionByHash.value = '0x20000000000001'
    const read = reader(data); const report = await verifyReceipt(read, hash, options)
    expect(report.state).toBe('success')
    expect(report.transaction?.valueWei).toBe('9007199254740993')
    expect(report.inclusion?.confirmations).toBe('3')
    expect(report.execution?.feeWei).toBe('21000000000000')
    expect(read.mock.calls.map(c => c[0].method)).toEqual(['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber','eth_blockNumber'])
    expect(read.mock.calls[3]![0]).toEqual({ method: 'eth_getBlockByNumber', params: ['0x64', false] })
  })
  it('执行失败独立报告，不能当成功', async () => {
    const d=fixture();d.eth_getTransactionReceipt.status='0x0'
    expect((await verifyReceipt(reader(d),hash,options)).state).toBe('reverted')
  })
  it('无gas价格显示未知，不以0替代', async () => {
    const d=fixture();Reflect.deleteProperty(d.eth_getTransactionReceipt,'effectiveGasPrice');Reflect.deleteProperty(d.eth_getTransactionByHash,'gasPrice')
    expect((await verifyReceipt(reader(d),hash,options)).execution?.feeWei).toBeNull()
  })
  it('兼容旧链回执缺少effectiveGasPrice，回退交易gasPrice', async () => {
    const d=fixture();Reflect.deleteProperty(d.eth_getTransactionReceipt,'effectiveGasPrice')
    expect((await verifyReceipt(reader(d),hash,options)).execution?.feeWei).toBe('21000000000000')
  })
  it('待打包不假造回执、不继续取区块', async () => {
    const d=fixture();Object.assign(d.eth_getTransactionByHash,{blockHash:null,blockNumber:null,transactionIndex:null});Object.assign(d,{eth_getTransactionReceipt:null})
    const read=reader(d);const r=await verifyReceipt(read,hash,options)
    expect(r.state).toBe('pending');expect(r.inclusion).toBeNull();expect(r.execution).toBeNull();expect(read).toHaveBeenCalledTimes(3)
  })
  it('节点未找到与网络失败严格区分', async () => {
    const d=fixture();Object.assign(d,{eth_getTransactionByHash:null,eth_getTransactionReceipt:null})
    expect((await verifyReceipt(reader(d),hash,options)).state).toBe('not-found')
    await expect(verifyReceipt(vi.fn().mockRejectedValue(new Error('网络离线')),hash,options)).rejects.toThrow('网络离线')
  })
  it('合约创建保留null目标和创建地址', async () => {
    const d=fixture();Object.assign(d.eth_getTransactionByHash,{to:null});Object.assign(d.eth_getTransactionReceipt,{to:null,contractAddress:from})
    const r=await verifyReceipt(reader(d),hash,options);expect(r.transaction?.to).toBeNull();expect(r.execution?.contractAddress).toBe(from)
  })
  it('无效hash不发送请求，合法hash大小写归一', async () => {
    const read=reader(fixture());await expect(verifyReceipt(read,'0x123',options)).rejects.toThrow();expect(read).not.toHaveBeenCalled()
    expect(parseTransactionHash('  '+hash.toUpperCase().replace('0X','0x')+'  ')).toBe(hash)
  })
  it('网络不匹配仅查询chainId后停止', async () => {
    const d=fixture();d.eth_chainId='0x1';const read=reader(d)
    await expect(verifyReceipt(read,hash,options)).rejects.toThrow('网络编号不匹配');expect(read).toHaveBeenCalledTimes(1)
  })
})
describe('失败关闭与重组防护', () => {
  it.each([
    ['eth_getTransactionByHash','hash',`0x${'ef'.repeat(32)}`],
    ['eth_getTransactionByHash','from',to],
    ['eth_getTransactionByHash','to',from],
    ['eth_getTransactionByHash','blockHash',`0x${'ef'.repeat(32)}`],
    ['eth_getTransactionByHash','blockNumber','0x63'],
    ['eth_getTransactionByHash','transactionIndex','0x1'],
    ['eth_getTransactionReceipt','transactionHash',`0x${'ef'.repeat(32)}`],
    ['eth_getTransactionReceipt','status','0x2'],
    ['eth_getTransactionReceipt','gasUsed','0x186a1'],
    ['eth_getTransactionReceipt','logs',null],
    ['eth_getTransactionReceipt','logs',Array(513).fill({})],
    ['eth_getTransactionByHash','nonce','0x00'],
    ['eth_getTransactionByHash','value',-1],
    ['eth_getBlockByNumber','number','0x65'],
    ['eth_getBlockByNumber','hash',`0x${'ef'.repeat(32)}`],
    ['eth_getBlockByNumber','transactions',[]],
    ['eth_getBlockByNumber','transactions',[`0x${'ef'.repeat(32)}`]],
  ])('拒绝矛盾/异常字段 %s.%s', async (method,key,value) => {
    const d=fixture(); Object.assign(d[method as keyof typeof d],{[key as string]:value})
    await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow()
  })
  it('最新高度落后于回执拒绝，不产生负确认数', async () => {
    const d=fixture();d.eth_blockNumber='0x63';await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow('落后')
  })
  it.each([
    { eth_getTransactionByHash: null }, { eth_getTransactionReceipt: null },
  ])('交易/回执缺失不产生成功结果 %s', async override => {
    const d=fixture();Object.assign(d,override);await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow()
  })
  it('异常区块/大数据失败，不静默截断', async () => {
    const d=fixture();Object.assign(d,{eth_getBlockByNumber:null});await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow()
    const e=fixture();e.eth_getTransactionByHash.input='0x'+'00'.repeat(262145);await expect(verifyReceipt(reader(e),hash,options)).rejects.toThrow('上限')
  })
})
function log() { return { address:to, topics:[`0x${'aa'.repeat(32)}`], data:'0x', logIndex:'0x0', transactionHash:hash, transactionIndex:'0x0', blockHash, blockNumber:'0x64', removed:false } }
describe('回执日志不是业务成功证明', () => {
  it('保留日志与警示，收费/履约不擅自判定', async () => {
    const d=fixture();d.eth_getTransactionReceipt.logs=[log()];const r=await verifyReceipt(reader(d),hash,options)
    expect(r.logs).toHaveLength(1);expect(r.limitations.join('')).toContain('不保证内部调用')
  })
  it.each([{ removed:true }, { transactionHash:`0x${'ef'.repeat(32)}` }, { blockHash:`0x${'ef'.repeat(32)}` }, { transactionIndex:'0x1' }, { blockNumber:'0x65' }, { topics:['0x01'] }, { topics:Array(5).fill(`0x${'aa'.repeat(32)}`) }, { data:'0xz' }])('阻断移除/错配/损坏日志 %s', async override => {
    const d=fixture();d.eth_getTransactionReceipt.logs=[{...log(),...override}];await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow()
  })
  it('超限日志数据拒绝而不是截断', async () => {
    const d=fixture();d.eth_getTransactionReceipt.logs=[{...log(),data:'0x'+'00'.repeat(1048577)}]
    await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow('1MiB')
  })
  it('重复日志编号与失败交易含事件均拒绝', async () => {
    const d=fixture();d.eth_getTransactionReceipt.logs=[log(),log()];await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow('重复')
    d.eth_getTransactionReceipt.logs=[log()];d.eth_getTransactionReceipt.status='0x0';await expect(verifyReceipt(reader(d),hash,options)).rejects.toThrow('执行失败')
  })
})
describe('缓存、并发与文件', () => {
  it('同hash并发合并；缓存保留原时间，30秒到期重读；调用者不能改写缓存', async () => {
    let now=1000;const read=reader(fixture());const verify=createReceiptVerifier(read,options,()=>now)
    const [a,b]=await Promise.all([verify(hash),verify(hash)]);expect(read).toHaveBeenCalledTimes(5);expect(a.report).toEqual(b.report)
    a.report.state='reverted';expect((await verify(hash)).report.state).toBe('success')
    now=2000;const c=await verify(hash);expect(c.cached).toBe(true);expect(c.report.source.observedAt).toBe('1970-01-01T00:00:01.000Z')
    now=31000;expect((await verify(hash)).cached).toBe(false);expect(read).toHaveBeenCalledTimes(10)
  })
  it('新hash不用旧缓存，失败不缓存且允许重试', async () => {
    const read=reader(fixture());read.mockRejectedValueOnce(new Error('offline'));const verify=createReceiptVerifier(read,options)
    await expect(verify(hash)).rejects.toThrow('offline');await verify(hash)
    await expect(verify(`0x${'ef'.repeat(32)}`)).rejects.toThrow('其他交易')
  })
  it('不同hash并发被阻断，不增加公共节点负担', async () => {
    const read=reader(fixture());const verify=createReceiptVerifier(read,options)
    const first=verify(hash);await expect(verify(`0x${'ef'.repeat(32)}`)).rejects.toThrow('任务进行中');await first
  })
  it('任何时刻最多两个RPC在途', async () => {
    const read=reader(fixture());let active=0,max=0
    await verifyReceipt(async req=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));try{return await read(req)}finally{active--}},hash,options)
    expect(max).toBe(2)
  })
  it('JSON没有bigint精度丢失，摘要可独立复算，改报告摘要会失配', async () => {
    const r=await verifyReceipt(reader(fixture()),hash,options);const bundle=JSON.parse(serializeReceiptReport(r))
    expect(bundle.report).toEqual(r)
    expect(bundle.integrity.digest).toBe(keccak256(stringToHex(JSON.stringify(bundle.report))))
    bundle.report.state='reverted';expect(bundle.integrity.digest).not.toBe(keccak256(stringToHex(JSON.stringify(bundle.report))))
  })
})
