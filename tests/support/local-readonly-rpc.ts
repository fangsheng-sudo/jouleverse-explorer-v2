import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LocalRpcRequest { method: string; params: unknown[] }

/** Loopback fixture only: no upstream connection, keys, wallet or execution engine. */
export async function startLocalReadonlyRpc(
  respond: (request: LocalRpcRequest) => unknown | Promise<unknown>,
  options: { responseTimeoutMs?: number } = {},
) {
  const timeout = options.responseTimeoutMs ?? 1000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 5000) throw new Error('invalid-fixture-timeout')
  const requests: LocalRpcRequest[] = []
  const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call', 'eth_getBalance',
    'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber'])
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/') { res.writeHead(405).end(); return }
    let id: string | number | null = null
    const send = (payload: object) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...payload }))
    }
    try {
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 16384) { res.writeHead(413).end(); return }
        chunks.push(buffer)
      }
      let msg: unknown
      try { msg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
      catch { send({ error: { code: -32700, message: 'invalid-json' } }); return }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        send({ error: { code: -32600, message: 'invalid-request' } }); return
      }
      const row = msg as Record<string, unknown>
      if (row.jsonrpc !== '2.0' || typeof row.method !== 'string' ||
          !(typeof row.id === 'string' || typeof row.id === 'number' && Number.isSafeInteger(row.id)) ||
          (row.params !== undefined && !Array.isArray(row.params))) {
        send({ error: { code: -32600, message: 'invalid-request' } }); return
      }
      id = row.id as string | number
      const request = { method: row.method, params: (row.params ?? []) as unknown[] }
      if (requests.length >= 1024) { send({ error: { code: -32005, message: 'fixture-budget-exceeded' } }); return }
      requests.push(structuredClone(request))
      if (!allowed.has(request.method)) { send({ error: { code: -32601, message: 'read-only-fixture' } }); return }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([Promise.resolve().then(() => respond(request)), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeout)
        })])
        send({ result })
      } finally { clearTimeout(timer) }
    } catch { send({ error: { code: -32000, message: 'fixture-unavailable' } }) }
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  server.maxConnections = 8
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  let closed: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => closed ??= new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
