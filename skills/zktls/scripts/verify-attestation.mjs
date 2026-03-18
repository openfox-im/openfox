/**
 * OpenFox wrapper for zktls.verify-attestation — delegates to openskills native module.
 */
import { join } from "node:path";
import { homedir } from "node:os";

export async function run(input) {
  const request = input?.request;
  if (!request) throw new Error("missing input.request");
  if (!request.attestation) throw new Error("missing request.attestation");

  let native;
  try {
    const nativePath = join(homedir(), ".agents", "skills", "openskills", "native", "openskills-zktls.node");
    native = await import(nativePath);
  } catch {
    return {
      error: "native binding required — install openskills and build native/ with: cd ~/.agents/skills/openskills/native && npm run build",
      backend: "skill:zktls.verify-attestation",
    };
  }

  const result = await native.verify({
    attestation: request.attestation,
    expectedServerName: request.expectedServerName || null,
  });

  return {
    valid: result.valid,
    serverName: result.serverName,
    revealedSent: result.revealedSent || null,
    revealedRecv: result.revealedRecv || null,
    attestationSha256: result.attestationSha256,
    backend: "skill:zktls.verify-attestation",
  };
}
