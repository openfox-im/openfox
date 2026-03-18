/**
 * OpenFox integration wrapper for zktls.prove.
 *
 * Prefer the configured Rust CLI worker. When the worker is unavailable,
 * this backend fails so the provider shell can decide whether to fall back
 * to a weaker bounded-integrity path.
 */
import { URL } from "node:url";
import { runCliWorker, unwrapCliWorkerResult } from "../../_shared/cli-worker.mjs";

export async function run(input, context) {
  const request = input?.request;
  if (!request) throw new Error("missing input.request");
  const worker = context?.config?.agentDiscovery?.newsFetchServer?.zktlsWorker;
  if (!worker?.command) {
    throw new Error("zktls.prove requires agentDiscovery.newsFetchServer.zktlsWorker");
  }
  if (!request.source_url) throw new Error("missing request.source_url");
  const sourceUrl = new URL(request.source_url);
  const capture = input?.capture ?? {};
  const workerResult = await runCliWorker(worker, {
    schema_version: "openfox.cli-worker.v1",
    worker: "zktls.prove",
    request_id: request.request_nonce || `zktls-prove-${Date.now()}`,
    request,
    capture,
    options: {
      sourcePolicyId:
        request.source_policy_id ||
        context?.config?.agentDiscovery?.newsFetchServer?.defaultSourcePolicyId ||
        null,
    },
    context: {
      fetchedAt: Number(input?.fetchedAt || Math.floor(Date.now() / 1000)),
      serverHost: sourceUrl.hostname,
      serverPort: sourceUrl.port ? Number(sourceUrl.port) : 443,
      method: "GET",
      path: `${sourceUrl.pathname || "/"}${sourceUrl.search || ""}`,
    },
  });
  if (workerResult.exitCode !== 0) {
    throw new Error(
      `zktls.prove CLI worker failed with exit code ${workerResult.exitCode}${
        workerResult.stderr ? `: ${workerResult.stderr}` : ""
      }`,
    );
  }

  return unwrapCliWorkerResult(workerResult.stdout, "zktls.prove");
}
