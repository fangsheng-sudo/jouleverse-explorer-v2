export interface DeliveryEvent {
  /** Configured, authenticated subscription namespace, never inferred from a sender. */
  source: string
  eventId: string
  /** Exact UTF-8 body; stable across retries. */
  payload: string
}
export interface DeliveryInbox {
  /** Atomic compare/insert by (source,eventId). Resolve only after durable commit. */
  record(event: Readonly<DeliveryEvent>): Promise<'inserted' | 'duplicate' | 'conflict'>
}
export type DeliveryDecision =
  | { action: 'ack'; reason: 'recorded' | 'duplicate' }
  | { action: 'retry'; reason: 'storage-unavailable' }
  | { action: 'review'; reason: 'invalid-event' | 'identity-conflict' }

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const maxBytes = 256 * 1024
const pending = new WeakMap<DeliveryInbox, number>()
export function normalizeDeliveryEvent(input: unknown): Readonly<DeliveryEvent> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const { source, eventId, payload } = input as Record<string, unknown>
  if (typeof source !== 'string' || !identifier.test(source) || typeof eventId !== 'string' || !identifier.test(eventId) ||
      typeof payload !== 'string' || payload.length === 0 || payload.length > maxBytes ||
      new TextEncoder().encode(payload).byteLength > maxBytes) return null
  // UTF-16 unpaired surrogates are replaced by UTF-8 encoders and cannot preserve exact identity.
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) { const next = payload.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return null }
    else if (c >= 0xdc00 && c <= 0xdfff) return null
  }
  return Object.freeze({ source, eventId, payload })
}

/** Timeout is uncertain commit, never a negative acknowledgement that authorizes a new ID. */
export async function receiveDelivery(inbox: DeliveryInbox, input: unknown, options: { timeoutMs?: number } = {}): Promise<DeliveryDecision> {
  const event = normalizeDeliveryEvent(input)
  if (!event) return { action: 'review', reason: 'invalid-event' }
  const timeout = options.timeoutMs ?? 5000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error('invalid-inbox-timeout')
  if ((pending.get(inbox) ?? 0) >= 8) return { action: 'retry', reason: 'storage-unavailable' }
  pending.set(inbox, (pending.get(inbox) ?? 0) + 1)
  const task = Promise.resolve().then(() => inbox.record(event)).finally(() => pending.set(inbox, (pending.get(inbox) ?? 1) - 1))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeout)
    })])
    if (result === 'inserted') return { action: 'ack', reason: 'recorded' }
    if (result === 'duplicate') return { action: 'ack', reason: 'duplicate' }
    if (result === 'conflict') return { action: 'review', reason: 'identity-conflict' }
  } catch { /* A commit may have completed: retry with exactly the same key. */ }
  finally { clearTimeout(timer) }
  return { action: 'retry', reason: 'storage-unavailable' }
}

/** Caller authenticates transport first; this closure binds the configured source. */
export function createDeliveryReceiver(inbox: DeliveryInbox, source: string, options: { timeoutMs?: number } = {}) {
  if (!identifier.test(source)) throw new Error('invalid-inbox-source')
  const timeoutMs = options.timeoutMs
  return (input: unknown): Promise<DeliveryDecision> => {
    const event = normalizeDeliveryEvent(input)
    if (!event || event.source !== source) return Promise.resolve({ action: 'review', reason: 'invalid-event' })
    return receiveDelivery(inbox, event, { timeoutMs })
  }
}
