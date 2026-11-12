import {
  keccak256,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";
import {
  evidenceAbi,
  envelopeDigest,
  ZERO,
  digestBytes,
} from "../dist/protocol.js";
export const hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
export const code = "0x60006000";
export const profile = {
  chainId: 3666,
  checkpoint: { number: 0n, hash: hash(1000) },
  registry: "0x" + "1".repeat(40),
  codeHash: keccak256(code),
  startBlock: 100n,
  confirmations: 3,
  applicationId: hash(7),
};
export function envelope(overrides = {}) {
  return {
    schema: "commercial-evidence/v1",
    network: "eip155:3666",
    deploymentId: `eip155:3666:${profile.registry}`,
    applicationId: profile.applicationId,
    recordId: hash(10),
    operation: "create",
    previousRecordId: ZERO,
    subjectCommitment: hash(22),
    documentDigest: digestBytes(new TextEncoder().encode("fictional report")),
    occurredAt: "2026-01-01T00:00:00.000Z",
    salt: hash(33),
    ...overrides,
  };
}
export function anchorLog(e = envelope(), height = 100n, overrides = {}) {
  return {
    address: profile.registry,
    topics: encodeEventTopics({
      abi: evidenceAbi,
      eventName: "EvidenceAnchored",
      args: { applicationId: e.applicationId, recordId: e.recordId },
    }),
    data: encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint8"), [
      envelopeDigest(e),
      e.previousRecordId,
      ["create", "correct", "revoke"].indexOf(e.operation),
    ]),
    blockNumber: "0x" + height.toString(16),
    blockHash: hash(1000n + height),
    transactionHash: hash(900),
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
    ...overrides,
  };
}
export class FakeChain {
  head = 110n;
  logs = [anchorLog()];
  calls = [];
  forkFrom = null;
  version = 0n;
  failMethod = null;
  hook = null;
  blockHash(n) {
    return hash(
      1000n +
        n +
        (this.forkFrom !== null && n >= this.forkFrom
          ? this.version * 100000n
          : 0n),
    );
  }
  async read(method, params, signal) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hook) await this.hook(method, params, signal);
    if (this.failMethod === method)
      throw new Error("private credentials should never escape");
    switch (method) {
      case "eth_chainId":
        return "0xe52";
      case "eth_blockNumber":
        return "0x" + this.head.toString(16);
      case "eth_getCode":
        return code;
      case "eth_gasPrice":
        return "0x1";
      case "eth_getBlockByNumber": {
        const n = BigInt(params[0]);
        if (n > this.head) return null;
        return {
          number: "0x" + n.toString(16),
          hash: this.blockHash(n),
          parentHash: n === 0n ? hash(0) : this.blockHash(n - 1n),
        };
      }
      case "eth_getTransactionReceipt":
        return {
          transactionHash: hash(900),
          transactionIndex: "0x0",
          status: "0x1",
          blockNumber: "0x64",
          blockHash: this.blockHash(100n),
          logs: structuredClone(this.logs),
        };
      case "eth_getLogs": {
        const f = params[0];
        return structuredClone(
          this.logs.filter(
            (l) =>
              BigInt(l.blockNumber) >= BigInt(f.fromBlock) &&
              BigInt(l.blockNumber) <= BigInt(f.toBlock),
          ),
        );
      }
      default:
        throw new Error("unsupported fixture method");
    }
  }
}
