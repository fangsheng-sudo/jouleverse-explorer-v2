import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Registry from '../src/views/ContractRegistry.vue'
import ToolsHome from '../src/views/ToolsHome.vue'
import { toolboxContracts } from '../src/contracts/toolbox'
import { NInput } from 'naive-ui'
import * as deployment from '../src/contracts/deployment-verification'

// 目录不应依赖 RPC 客户端，任何意外访问立即失败。
vi.mock('../src/config/client', () => { throw new Error('合约目录禁止使用 RPC') })
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()) })
async function render(component = Registry) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
  ] })
  await router.push('/contracts')
  const w = mount(component, { global: { plugins: [router] } })
  mounted.push(w)
  return { w, router }
}
it('复用全部本地合约、分类、地址链接和工具入口', async () => {
  const { w, router } = await render()
  expect(w.findAll('[data-contract]')).toHaveLength(toolboxContracts.length)
  expect(w.text()).toContain('核心合约（4）')
  expect(w.text()).toContain('生态合约（8）')
  for (const c of toolboxContracts) {
    const card = w.get(`[data-contract="${c.key}"]`)
    expect(card.text()).toContain(c.name)
    expect(card.get('a.jv-hash__text').attributes('href')).toBe(`/address/${c.address}`)
    expect(card.get('a.tool-link').attributes('href')).toBe(`/tools/contract/${c.key}`)
  }
  const first = toolboxContracts[0]!
  const copy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  await w.get('[data-contract] button').trigger('click')
  expect(copy).toHaveBeenCalledWith(first.address)
  await w.get('[data-contract] a.jv-hash__text').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe(`/address/${first.address}`)
})
it('名称和地址搜索不区分大小写，空结果可恢复', async () => {
  const { w } = await render()
  const input = w.getComponent(NInput)
  input.vm.$emit('update:value', toolboxContracts[0]!.address.toUpperCase())
  await flushPromises()
  expect(w.findAll('[data-contract]')).toHaveLength(1)
  input.vm.$emit('update:value', '不存在的合约')
  await flushPromises()
  expect(w.text()).toContain('找到 0 个合约')
  expect(w.text()).toContain('请尝试其他关键词')
  input.vm.$emit('update:value', '')
  await flushPromises()
  expect(w.findAll('[data-contract]')).toHaveLength(toolboxContracts.length)
})
it('工具集提供两个独立目录入口', async () => {
  const { w } = await render(ToolsHome)
  expect(w.get('a[href="/contracts"]').text()).toContain('生态合约注册目录')
  expect(w.get('a[href="/validators"]').text()).toContain('签名人目录')
})

it('打开目录和展开档案不查询，点击才核验所选地址', async () => {
  const verify = vi.spyOn(deployment, 'verifyDeployment').mockResolvedValue({ status: 'wrong-chain' })
  try {
    const { w } = await render()
    expect(verify).not.toHaveBeenCalled()
    const card = w.get('[data-contract="wj"]')
    await card.get('summary').trigger('click')
    expect(verify).not.toHaveBeenCalled()
    const button = card.findAll('button').find(b => b.text().includes('只读核验'))!
    await button.trigger('click')
    await flushPromises()
    expect(verify).toHaveBeenCalledExactlyOnceWith(toolboxContracts.find(c => c.key === 'wj')!.address)
    expect(card.text()).toContain('节点返回的网络编号不符')
  } finally { verify.mockRestore() }
})
