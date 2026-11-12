import { ensure, PilotError, record } from "./protocol.js";
export type Method =
  | "eth_chainId"
  | "eth_blockNumber"
  | "eth_getBlockByNumber"
  | "eth_getCode"
  | "eth_getTransactionReceipt"
  | "eth_getLogs"
  | "eth_gasPrice";
const methods = new Set<Method>([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_gasPrice",
]);
export type RawReader = (
  method: Method,
  params: readonly unknown[],
  signal: AbortSignal,
) => Promise<unknown>;
export type Request = (
  method: Method,
  params?: readonly unknown[],
) => Promise<unknown>;
/** Slots remain occupied until underlying work settles, including transports that ignore abort. */
export class RpcSession {
  #active = 0;
  #inflight = 0;
  readonly #read: RawReader;
  readonly #timeout: number;
  constructor(read: RawReader, timeoutMs = 8000) {
    ensure(
      typeof read === "function" &&
        Number.isSafeInteger(timeoutMs) &&
        timeoutMs >= 1 &&
        timeoutMs <= 30000,
      "INVALID_SESSION",
    );
    this.#read = read;
    this.#timeout = timeoutMs;
  }
  async run<T>(
    work: (request: Request, signal: AbortSignal) => Promise<T>,
    caller?: AbortSignal,
  ): Promise<T> {
    ensure(!caller?.aborted, "ABORTED");
    ensure(this.#active < 2, "BUSY");
    this.#active++;
    const controller = new AbortController();
    let count = 0,
      reason = "TIMEOUT";
    let rejectAbort: (error: PilotError) => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const cancel = () => {
      reason = "ABORTED";
      controller.abort();
      rejectAbort(new PilotError(reason));
    };
    caller?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      controller.abort();
      rejectAbort(new PilotError(reason));
    }, this.#timeout);
    let closed = false;
    const pending = new Set<Promise<unknown>>();
    const request: Request = (method, params = []) => {
      const operation = (async () => {
        ensure(!closed, "OPERATION_CLOSED");
        ensure(!controller.signal.aborted, reason);
        ensure(methods.has(method), "METHOD_FORBIDDEN");
        ensure(++count <= 64, "REQUEST_BUDGET");
        let value: unknown;
        ensure(this.#inflight < 2, "RPC_BUSY");
        this.#inflight++;
        try {
          value = await this.#read(
            method,
            structuredClone(params),
            controller.signal,
          );
        } catch {
          ensure(!controller.signal.aborted, reason);
          throw new PilotError("RPC_UNAVAILABLE");
        } finally {
          this.#inflight--;
        }
        ensure(!controller.signal.aborted, reason);
        return structuredClone(value);
      })();
      pending.add(operation);
      operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      return operation;
    };
    const task = Promise.resolve()
      .then(() => work(request, controller.signal))
      .finally(async () => {
        closed = true;
        if (pending.size) {
          controller.abort();
          await Promise.allSettled([...pending]);
        }
      })
      .finally(() => {
        this.#active--;
      });
    try {
      return await Promise.race([task, abort]);
    } catch (error) {
      throw error instanceof PilotError
        ? error
        : new PilotError("INVALID_RPC_DATA");
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
  }
}
/** Read-only JSON-RPC transport. No retries; 1MiB response cap. */
export function createHttpReader(endpoint: string): RawReader {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PilotError("INVALID_ENDPOINT");
  }
  ensure(
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.hash,
    "INVALID_ENDPOINT",
  );
  const target = url.href;
  let next = 0;
  return async (method, params, signal) => {
    ensure(methods.has(method), "METHOD_FORBIDDEN");
    const id = ++next;
    let response: Response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal,
        redirect: "error",
      });
    } catch {
      throw new PilotError("RPC_UNAVAILABLE");
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new PilotError("RPC_UNAVAILABLE");
    }
    const reader = response.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        ensure(length <= 1024 * 1024, "RPC_RESPONSE_LIMIT");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error instanceof PilotError
        ? error
        : new PilotError("RPC_UNAVAILABLE");
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body;
    try {
      body = record(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch {
      throw new PilotError("INVALID_RPC_RESPONSE");
    }
    ensure(
      body.jsonrpc === "2.0" &&
        body.id === id &&
        !("error" in body) &&
        "result" in body,
      "INVALID_RPC_RESPONSE",
    );
    return body.result;
  };
}
