import type { OpenFoxDatabase } from "../types.js";
import type { EvidenceWorkflowRunRecord } from "./coordinator.js";
import { createCommitteeManager } from "../committee/manager.js";
import { buildProofVerificationSummary, buildZkTlsBundleSummary } from "../proof-market/records.js";

function listEvidenceWorkflowRuns(
  db: OpenFoxDatabase,
  limit = 20,
): EvidenceWorkflowRunRecord[] {
  const rows = db.raw
    .prepare("SELECT value FROM kv WHERE key LIKE ? ORDER BY key DESC LIMIT ?")
    .all("evidence_workflow:index:%", Math.max(1, limit)) as Array<{ value: string }>;
  return rows
    .map((row) => db.getKV(row.value.startsWith("evidence_workflow:run:") ? row.value : `evidence_workflow:run:${row.value}`))
    .filter((raw): raw is string => typeof raw === "string" && raw.length > 0)
    .map((raw) => JSON.parse(raw) as EvidenceWorkflowRunRecord);
}

function sumPriceTomi(...values: Array<string | undefined>): bigint {
  return values.reduce((acc, value) => {
    if (!value || !/^[0-9]+$/.test(value)) return acc;
    return acc + BigInt(value);
  }, 0n);
}

export interface EvidenceWorkflowSummarySnapshot {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  validSources: number;
  attemptedSources: number;
  aggregatePublished: number;
  estimatedCostTomi: string;
  zktlsBundles: number;
  proofVerifications: number;
  nativeAttestedVerifications: number;
  committeeVerifiedResults: number;
  fallbackOnlyVerifications: number;
  committeeRuns: number;
  committeeQuorumMet: number;
  latestRunId: string | null;
  latestUpdatedAt: string | null;
  runs: EvidenceWorkflowRunRecord[];
  summary: string;
}

export function buildEvidenceWorkflowSummary(params: {
  db: OpenFoxDatabase;
  limit?: number;
}): EvidenceWorkflowSummarySnapshot {
  const runs = listEvidenceWorkflowRuns(params.db, params.limit ?? 20);
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const validSources = runs.reduce((acc, run) => acc + run.validCount, 0);
  const attemptedSources = runs.reduce((acc, run) => acc + run.attemptedCount, 0);
  const aggregatePublished = runs.filter(
    (run) => Boolean(run.aggregateObjectId || run.aggregateResultUrl),
  ).length;
  const zktls = buildZkTlsBundleSummary(params.db, params.limit ?? 20);
  const proofs = buildProofVerificationSummary(params.db, params.limit ?? 20);
  const committees = createCommitteeManager(params.db).buildSummary(
    params.limit ?? 20,
    "evidence",
  );
  const estimatedCostTomi = runs
    .reduce((acc, run) => {
      const sourceCost = run.sourceRecords.reduce((inner, source) => {
        return (
          inner +
          sumPriceTomi(source.fetchResponse?.price_tomi, source.verifyResponse?.price_tomi)
        );
      }, 0n);
      return acc + sourceCost + sumPriceTomi(run.aggregateResponse?.price_tomi);
    }, 0n)
    .toString();
  const latest = runs[0] ?? null;
  return {
    totalRuns: runs.length,
    completedRuns,
    failedRuns,
    validSources,
    attemptedSources,
    aggregatePublished,
    estimatedCostTomi,
    zktlsBundles: zktls.totalBundles,
    proofVerifications: proofs.totalResults,
    nativeAttestedVerifications: proofs.nativeAttestationVerifications,
    committeeVerifiedResults: proofs.committeeVerifiedResults,
    fallbackOnlyVerifications: proofs.fallbackIntegrityVerifications,
    committeeRuns: committees.totalRuns,
    committeeQuorumMet: committees.quorumMet,
    latestRunId: latest?.runId ?? null,
    latestUpdatedAt: latest?.updatedAt ?? null,
    runs,
    summary:
      runs.length === 0
        ? "No evidence workflow runs recorded."
        : `${runs.length} workflow run(s), completed=${completedRuns}, failed=${failedRuns}, valid_sources=${validSources}/${attemptedSources}, aggregate_published=${aggregatePublished}, zktls=${zktls.totalBundles}, proofs=${proofs.totalResults}, committee_runs=${committees.totalRuns}.`,
  };
}

export function buildEvidenceWorkflowSummaryReport(
  snapshot: EvidenceWorkflowSummarySnapshot,
): string {
  const lines = [
    "=== OPENFOX EVIDENCE SUMMARY ===",
    `Runs:            ${snapshot.totalRuns}`,
    `Completed:       ${snapshot.completedRuns}`,
    `Failed:          ${snapshot.failedRuns}`,
    `Valid sources:   ${snapshot.validSources}/${snapshot.attemptedSources}`,
    `Aggregates:      ${snapshot.aggregatePublished}`,
    `Estimated cost:  ${snapshot.estimatedCostTomi} tomi`,
    `zkTLS bundles:   ${snapshot.zktlsBundles}`,
    `Proof results:   ${snapshot.proofVerifications} (${snapshot.nativeAttestedVerifications} native, ${snapshot.committeeVerifiedResults} committee, ${snapshot.fallbackOnlyVerifications} fallback)`,
    `Committees:      ${snapshot.committeeRuns} (${snapshot.committeeQuorumMet} quorum met)`,
    `Latest run:      ${snapshot.latestRunId || "(none)"}`,
    `Latest updated:  ${snapshot.latestUpdatedAt || "(none)"}`,
    "",
    `Summary: ${snapshot.summary}`,
  ];
  return lines.join("\n");
}
