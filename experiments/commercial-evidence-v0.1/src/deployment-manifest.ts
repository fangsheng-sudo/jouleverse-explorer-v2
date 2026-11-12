import { normalizeProfile, type DeploymentProfile } from "./evm.js";
import {
  ensure,
  exact,
  hex,
  nonzero,
  PilotError,
  record,
  tag,
} from "./protocol.js";

export interface TrialManifest {
  schema: "commercial-deployment/v1";
  environment: "local" | "isolated-test" | "mainnet";
  network: { chainId: number; checkpoint: { number: string; hash: string } };
  deployment: {
    registry: string | null;
    codeHash: string | null;
    startBlock: string | null;
    applicationId: string | null;
    confirmations: number | null;
    upgradeability: "immutable" | "proxy" | "unknown";
  };
  references: {
    checkpointSource: string | null;
    deploymentRecord: string | null;
    codeAudit: string | null;
    permissionPolicy: string | null;
  };
}
export interface ManifestIssue {
  code: string;
  field: string;
}
export interface ManifestAssessment {
  status: "blocked" | "configuration-complete";
  environment: TrialManifest["environment"];
  issues: ManifestIssue[];
  networkVerified: false;
  deploymentVerified: false;
  authorizationVerified: false;
  mainnetWriteEnabled: false;
}
function decimal(input: unknown): bigint {
  ensure(
    typeof input === "string" && /^(0|[1-9]\d{0,19})$/.test(input),
    "INVALID_MANIFEST_HEIGHT",
  );
  const n = BigInt(input);
  tag(n);
  return n;
}
function reference(input: unknown): string | null {
  if (input === null) return null;
  ensure(
    typeof input === "string" && input.length <= 2048,
    "INVALID_MANIFEST_REFERENCE",
  );
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PilotError("INVALID_MANIFEST_REFERENCE");
  }
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "INVALID_MANIFEST_REFERENCE",
  );
  return url.href;
}
/** Parses trusted operator configuration only. Reference URLs are neither fetched nor authenticated. */
export function normalizeTrialManifest(input: unknown): TrialManifest {
  const x = record(input);
  exact(x, ["schema", "environment", "network", "deployment", "references"]);
  ensure(x.schema === "commercial-deployment/v1", "INVALID_MANIFEST_SCHEMA");
  ensure(
    typeof x.environment === "string" &&
      ["local", "isolated-test", "mainnet"].includes(x.environment),
    "INVALID_MANIFEST_ENVIRONMENT",
  );
  const network = record(x.network);
  exact(network, ["chainId", "checkpoint"]);
  ensure(
    Number.isSafeInteger(network.chainId) && Number(network.chainId) > 0,
    "INVALID_CHAIN_ID",
  );
  const checkpoint = record(network.checkpoint);
  exact(checkpoint, ["number", "hash"]);
  const checkpointNumber = decimal(checkpoint.number),
    checkpointHash = nonzero(checkpoint.hash);
  const d = record(x.deployment);
  exact(d, [
    "registry",
    "codeHash",
    "startBlock",
    "applicationId",
    "confirmations",
    "upgradeability",
  ]);
  const registry = d.registry === null ? null : hex(d.registry, 20);
  ensure(registry === null || !/^0x0+$/.test(registry), "INVALID_REGISTRY");
  const codeHash = d.codeHash === null ? null : nonzero(d.codeHash),
    applicationId = d.applicationId === null ? null : nonzero(d.applicationId);
  const startBlock = d.startBlock === null ? null : decimal(d.startBlock);
  ensure(
    startBlock === null || startBlock > checkpointNumber,
    "INVALID_START_BLOCK",
  );
  ensure(
    d.confirmations === null ||
      (Number.isSafeInteger(d.confirmations) &&
        Number(d.confirmations) >= 1 &&
        Number(d.confirmations) <= 128),
    "INVALID_CONFIRMATIONS",
  );
  ensure(
    typeof d.upgradeability === "string" &&
      ["immutable", "proxy", "unknown"].includes(d.upgradeability),
    "INVALID_UPGRADEABILITY",
  );
  const r = record(x.references);
  exact(r, [
    "checkpointSource",
    "deploymentRecord",
    "codeAudit",
    "permissionPolicy",
  ]);
  return {
    schema: x.schema,
    environment: x.environment as TrialManifest["environment"],
    network: {
      chainId: network.chainId as number,
      checkpoint: { number: checkpointNumber.toString(), hash: checkpointHash },
    },
    deployment: {
      registry,
      codeHash,
      startBlock: startBlock === null ? null : startBlock.toString(),
      applicationId,
      confirmations: d.confirmations as number | null,
      upgradeability:
        d.upgradeability as TrialManifest["deployment"]["upgradeability"],
    },
    references: {
      checkpointSource: reference(r.checkpointSource),
      deploymentRecord: reference(r.deploymentRecord),
      codeAudit: reference(r.codeAudit),
      permissionPolicy: reference(r.permissionPolicy),
    },
  };
}
export function assessTrialManifest(input: unknown): ManifestAssessment {
  const m = normalizeTrialManifest(input),
    issues: ManifestIssue[] = [];
  for (const [field, code] of [
    ["registry", "MISSING_REGISTRY"],
    ["codeHash", "MISSING_CODE_HASH"],
    ["startBlock", "MISSING_DEPLOYMENT_HEIGHT"],
    ["applicationId", "MISSING_APPLICATION"],
    ["confirmations", "MISSING_CONFIRMATION_POLICY"],
  ] as const)
    if (m.deployment[field] === null)
      issues.push({ field: `deployment.${field}`, code });
  if (m.deployment.upgradeability !== "immutable")
    issues.push({
      field: "deployment.upgradeability",
      code:
        m.deployment.upgradeability === "proxy"
          ? "PROXY_NOT_SUPPORTED"
          : "MISSING_UPGRADEABILITY_POLICY",
    });
  for (const field of [
    "checkpointSource",
    "deploymentRecord",
    "codeAudit",
    "permissionPolicy",
  ] as const)
    if (m.references[field] === null)
      issues.push({
        field: `references.${field}`,
        code: "MISSING_TRUST_REFERENCE",
      });
  return {
    status: issues.length ? "blocked" : "configuration-complete",
    environment: m.environment,
    issues,
    networkVerified: false,
    deploymentVerified: false,
    authorizationVerified: false,
    mainnetWriteEnabled: false,
  };
}
/** Complete configuration is not approval, deployment verification or production readiness. */
export function profileForReadOnlyTrial(input: unknown): DeploymentProfile {
  const m = normalizeTrialManifest(input);
  ensure(
    assessTrialManifest(m).status === "configuration-complete",
    "MANIFEST_BLOCKED",
  );
  return normalizeProfile({
    chainId: m.network.chainId,
    checkpoint: {
      number: BigInt(m.network.checkpoint.number),
      hash: hex(m.network.checkpoint.hash, 32),
    },
    registry: hex(m.deployment.registry, 20),
    codeHash: hex(m.deployment.codeHash, 32),
    startBlock: BigInt(m.deployment.startBlock!),
    applicationId: hex(m.deployment.applicationId, 32),
    confirmations: m.deployment.confirmations!,
  });
}
