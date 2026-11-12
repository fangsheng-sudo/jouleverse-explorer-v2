import type { Hex } from "viem";
import { normalizeProfile, type DeploymentProfile } from "./evm.js";
export const jouleverseNetwork = Object.freeze({
  chainId: 3666,
  network: "eip155:3666",
  rpcUrl: "https://rpc.jnsdao.com",
  nativeTransfersSupported: false,
  explorerCheckpoint: Object.freeze({
    number: 0x82fccfn,
    hash: "0xfde447d13d6c229d85cbbc64c670b0cd61d57b593b2dee91b3ef5d507d6e261f" as Hex,
  }),
});
/** No default registry, code hash or start block: there is no registered production anchor deployment in this pilot. */
export function createJouleverseProfile(
  deployment: Omit<DeploymentProfile, "chainId" | "checkpoint">,
  checkpoint: DeploymentProfile["checkpoint"] = jouleverseNetwork.explorerCheckpoint,
): DeploymentProfile {
  return normalizeProfile({
    ...deployment,
    chainId: jouleverseNetwork.chainId,
    checkpoint,
  });
}
