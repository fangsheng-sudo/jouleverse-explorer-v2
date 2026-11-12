import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEnvelope,
  envelopeDigest,
  decodeAnchor,
  quantity,
  PilotError,
  ZERO,
} from "../dist/protocol.js";
import { envelope, anchorLog, hash } from "./fixture.mjs";
const rejects = (fn, code) =>
  assert.throws(fn, (e) => e instanceof PilotError && e.code === code);
test("canonical digest ignores object key order and normalizes hex case", () => {
  const e = envelope(),
    other = Object.fromEntries(Object.entries(e).reverse());
  other.recordId = e.recordId.toUpperCase().replace("0X", "0x");
  assert.equal(envelopeDigest(e), envelopeDigest(other));
  assert.notEqual(envelopeDigest(e), envelopeDigest({ ...e, salt: hash(44) }));
});
test("rejects unknown fields, array operation, zero salt, impossible dates", () => {
  rejects(
    () => normalizeEnvelope({ ...envelope(), name: "private" }),
    "INVALID_FIELDS",
  );
  rejects(
    () => normalizeEnvelope({ ...envelope(), operation: ["create"] }),
    "INVALID_OPERATION",
  );
  rejects(
    () => normalizeEnvelope({ ...envelope(), salt: ZERO }),
    "ZERO_IDENTIFIER",
  );
  for (const occurredAt of [
    "2026-02-30T00:00:00.000Z",
    "+010000-01-01T00:00:00.000Z",
  ])
    rejects(
      () => normalizeEnvelope({ ...envelope(), occurredAt }),
      "INVALID_TIME",
    );
});
test("correction and revocation require a different predecessor", () => {
  for (const operation of ["correct", "revoke"]) {
    rejects(
      () => normalizeEnvelope({ ...envelope(), operation }),
      "INVALID_PREDECESSOR",
    );
    assert.equal(
      normalizeEnvelope({
        ...envelope(),
        operation,
        previousRecordId: hash(11),
      }).operation,
      operation,
    );
  }
  rejects(
    () => normalizeEnvelope({ ...envelope(), previousRecordId: hash(11) }),
    "INVALID_PREDECESSOR",
  );
});
test("decodes strict event ABI and rejects truncated data or extra topics", () => {
  const l = anchorLog();
  assert.equal(decodeAnchor(l.topics, l.data).recordId, envelope().recordId);
  rejects(() => decodeAnchor(l.topics, l.data.slice(0, -2)), "INVALID_HEX");
  rejects(
    () => decodeAnchor([...l.topics, hash(44)], l.data),
    "INVALID_TOPICS",
  );
});
test("RPC quantities have canonical bounded representation", () => {
  assert.equal(quantity("0x0"), 0n);
  for (const n of ["0x00", "0x-1", "123", "0x" + "f".repeat(17)])
    rejects(() => quantity(n), "INVALID_QUANTITY");
});
