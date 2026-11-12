# Independent review: commercial evidence pilot v0.1

Review date: 2026-11-12 (UTC). Reviewer: separate review agent; orchestration supplied model configuration `gpt-6-astra`. This records the configured model label, not independent attestation of backend model identity. Implementation and review were performed in separate agent contexts. The reviewer did not edit implementation files.

Scope: `src/protocol.ts`, `rpc.ts`, `evm.ts`, `verifier.ts`, `indexer.ts`, and the final `jouleverse.ts` configuration adapter and simulated demo, including local test fixtures, real loopback HTTP transport, cancellation, bounded indexing, reorganization and trusted checkpoint restoration. This is a local integration pilot. No deployed commercial anchoring contract, real commercial evidence, business truth, consensus finality, or customs compliance was established by this review. All examples used fictional data. Explorer source code was not part of this review.

## Initial validation

`npm test` built successfully and passed all 28 tests present at the initial run. The reviewer then ran independent adversarial probes. Passing the initial suite did not cover the cases below. Implementation was still changing during review; final verification status is recorded separately below.

## Findings

### R1 — HTTP error responses leave the response stream alive (medium)

Initial status: reproduced using a real HTTP server on loopback.

`createHttpReader` checks `response.ok` before acquiring or cancelling `response.body`. On a 503 response with an ongoing body, it throws immediately. `RpcSession.run` then clears its timeout, leaving the failed HTTP response streaming beyond the operation lifetime.

Reproduction: start a local Node HTTP server that sends status 503, writes an initial chunk, and continues writing every 5 ms. Run `new RpcSession(createHttpReader(url), 300).run(r => r('eth_chainId'))`. After the expected `RPC_UNAVAILABLE`, wait 400 ms and observe the server response's `close` event. Initial result: `close` had not fired and 78 further writes occurred. Close the server connections explicitly after the probe.

Impact: repeated unsuccessful responses can consume network connections and bandwidth outside the advertised operation deadline. Required correction: cancel the response body on every early rejection, and cover this with an integration test that observes connection/body termination.

### R2 — Session accounting does not include detached reads and escaped requests (medium)

Initial status: reproduced against the exported public `RpcSession` API. The built-in verifier and indexer await their reads sequentially, so they do not directly exercise this path.

The active count originally followed only the callback's returned promise. A callback could start a request without awaiting it and return immediately. Five sequential calls of the form below started five simultaneously unresolved transports despite the two-operation bound:

```js
let calls = 0;
let release;
const pending = new Promise(resolve => { release = resolve; });
const session = new RpcSession(async () => { calls++; return pending; }, 10);
for (let i = 0; i < 5; i++) {
  await session.run(async request => { void request('eth_chainId'); });
}
console.log(calls); // initially 5
release('0xe52');
```

Separately, saving `request` from a completed `run`, waiting beyond its original deadline, and then calling it still dispatched a transport. Its timer had already been cleared. This bypasses the intended operation lifetime.

Required correction: close the request capability when the callback completes; account for and retain operation slots until all already-dispatched transports settle, including transports ignoring cancellation. Avoid unhandled rejections from detached request promises. Regression tests must cover callback completion, callback error, timeout and cancellation with outstanding reads.

### R3 — Reported confirmation depth can survive an observed-head rollback (medium)

Initial status: reproduced with `FakeChain`.

The verifier reads head height once, checks code at that height, and finally rechecks only the anchor block. If the head retreats after the code read while the anchor remains canonical, the verifier can return the earlier depth as a successful confirmed match. In the probe, head was first 110, the anchor was 100, and the configured minimum was 3. After the second `eth_getCode`, the fixture's head became 100. Verification still returned `matched: true`, `confirmations: 11n`.

Reproduction with the repository fixture:

```js
const chain = new FakeChain();
let codeReads = 0;
chain.hook = async method => {
  if (method === 'eth_getCode' && ++codeReads === 2)
    queueMicrotask(() => { chain.head = 100n; });
};
const verify = createEvidenceVerifier(new RpcSession(chain.read.bind(chain)), profile);
const result = await verify(envelope(), hash(900));
```

Required correction: capture and recheck the observed head block identity as part of the verification observation, rejecting if it disappears or changes; apply the same observation guard before an indexer commit. A bounded set of RPC reads still does not establish consensus finality or a cryptographically authenticated atomic snapshot. Documentation must describe the observation accurately.

## Protocol, index and trust-boundary observations

