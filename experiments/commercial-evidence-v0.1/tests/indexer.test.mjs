import test from "node:test";
import assert from "node:assert/strict";
import { RpcSession } from "../dist/rpc.js";
import { EvidenceIndexer } from "../dist/indexer.js";
import { profile, FakeChain, envelope, hash, anchorLog } from "./fixture.mjs";
const setup = () => {
  const chain = new FakeChain(),
    session = new RpcSession(chain.read.bind(chain));
  return { chain, session, index: new EvidenceIndexer(session, profile) };
};
test("bounded scan, stable repeat, checkpoint resume without duplicates", async () => {
  const { chain, index, session } = setup();
  const a = await index.sync();
  assert.deepEqual(a, {
    scanned: 8,
    inserted: 1,
    rolledBack: 0,
    nextBlock: 108n,
  });
  assert.equal(index.query(profile.applicationId).length, 1);
  const checkpoint = index.exportCheckpoint();
  const resumed = EvidenceIndexer.restoreTrustedCheckpoint(
    session,
    profile,
    checkpoint,
  );
  assert.equal((await resumed.sync()).scanned, 1);
  assert.equal(resumed.query(profile.applicationId).length, 1);
  assert.equal((await resumed.sync()).scanned, 0);
  const filters = chain.calls
    .filter((c) => c.method === "eth_getLogs")
    .map((c) => c.params[0]);
  assert.ok(
    filters.every(
      (f) =>
        BigInt(f.fromBlock) >= profile.startBlock &&
        BigInt(f.toBlock) - BigInt(f.fromBlock) < 8n,
    ),
  );
});
test("duplicate RPC log positions are idempotent, conflicting positions roll back", async () => {
  const { chain, index } = setup();
  chain.logs.push(structuredClone(chain.logs[0]));
  assert.equal((await index.sync()).inserted, 1);
  const next = {
    ...anchorLog(envelope({ recordId: hash(11) }), 108n),
    transactionHash: hash(901),
  };
  chain.logs = [next, { ...next, transactionHash: hash(902) }];
  const before = index.exportCheckpoint();
  await assert.rejects(index.sync(), { code: "LOG_POSITION_CONFLICT" });
  assert.equal(index.exportCheckpoint(), before);
});
test("bounded reorg removes orphan events and replays replacement branch", async () => {
  const { chain, index } = setup();
  chain.logs.push(
    anchorLog(envelope({ recordId: hash(11) }), 105n, {
      transactionHash: hash(901),
    }),
  );
  await index.sync();
  assert.equal(index.query(profile.applicationId).length, 2);
  chain.forkFrom = 104n;
  chain.version = 1n;
  chain.logs = [
    anchorLog(),
    anchorLog(envelope({ recordId: hash(12) }), 105n, {
      blockHash: chain.blockHash(105n),
      transactionHash: hash(902),
    }),
  ];
  const result = await index.sync();
  assert.equal(result.rolledBack, 4);
  assert.deepEqual(
    index.query(profile.applicationId).map((a) => a.recordId),
    [hash(10), hash(12)],
  );
});
test("deep reorg fails without mutating last snapshot", async () => {
  const { chain, index } = setup();
  await index.sync();
  const before = index.exportCheckpoint();
  chain.forkFrom = 1n;
  chain.version = 1n;
  await assert.rejects(index.sync(), { code: "REORG_OUTSIDE_WINDOW" });
  assert.equal(index.exportCheckpoint(), before);
});
test("wrong log block and RPC failure cannot partially advance checkpoint", async () => {
  for (const mode of ["hash", "rpc"]) {
    const { chain, index } = setup();
    if (mode === "hash") chain.logs[0].blockHash = hash(999);
    else chain.failMethod = "eth_getLogs";
    const before = index.exportCheckpoint();
    await assert.rejects(index.sync(), {
      code: mode === "hash" ? "LOG_BLOCK_MISMATCH" : "RPC_UNAVAILABLE",
    });
    assert.equal(index.exportCheckpoint(), before);
  }
});
test("checkpoint restore rejects changed profile, malformed positions and scope", async () => {
  const { index, session } = setup();
  await index.sync();
  const checkpoint = index.exportCheckpoint(),
    data = JSON.parse(checkpoint);
  assert.throws(
    () =>
      EvidenceIndexer.restoreTrustedCheckpoint(
        session,
        { ...profile, confirmations: 4 },
        checkpoint,
      ),
    { code: "CHECKPOINT_SCOPE" },
  );
  data.state.anchors[0].blockNumber = "01";
  assert.throws(
    () =>
      EvidenceIndexer.restoreTrustedCheckpoint(
        session,
        profile,
        JSON.stringify(data),
      ),
    { code: "INVALID_CHECKPOINT" },
  );
});
test("query output is isolated and page limits fail closed", async () => {
  const { index } = setup();
  await index.sync();
  const page = index.query(profile.applicationId);
  page[0].recordId = hash(99);
  assert.equal(index.query(profile.applicationId)[0].recordId, hash(10));
  assert.throws(() => index.query(hash(8)), { code: "WRONG_APPLICATION" });
  assert.throws(() => index.query(profile.applicationId, 0, 201), {
    code: "INVALID_PAGE",
  });
});
test("overlapping sync is rejected and cancellation cannot mutate state", async () => {
  const { index, chain } = setup();
  let release;
  chain.hook = () => new Promise((r) => (release = r));
  const controller = new AbortController(),
    pending = index.sync(controller.signal);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(index.sync(), { code: "INDEXER_BUSY" });
  controller.abort();
  await assert.rejects(pending, { code: "ABORTED" });
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(index.snapshot().nextBlock, 100n);
});
