import { RpcSession } from "../dist/rpc.js";
import { createEvidenceVerifier } from "../dist/verifier.js";
import { EvidenceIndexer } from "../dist/indexer.js";
import { createJouleverseProfile } from "../dist/jouleverse.js";
import { envelopeDigest } from "../dist/protocol.js";
import {
  profile,
  FakeChain,
  envelope,
  anchorLog,
  hash,
} from "../tests/fixture.mjs";
// Entire demonstration uses a simulated RPC; no wallet, external RPC or blockchain writes.
const chain = new FakeChain();
const p = createJouleverseProfile(profile, profile.checkpoint);
const created = envelope();
const corrected = envelope({
  recordId: hash(11),
  operation: "correct",
  previousRecordId: created.recordId,
  salt: hash(34),
});
const revoked = envelope({
  recordId: hash(12),
  operation: "revoke",
  previousRecordId: corrected.recordId,
  salt: hash(35),
});
chain.logs = [
  anchorLog(created),
  anchorLog(corrected, 101n, { transactionHash: hash(901) }),
  anchorLog(revoked, 102n, { transactionHash: hash(902) }),
];
const reader = async (method, params, signal) => {
  if (method === "eth_getTransactionReceipt") {
    const logs = chain.logs.filter((l) => l.transactionHash === params[0]);
    const log = logs[0];
    if (!log) return null;
    return {
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      status: "0x1",
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      logs,
    };
  }
  return chain.read(method, params, signal);
};
const session = new RpcSession(reader),
  verify = createEvidenceVerifier(session, p);
for (const [i, event] of [created, corrected, revoked].entries()) {
  const result = await verify(event, hash(900 + i));
  console.log(event.operation, {
    digest: envelopeDigest(event),
    matched: result.matched,
    scope: result.scope,
  });
}
const index = new EvidenceIndexer(session, p);
console.log("索引", await index.sync());
const checkpoint = index.exportCheckpoint();
const restored = EvidenceIndexer.restoreTrustedCheckpoint(
  session,
  p,
  checkpoint,
);
console.log(
  "恢复后事件操作",
  restored.query(p.applicationId).map((a) => a.operation),
);
console.log("再次同步", await restored.sync());
console.log("说明：这是模拟事件闭环，没有部署或证明真实商业证据。");
