import { getAddress, isAddress, keccak256, zeroAddress, type Hex } from 'viem'
import { jouleverseChain } from '../config/chain'

export interface AgentPrincipal {
  tenantId: string
  agentId: string
}

type ReadOperation = 'verify-receipt' | 'verify-wj-payment' | 'inspect-gas'

type ReadScope = { operation: ReadOperation; resource: string }
type ReviewScope = { operation: 'review-contract-call'; sender: string; target: string; calldataHash: string }

export interface AgentGrant {
  id: string
  principal: AgentPrincipal
  chainId: number
  notBeforeMs: number
  expiresAtMs: number
  state: 'active' | 'revoked'
  scope: ReadScope | ReviewScope
}

export type AgentRequest = { chainId: number } & (
  | ReadScope
  | { operation: 'review-contract-call'; sender: string; target: string; calldata: string; value: bigint }
)

export type AgentAuthorization =
  | { status: 'denied'; reason: 'invalid-request' | 'no-matching-grant' }
  | { status: 'read-allowed' | 'review-only'; grantId: string }

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/
const word = /^0x[0-9a-f]{64}$/i
const calldata = /^0x[0-9a-f]{8}(?:[0-9a-f]{2})*$/i
const readOperations = ['verify-receipt', 'verify-wj-payment', 'inspect-gas'] as const

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifier.test(value)
}

function validTime(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

function normalizeAddress(value: string) {
  if (typeof value !== 'string' || !isAddress(value)) return null
  const address = getAddress(value)
  return address === zeroAddress ? null : address
}

function normalizeResource(operation: ReadOperation, resource: string) {
  if (operation === 'inspect-gas') return normalizeAddress(resource)
  return typeof resource === 'string' && word.test(resource) ? resource.toLowerCase() : null
}

/** Caller supplies the authenticated principal, current grant store snapshot and trusted clock. */
function authorizeAgentRequestUnchecked(
  principal: Readonly<AgentPrincipal>,
  request: Readonly<AgentRequest>,
  grants: readonly AgentGrant[],
  nowMs: number,
): AgentAuthorization {
  const invalid = { status: 'denied', reason: 'invalid-request' } as const
  if (!validIdentifier(principal.tenantId) || !validIdentifier(principal.agentId) ||
      request.chainId !== jouleverseChain.id || !validTime(nowMs)) return invalid

  let scope: ReadScope | ReviewScope
  if (request.operation === 'review-contract-call') {
    const sender = normalizeAddress(request.sender)
    const target = normalizeAddress(request.target)
    if (!sender || !target || request.value !== 0n || typeof request.calldata !== 'string' ||
        request.calldata.length > 8194 || !calldata.test(request.calldata)) return invalid
    scope = {
      operation: request.operation, sender, target,
      calldataHash: keccak256(request.calldata.toLowerCase() as Hex),
    }
  } else {
    if (!readOperations.includes(request.operation)) return invalid
    const resource = normalizeResource(request.operation, request.resource)
    if (!resource) return invalid
    scope = { operation: request.operation, resource }
  }

  // An ambiguous ID is never actionable; a stale active entry must not override its revocation.
  const ids = new Map<string, number>()
  for (const grant of grants) ids.set(grant.id, (ids.get(grant.id) ?? 0) + 1)

  for (const grant of grants) {
    if (!validIdentifier(grant.id) || ids.get(grant.id) !== 1 || grant.state !== 'active' ||
        grant.chainId !== request.chainId ||
        grant.principal.tenantId !== principal.tenantId || grant.principal.agentId !== principal.agentId ||
        !validTime(grant.notBeforeMs) || !validTime(grant.expiresAtMs) ||
        nowMs < grant.notBeforeMs || nowMs >= grant.expiresAtMs) continue

    const permitted = grant.scope
    if (scope.operation === 'review-contract-call') {
      if (permitted.operation === scope.operation &&
          normalizeAddress(permitted.sender) === scope.sender &&
          normalizeAddress(permitted.target) === scope.target &&
          typeof permitted.calldataHash === 'string' && word.test(permitted.calldataHash) &&
          permitted.calldataHash.toLowerCase() === scope.calldataHash) {
        return { status: 'review-only', grantId: grant.id }
      }
    } else if (permitted.operation === scope.operation &&
        normalizeResource(permitted.operation, permitted.resource) === scope.resource) {
      return { status: 'read-allowed', grantId: grant.id }
    }
  }
  return { status: 'denied', reason: 'no-matching-grant' }
}


/** Malformed external input fails closed; grants are loaded from an authenticated store. */
export function authorizeAgentRequest(
  principal: Readonly<AgentPrincipal>, request: Readonly<AgentRequest>, grants: readonly AgentGrant[], nowMs: number,
): AgentAuthorization {
  try {
    if (!principal || !request || !Array.isArray(grants) || grants.length > 10000) return { status: 'denied', reason: 'invalid-request' }
    return authorizeAgentRequestUnchecked(principal, request, grants, nowMs)
  } catch { return { status: 'denied', reason: 'invalid-request' } }
}
