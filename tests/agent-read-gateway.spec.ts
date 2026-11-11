import { expect, it, vi } from 'vitest'
import { createAgentReadGateway } from '../src/integration/agent-read-gateway'
import { type AgentGrant } from '../src/integration/agent-authorization'

const principal = { tenantId: 'tenant-a', agentId: 'reader-1' }
const resource = '0x' + 'ab'.repeat(32)
const request = { chainId: 3666, operation: 'verify-receipt', resource } as const
const grant: AgentGrant = { id: 'grant', principal, chainId: 3666, state: 'active', notBeforeMs: 10, expiresAtMs: 100,
  scope: { operation: 'verify-receipt', resource } }
it('真实分发只使用冻结的已授权参数，异步期间修改请求不能改变执行', async () => {
  const input = { ...request }
  const handler = vi.fn(async () => ({ state: 'observed' }))
  const gateway = createAgentReadGateway({ now: () => 20, loadGrants: async () => {
    input.resource = '0x' + 'cd'.repeat(32); return [grant]
  }, handlers: { 'verify-receipt': handler } })
  const result = await gateway(principal, input)
  expect(result).toMatchObject({ executed: true, request: { resource }, result: { state: 'observed' } })
  expect(handler).toHaveBeenCalledExactlyOnceWith(resource, expect.any(AbortSignal))
  expect(result.bindingHash).toMatch(/^0x[0-9a-f]{64}$/)
})
it('每次读取最新授权，撤销和过期不调用业务适配器', async () => {
  const handler = vi.fn(async () => null)
  const gateway = createAgentReadGateway({ now: () => 100, loadGrants: async () => [grant], handlers: { 'verify-receipt': handler } })
  await expect(gateway(principal, request)).rejects.toMatchObject({ code: 'denied' })
  const revoked = createAgentReadGateway({ now: () => 20, loadGrants: async () => [{ ...grant, state: 'revoked' }], handlers: { 'verify-receipt': handler } })
  await expect(revoked(principal, request)).rejects.toMatchObject({ code: 'denied' })
  expect(handler).not.toHaveBeenCalled()
})
it('加载异常和业务异常均不泄漏，超时通知取消且保留底层槽位', async () => {
  const broken = createAgentReadGateway({ loadGrants: async () => { throw new Error('private') }, handlers: {}, now: () => 20 })
  await expect(broken(principal, request)).rejects.toMatchObject({ code: 'adapter-error', message: 'agent-gateway:adapter-error' })
  vi.useFakeTimers()
  try {
    let signal: AbortSignal | undefined
    const handler = vi.fn((_resource: string, s: AbortSignal) => { signal = s; return new Promise(() => {}) })
    const gateway = createAgentReadGateway({ now: () => 20, loadGrants: async () => [grant], handlers: { 'verify-receipt': handler }, timeoutMs: 10 })
    const first = expect(gateway(principal, request)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(10); await first
    expect(signal?.aborted).toBe(true)
    const second = expect(gateway(principal, request)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(10); await second
    await expect(gateway(principal, request)).rejects.toMatchObject({ code: 'busy' })
  } finally { vi.useRealTimers() }
})
it('只有 review-only 的完整调用不会执行任何 handler', async () => {
  const { keccak256 } = await import('viem')
  const sender = '0x' + '11'.repeat(20), target = '0x' + '22'.repeat(20), calldata = '0x12345678'
  const review = { chainId: 3666, operation: 'review-contract-call', sender, target, calldata, value: 0n } as const
  const handler = vi.fn(async () => null)
  const gateway = createAgentReadGateway({ now: () => 20, handlers: { 'verify-receipt': handler }, loadGrants: async () => [{ ...grant,
    scope: { operation: 'review-contract-call', sender, target, calldataHash: keccak256(calldata) } }] })
  expect(await gateway(principal, review)).toMatchObject({ executed: false, authorization: { status: 'review-only' } })
  expect(handler).not.toHaveBeenCalled()
})

it('可信时钟和业务适配器异常也统一脱敏', async () => {
  const clock = createAgentReadGateway({ now: () => { throw new Error('private clock') }, loadGrants: async () => [], handlers: {} })
  await expect(clock(principal, request)).rejects.toMatchObject({ code: 'adapter-error' })
  const handler = createAgentReadGateway({ now: () => 20, loadGrants: async () => [grant], handlers: {
    'verify-receipt': async () => { throw new Error('private request') },
  } })
  await expect(handler(principal, request)).rejects.toMatchObject({ code: 'adapter-error', message: 'agent-gateway:adapter-error' })
})
