import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHttpReader, RpcSession } from "../dist/rpc.js";
import { createEvidenceVerifier } from "../dist/verifier.js";
import { EvidenceIndexer } from "../dist/indexer.js";
import { profile, FakeChain, envelope, hash } from "./fixture.mjs";
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}
test("real HTTP JSON-RPC verifies receipt and indexes without writes", async () => {
  const chain = new FakeChain();
  const server = await serve(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    const result = await chain.read(
      body.method,
      body.params,
      new AbortController().signal,
    );
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  try {
    const session = new RpcSession(createHttpReader(server.url));
    assert.equal(
      (await createEvidenceVerifier(session, profile)(envelope(), hash(900)))
        .matched,
      true,
    );
    const index = new EvidenceIndexer(session, profile);
    await index.sync();
    assert.equal(index.query(profile.applicationId).length, 1);
    assert.ok(chain.calls.every((c) => !c.method.startsWith("eth_send")));
  } finally {
    await server.close();
  }
});
test("HTTP rejects wrong response IDs, JSON-RPC errors and oversized bodies", async () => {
  for (const kind of ["id", "error", "large"]) {
    const server = await serve(async (req, res) => {
      for await (const _ of req) {
      }
      res.setHeader("content-type", "application/json");
      res.end(
        kind === "large"
          ? "x".repeat(1024 * 1024 + 1)
          : JSON.stringify(
              kind === "id"
                ? { jsonrpc: "2.0", id: -1, result: "0xe52" }
                : {
                    jsonrpc: "2.0",
                    id: 1,
                    error: { message: "private detail" },
                  },
            ),
      );
    });
    try {
      const read = createHttpReader(server.url);
      await assert.rejects(
        read("eth_chainId", [], new AbortController().signal),
        {
          code:
            kind === "large" ? "RPC_RESPONSE_LIMIT" : "INVALID_RPC_RESPONSE",
        },
      );
    } finally {
      await server.close();
    }
  }
});
test("non-success HTTP response cancels a continuing response body", async () => {
  let closed = false;
  const server = await serve(async (req, res) => {
    for await (const _ of req) {
    }
    res.writeHead(503, { "content-type": "text/plain" });
    res.write("unavailable");
    res.on("close", () => (closed = true));
  });
  try {
    await assert.rejects(
      createHttpReader(server.url)(
        "eth_chainId",
        [],
        new AbortController().signal,
      ),
      { code: "RPC_UNAVAILABLE" },
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(closed, true);
  } finally {
    await server.close();
  }
});
