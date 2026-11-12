import { RpcSession } from "./rpc.js";
import {
  ensure,
  envelopeDigest,
  evidenceTopic,
  hex,
  normalizeEnvelope,
  quantity,
  record,
  type EvidenceEnvelope,
} from "./protocol.js";
import {
  deploymentId,
  gateCode,
  gateNetwork,
  getBlock,
  normalizeProfile,
  parseAnchorLog,
  type DeploymentProfile,
  type IndexedAnchor,
} from "./evm.js";
/** Checks inclusion and depth at a bounded RPC observation, not current business validity or consensus finality. */
export function createEvidenceVerifier(
  session: RpcSession,
  input: DeploymentProfile,
) {
  const profile = normalizeProfile(input);
  return async (
    envelopeInput: EvidenceEnvelope,
    transactionHashInput: unknown,
    signal?: AbortSignal,
  ) => {
    const envelope = normalizeEnvelope(envelopeInput),
      transactionHash = hex(transactionHashInput, 32);
    ensure(
      envelope.network === `eip155:${profile.chainId}` &&
        envelope.deploymentId === deploymentId(profile) &&
        envelope.applicationId === profile.applicationId,
      "WRONG_SCOPE",
    );
    const expectedDigest = envelopeDigest(envelope);
    return session.run(async (request) => {
      await gateNetwork(request, profile);
      const receipt = record(
        await request("eth_getTransactionReceipt", [transactionHash]),
      );
      ensure(
        hex(receipt.transactionHash, 32) === transactionHash,
        "WRONG_TRANSACTION",
      );
      ensure(receipt.status === "0x1", "TRANSACTION_FAILED");
      const blockNumber = quantity(receipt.blockNumber),
        blockHash = hex(receipt.blockHash, 32),
        transactionIndex = quantity(receipt.transactionIndex);
      ensure(blockNumber >= profile.startBlock, "BEFORE_DEPLOYMENT");
      const head = quantity(await request("eth_blockNumber"));
      ensure(
        head >= blockNumber &&
          head - blockNumber + 1n >= BigInt(profile.confirmations),
        "NOT_CONFIRMED",
      );
      const headBlock = await getBlock(request, head);
      const block = await getBlock(request, blockNumber);
      ensure(block.hash === blockHash, "ORPHAN_RECEIPT");
      await gateCode(request, profile, blockNumber);
      if (head !== blockNumber) await gateCode(request, profile, head);
      ensure(
        Array.isArray(receipt.logs) && receipt.logs.length <= 512,
        "INVALID_RECEIPT_LOGS",
      );
      const anchors: IndexedAnchor[] = [];
      const seen = new Set<string>();
      for (const input of receipt.logs) {
        const log = record(input);
        if (hex(log.address, 20) !== profile.registry) continue;
        ensure(Array.isArray(log.topics), "INVALID_TOPICS");
        if (log.topics[0] !== evidenceTopic) continue;
        const a = parseAnchorLog(input, profile);
        ensure(
          a.blockHash === blockHash &&
            a.blockNumber === blockNumber &&
            a.transactionHash === transactionHash &&
            a.transactionIndex === transactionIndex,
          "LOG_RECEIPT_MISMATCH",
        );
        ensure(!seen.has(String(a.logIndex)), "DUPLICATE_LOG");
        seen.add(String(a.logIndex));
        if (a.recordId === envelope.recordId) anchors.push(a);
      }
      ensure(anchors.length === 1, "AMBIGUOUS_OR_MISSING_ANCHOR");
      const anchor = anchors[0]!;
      ensure(
        anchor.payloadDigest === expectedDigest &&
          anchor.previousRecordId === envelope.previousRecordId &&
          anchor.operation === envelope.operation,
        "ANCHOR_MISMATCH",
      );
      ensure(
        (await getBlock(request, head)).hash === headBlock.hash,
        "HEAD_CHANGED",
      );
      ensure(
        (await getBlock(request, blockNumber)).hash === blockHash,
        "CHAIN_CHANGED",
      );
      return {
        scope: "inclusion-only" as const,
        matched: true as const,
        anchor,
        observedHead: head,
        confirmations: head - blockNumber + 1n,
        consensusFinalityVerified: false as const,
      };
    }, signal);
  };
}
