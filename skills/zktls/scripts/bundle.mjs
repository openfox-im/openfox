/**
 * OpenFox integration wrapper for zktls.bundle.
 *
 * Adds CLI worker routing on top of the openskills core implementation.
 * When no worker is configured, delegates to the openskills bundle logic.
 */
import { createHash } from "node:crypto";
import { runCliWorker, unwrapCliWorkerResult } from "../../_shared/cli-worker.mjs";

export async function run(input, context) {
  // CLI worker routing (OpenFox-specific)
  const worker = context?.config?.agentDiscovery?.newsFetchServer?.zktlsWorker;
  if (worker?.command) {
    const workerResult = await runCliWorker(worker, {
      schema_version: "openfox.cli-worker.v1",
      worker: "zktls.bundle",
      request_id: input?.request?.request_nonce || `newsfetch-${Date.now()}`,
      request: input?.request ?? {},
      capture: input?.capture ?? {},
      proof: input?.proof ?? null,
      options: {
        sourcePolicyId:
          input?.request?.source_policy_id ||
          context?.config?.agentDiscovery?.newsFetchServer?.defaultSourcePolicyId ||
          context?.config?.agentDiscovery?.newsFetchServer?.capability ||
          "news.fetch",
        maxBundleBytes: worker.maxStdoutBytes || 1024 * 1024,
      },
      context: {
        fetchedAt: Number(input?.fetchedAt || Math.floor(Date.now() / 1000)),
      },
    });
    if (workerResult.exitCode !== 0) {
      throw new Error(
        `zktls.bundle CLI worker failed with exit code ${workerResult.exitCode}${
          workerResult.stderr ? `: ${workerResult.stderr}` : ""
        }`,
      );
    }
    return unwrapCliWorkerResult(workerResult.stdout, "zktls.bundle");
  }

  // Core bundling logic (same as openskills/zktls bundle)
  const request = input?.request ?? {};
  const capture = input?.capture ?? {};
  const fetchedAt = Number(input?.fetchedAt || Math.floor(Date.now() / 1000));
  const bundle = {
    version: 1,
    backend: "skill:zktls.bundle",
    fetched_at: fetchedAt,
    source_url: request.source_url,
    canonical_url: capture.canonicalUrl || request.source_url,
    source_policy_id:
      request.source_policy_id ||
      context?.config?.agentDiscovery?.newsFetchServer?.defaultSourcePolicyId ||
      null,
    publisher_hint: request.publisher_hint || null,
    headline_hint: request.headline_hint || null,
    http_status: capture.httpStatus,
    content_type: capture.contentType,
    article_sha256: capture.articleSha256,
    zktls_attestation_sha256: input?.proof?.attestationSha256 || null,
    zktls_attestation: input?.proof?.attestation || null,
    headline: capture.headline || null,
    publisher: capture.publisher || null,
    article_preview: capture.articleText || null,
  };
  const encoded = JSON.stringify(bundle);
  return {
    format: "skill_zktls_bundle_v1",
    bundle,
    bundleSha256: `0x${createHash("sha256").update(encoded).digest("hex")}`,
    originClaims: {
      sourceUrl: request.source_url,
      canonicalUrl: capture.canonicalUrl || request.source_url,
      sourcePolicyId:
        request.source_policy_id ||
        context?.config?.agentDiscovery?.newsFetchServer?.defaultSourcePolicyId ||
        null,
      sourcePolicyHost:
        (() => {
          try {
            return new URL(capture.canonicalUrl || request.source_url).hostname.toLowerCase();
          } catch {
            return null;
          }
        })(),
      publisherHint: request.publisher_hint || null,
      headlineHint: request.headline_hint || null,
      publisher: capture.publisher || null,
      headline: capture.headline || null,
      fetchedAt,
      httpStatus: capture.httpStatus,
      contentType: capture.contentType,
    },
    verifierMaterialReferences: input?.proof?.attestation
      ? [
          {
            kind: "tlsn.attestation",
            ref: `inline://attestation/${input?.proof?.attestationSha256 || "unknown"}`,
            hash: input?.proof?.attestationSha256 || null,
            metadata: {
              serverName: input?.proof?.serverName || null,
              sentLen: input?.proof?.sentLen ?? null,
              recvLen: input?.proof?.recvLen ?? null,
            },
          },
        ]
      : [],
    integrity: {
      bundleSha256: `0x${createHash("sha256").update(encoded).digest("hex")}`,
      articleSha256: capture.articleSha256 || null,
      sourceResponseSha256: capture.articleSha256 || null,
    },
    backend: "skill:zktls.bundle",
  };
}
