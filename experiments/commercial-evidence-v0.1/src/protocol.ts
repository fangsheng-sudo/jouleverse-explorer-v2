import { createHash } from "node:crypto";
import {
  decodeEventLog,
  parseAbi,
  toEventSelector,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from "viem";
export class PilotError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PilotError";
  }
}
export function ensure(value: unknown, code: string): asserts value {
  if (!value) throw new PilotError(code);
}
export function record(value: unknown): Record<string, unknown> {
  ensure(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_OBJECT",
  );
  return value as Record<string, unknown>;
}
export function exact(
  value: Record<string, unknown>,
  names: readonly string[],
) {
  ensure(
    Object.keys(value).length === names.length &&
      Object.keys(value).every((k) => names.includes(k)),
    "INVALID_FIELDS",
  );
}
export function hex(value: unknown, bytes: number): Hex {
  ensure(
    typeof value === "string" &&
      new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value),
    "INVALID_HEX",
  );
  return value.toLowerCase() as Hex;
}
export function quantity(value: unknown): bigint {
  ensure(
    typeof value === "string" &&
      /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value) &&
      value.length <= 18,
    "INVALID_QUANTITY",
  );
  return BigInt(value);
}
export function tag(value: bigint): Hex {
  ensure(value >= 0n && value <= 0xffffffffffffffffn, "INVALID_HEIGHT");
  return `0x${value.toString(16)}`;
}
export const ZERO = ("0x" + "0".repeat(64)) as Hex;
export function nonzero(value: unknown): Hex {
  const v = hex(value, 32);
  ensure(v !== ZERO, "ZERO_IDENTIFIER");
  return v;
}
export function digestBytes(bytes: Uint8Array): Hex {
  ensure(
    bytes instanceof Uint8Array && bytes.byteLength <= 32 * 1024 * 1024,
    "INVALID_DOCUMENT",
  );
  return ("0x" + createHash("sha256").update(bytes).digest("hex")) as Hex;
}
export interface EvidenceEnvelope {
  schema: "commercial-evidence/v1";
  network: string;
  deploymentId: string;
  applicationId: Hex;
  recordId: Hex;
  operation: "create" | "correct" | "revoke";
  previousRecordId: Hex;
  subjectCommitment: Hex;
  documentDigest: Hex;
  occurredAt: string;
  salt: Hex;
}
export function normalizeEnvelope(input: unknown): EvidenceEnvelope {
  const x = record(input);
  exact(x, [
    "schema",
    "network",
    "deploymentId",
    "applicationId",
    "recordId",
    "operation",
    "previousRecordId",
    "subjectCommitment",
    "documentDigest",
    "occurredAt",
    "salt",
  ]);
  ensure(x.schema === "commercial-evidence/v1", "INVALID_SCHEMA");
  ensure(
    typeof x.network === "string" &&
      /^[a-z0-9]{3,8}:[A-Za-z0-9-]{1,32}$/.test(x.network),
    "INVALID_NETWORK",
  );
  ensure(
    typeof x.deploymentId === "string" &&
      /^[A-Za-z0-9:._-]{1,128}$/.test(x.deploymentId),
    "INVALID_DEPLOYMENT",
  );
  ensure(
    typeof x.operation === "string" &&
      ["create", "correct", "revoke"].includes(x.operation),
    "INVALID_OPERATION",
  );
  const previousRecordId = hex(x.previousRecordId, 32),
    recordId = nonzero(x.recordId);
  ensure(
    (x.operation === "create") === (previousRecordId === ZERO) &&
      previousRecordId !== recordId,
    "INVALID_PREDECESSOR",
  );
  ensure(
    typeof x.occurredAt === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x.occurredAt) &&
      Number.isFinite(Date.parse(x.occurredAt)) &&
      new Date(x.occurredAt).toISOString() === x.occurredAt,
    "INVALID_TIME",
  );
  return {
    schema: x.schema,
    network: x.network,
    deploymentId: x.deploymentId,
    applicationId: nonzero(x.applicationId),
    recordId,
    operation: x.operation as EvidenceEnvelope["operation"],
    previousRecordId,
    subjectCommitment: nonzero(x.subjectCommitment),
    documentDigest: hex(x.documentDigest, 32),
    occurredAt: x.occurredAt,
    salt: nonzero(x.salt),
  };
}
export function envelopeDigest(input: unknown): Hex {
  const e = normalizeEnvelope(input);
  return digestBytes(
    new TextEncoder().encode(
      JSON.stringify([
        "commercial-evidence/v1",
        e.network,
        e.deploymentId,
        e.applicationId,
        e.recordId,
        e.operation,
        e.previousRecordId,
        e.subjectCommitment,
        e.documentDigest,
        e.occurredAt,
        e.salt,
      ]),
    ),
  );
}
export const evidenceAbi = parseAbi([
  "event EvidenceAnchored(bytes32 indexed applicationId, bytes32 indexed recordId, bytes32 payloadDigest, bytes32 previousRecordId, uint8 operation)",
]);
export const evidenceTopic = toEventSelector(evidenceAbi[0]);
export interface AnchorEvent {
  applicationId: Hex;
  recordId: Hex;
  payloadDigest: Hex;
  previousRecordId: Hex;
  operation: EvidenceEnvelope["operation"];
}
export function decodeAnchor(topics: unknown, data: unknown): AnchorEvent {
  ensure(Array.isArray(topics) && topics.length === 3, "INVALID_TOPICS");
  const fixed = topics.map((t) => hex(t, 32)) as [Hex, Hex, Hex];
  ensure(fixed[0] === evidenceTopic.toLowerCase(), "INVALID_TOPIC");
  const raw = hex(data, 96);
  let args;
  try {
    args = decodeEventLog({
      abi: evidenceAbi,
      topics: fixed,
      data: raw,
      strict: true,
    }).args;
  } catch {
    throw new PilotError("INVALID_EVENT_ENCODING");
  }
  ensure(
    encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint8"), [
      args.payloadDigest,
      args.previousRecordId,
      args.operation,
    ]) === raw,
    "NONCANONICAL_EVENT",
  );
  const operation = (["create", "correct", "revoke"] as const)[
    Number(args.operation)
  ];
  ensure(operation !== undefined, "INVALID_OPERATION");
  const event = {
    applicationId: nonzero(args.applicationId),
    recordId: nonzero(args.recordId),
    payloadDigest: nonzero(args.payloadDigest),
    previousRecordId: hex(args.previousRecordId, 32),
    operation,
  };
  ensure(
    (operation === "create") === (event.previousRecordId === ZERO) &&
      event.previousRecordId !== event.recordId,
    "INVALID_PREDECESSOR",
  );
  return event;
}
