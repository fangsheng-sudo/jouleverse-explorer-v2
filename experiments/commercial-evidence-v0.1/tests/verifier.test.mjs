import test from "node:test";
import assert from "node:assert/strict";
import { RpcSession } from "../dist/rpc.js";
import { createEvidenceVerifier } from "../dist/verifier.js";
import { profile, FakeChain, envelope, hash, anchorLog } from "./fixture.mjs";
const setup = () => {
  const chain = new FakeChain();
  return {
    chain,
    verify: createEvidenceVerifier(
      new RpcSession(chain.read.bind(chain)),
      profile,
    ),
  };
};
test("matches only a bound canonical confirmed anchor; inclusion is explicit", async () => {
  const { chain, verify } = setup();
  const r = await verify(envelope(), hash(900));
  assert.equal(r.matched, true);
  assert.equal(r.scope, "inclusion-only");
  assert.equal(r.consensusFinalityVerified, false);
  assert.equal(r.confirmations, 11n);
  assert.ok(chain.calls.length <= 12);
});
test("wrong chain stops before receipt or logs", async () => {
  const chain = new FakeChain(),
    calls = [];
  const session = new RpcSession(async (method, params, signal) => {
    calls.push(method);
    return method === "eth_chainId"
      ? "0x1"
      : chain.read(method, params, signal);
  });
  await assert.rejects(
    createEvidenceVerifier(session, profile)(envelope(), hash(900)),
    { code: "WRONG_CHAIN" },
  );
  assert.deepEqual(calls, ["eth_chainId"]);
});
test("rejects wrong application and deployment before RPC", async () => {
  const { chain, verify } = setup();
  await assert.rejects(
    verify({ ...envelope(), applicationId: hash(8) }, hash(900)),
    { code: "WRONG_SCOPE" },
  );
  assert.equal(chain.calls.length, 0);
});
test("code mismatch fails closed", async () => {
  const chain = new FakeChain();
  const verify = createEvidenceVerifier(
    new RpcSession(chain.read.bind(chain)),
    { ...profile, codeHash: hash(99) },
  );
  await assert.rejects(verify(envelope(), hash(900)), {
    code: "CODE_MISMATCH",
  });
});
test("insufficient depth never returns a match", async () => {
  const { chain, verify } = setup();
  chain.head = 100n;
  await assert.rejects(verify(envelope(), hash(900)), {
    code: "NOT_CONFIRMED",
  });
});
test("removed, duplicate and payload mismatch are rejected", async () => {
  for (const mode of ["removed", "duplicate", "mismatch"]) {
    const { chain, verify } = setup();
    if (mode === "removed") chain.logs[0].removed = true;
    if (mode === "duplicate") chain.logs.push(structuredClone(chain.logs[0]));
    if (mode === "mismatch")
      chain.logs = [anchorLog({ ...envelope(), salt: hash(55) })];
    await assert.rejects(verify(envelope(), hash(900)), {
      code:
        mode === "removed"
          ? "REMOVED_LOG"
          : mode === "duplicate"
            ? "DUPLICATE_LOG"
            : "ANCHOR_MISMATCH",
    });
  }
});
test("changed canonical block during verification is rejected", async () => {
  const { chain, verify } = setup();
  let reads = 0;
  chain.hook = async (method, params) => {
    if (
      method === "eth_getBlockByNumber" &&
      params[0] === "0x64" &&
      ++reads === 2
    ) {
      chain.forkFrom = 100n;
      chain.version = 1n;
    }
  };
  await assert.rejects(verify(envelope(), hash(900)), {
    code: "CHAIN_CHANGED",
  });
});
test("profile and envelope changes after dispatch cannot alter verification", async () => {
  const chain = new FakeChain(),
    p = structuredClone(profile),
    e = envelope(),
    verify = createEvidenceVerifier(new RpcSession(chain.read.bind(chain)), p);
  p.registry = "0x" + "2".repeat(40);
  const result = verify(e, hash(900));
  e.salt = hash(99);
  assert.equal((await result).matched, true);
});

test("head retreat cannot preserve an obsolete confirmation count", async () => {
  const { chain, verify } = setup();
  let codes = 0;
  chain.hook = async (method) => {
    if (method === "eth_getCode" && ++codes === 2) chain.head = 100n;
  };
  await assert.rejects(verify(envelope(), hash(900)));
});

test("checkpoint mismatch stops before receipt", async () => {
  const { chain, verify } = setup();
  chain.forkFrom = 0n;
  chain.version = 1n;
  await assert.rejects(verify(envelope(), hash(900)), {
    code: "CHECKPOINT_MISMATCH",
  });
  assert.equal(chain.calls.length, 2);
});
test("failed transaction and wrong receipt identity cannot match", async () => {
  for (const [field, value, code] of [
    ["status", "0x0", "TRANSACTION_FAILED"],
    ["transactionHash", hash(901), "WRONG_TRANSACTION"],
    ["blockHash", hash(444), "ORPHAN_RECEIPT"],
  ]) {
    const chain = new FakeChain(),
      session = new RpcSession(async (method, params, signal) => {
        const result = await chain.read(method, params, signal);
        return method === "eth_getTransactionReceipt"
          ? { ...result, [field]: value }
          : result;
      });
    await assert.rejects(
      createEvidenceVerifier(session, profile)(envelope(), hash(900)),
      { code },
    );
  }
});
