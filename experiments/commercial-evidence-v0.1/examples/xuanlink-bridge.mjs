import { randomBytes } from "node:crypto";
import {
  TraceStore,
  sha256,
} from "../../xuanlink-traceability-v0.1/dist/index.js";
import { digestBytes, envelopeDigest, ZERO } from "../dist/protocol.js";
import { RpcSession } from "../dist/rpc.js";
import { createEvidenceVerifier } from "../dist/verifier.js";
import { EvidenceIndexer } from "../dist/indexer.js";
import { FakeChain, profile, anchorLog, hash } from "../tests/fixture.mjs";
// Optional local integration with the adjacent foundation prototype. Fictional data only.
const context = {
  organizationId: "sample-company",
  actorId: "sample-operator",
  roles: ["read", "write"],
};
const store = new TraceStore(context.organizationId);
const bytes = new TextEncoder().encode("Fictional garment inspection evidence");
const at = "2026-01-01T00:00:00.000Z";
store.append(context, {
  kind: "product",
  id: "sample-garment",
  name: "示例成衣",
});
store.append(context, {
  kind: "batch",
  id: "private-batch-1",
  productId: "sample-garment",
  quantity: "100",
  unit: "件",
});
store.append(context, {
  kind: "evidence",
  id: "private-report-1",
  batchId: "private-batch-1",
  digest: sha256(bytes),
  issuerId: "sample-lab",
  issuedAt: at,
  expiresAt: null,
  previousId: null,
});
const local = store.verify(context, "private-report-1", bytes, at);
if (!local.matches || local.revoked || local.expired || local.superseded)
  throw new Error("LOCAL_EVIDENCE_NOT_USABLE");
const salt = "0x" + randomBytes(32).toString("hex");
// Persist the draft envelope privately before retrying an anchor submission. Do not regenerate salt/recordId on retries.
const evidence = {
  schema: "commercial-evidence/v1",
  network: "eip155:3666",
  deploymentId: `eip155:3666:${profile.registry}`,
  applicationId: profile.applicationId,
  recordId: "0x" + randomBytes(32).toString("hex"),
  operation: "create",
  previousRecordId: ZERO,
  subjectCommitment: digestBytes(
    new TextEncoder().encode(
      JSON.stringify(["xuanlink.batch/v1", "private-batch-1", salt]),
    ),
  ),
  documentDigest: "0x" + sha256(bytes),
  occurredAt: at,
  salt,
};
const chain = new FakeChain();
chain.logs = [anchorLog(evidence)];
const session = new RpcSession(chain.read.bind(chain));
const result = await createEvidenceVerifier(session, profile)(
  evidence,
  hash(900),
);
const index = new EvidenceIndexer(session, profile);
await index.sync();
console.log({
  localFileMatches: local.matches,
  issuerVerified: local.issuerVerified,
  payloadDigest: envelopeDigest(evidence),
  simulatedChainInclusion: result.matched,
  indexedCount: index.query(profile.applicationId).length,
});
console.log(
  "原始批次编号和文件未进入公开事件；签发主体仍未认证，链回执为模拟数据。",
);
