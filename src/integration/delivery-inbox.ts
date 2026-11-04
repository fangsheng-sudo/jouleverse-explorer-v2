export interface DeliveryEvent {
  /** Configured subscription namespace. Never derive it from an untrusted sender. */
  source: string
  /** Stable across retries; must identify the event, not the delivery attempt. */
  eventId: string
  /** Exact UTF-8 event body. Preserve the same bytes for retries. */
  payload: string
}

export interface DeliveryInbox {
  /**
   * Atomically insert by (source, eventId), or compare against existing payload.
   * Resolve only after durable commit. Throw on failure or uncertain commit.
   * Identical payload => duplicate; different payload => conflict. Never overwrite.
   */
  record(event: Readonly<DeliveryEvent>): Promise<'inserted' | 'duplicate' | 'conflict'>
}

export type DeliveryDecision =
  | { action: 'ack'; reason: 'recorded' | 'duplicate' }
  | { action: 'retry'; reason: 'storage-unavailable' }
  | { action: 'review'; reason: 'invalid-event' | 'identity-conflict' }

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const maxBytes = 256 * 1024

/** Receive into an inbox; acknowledgement means recorded, not processed or settled. */
export async function receiveDelivery(inbox: DeliveryInbox, input: DeliveryEvent): Promise<DeliveryDecision> {
  const event = Object.freeze({ source: input.source, eventId: input.eventId, payload: input.payload })
  if (typeof event.source !== 'string' || !identifier.test(event.source) ||
      typeof event.eventId !== 'string' || !identifier.test(event.eventId) ||
      typeof event.payload !== 'string' || event.payload.length === 0 ||
      event.payload.length > maxBytes || new TextEncoder().encode(event.payload).byteLength > maxBytes) {
    return { action: 'review', reason: 'invalid-event' }
  }
  try {
    const result = await inbox.record(event)
    if (result === 'inserted') return { action: 'ack', reason: 'recorded' }
    if (result === 'duplicate') return { action: 'ack', reason: 'duplicate' }
    if (result === 'conflict') return { action: 'review', reason: 'identity-conflict' }
  } catch {
    // A commit might already have happened. The next attempt must use the same key.
  }
  return { action: 'retry', reason: 'storage-unavailable' }
}
