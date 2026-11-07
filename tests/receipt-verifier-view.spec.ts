import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { NInput } from 'naive-ui'
import { JvActionButton } from '../src/design-system'
import { verifyReceipt } from '../src/services/receipt-verifier'
import mainnet from './fixtures/receipt-mainnet.json'
const mocks = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('../src/services/jouleverse-receipt', () => ({ verifyJouleverseReceipt: mocks.verify }))
import ReceiptVerifier from '../src/views/ReceiptVerifier.vue'
const wrappers: ReturnType<typeof mount>[]=[]
afterEach(() => { wrappers.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();mocks.verify.mockReset() })
async function render() {
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]})
  await router.push('/tools/receipt');const w=mount(ReceiptVerifier,{global:{plugins:[router]}});wrappers.push(w);return w
}
const hash='0x7b0d71b878bdbf789d3255e94174beed5fa2a8e6b9c849f00b0fda4a9715ef74'
async function report() { return verifyReceipt(async req => {
  const pair=mainnet.responses.find(item=>JSON.stringify(item.request)===JSON.stringify(req))
  if(!pair)throw new Error('unknown request');return pair.result
},hash,{expectedChainId:3666,rpcUrl:mainnet.rpcUrl}) }
it('初次打开和非法输入零请求，合法输入才可核验', async()=>{
  const w=await render();expect(mocks.verify).not.toHaveBeenCalled()
  await w.getComponent(JvActionButton).trigger('click');expect(mocks.verify).not.toHaveBeenCalled()
  w.getComponent(NInput).vm.$emit('update:value',hash);await flushPromises()
  mocks.verify.mockResolvedValue({report:await report(),cached:false})
  await w.getComponent(JvActionButton).trigger('click');await flushPromises()
  expect(w.text()).toContain('顶层调用成功');expect(w.text()).toContain('不等于付款或履约成功')
  expect(w.findAllComponents(JvActionButton)).toHaveLength(2)
})
it('网络错误显示失败而非未找到，且清除前次结果',async()=>{
  const w=await render();w.getComponent(NInput).vm.$emit('update:value',hash);await flushPromises()
  mocks.verify.mockResolvedValueOnce({report:await report(),cached:false}).mockRejectedValueOnce(new Error('节点超时'))
  await w.getComponent(JvActionButton).trigger('click');await flushPromises()
  expect(w.find('.result').exists()).toBe(true)
  await w.getComponent(JvActionButton).trigger('click');await flushPromises()
  expect(w.text()).toContain('节点超时');expect(w.find('.result').exists()).toBe(false)
})
it('缓存提示保留时间，未找到结果不宣称交易不存在',async()=>{
  const r=await report();r.state='not-found';r.transaction=null;r.inclusion=null;r.execution=null;r.logs=[]
  mocks.verify.mockResolvedValue({report:r,cached:true})
  const w=await render();w.getComponent(NInput).vm.$emit('update:value',hash);await flushPromises()
  await w.getComponent(JvActionButton).trigger('click');await flushPromises()
  expect(w.text()).toContain('命中30秒缓存');expect(w.text()).toContain('不能据此断言交易不存在')
})
it('防双击并发，卸载后不会回写已废弃界面',async()=>{
  let resolve!: (value: unknown)=>void;mocks.verify.mockImplementation(()=>new Promise(r=>{resolve=r}))
  const w=await render();w.getComponent(NInput).vm.$emit('update:value',hash);await flushPromises()
  await w.getComponent(JvActionButton).trigger('click');await w.getComponent(JvActionButton).trigger('click');expect(mocks.verify).toHaveBeenCalledTimes(1)
  w.unmount();wrappers.pop();resolve({report:await report(),cached:false});await flushPromises()
})
