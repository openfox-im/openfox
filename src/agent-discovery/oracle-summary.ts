import type { OpenFoxDatabase } from "../types.js";
import type { OracleResolutionResponse } from "./types.js";
import { createCommitteeManager } from "../committee/manager.js";

export interface StoredOracleJobSummary {
  resultId: string;
  request: {
    query: string;
    query_kind: string;
  };
  response: OracleResolutionResponse;
  createdAt: string;
}

export function listStoredOracleJobs(
  db: OpenFoxDatabase,
  limit = 20,
): StoredOracleJobSummary[] {
  const rows = db.raw
    .prepare("SELECT key, value FROM kv WHERE key LIKE ? ORDER BY key DESC LIMIT ?")
    .all("agent_discovery:oracle:job:%", Math.max(1, limit)) as Array<{
      key: string;
      value: string;
    }>;
  return rows.map((row) => JSON.parse(row.value) as StoredOracleJobSummary);
}

export function getStoredOracleJob(
  db: OpenFoxDatabase,
  resultId: string,
): StoredOracleJobSummary | null {
  const raw = db.getKV(`agent_discovery:oracle:job:${resultId}`);
  return raw ? (JSON.parse(raw) as StoredOracleJobSummary) : null;
}

export interface OracleSummarySnapshot {
  totalResults: number;
  queryKinds: Record<string, number>;
  settledResults: number;
  marketBoundResults: number;
  averageConfidence: number;
  estimatedCostTomi: string;
  committeeRuns: number;
  committeeQuorumMet: number;
  committeeDisagreements: number;
  committeePayoutTomi: string;
  latestResultId: string | null;
  latestResolvedAt: number | null;
  items: StoredOracleJobSummary[];
  summary: string;
}

export function buildOracleSummary(params: {
  db: OpenFoxDatabase;
  limit?: number;
}): OracleSummarySnapshot {
  const items = listStoredOracleJobs(params.db, params.limit ?? 20);
  const queryKinds: Record<string, number> = {};
  let settledResults = 0;
  let marketBoundResults = 0;
  let confidenceTotal = 0;
  let confidenceCount = 0;
  let estimatedCostTomi = 0n;
  const committees = createCommitteeManager(params.db).buildSummary(
    params.limit ?? 20,
    "oracle",
  );

  for (const item of items) {
    queryKinds[item.response.query_kind] = (queryKinds[item.response.query_kind] || 0) + 1;
    if (item.response.settlement_tx_hash) settledResults += 1;
    if (item.response.market_callback_tx_hash || item.response.binding_hash) {
      marketBoundResults += 1;
    }
    if (typeof item.response.confidence === "number" && Number.isFinite(item.response.confidence)) {
      confidenceTotal += item.response.confidence;
      confidenceCount += 1;
    }
    if (item.response.price_tomi && /^[0-9]+$/.test(item.response.price_tomi)) {
      estimatedCostTomi += BigInt(item.response.price_tomi);
    }
  }

  const latest = items[0] ?? null;
  return {
    totalResults: items.length,
    queryKinds,
    settledResults,
    marketBoundResults,
    averageConfidence:
      confidenceCount === 0 ? 0 : Number((confidenceTotal / confidenceCount).toFixed(4)),
    estimatedCostTomi: estimatedCostTomi.toString(),
    committeeRuns: committees.totalRuns,
    committeeQuorumMet: committees.quorumMet,
    committeeDisagreements: committees.disagreements,
    committeePayoutTomi: committees.totalPayoutTomi,
    latestResultId: latest?.resultId ?? null,
    latestResolvedAt: latest?.response.resolved_at ?? null,
    items,
    summary:
      items.length === 0
        ? "No oracle results recorded."
        : `${items.length} oracle result(s), settled=${settledResults}, market_bound=${marketBoundResults}, avg_confidence=${confidenceCount === 0 ? "0.0000" : (confidenceTotal / confidenceCount).toFixed(4)}, committee_runs=${committees.totalRuns}, committee_quorum_met=${committees.quorumMet}.`,
  };
}

export function buildOracleSummaryReport(snapshot: OracleSummarySnapshot): string {
  const lines = [
    "=== OPENFOX ORACLE SUMMARY ===",
    `Results:         ${snapshot.totalResults}`,
    `Settled:         ${snapshot.settledResults}`,
    `Market bound:    ${snapshot.marketBoundResults}`,
    `Avg confidence:  ${snapshot.averageConfidence.toFixed(4)}`,
    `Estimated cost:  ${snapshot.estimatedCostTomi} tomi`,
    `Committees:      ${snapshot.committeeRuns} (${snapshot.committeeQuorumMet} quorum met, ${snapshot.committeeDisagreements} disagreements)`,
    `Committee pay:   ${snapshot.committeePayoutTomi} tomi`,
    `Latest result:   ${snapshot.latestResultId || "(none)"}`,
    `Latest resolved: ${snapshot.latestResolvedAt ?? "(none)"}`,
    `Kinds:           ${
      Object.keys(snapshot.queryKinds).length === 0
        ? "(none)"
        : Object.entries(snapshot.queryKinds)
            .map(([kind, count]) => `${kind}=${count}`)
            .join(", ")
    }`,
    "",
    `Summary: ${snapshot.summary}`,
  ];
  return lines.join("\n");
}
