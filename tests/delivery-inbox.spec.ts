// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { receiveDelivery, type DeliveryInbox } from '../src/integration/delivery-inbox'

const event = { source: 'orders', eventId: 'evt-1', payload: '{"status":"observed"}' }

function withDatabase(run: (open: () => DatabaseSync) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'jv-inbox-'))
  const connections: DatabaseSync[] = []
  return run(() => {
    const db = new DatabaseSync(join(dir, 'test.sqlite'))
    connections.push(db)
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS inbox (
        source TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(source, id)
      )`)
    return db
  }).finally(() => {
    for (const db of connections.reverse()) if (db.isOpen) db.close()
    rmSync(dir, { recursive: true, force: true })
  })
}

// Example adapter for tests only: one atomic statement, no network or application side effects.
function adapter(db: DatabaseSync): DeliveryInbox {
  return {
    async record(row) {
      const inserted = db.prepare('INSERT INTO inbox VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(row.source, row.eventId, row.payload)
      if (inserted.changes === 1) return 'inserted'
      const existing = db.prepare('SELECT payload FROM inbox WHERE source = ? AND id = ?')
        .get(row.source, row.eventId)
      if (!existing) throw new Error('missing row')
      return existing.payload === row.payload ? 'duplicate' : 'conflict'
    },
  }
}

it('提交后确认丢失，重新打开数据库后重投不重复入库', () => withDatabase(async open => {
  const db = open()
  const store = adapter(db)
  expect(await receiveDelivery({ async record(row) {
    await store.record(row)
    throw new Error('响应丢失')
  } }, event)).toEqual({ action: 'retry', reason: 'storage-unavailable' })
  db.close()
  const reopened = open()
  expect(await receiveDelivery(adapter(reopened), event)).toEqual({ action: 'ack', reason: 'duplicate' })
  expect(reopened.prepare('SELECT count(*) AS n FROM inbox').get()?.n).toBe(1)
}))
it('存储失败不确认，恢复后同一事件可成功保存', () => withDatabase(async open => {
  const unavailable: DeliveryInbox = { async record() { throw new Error('离线') } }
  expect((await receiveDelivery(unavailable, event)).action).toBe('retry')
  expect(await receiveDelivery(adapter(open()), event)).toEqual({ action: 'ack', reason: 'recorded' })
}))
it('并发重投只保存一次，冲突不覆盖，不同来源独立', () => withDatabase(async open => {
  const db = open()
  const store = adapter(db)
  const decisions = await Promise.all([receiveDelivery(store, event), receiveDelivery(adapter(open()), event)])
  expect(decisions.map(result => result.reason).sort()).toEqual(['duplicate', 'recorded'])
  expect(await receiveDelivery(store, { ...event, payload: 'changed' })).toEqual({ action: 'review', reason: 'identity-conflict' })
  expect((await receiveDelivery(store, { ...event, source: 'refunds' })).reason).toBe('recorded')
  expect(db.prepare('SELECT payload FROM inbox WHERE source = ?').get('orders')?.payload).toBe(event.payload)
}))
it('未完成持久化前不会返回确认', async () => {
  let commit!: (result: 'inserted') => void
  const pending = new Promise<'inserted'>(resolve => { commit = resolve })
  const callback = vi.fn()
  const result = receiveDelivery({ record: () => pending }, event).then(callback)
  await Promise.resolve()
  expect(callback).not.toHaveBeenCalled()
  commit('inserted')
  await result
  expect(callback).toHaveBeenCalledExactlyOnceWith({ action: 'ack', reason: 'recorded' })
})
it('拒绝无效编号和超过字节上限的正文，不写存储', async () => {
  const record = vi.fn(async () => 'inserted' as const)
  for (const invalid of [{ ...event, eventId: ' ' }, { ...event, payload: '中'.repeat(100000) }]) {
    expect(await receiveDelivery({ record }, invalid)).toEqual({ action: 'review', reason: 'invalid-event' })
  }
  expect(record).not.toHaveBeenCalled()
})

it('畸形输入与无法保留 UTF-8 身份的文本不会触及存储', async () => {
  const record = vi.fn(async () => 'inserted' as const)
  for (const invalid of [null, {}, { ...event, payload: '\ud800' }, { ...event, source: 1 }]) {
    expect((await receiveDelivery({ record }, invalid)).action).toBe('review')
  }
  expect(record).not.toHaveBeenCalled()
})
it('绑定来源，拒绝调用方跨来源提交', async () => {
  const { createDeliveryReceiver } = await import('../src/integration/delivery-inbox')
  const record = vi.fn(async () => 'inserted' as const)
  const receive = createDeliveryReceiver({ record }, 'orders')
  expect((await receive({ ...event, source: 'refunds' })).action).toBe('review')
  expect(record).not.toHaveBeenCalled()
  expect((await receive(event)).action).toBe('ack')
})
it('持久化超时按不确定提交处理，并限制不响应的存储适配器', async () => {
  vi.useFakeTimers()
  try {
    const record = vi.fn(() => new Promise<'inserted'>(() => {}))
    const store = { record }
    const attempts = Array.from({ length: 8 }, () => receiveDelivery(store, event, { timeoutMs: 10 }))
    await vi.advanceTimersByTimeAsync(10)
    expect((await Promise.all(attempts)).every(x => x.action === 'retry')).toBe(true)
    expect((await receiveDelivery(store, event)).action).toBe('retry')
    expect(record).toHaveBeenCalledTimes(8)
  } finally { vi.useRealTimers() }
})
