import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LocalRpcRequest { method: string; params: unknown[] }

/** In-process, loopback-only fixture server. Never forwards requests. */
export async function startLocalReadonlyRpc(respond: (request: LocalRpcRequest) => unknown) {
  const requests: LocalRpcRequest[] = []
  const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode',
    'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber'])
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/') {
      res.writeHead(405).end()
      return
    }
    let id: string | number | null = null
    const send = (payload: object) => res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id, ...payload }))
    try {
      let body = ''
      for await (const chunk of req) {
        body += String(chunk)
        if (body.length > 16384) {
          res.writeHead(413).end()
          return
        }
      }
      const msg = JSON.parse(body)
      if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' ||
          (typeof msg.id !== 'number' && typeof msg.id !== 'string') ||
          (msg.params !== undefined && !Array.isArray(msg.params))) {
        send({ error: { code: -32600, message: '无效请求' } })
        return
      }
      id = msg.id
      const request = { method: msg.method, params: msg.params ?? [] }
      requests.push(request)
      if (!allowed.has(request.method)) {
        send({ error: { code: -32601, message: '只读测试环境不支持该方法' } })
        return
      }
      send({ result: respond(request) })
    } catch {
      send({ error: { code: -32000, message: '模拟节点异常' } })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
