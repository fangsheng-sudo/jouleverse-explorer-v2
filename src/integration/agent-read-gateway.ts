import { getAddress, keccak256, stringToHex } from 'viem'
import { authorizeAgentRequest, type AgentGrant, type AgentPrincipal, type AgentRequest } from './agent-authorization'

type ReadOperation = 'verify-receipt' | 'verify-wj-payment' | 'inspect-gas'
export interface AgentReadGatewayOptions {
  /** Trusted authenticated context and grant store: never accept these from an unsigned request body. */
  loadGrants(principal: Readonly<AgentPrincipal>): Promise<readonly AgentGrant[]>
  handlers: Partial<Record<ReadOperation, (resource: string, signal: AbortSignal) => Promise<unknown>>>
  now?: () => number
  timeoutMs?: number
}
export class AgentGatewayError extends Error {
  readonly code: 'denied' | 'busy' | 'timeout' | 'handler-unavailable' | 'adapter-error'
  constructor(code: AgentGatewayError['code']) { super(`agent-gateway:${code}`); this.name = 'AgentGatewayError'; this.code = code }
}

/** Read dispatch only. Review grants never invoke a handler or wallet operation. */
export function createAgentReadGateway(options: AgentReadGatewayOptions) {
  const { loadGrants, now = Date.now, timeoutMs = 5000 } = options
  const handlers = { ...options.handlers }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('invalid-gateway-timeout')
  let active = 0
  return async (principal: Readonly<AgentPrincipal>, request: Readonly<AgentRequest>) => {
    let actor: Readonly<AgentPrincipal>
    let input: Readonly<AgentRequest>
    try {
      actor = Object.freeze({ tenantId: principal.tenantId, agentId: principal.agentId })
      input = request.operation === 'review-contract-call'
        ? Object.freeze({ chainId: request.chainId, operation: request.operation, sender: request.sender, target: request.target, calldata: request.calldata, value: request.value })
        : Object.freeze({ chainId: request.chainId, operation: request.operation, resource: request.resource })
    } catch { throw new AgentGatewayError('denied') }
    let initial: ReturnType<typeof authorizeAgentRequest>
    try { initial = authorizeAgentRequest(actor, input, [], now()) }
    catch { throw new AgentGatewayError('adapter-error') }
    if (initial.status === 'denied' && initial.reason === 'invalid-request') throw new AgentGatewayError('denied')
    if (active >= 2) throw new AgentGatewayError('busy')
    active++
    const controller = new AbortController()
    const task = Promise.resolve().then(async () => {
      const grants = await loadGrants(actor)
      if (controller.signal.aborted) throw new AgentGatewayError('timeout')
      const checkedAtMs = now()
      const authorization = authorizeAgentRequest(actor, input, grants, checkedAtMs)
      if (authorization.status === 'denied') throw new AgentGatewayError('denied')
      const normalized = input.operation === 'review-contract-call'
        ? Object.freeze({ ...input, sender: getAddress(input.sender), target: getAddress(input.target), calldata: input.calldata.toLowerCase() })
        : Object.freeze({ ...input, resource: input.operation === 'inspect-gas' ? getAddress(input.resource) : input.resource.toLowerCase() })
      const bindingHash = keccak256(stringToHex(JSON.stringify({ principal: actor, request: normalized }, (_, value) => typeof value === 'bigint' ? value.toString() : value)))
      const context = { authorization, request: normalized, bindingHash, checkedAtMs }
      if (input.operation === 'review-contract-call') return Object.freeze({ ...context, executed: false as const })
      const handler = handlers[input.operation]
      if (typeof handler !== 'function') throw new AgentGatewayError('handler-unavailable')
      const resource = 'resource' in normalized ? normalized.resource : ''
      const result = await handler(resource, controller.signal)
      if (controller.signal.aborted) throw new AgentGatewayError('timeout')
      return Object.freeze({ ...context, executed: true as const, result })
    }).finally(() => { active-- })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([task, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new AgentGatewayError('timeout')); controller.abort() }, timeoutMs)
      })])
    } catch (error) {
      if (error instanceof AgentGatewayError) throw new AgentGatewayError(error.code)
      throw new AgentGatewayError('adapter-error')
    } finally { clearTimeout(timer) }
  }
}
