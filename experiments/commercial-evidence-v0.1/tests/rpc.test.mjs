import test from "node:test";
import assert from "node:assert/strict";
import { RpcSession, createHttpReader } from "../dist/rpc.js";
const pause = () => new Promise((r) => setImmediate(r));
test("uncancellable requests retain both slots after deadline until real settlement", async () => {
  const releases = [];
  const session = new RpcSession(
    () => new Promise((resolve) => releases.push(resolve)),
    10,
  );
  const one = session.run((r) => r("eth_chainId")),
    two = session.run((r) => r("eth_chainId"));
  await Promise.all([
    assert.rejects(one, { code: "TIMEOUT" }),
    assert.rejects(two, { code: "TIMEOUT" }),
  ]);
  await assert.rejects(
    session.run(async () => null),
    { code: "BUSY" },
  );
  for (const release of releases) release("0xe52");
  await pause();
  assert.equal(await session.run(async () => 7), 7);
});
test("abort stops follow-up RPC even when earlier request ignores cancellation", async () => {
  let release,
    calls = 0;
  const s = new RpcSession(() => {
    calls++;
    return new Promise((r) => (release = r));
  });
  const c = new AbortController();
  const p = s.run(async (r) => {
    await r("eth_chainId");
    await r("eth_blockNumber");
  }, c.signal);
  await pause();
  c.abort();
  await assert.rejects(p, { code: "ABORTED" });
  release("0xe52");
  await pause();
  assert.equal(calls, 1);
});
test("request budget and write method blacklist are enforced", async () => {
  let calls = 0;
  const s = new RpcSession(async () => {
    calls++;
    return "0x1";
  });
  await assert.rejects(
    s.run(async (r) => {
      for (let i = 0; i < 65; i++) await r("eth_blockNumber");
    }),
    { code: "REQUEST_BUDGET" },
  );
  assert.equal(calls, 64);
  await assert.rejects(
    s.run((r) => r("eth_sendRawTransaction", [])),
    { code: "METHOD_FORBIDDEN" },
  );
});
test("raw endpoint errors are sanitized and aborted entry does not call reader", async () => {
  let calls = 0;
  const s = new RpcSession(async () => {
    calls++;
    throw new Error("https://secret@node");
  });
  await assert.rejects(
    s.run((r) => r("eth_chainId")),
    { message: "RPC_UNAVAILABLE" },
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    s.run((r) => r("eth_chainId"), c.signal),
    { code: "ABORTED" },
  );
  assert.equal(calls, 1);
});
test("HTTP transport rejects credentials, plaintext remote and invalid endpoints", () => {
  for (const endpoint of [
    "http://remote.invalid",
    "https://user:secret@example.invalid",
    "not a URL",
  ])
    assert.throws(() => createHttpReader(endpoint), {
      code: "INVALID_ENDPOINT",
    });
});
test("escaped request is closed after work completes", async () => {
  let escaped,
    calls = 0;
  const session = new RpcSession(async () => {
    calls++;
    return "0x1";
  });
  await session.run(async (request) => {
    escaped = request;
  });
  await assert.rejects(escaped("eth_chainId"), { code: "OPERATION_CLOSED" });
  assert.equal(calls, 0);
});
test("unawaited transport still retains operation slots until underlying settlement", async () => {
  const releases = [];
  const session = new RpcSession(
    () => new Promise((r) => releases.push(r)),
    10,
  );
  const call = () =>
    session.run(async (request) => {
      void request("eth_chainId");
      return 1;
    });
  await Promise.all([
    assert.rejects(call(), { code: "TIMEOUT" }),
    assert.rejects(call(), { code: "TIMEOUT" }),
  ]);
  await assert.rejects(
    session.run(async () => null),
    { code: "BUSY" },
  );
  for (const release of releases) release("0x1");
  await pause();
  assert.equal(await session.run(async () => 2), 2);
});
test("per-session raw request concurrency is capped even for parallel work", async () => {
  let active = 0,
    max = 0;
  const release = [];
  const session = new RpcSession(() => {
    active++;
    max = Math.max(max, active);
    return new Promise((r) =>
      release.push(() => {
        active--;
        r("0x1");
      }),
    );
  });
  const result = session.run(async (request) => {
    const a = request("eth_chainId"),
      b = request("eth_chainId");
    await assert.rejects(request("eth_chainId"), { code: "RPC_BUSY" });
    release.forEach((r) => r());
    await Promise.all([a, b]);
  });
  await result;
  assert.equal(max, 2);
});
