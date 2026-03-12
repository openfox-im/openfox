/**
 * OpenFox integration wrapper for proofverify.verify-consensus.
 *
 * Prefer the configured Rust CLI worker. Fall back to the OpenSkills JS
 * consensus checker when no worker is configured.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { runCliWorker, unwrapCliWorkerResult } from "../../_shared/cli-worker.mjs";

function buildConsensusRequest(input) {
  const request = input?.request ?? {};
  const attestationVerification = input?.attestationVerification ?? null;
  if (Array.isArray(request.agentResults) && request.agentResults.length > 0) {
    return {
      m: Number(request.m || request.committee_threshold_m || request.agentResults.length),
      n: Number(request.n || request.committee_size_n || request.agentResults.length),
      agentResults: request.agentResults,
      expectedServerName: request.expected_server_name || request.expectedServerName || undefined,
      expectedArticleSha256: request.subject_sha256 || request.expectedArticleSha256 || undefined,
    };
  }
  const metadata = attestationVerification?.metadata ?? {};
  const agentResult = {
    verdict: attestationVerification?.verdict || "inconclusive",
    serverName:
      Array.isArray(metadata.server_names) && metadata.server_names.length > 0
        ? metadata.server_names[0]
        : request.expected_server_name || request.expectedServerName || null,
    articleSha256: request.subject_sha256 || request.expectedArticleSha256 || null,
    attestationSha256:
      Array.isArray(metadata.attestation_hashes) && metadata.attestation_hashes.length > 0
        ? metadata.attestation_hashes[0]
        : null,
  };
  return {
    m: 1,
    n: 1,
    agentResults: [agentResult],
    expectedServerName: request.expected_server_name || request.expectedServerName || undefined,
    expectedArticleSha256: request.subject_sha256 || request.expectedArticleSha256 || undefined,
    syntheticSingleVerification: true,
  };
}

export async function run(input, context) {
  const request = buildConsensusRequest(input);
  const worker = context?.config?.agentDiscovery?.proofVerifyServer?.verifierWorker;
  if (worker?.command) {
    const workerResult = await runCliWorker(worker, {
      schema_version: "openfox.cli-worker.v1",
      worker: "proofverify.verify-consensus",
      request_id: input?.request?.request_nonce || `proofverify-consensus-${Date.now()}`,
      request,
      options: {},
      context: {},
    });
    if (workerResult.exitCode === 0) {
      return unwrapCliWorkerResult(workerResult.stdout, "proofverify.verify-consensus");
    }
    if ((workerResult.exitCode === 20 || workerResult.exitCode === 21) && workerResult.stdout) {
      return unwrapCliWorkerResult(workerResult.stdout, "proofverify.verify-consensus");
    }
    throw new Error(
      `proofverify.verify-consensus CLI worker failed with exit code ${workerResult.exitCode}${
        workerResult.stderr ? `: ${workerResult.stderr}` : ""
      }`,
    );
  }

  const { run: coreRun } = await import(
    join(homedir(), ".agents", "skills", "openskills", "skills", "proofverify", "scripts", "verify-consensus.mjs"),
  );
  return coreRun({ request });
}
