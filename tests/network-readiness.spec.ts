import { expect, it, vi } from 'vitest'
import { probeNetwork, createNetworkProbe, type ReadinessProfile, type ProbeRequest } from '../src/services/network-readiness'
import live from './fixtures/integration-mainnet.json'
const genesis=`0x${'aa'.repeat(32)}` as const,headHash=`0x${'bb'.repeat(32)}` as const
const profile:ReadinessProfile={schema:'jouleverse.integration-profile/v1',chainId:3666,name:'test',rpcUrl:'https://rpc.jnsdao.com',explorerUrl:'https://jscan.jnsdao.com',nativeCurrency:{name:'J',symbol:'J',decimals:18},multicall3:'0x1111111111111111111111111111111111111111'}
function fixture(){return {chainId:'0xe52',head:'0x64',client:'Geth/test',genesis:{number:'0x0',hash:genesis},block:{number:'0x64',hash:headHash,timestamp:'0x123',baseFeePerGas:'0x7'},gas:'0x7',code:'0x6000',call:'0x'+BigInt(3666).toString(16).padStart(64,'0')}}
function reader(d=fixture()) { return vi.fn(async(req:ProbeRequest):Promise<unknown>=>{
 if(req.method==='eth_chainId')return d.chainId
 if(req.method==='eth_blockNumber')return d.head
 if(req.method==='web3_clientVersion')return d.client
 if(req.method==='eth_getBlockByNumber')return req.params[0]==='0x0'?d.genesis:d.block
 if(req.method==='eth_gasPrice')return d.gas
 if(req.method==='eth_getCode')return d.code
 return d.call
}) }
it('真链8请求fixture用实际核心回放验证',async()=>{
 const read=vi.fn(async(req:ProbeRequest)=>{const pair=live.responses.find(x=>JSON.stringify(x.request)===JSON.stringify(req));if(!pair)throw Error('missing request');if('error'in pair)throw Error(String(pair.error));return pair.result})
 const r=await probeNetwork(read,live.profile as ReadinessProfile)
 expect(r.requestCount).toBe(8);expect(r.result).toBe('observed');expect(r.checks.find(c=>c.key==='genesis')?.status).toBe('warn')
})
it('固定高度、只读请求预算和未知官方锚点披露',async()=>{
 const read=reader();const r=await probeNetwork(read,profile)
 expect(read).toHaveBeenCalledTimes(8);expect(r.observedHead).toBe('100');expect(r.gasPriceWei).toBe('7');expect(r.baseFeePerGasWei).toBe('7')
 expect(r.genesisHash).toBe(genesis);expect(r.checks.find(c=>c.key==='genesis')?.status).toBe('warn')
 expect(read.mock.calls.filter(c=>c[0].method==='eth_getCode')[0]![0]).toMatchObject({params:[profile.multicall3,'0x64']})
 expect(r.limitations.join('')).toContain('不验证写交易')
})
it('错链一个请求后停止',async()=>{
 const d=fixture();d.chainId='0x1';const read=reader(d);await expect(probeNetwork(read,profile)).rejects.toThrow('网络编号');expect(read).toHaveBeenCalledTimes(1)
})
it.each([{head:'0x00'},{chainId:'0xzz'}])('畸形关键字段拒绝 %s',async override=>{await expect(probeNetwork(reader({...fixture(),...override}),profile)).rejects.toThrow()})
it('固定高度失败或错位不掩盖，不能显示完整通过',async()=>{
 const d=fixture();d.block.number='0x63';const r=await probeNetwork(reader(d),profile);expect(r.result).toBe('blocked');expect(r.checks.find(c=>c.key==='block')?.status).toBe('fail')
})
it('可信锚点匹配和不匹配分别有明确结果',async()=>{
 expect((await probeNetwork(reader(),{...profile,expectedGenesisHash:genesis})).checks.find(c=>c.key==='genesis')?.status).toBe('pass')
 const r=await probeNetwork(reader(),{...profile,expectedGenesisHash:headHash});expect(r.result).toBe('blocked')
})
it('无代码不调用合约，七次后结束，绝不把零代码当兼容',async()=>{
 const d=fixture();d.code='0x';const read=reader(d);const r=await probeNetwork(read,profile)
 expect(r.result).toBe('blocked');expect(read).toHaveBeenCalledTimes(7);expect(read.mock.calls.some(c=>c[0].method==='eth_call')).toBe(false)
})
it.each(['0x01','0x'+'00'.repeat(32),'0x'+'ff'.repeat(32)])('合约返回错误网络或错误ABI阻断 %s',async call=>{const r=await probeNetwork(reader({...fixture(),call}),profile);expect(r.result).toBe('blocked')})
it('燃料价格失败显示未知而非0，版本失败不伪造版本',async()=>{
 const base=reader();const read=vi.fn(async(req:ProbeRequest)=>{if(['eth_gasPrice','web3_clientVersion'].includes(req.method))throw Error('disabled');return base(req)})
 const r=await probeNetwork(read,profile);expect(r.gasPriceWei).toBeNull();expect(r.checks.filter(c=>c.status==='warn')).toHaveLength(3)
})
it('没有baseFee字段时保留null',async()=>{const d=fixture();Reflect.deleteProperty(d.block,'baseFeePerGas');expect((await probeNetwork(reader(d),profile)).baseFeePerGasWei).toBeNull()})
it('同时至多2个请求',async()=>{
 let active=0,max=0;const base=reader();await probeNetwork(async req=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));try{return await base(req)}finally{active--}},profile);expect(max).toBe(2)
})
it('合并并发并缓存60秒，返回值修改不污染缓存，过期再读',async()=>{
 let time=1000;const read=reader();const run=createNetworkProbe(read,profile,()=>time)
 const [a,b]=await Promise.all([run(),run()]);expect(read).toHaveBeenCalledTimes(8);expect(a.report).toEqual(b.report)
 a.report.gasPriceWei='0';expect((await run()).report.gasPriceWei).toBe('7');expect((await run()).cached).toBe(true)
 time=61000;expect((await run()).cached).toBe(false);expect(read).toHaveBeenCalledTimes(16)
})
it('关键网络错误不缓存，重试可恢复；有fail结果也不缓存',async()=>{
 const read=reader();read.mockRejectedValueOnce(Error('offline'));const run=createNetworkProbe(read,profile)
 await expect(run()).rejects.toThrow('offline');await run();expect(read).toHaveBeenCalledTimes(9)
 const bad=reader({...fixture(),code:'0x'});const probe=createNetworkProbe(bad,profile);await probe();await probe();expect(bad).toHaveBeenCalledTimes(14)
})

it('检测期间外部修改配置不能改变已经选定的网络门禁',async()=>{
 const mutable=structuredClone(profile);let calls=0
 await expect(probeNetwork(async()=>{calls++;mutable.chainId=1;return '0x1'},mutable)).rejects.toThrow('网络编号')
 expect(calls).toBe(1)
})