- Envelope digests bind schema, network, deployment, application, record, operation, predecessor, subject commitment, document digest, timestamp and salt. Object key order is not part of the digest. Unknown envelope fields, invalid dates, zero identifiers and inconsistent predecessor rules are rejected.
- Receipt verification checks transaction identity/status, event emitter/application, receipt/log block and transaction consistency, one matching record, payload digest and operation/predecessor consistency. It validates configured checkpoint and contract bytecode hashes. Profile checkpoint and code hash must come from trusted configuration; discovering them from the same untrusted RPC would not create an independent trust root.
- The RPC reader is a trusted information source within this pilot. No header/receipt proof or independent consensus verification is performed. A node can omit logs or consistently fabricate data. Code hash checks do not establish business correctness or authenticate a proxy implementation's state.
- Index scans are bounded to eight blocks, use scoped log filters, reject conflicting positions, validate block linkage, keep 32 block identities, and commit state atomically after validation. The tests demonstrate bounded reorganization replay and failure without partial advancement. A reorganization outside the retained window fails and requires explicit trusted recovery/rebuild.
- `restoreTrustedCheckpoint` validates shape, configured profile equality, numeric bounds, ordering, uniqueness and retained block linkage. It is deliberately a trusted import, not an authentication mechanism. Historical anchors outside its 32-block window are not reverified against RPC, and queries can return restored data immediately. The caller must authenticate provenance/integrity externally and protect local checkpoint storage.
- Failed synchronization preserves the last committed cache. Queries and snapshots therefore describe cached observations, not guaranteed current canonicality or freshness after a failure. Applications must surface failed synchronization and must not label cached results as newly verified.
- Correction/revocation fields describe supplied events; the index does not establish predecessor existence, subject continuity, record uniqueness across transactions, authorization or current business validity. These are deployment/contract/application responsibilities.

## Final verification status

All three findings above are resolved in the reviewed source snapshot. The developer applied the fixes; the independent reviewer inspected the changes and reran the adversarial cases.

- `npm test`: TypeScript build succeeded; **35 tests passed**, zero failures.
- R1: repeated the real loopback 503 streaming response. After 400 ms the server observed connection/body closure; only one continuation write occurred before cancellation. No response persisted beyond the 300 ms operation deadline.
- R2: independently exercised outstanding reads when the callback returns, throws, or the caller aborts. Two outstanding transports retained both slots; another operation returned `BUSY`; settling the underlying transports released the slots. A request saved from a completed callback returned `OPERATION_CLOSED` without invoking the raw reader. No unhandled rejection was observed.
- R3: the original verifier head-retreat probe now rejects. Additional index probes retreating or replacing the observed head during log retrieval both reject and leave the exported checkpoint unchanged.

Final incremental review also inspected the formatted source, the per-session raw transport concurrency counter, stream-error sanitization, ABI re-encoding equality check, and `jouleverse.ts` thin configuration adapter. Additional independent probes confirmed:

- Parallel requests from separate operations on the same session cannot dispatch more than two raw reads; excess requests reject with `RPC_BUSY`.
- A real loopback HTTP stream reset produces only `PilotError: RPC_UNAVAILABLE` when calling the reader directly.
- Noncanonical/out-of-range operation words are rejected, and a valid event still decodes.
- Registry and code hash remain required deployment inputs; the bundled checkpoint object is immutable. The bundled Explorer checkpoint is a configuration trust choice, not an independently authenticated chain proof; operators must approve its provenance or provide another trusted checkpoint.
- The simulated demo successfully verifies create/correct/revoke events, indexes three records, restores a trusted checkpoint and resumes without duplicate insertion. It makes no external RPC calls or blockchain writes.
- The verifier comment now describes a bounded RPC observation, without implying an atomic snapshot.

The post-fix checks found no additional blocker in the reviewed modules for the explicitly limited local pilot. This is a bounded source/test review, not a certification or evidence of production deployment readiness. The trusted RPC, trusted configuration, trusted snapshot and stale-cache limits above remain material.

SHA-256 of the reviewed implementation snapshot:

```text
7713294c3aea20058e3ebbec362c0b90ced0b7647bcc8022a9bca70634343144  src/evm.ts
905f8c775094a0e6b3d62fe7e7ff79eb466e688e8a2d5622e2da0052409b51c2  src/indexer.ts
5fd89431231b5ce263323ec57f235d5c33c6d01e7bc59ab53d25dd627fe3be81  src/jouleverse.ts
52954248c814473e9a42ed44adaa07a99624f5e26349d1c855b441a47ac2f8c4  src/protocol.ts
8047c008dc10a6eb85804a870d5104211c68be770bcbe8539fdc15b329dac84b  src/rpc.ts
e490d455663491891ac809500bd5e6e8847922332d87992fc38db515f7b3f11e  src/verifier.ts
```
