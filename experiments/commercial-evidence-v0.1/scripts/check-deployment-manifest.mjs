import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessTrialManifest } from "../dist/deployment-manifest.js";
import { PilotError } from "../dist/protocol.js";
const limit = 65536;
const path =
  process.argv[2] ??
  fileURLToPath(
    new URL("../config/deployment.jouleverse.draft.json", import.meta.url),
  );
async function readBoundedFile(path) {
  const file = await open(
    path,
    constants.O_RDONLY |
      (constants.O_NONBLOCK ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new PilotError("MANIFEST_NOT_REGULAR_FILE");
    if (info.size > limit) throw new PilotError("MANIFEST_SIZE_LIMIT");
    const bytes = new Uint8Array(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new PilotError("MANIFEST_SIZE_LIMIT");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } finally {
    await file.close();
  }
}
try {
  if (process.argv.length > 3) throw new PilotError("INVALID_ARGUMENTS");
  const report = assessTrialManifest(JSON.parse(await readBoundedFile(path)));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "blocked" ? 2 : 0;
} catch (error) {
  console.log(
    JSON.stringify({
      status: "invalid",
      code:
        error instanceof PilotError
          ? error.code
          : "MANIFEST_UNREADABLE_OR_INVALID_JSON",
    }),
  );
  process.exitCode = 1;
}
