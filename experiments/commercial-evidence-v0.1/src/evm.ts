import { keccak256, type Hex } from "viem";
import {
  decodeAnchor,
  ensure,
  hex,
  nonzero,
  quantity,
  record,
  tag,
  type AnchorEvent,
} from "./protocol.js";
import type { Request } from "./rpc.js";
export interface DeploymentProfile {
  chainId: number;
  checkpoint: { number: bigint; hash: Hex };
  registry: Hex;
  codeHash: Hex;
  startBlock: bigint;
  confirmations: number;
  applicationId: Hex;
}
export function normalizeProfile(input: DeploymentProfile): DeploymentProfile {
  const p = structuredClone(input);
  ensure(Number.isSafeInteger(p.chainId) && p.chainId > 0, "INVALID_CHAIN_ID");
  ensure(
    typeof p.startBlock === "bigint" &&
      typeof p.checkpoint?.number === "bigint" &&
      p.checkpoint.number >= 0n &&
      p.startBlock > p.checkpoint.number,
    "INVALID_START_BLOCK",
  );
  tag(p.startBlock);
  ensure(
    Number.isSafeInteger(p.confirmations) &&
      p.confirmations >= 1 &&
      p.confirmations <= 128,
    "INVALID_CONFIRMATIONS",
  );
  const registry = hex(p.registry, 20);
  ensure(!/^0x0+$/.test(registry), "INVALID_REGISTRY");
  return {
    chainId: p.chainId,
    checkpoint: {
      number: p.checkpoint.number,
      hash: nonzero(p.checkpoint.hash),
    },
    registry,
    codeHash: nonzero(p.codeHash),
    startBlock: p.startBlock,
    confirmations: p.confirmations,
    applicationId: nonzero(p.applicationId),
  };
}
export interface Block {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
}
export function parseBlock(input: unknown, expected: bigint): Block {
  const b = record(input),
    number = quantity(b.number);
  ensure(number === expected, "WRONG_BLOCK");
  return { number, hash: nonzero(b.hash), parentHash: hex(b.parentHash, 32) };
}
export async function getBlock(
  request: Request,
  height: bigint,
): Promise<Block> {
  return parseBlock(
    await request("eth_getBlockByNumber", [tag(height), false]),
    height,
  );
}
export async function gateNetwork(request: Request, p: DeploymentProfile) {
  ensure(
    quantity(await request("eth_chainId")) === BigInt(p.chainId),
    "WRONG_CHAIN",
  );
  const checkpoint = await getBlock(request, p.checkpoint.number);
  ensure(checkpoint.hash === p.checkpoint.hash, "CHECKPOINT_MISMATCH");
}
export async function gateCode(
  request: Request,
  p: DeploymentProfile,
  height: bigint,
) {
  const raw = await request("eth_getCode", [p.registry, tag(height)]);
  ensure(
    typeof raw === "string" &&
      /^0x(?:[a-fA-F0-9]{2})+$/.test(raw) &&
      raw.length <= 262146,
    "INVALID_CODE",
  );
  ensure(keccak256(raw as Hex) === p.codeHash, "CODE_MISMATCH");
}
export interface IndexedAnchor extends AnchorEvent {
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: bigint;
  logIndex: bigint;
}
export function parseAnchorLog(
  input: unknown,
  p: DeploymentProfile,
): IndexedAnchor {
  const l = record(input);
  ensure(hex(l.address, 20) === p.registry, "WRONG_EMITTER");
  ensure(l.removed === false, "REMOVED_LOG");
  const event = decodeAnchor(l.topics, l.data);
  ensure(event.applicationId === p.applicationId, "WRONG_APPLICATION");
  return {
    ...event,
    blockNumber: quantity(l.blockNumber),
    blockHash: nonzero(l.blockHash),
    transactionHash: nonzero(l.transactionHash),
    transactionIndex: quantity(l.transactionIndex),
    logIndex: quantity(l.logIndex),
  };
}
export function deploymentId(p: DeploymentProfile) {
  return `eip155:${p.chainId}:${p.registry}`;
}
