import { normalizeDeliveryEvent, type DeliveryInbox, type DeliveryEvent } from './delivery-inbox'

export interface PersistentDeliveryInbox extends DeliveryInbox {
  listPending(source: string, limit?: number): Promise<readonly Readonly<DeliveryEvent>[]>
  markProcessed(source: string, eventId: string): Promise<boolean>
  close(): void
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
type Stored = DeliveryEvent & { state: 'pending' | 'processed' }

/** Native browser persistence, no server or added dependency. Storage eviction remains possible. */
export function openIndexedDbInbox(name: string, factory: IDBFactory = globalThis.indexedDB): Promise<PersistentDeliveryInbox> {
  if (typeof name !== 'string' || !identifier.test(name) || !factory) return Promise.reject(new Error('storage-unavailable'))
  return new Promise((resolve, reject) => {
    let settled = false
    let request: IDBOpenDBRequest
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('storage-unavailable')) } }
    const timer = setTimeout(fail, 5000)
    try { request = factory.open(name, 1) } catch { fail(); return }
    request.onerror = fail
    request.onblocked = fail
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('events', { keyPath: ['source', 'eventId'] })
      store.createIndex('pending', ['source', 'state'])
    }
    request.onsuccess = () => {
      const db = request.result
      if (settled) { db.close(); return }
      settled = true; clearTimeout(timer)
      let closed = false
      const close = () => { closed = true; db.close() }
      db.onversionchange = close
      function transaction<T>(write: boolean, work: (store: IDBObjectStore, set: (value: T) => void) => void): Promise<T> {
        return new Promise((done, failed) => {
          if (closed) { failed(new Error('storage-unavailable')); return }
          let tx: IDBTransaction
          try { tx = db.transaction('events', write ? 'readwrite' : 'readonly', write ? { durability: 'strict' } : undefined) }
          catch { failed(new Error('storage-unavailable')); return }
          let result: T
          const deadline = setTimeout(() => { try { tx.abort() } catch { /* already finished */ } }, 5000)
          tx.oncomplete = () => { clearTimeout(deadline); done(result) }
          tx.onabort = tx.onerror = () => { clearTimeout(deadline); failed(new Error('storage-unavailable')) }
          try { work(tx.objectStore('events'), value => { result = value }) }
          catch { try { tx.abort() } catch { /* already failed */ } }
        })
      }
      resolve({
        close,
        async record(input) {
          const event = normalizeDeliveryEvent(input)
          if (!event) throw new Error('invalid-event')
          return transaction<'inserted' | 'duplicate' | 'conflict'>(true, (store, set) => {
            const read = store.get([event.source, event.eventId])
            read.onsuccess = () => {
              const row = read.result as Stored | undefined
              if (row) { set(row.payload === event.payload ? 'duplicate' : 'conflict'); return }
              store.add({ ...event, state: 'pending' } satisfies Stored)
              set('inserted')
            }
          })
        },
        async listPending(source, limit = 100) {
          if (!identifier.test(source) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('invalid-inbox-query')
          return transaction<readonly Readonly<DeliveryEvent>[]>(false, (store, set) => {
            const read = store.index('pending').getAll([source, 'pending'], limit)
            read.onsuccess = () => set((read.result as Stored[]).map(row => Object.freeze({ source: row.source, eventId: row.eventId, payload: row.payload })))
          })
        },
        async markProcessed(source, eventId) {
          if (!identifier.test(source) || !identifier.test(eventId)) throw new Error('invalid-inbox-query')
          return transaction<boolean>(true, (store, set) => {
            const read = store.get([source, eventId])
            read.onsuccess = () => {
              const row = read.result as Stored | undefined
              set(Boolean(row))
              if (row && row.state !== 'processed') store.put({ ...row, state: 'processed' })
            }
          })
        },
      })
    }
  })
}
