import { RpcSession } from "./rpc.js";
import {
  ensure,
  evidenceTopic,
  hex,
  nonzero,
  quantity,
  record,
  tag,
  ZERO,
  exact,
} from "./protocol.js";
import {
  gateCode,
  gateNetwork,
  getBlock,
  normalizeProfile,
  parseAnchorLog,
  type Block,
  type DeploymentProfile,
  type IndexedAnchor,
} from "./evm.js";
interface State {
  blocks: Block[];
  anchors: IndexedAnchor[];
  nextBlock: bigint;
}
/** In-memory pilot, up to 8 blocks per call and 32 checkpoint hashes retained. Never scans from genesis. */
export class EvidenceIndexer {
  readonly #profile: DeploymentProfile;
  readonly #session: RpcSession;
  #state: State;
  #busy = false;
  constructor(session: RpcSession, profile: DeploymentProfile) {
    this.#session = session;
    this.#profile = normalizeProfile(profile);
    this.#state = {
      blocks: [],
      anchors: [],
      nextBlock: this.#profile.startBlock,
    };
  }
  snapshot() {
    return structuredClone(this.#state);
  }
  query(applicationId: unknown, after = 0, limit = 100) {
    ensure(
      hex(applicationId, 32) === this.#profile.applicationId,
      "WRONG_APPLICATION",
    );
    ensure(
      Number.isSafeInteger(after) &&
        after >= 0 &&
        after <= this.#state.anchors.length &&
        Number.isSafeInteger(limit) &&
        limit >= 1 &&
        limit <= 200,
      "INVALID_PAGE",
    );
    return structuredClone(this.#state.anchors.slice(after, after + limit));
  }
  async sync(signal?: AbortSignal) {
    ensure(!this.#busy, "INDEXER_BUSY");
    this.#busy = true;
    let started = false;
    try {
      return await this.#session.run(async (request) => {
        started = true;
        try {
          const p = this.#profile,
            state = structuredClone(this.#state);
          await gateNetwork(request, p);
          const head = quantity(await request("eth_blockNumber"));
          const headBlock = await getBlock(request, head);
          let rolledBack = 0;
          const tip = state.blocks.at(-1);
          if (tip && (await getBlock(request, tip.number)).hash !== tip.hash) {
            let common: Block | undefined;
            for (let i = state.blocks.length - 2; i >= 0; i--) {
              const candidate = state.blocks[i]!;
              if (
                (await getBlock(request, candidate.number)).hash ===
                candidate.hash
              ) {
                common = candidate;
                break;
              }
            }
            ensure(common, "REORG_OUTSIDE_WINDOW");
            rolledBack = Number(tip.number - common.number);
            state.blocks = state.blocks.filter(
              (b) => b.number <= common.number,
            );
            state.anchors = state.anchors.filter(
              (a) => a.blockNumber <= common.number,
            );
            state.nextBlock = common.number + 1n;
          }
          ensure(head + 1n >= BigInt(p.confirmations), "HEAD_TOO_LOW");
          const safeHead = head - BigInt(p.confirmations) + 1n;
          if (state.nextBlock > safeHead) {
            ensure(
              (await getBlock(request, head)).hash === headBlock.hash,
              "HEAD_CHANGED",
            );
            ensure(!signal?.aborted, "ABORTED");
            this.#state = state;
            return {
              scanned: 0,
              inserted: 0,
              rolledBack,
              nextBlock: state.nextBlock,
            };
          }
          const start = state.nextBlock,
            end = start + 7n < safeHead ? start + 7n : safeHead;
          const previous = await getBlock(request, start - 1n);
          const retained = state.blocks.at(-1);
          if (retained)
            ensure(
              retained.number === start - 1n && retained.hash === previous.hash,
              "CHAIN_CHANGED",
            );
          await gateCode(request, p, start);
          if (end !== start) await gateCode(request, p, end);
          const blocks: Block[] = [];
          let parent = previous.hash;
          for (let n = start; n <= end; n++) {
            const block = await getBlock(request, n);
            ensure(block.parentHash === parent, "BROKEN_BLOCK_CHAIN");
            blocks.push(block);
            parent = block.hash;
          }
          const raw = await request("eth_getLogs", [
            {
              address: p.registry,
              fromBlock: tag(start),
              toBlock: tag(end),
              topics: [evidenceTopic, p.applicationId],
            },
          ]);
          ensure(Array.isArray(raw) && raw.length <= 256, "LOG_LIMIT");
          const blockMap = new Map(
              blocks.map((b) => [String(b.number), b.hash]),
            ),
            positions = new Map<string, IndexedAnchor>();
          for (const item of raw) {
            const a = parseAnchorLog(item, p);
            ensure(
              a.blockNumber >= start &&
                a.blockNumber <= end &&
                blockMap.get(String(a.blockNumber)) === a.blockHash,
              "LOG_BLOCK_MISMATCH",
            );
            const key = `${a.blockNumber}:${a.logIndex}`;
            const prior = positions.get(key);
            if (prior) ensure(equal(prior, a), "LOG_POSITION_CONFLICT");
            else positions.set(key, a);
          }
          const anchors = [...positions.values()].sort((a, b) =>
            a.blockNumber === b.blockNumber
              ? a.logIndex < b.logIndex
                ? -1
                : 1
              : a.blockNumber < b.blockNumber
                ? -1
                : 1,
          );
          for (let i = 1; i < anchors.length; i++) {
            const before = anchors[i - 1]!,
              after = anchors[i]!;
            if (before.blockNumber === after.blockNumber)
              ensure(
                before.transactionIndex <= after.transactionIndex,
                "LOG_ORDER_MISMATCH",
              );
          }
          for (const height of new Set(anchors.map((a) => a.blockNumber)))
            if (height !== start && height !== end)
              await gateCode(request, p, height);
          ensure(
            (await getBlock(request, end)).hash === blocks.at(-1)!.hash,
            "CHAIN_CHANGED",
          );
          ensure(
            (await getBlock(request, head)).hash === headBlock.hash,
            "HEAD_CHANGED",
          );
          ensure(
            state.anchors.length + anchors.length <= 2048,
            "INDEX_CAPACITY",
          );
          if (state.blocks.length === 0) state.blocks.push(previous);
          state.blocks.push(...blocks);
          state.blocks = state.blocks.slice(-32);
          state.anchors.push(...anchors);
          state.nextBlock = end + 1n;
          ensure(!signal?.aborted, "ABORTED");
          this.#state = state;
          return {
            scanned: blocks.length,
            inserted: anchors.length,
            rolledBack,
            nextBlock: state.nextBlock,
          };
        } finally {
          this.#busy = false;
        }
      }, signal);
    } catch (error) {
      if (!started) this.#busy = false;
      throw error;
    }
  }
  static restoreTrustedCheckpoint(
    session: RpcSession,
    profile: DeploymentProfile,
    text: string,
  ): EvidenceIndexer {
    ensure(
      typeof text === "string" && text.length <= 4 * 1024 * 1024,
      "INVALID_CHECKPOINT",
    );
    let data: Record<string, unknown>;
    try {
      data = record(JSON.parse(text));
    } catch {
      ensure(false, "INVALID_CHECKPOINT");
    }
    exact(data, ["schema", "profile", "state"]);
    const index = new EvidenceIndexer(session, profile);
    ensure(
      data.schema === "evidence-index-checkpoint/v1" &&
        JSON.stringify(data.profile) ===
          JSON.stringify(index.#profile, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
      "CHECKPOINT_SCOPE",
    );
    const state = record(data.state);
    exact(state, ["blocks", "anchors", "nextBlock"]);
    ensure(
      Array.isArray(state.blocks) &&
        state.blocks.length <= 32 &&
        Array.isArray(state.anchors) &&
        state.anchors.length <= 2048,
      "INVALID_CHECKPOINT",
    );
    const decimal = (x: unknown) => {
      ensure(
        typeof x === "string" && /^(0|[1-9]\d{0,19})$/.test(x),
        "INVALID_CHECKPOINT",
      );
      const n = BigInt(x);
      tag(n);
      return n;
    };
    const nextBlock = decimal(state.nextBlock);
    ensure(nextBlock >= index.#profile.startBlock, "INVALID_CHECKPOINT");
    const blocks = state.blocks.map((input) => {
      const b = record(input);
      exact(b, ["number", "hash", "parentHash"]);
      return {
        number: decimal(b.number),
        hash: nonzero(b.hash),
        parentHash: hex(b.parentHash, 32),
      };
    });
    if (blocks.length) {
      ensure(blocks.at(-1)!.number + 1n === nextBlock, "INVALID_CHECKPOINT");
      for (let i = 1; i < blocks.length; i++)
        ensure(
          blocks[i]!.number === blocks[i - 1]!.number + 1n &&
            blocks[i]!.parentHash === blocks[i - 1]!.hash,
          "INVALID_CHECKPOINT",
        );
    } else
      ensure(
        nextBlock === index.#profile.startBlock && state.anchors.length === 0,
        "INVALID_CHECKPOINT",
      );
    const seen = new Set<string>();
    const blockMap = new Map(blocks.map((b) => [String(b.number), b.hash]));
    const anchors = state.anchors.map((input) => {
      const a = record(input);
      exact(a, [
        "applicationId",
        "recordId",
        "payloadDigest",
        "previousRecordId",
        "operation",
        "blockNumber",
        "blockHash",
        "transactionHash",
        "transactionIndex",
        "logIndex",
      ]);
      ensure(
        typeof a.operation === "string" &&
          ["create", "correct", "revoke"].includes(a.operation),
        "INVALID_OPERATION",
      );
      const previousRecordId = hex(a.previousRecordId, 32),
        recordId = nonzero(a.recordId);
      ensure(
        (a.operation === "create") === (previousRecordId === ZERO) &&
          previousRecordId !== recordId,
        "INVALID_PREDECESSOR",
      );
      const anchor: IndexedAnchor = {
        applicationId: nonzero(a.applicationId),
        recordId,
        payloadDigest: nonzero(a.payloadDigest),
        previousRecordId,
        operation: a.operation as IndexedAnchor["operation"],
        blockNumber: decimal(a.blockNumber),
        blockHash: nonzero(a.blockHash),
        transactionHash: nonzero(a.transactionHash),
        transactionIndex: decimal(a.transactionIndex),
        logIndex: decimal(a.logIndex),
      };
      ensure(
        anchor.applicationId === index.#profile.applicationId &&
          anchor.blockNumber >= index.#profile.startBlock &&
          anchor.blockNumber < nextBlock,
        "CHECKPOINT_SCOPE",
      );
      const canonical = blockMap.get(String(anchor.blockNumber));
      ensure(
        !canonical || canonical === anchor.blockHash,
        "INVALID_CHECKPOINT",
      );
      const key = `${anchor.blockNumber}:${anchor.logIndex}`;
      ensure(!seen.has(key), "INVALID_CHECKPOINT");
      seen.add(key);
      return anchor;
    });
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!,
        b = anchors[i]!;
      ensure(
        a.blockNumber < b.blockNumber ||
          (a.blockNumber === b.blockNumber &&
            a.logIndex < b.logIndex &&
            a.transactionIndex <= b.transactionIndex),
        "INVALID_CHECKPOINT",
      );
    }
    index.#state = { blocks, anchors, nextBlock };
    return index;
  }
  exportCheckpoint() {
    return JSON.stringify(
      {
        schema: "evidence-index-checkpoint/v1",
        profile: this.#profile,
        state: this.#state,
      },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
    );
  }
}
function equal(a: IndexedAnchor, b: IndexedAnchor) {
  return (
    JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v)) ===
    JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}
