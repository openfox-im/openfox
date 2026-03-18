/**
 * OpenFox integration wrapper for proofverify.verify-attestations.
 *
 * Prefer the configured Rust CLI worker. When unavailable, fall back to the
 * OpenSkills native backend if it is installed.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { runCliWorker, unwrapCliWorkerResult } from "../../_shared/cli-worker.mjs";
import { fetchBoundedUrl, validateHttpTargetUrl } from "../../_shared/http-utils.mjs";

async function buildRequest(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};
  const attestations = [];
  if (Array.isArray(request.attestations)) {
    for (const entry of request.attestations) {
      if (typeof entry === "string" && entry.trim()) attestations.push(entry);
    }
  }
  if (attestations.length === 0 && request.proof_bundle_url) {
    const bundleUrl = validateHttpTargetUrl(String(request.proof_bundle_url), {
      allowPrivateTargets: options.allowPrivateTargets === true,
    });
    const bundle = await fetchBoundedUrl(bundleUrl, {
      timeoutMs: Number(options.requestTimeoutMs || 10_000),
      maxResponseBytes: Number(options.maxFetchBytes || 262_144),
    });
    const parsed = JSON.parse(bundle.body.toString("utf8"));
    if (typeof parsed?.zktls_attestation === "string" && parsed.zktls_attestation.trim()) {
      attestations.push(parsed.zktls_attestation);
    }
    if (Array.isArray(parsed?.attestations)) {
      for (const entry of parsed.attestations) {
        if (typeof entry === "string" && entry.trim()) attestations.push(entry);
      }
    }
  }
  return {
    attestations,
    expectedServerName: request.expected_server_name || request.expectedServerName || undefined,
    expectedArticleSha256: request.subject_sha256 || request.expectedArticleSha256 || undefined,
  };
}

export async function run(input, context) {
  const request = await buildRequest(input);
  const worker = context?.config?.agentDiscovery?.proofVerifyServer?.verifierWorker;
  if (worker?.command) {
    const workerResult = await runCliWorker(worker, {
      schema_version: "openfox.cli-worker.v1",
      worker: "proofverify.verify-attestations",
      request_id: input?.request?.request_nonce || `proofverify-attest-${Date.now()}`,
      request,
      options: {
        ...(input?.options ?? {}),
      },
      context: {},
    });
    if (workerResult.exitCode === 0) {
      return unwrapCliWorkerResult(workerResult.stdout, "proofverify.verify-attestations");
    }
    if ((workerResult.exitCode === 20 || workerResult.exitCode === 21) && workerResult.stdout) {
      return unwrapCliWorkerResult(workerResult.stdout, "proofverify.verify-attestations");
    }
    throw new Error(
      `proofverify.verify-attestations CLI worker failed with exit code ${workerResult.exitCode}${
        workerResult.stderr ? `: ${workerResult.stderr}` : ""
      }`,
    );
  }

  const { run: coreRun } = await import(
    join(homedir(), ".agents", "skills", "openskills", "skills", "proofverify", "scripts", "verify-attestations.mjs"),
  );
  return coreRun({ request });
}
