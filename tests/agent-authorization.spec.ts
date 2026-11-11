import { describe, expect, it } from 'vitest'
import { encodeFunctionData, keccak256 } from 'viem'
import { wjABI, WJ_ADDRESS } from '../src/contracts/wj'
import { authorizeAgentRequest, type AgentGrant, type AgentRequest } from '../src/integration/agent-authorization'

const principal = { tenantId: 'buyer-a', agentId: 'procurement-1' }
const tx = '0x' + 'ab'.repeat(32)
const recipient = '0x2222222222222222222222222222222222222222'
const sender = '0x1111111111111111111111111111111111111111'
const base = { id: 'grant-1', principal, chainId: 3666, notBeforeMs: 100, expiresAtMs: 200, state: 'active' } as const
const receipt = { chainId: 3666, operation: 'verify-receipt', resource: tx } as const
const grant: AgentGrant = { ...base, scope: receipt }
const withdraw = (to: `0x${string}` = recipient, amount = 5n) =>
  encodeFunctionData({ abi: wjABI, functionName: 'withdrawTo', args: [to, amount] })
const review: AgentRequest = {
  chainId: 3666, operation: 'review-contract-call', sender, target: WJ_ADDRESS, calldata: withdraw(), value: 0n,
}
const reviewGrant: AgentGrant = {
  ...base, scope: { operation: review.operation, sender, target: WJ_ADDRESS, calldataHash: keccak256(withdraw()) },
}

describe('Jouleverse agent authorization', () => {
  it('defaults to deny and matches only the authorized read resource and operation', () => {
    expect(authorizeAgentRequest(principal, receipt, [], 100).status).toBe('denied')
    expect(authorizeAgentRequest(principal, { ...receipt, resource: '0x' + 'AB'.repeat(32) }, [grant], 100))
      .toEqual({ status: 'read-allowed', grantId: grant.id })
    expect(authorizeAgentRequest(principal, { ...receipt, resource: '0x' + 'cd'.repeat(32) }, [grant], 100).status).toBe('denied')
    expect(authorizeAgentRequest(principal, { ...receipt, operation: 'verify-wj-payment' }, [grant], 100).status).toBe('denied')
  })
  it('isolates tenants and agents, and rejects the wrong chain', () => {
    for (const other of [{ ...principal, tenantId: 'buyer-b' }, { ...principal, agentId: 'procurement-2' }]) {
      expect(authorizeAgentRequest(other, receipt, [grant], 100).status).toBe('denied')
    }
    expect(authorizeAgentRequest(principal, { ...receipt, chainId: 1 }, [grant], 100).status).toBe('denied')
    expect(authorizeAgentRequest(principal, receipt, [{ ...grant, chainId: 1 }], 100).status).toBe('denied')
  })
  it('checks time and refuses revocation conflicts, even if an active copy appears first', () => {
    for (const time of [99, 200, NaN]) {
      expect(authorizeAgentRequest(principal, receipt, [grant], time).status).toBe('denied')
    }
    expect(authorizeAgentRequest(principal, receipt, [grant], 199).status).toBe('read-allowed')
    const revoked = { ...grant, state: 'revoked' } as const
    for (const grants of [[revoked], [grant, revoked], [revoked, grant], [grant, grant]]) {
      expect(authorizeAgentRequest(principal, receipt, grants, 100).status).toBe('denied')
    }
  })
  it('scopes a gas preflight to the configured recipient', () => {
    const request = { chainId: 3666, operation: 'inspect-gas', resource: recipient } as const
    const gasGrant: AgentGrant = { ...base, scope: request }
    expect(authorizeAgentRequest(principal, request, [gasGrant], 100).status).toBe('read-allowed')
    expect(authorizeAgentRequest(principal, { ...request, resource: sender }, [gasGrant], 100).status).toBe('denied')
  })
  it('returns review only and rejects any change in account, target, encoded recipient, amount or value', () => {
    expect(authorizeAgentRequest(principal, review, [reviewGrant], 100))
      .toEqual({ status: 'review-only', grantId: reviewGrant.id })
    for (const changes of [
      { sender: recipient }, { target: recipient }, { calldata: withdraw(sender) },
      { calldata: withdraw(recipient, 6n) }, { value: 1n }, { calldata: '0x123456789' },
      { calldata: '0x' + '00'.repeat(4097) },
    ]) {
      expect(authorizeAgentRequest(principal, { ...review, ...changes }, [reviewGrant], 100).status).toBe('denied')
    }
  })
})

it('缺失主体、请求和异常授权记录均 fail closed，不把存储畸形数据当作许可', () => {
  expect(authorizeAgentRequest(null as never, receipt, [grant], 100)).toEqual({ status: 'denied', reason: 'invalid-request' })
  expect(authorizeAgentRequest(principal, null as never, [grant], 100).status).toBe('denied')
  expect(authorizeAgentRequest(principal, receipt, [null] as never, 100).status).toBe('denied')
  expect(authorizeAgentRequest(principal, receipt, Array(10001).fill(grant), 100).status).toBe('denied')
})
