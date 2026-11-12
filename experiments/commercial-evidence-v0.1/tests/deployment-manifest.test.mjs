import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  assessTrialManifest,
  normalizeTrialManifest,
  profileForReadOnlyTrial,
} from "../dist/deployment-manifest.js";
import { profile, hash } from "./fixture.mjs";
const draft = JSON.parse(
  await readFile(
    new URL("../config/deployment.jouleverse.draft.json", import.meta.url),
    "utf8",
  ),
);
function complete() {
  const m = structuredClone(draft);
  m.environment = "local";
  m.network = {
    chainId: profile.chainId,
    checkpoint: { number: "0", hash: profile.checkpoint.hash },
  };
  m.deployment = {
    registry: profile.registry,
    codeHash: profile.codeHash,
    startBlock: String(profile.startBlock),
    applicationId: profile.applicationId,
    confirmations: profile.confirmations,
    upgradeability: "immutable",
  };
  m.references = {
    checkpointSource: "https://example.invalid/checkpoint",
    deploymentRecord: "https://example.invalid/deployment",
    codeAudit: "https://example.invalid/audit",
    permissionPolicy: "https://example.invalid/policy",
  };
  return m;
}
test("real draft remains blocked with no fabricated production profile", () => {
  const r = assessTrialManifest(draft);
  assert.equal(r.status, "blocked");
  assert.equal(r.issues.length, 9);
  assert.ok(r.issues.some((x) => x.code === "MISSING_REGISTRY"));
  assert.throws(() => profileForReadOnlyTrial(draft), {
    code: "MANIFEST_BLOCKED",
  });
});
test("configuration complete never claims verification or enables writing", () => {
  const m = complete(),
    r = assessTrialManifest(m);
  assert.equal(r.status, "configuration-complete");
  for (const k of [
    "networkVerified",
    "deploymentVerified",
    "authorizationVerified",
    "mainnetWriteEnabled",
  ])
    assert.equal(r[k], false);
  assert.deepEqual(profileForReadOnlyTrial(m), profile);
});
test("zero or malformed deployment data is rejected, not treated as a placeholder", () => {
  for (const patch of [
    { registry: "0x" + "0".repeat(40) },
    { codeHash: "0x" + "0".repeat(64) },
    { startBlock: "01" },
    { confirmations: 0 },
    { applicationId: [] },
  ]) {
    const m = complete();
    Object.assign(m.deployment, patch);
    assert.throws(() => assessTrialManifest(m));
  }
});
test("unknown and proxy upgradeability cannot create a trial profile", () => {
  for (const upgradeability of ["unknown", "proxy"]) {
    const m = complete();
    m.deployment.upgradeability = upgradeability;
    assert.equal(assessTrialManifest(m).status, "blocked");
    assert.throws(() => profileForReadOnlyTrial(m), {
      code: "MANIFEST_BLOCKED",
    });
  }
});
test("untrusted reference values are not fetched, reflected or accepted as credentials", () => {
  for (const bad of [
    "http://example.invalid",
    "https://user:private@example.invalid",
    "https://example.invalid/?token=private",
    "https://example.invalid/#private",
    [],
  ]) {
    const m = complete();
    m.references.codeAudit = bad;
    assert.throws(() => assessTrialManifest(m), {
      code: "INVALID_MANIFEST_REFERENCE",
    });
  }
  const r = assessTrialManifest(complete());
  assert.ok(!JSON.stringify(r).includes("example.invalid"));
});
test("schema rejects unknown private fields and nonprimitive discriminators", () => {
  assert.throws(
    () =>
      normalizeTrialManifest({ ...complete(), privateKey: "fake-test-secret" }),
    { code: "INVALID_FIELDS" },
  );
  assert.throws(
    () => normalizeTrialManifest({ ...complete(), environment: ["mainnet"] }),
    { code: "INVALID_MANIFEST_ENVIRONMENT" },
  );
});
test("normalized profile is detached and rejects pre-checkpoint deployment height", () => {
  const m = complete(),
    p = profileForReadOnlyTrial(m);
  m.deployment.registry = "0x" + "2".repeat(40);
  assert.equal(p.registry, profile.registry);
  m.network.checkpoint.number = "100";
  assert.throws(() => profileForReadOnlyTrial(m), {
    code: "INVALID_START_BLOCK",
  });
});
test("offline CLI returns blocked exit 2 for real draft and stable failure for missing file", () => {
  const script = new URL(
    "../scripts/check-deployment-manifest.mjs",
    import.meta.url,
  );
  const r = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).status, "blocked");
  const bad = spawnSync(
    process.execPath,
    [script.pathname, "/nonexistent-private-test-input"],
    { encoding: "utf8" },
  );
  assert.equal(bad.status, 1);
  assert.ok(!bad.stdout.includes("nonexistent-private"));
});

test(
  "CLI rejects a FIFO without waiting for a writer",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-readiness-"));
    try {
      const path = join(dir, "input.fifo");
      execFileSync("mkfifo", [path]);
      const result = spawnSync(
        process.execPath,
        [
          new URL("../scripts/check-deployment-manifest.mjs", import.meta.url)
            .pathname,
          path,
        ],
        { encoding: "utf8", timeout: 2000 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).code, "MANIFEST_NOT_REGULAR_FILE");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("CLI accepts a 64KiB regular draft but rejects larger files without reflecting paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manifest-size-"));
  try {
    const path = join(dir, "sensitive-filename.json"),
      text = JSON.stringify(draft);
    for (const [size, exit, code] of [
      [65536, 2, undefined],
      [65537, 1, "MANIFEST_SIZE_LIMIT"],
    ]) {
      await writeFile(path, text + " ".repeat(size - Buffer.byteLength(text)));
      const r = spawnSync(
        process.execPath,
        [
          new URL("../scripts/check-deployment-manifest.mjs", import.meta.url)
            .pathname,
          path,
        ],
        { encoding: "utf8", timeout: 2000 },
      );
      assert.equal(r.status, exit);
      if (code) assert.equal(JSON.parse(r.stdout).code, code);
      assert.ok(!r.stdout.includes("sensitive-filename"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
