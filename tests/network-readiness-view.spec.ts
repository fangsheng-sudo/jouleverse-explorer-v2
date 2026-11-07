import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter,createMemoryHistory } from 'vue-router'
import { JvActionButton } from '../src/design-system'
import { probeNetwork,type ReadinessProfile } from '../src/services/network-readiness'
import fixture from './fixtures/integration-mainnet.json'
const mocks=vi.hoisted(()=>({run:vi.fn()}))
vi.mock('../src/services/jouleverse-readiness',()=>({checkJouleverseReadiness:mocks.run,integrationProfile:{schema:'jouleverse.integration-profile/v1',chainId:3666,name:'test',rpcUrl:'https://rpc.jnsdao.com',multicall3:'0x1111111111111111111111111111111111111111'}}))
import View from '../src/views/NetworkReadiness.vue'
const wrappers:ReturnType<typeof mount>[]=[]
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());mocks.run.mockReset()})
async function render(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});await router.push('/tools/integration');const w=mount(View,{global:{plugins:[router]}});wrappers.push(w);return w}
async function report(){return probeNetwork(async req=>{const r=fixture.responses.find(r=>JSON.stringify(r.request)===JSON.stringify(req));if(!r)throw Error('missing');if('error'in r)throw Error(String(r.error));return r.result},fixture.profile as ReadinessProfile)}
it('初次打开零RPC；手动检测显示边界和时间，不误报全面兼容',async()=>{
 const w=await render();expect(mocks.run).not.toHaveBeenCalled();mocks.run.mockResolvedValue({report:await report(),cached:true})
 await w.findAllComponents(JvActionButton)[1]!.trigger('click');await flushPromises()
 expect(w.text()).toContain('观测完成，请核对限制');expect(w.text()).toContain('60秒缓存快照');expect(w.text()).toContain('未配置官方确认');expect(w.text()).toContain('不验证写交易')
})
it('RPC异常显示失败，无成功检测记录',async()=>{
 const w=await render();mocks.run.mockRejectedValue(Error('节点超时'));await w.findAllComponents(JvActionButton)[1]!.trigger('click');await flushPromises();expect(w.text()).toContain('检测未完成');expect(w.text()).toContain('节点超时');expect(w.text()).not.toContain('下载检测记录')
})
it('有阻碍时不显示已全面通过，避免多次并发点击',async()=>{
 const r=await report();r.result='blocked';let resolve!:(value:unknown)=>void;mocks.run.mockImplementation(()=>new Promise(r=>{resolve=r}))
 const w=await render();await w.findAllComponents(JvActionButton)[1]!.trigger('click');await w.findAllComponents(JvActionButton)[1]!.trigger('click');expect(mocks.run).toHaveBeenCalledTimes(1)
 resolve({report:r,cached:false});await flushPromises();expect(w.text()).toContain('存在接入阻碍')
})
