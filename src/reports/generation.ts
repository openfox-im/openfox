import { keccak256, toHex } from "tosdk";
import type {
  InferenceClient,
  OpenFoxConfig,
  OpenFoxDatabase,
  OwnerFinanceSnapshotRecord,
  OwnerGeneratedNarrative,
  OwnerReportData,
  OwnerReportInput,
  OwnerReportPeriodKind,
  OwnerReportRecord,
} from "../types.js";
import {
  getCurrentStrategyProfile,
} from "../opportunity/strategy.js";
import {
  collectOpportunityItems,
  rankOpportunityItems,
} from "../opportunity/scout.js";
import {
  buildOpportunityExecutionTemplate,
  buildOwnerStrategyExecutionSummary,
} from "./opportunity-execution.js";
import {
  buildOwnerFinanceSnapshot,
  persistOwnerFinanceSnapshot,
} from "./finance.js";
import { buildEvidenceWorkflowSummary } from "../evidence-workflow/summary.js";
import { buildOracleSummary } from "../agent-discovery/oracle-summary.js";

function inferProviderName(config: OpenFoxConfig): string | null {
  const modelRef = config.inferenceModelRef || config.inferenceModel;
  if (modelRef.includes("/")) {
    return modelRef.split("/")[0] || null;
  }
  if (config.openaiApiKey) return "openai";
  if (config.anthropicApiKey) return "anthropic";
  if (config.ollamaBaseUrl) return "ollama";
  return config.runtimeApiKey ? "runtime" : null;
}

function buildReportId(
  periodKind: OwnerReportPeriodKind,
  financeSnapshotId: string,
): string {
  return `owner-report:${periodKind}:${financeSnapshotId}`;
}

function buildInputHash(input: OwnerReportInput): `0x${string}` {
  return keccak256(toHex(JSON.stringify(input)));
}

function normalizeNarrative(value: unknown): OwnerGeneratedNarrative | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const recommendations = Array.isArray(record.recommendations)
    ? record.recommendations
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
  const overview =
    typeof record.overview === "string" ? record.overview.trim() : "";
  const gains = typeof record.gains === "string" ? record.gains.trim() : "";
  const losses = typeof record.losses === "string" ? record.losses.trim() : "";
  const opportunityDigest =
    typeof record.opportunityDigest === "string"
      ? record.opportunityDigest.trim()
      : "";
  const anomalies =
    typeof record.anomalies === "string" ? record.anomalies.trim() : "";
  if (
    !overview &&
    !gains &&
    !losses &&
    !opportunityDigest &&
    !anomalies &&
    recommendations.length === 0
  ) {
    return null;
  }
  return {
    overview,
    gains,
    losses,
    opportunityDigest,
    anomalies,
    recommendations,
  };
}

function tryParseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const match = trimmed.match(/\{[\s\S]*\}$/);
  if (match) candidates.push(match[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function buildOwnerReportInput(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  periodKind: OwnerReportPeriodKind;
  nowMs?: number;
}): Promise<{
  financeSnapshot: OwnerFinanceSnapshotRecord;
  input: OwnerReportInput;
}> {
  let financeSnapshot: OwnerFinanceSnapshotRecord;
  if (params.config.ownerReports?.persistSnapshots === false) {
    const payload = await buildOwnerFinanceSnapshot({
      config: params.config,
      db: params.db,
      periodKind: params.periodKind,
      nowMs: params.nowMs,
    });
    financeSnapshot = {
      snapshotId: `owner-finance:${params.periodKind}:${payload.periodStart}`,
      periodKind: params.periodKind,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      payload,
      createdAt: payload.generatedAt,
      updatedAt: payload.generatedAt,
    };
  } else {
    financeSnapshot = await persistOwnerFinanceSnapshot({
      config: params.config,
      db: params.db,
      periodKind: params.periodKind,
      nowMs: params.nowMs,
    });
  }
  const strategy = getCurrentStrategyProfile(params.db);
  const opportunityItems = await collectOpportunityItems({
    config: params.config,
    db: params.db,
  });
  const ranked = strategy
    ? rankOpportunityItems({
        items: opportunityItems,
        strategy,
        maxItems: params.config.opportunityScout?.maxItems ?? 10,
      })
    : opportunityItems.slice(0, params.config.opportunityScout?.maxItems ?? 10);
  const opportunities = ranked.slice(0, 10).map((item) => ({
    title: item.title,
    kind: item.kind,
    providerClass: item.providerClass,
    trustTier: item.trustTier,
    capability: item.capability ?? null,
    baseUrl: item.baseUrl ?? null,
    rewardWei: item.rewardWei ?? null,
    marginWei: item.marginWei ?? null,
    marginBps: item.marginBps ?? null,
    strategyScore: item.strategyScore ?? null,
    strategyMatched: item.strategyMatched ?? null,
    strategyReasons: item.strategyReasons ?? [],
    executionTemplate: buildOpportunityExecutionTemplate(item),
  }));
  const actionExecution = params.config.ownerReports?.actionExecution;
  const strategyExecution = buildOwnerStrategyExecutionSummary({
    db: params.db,
    config: {
      autoExecutePursue: actionExecution?.autoExecutePursue === true,
      autoExecuteDelegate: actionExecution?.autoExecuteDelegate === true,
      autoQueueFollowUps: actionExecution?.autoQueueFollowUps === true,
      maxFollowUpDepth: actionExecution?.maxFollowUpDepth ?? 0,
      maxFollowUpsPerRun: actionExecution?.maxFollowUpsPerRun ?? 0,
    },
  });
  const evidence = buildEvidenceWorkflowSummary({ db: params.db, limit: 20 });
  const oracle = buildOracleSummary({ db: params.db, limit: 20 });

  return {
    financeSnapshot,
    input: {
      generatedAt: new Date(params.nowMs ?? Date.now()).toISOString(),
      periodKind: params.periodKind,
      finance: financeSnapshot.payload,
      strategy: strategy ?? null,
      strategyExecution,
      evidenceOracle: {
        evidence: {
          totalRuns: evidence.totalRuns,
          completedRuns: evidence.completedRuns,
          failedRuns: evidence.failedRuns,
          validSources: evidence.validSources,
          attemptedSources: evidence.attemptedSources,
          aggregatePublished: evidence.aggregatePublished,
          estimatedCostWei: evidence.estimatedCostWei,
          zktlsBundles: evidence.zktlsBundles,
          proofVerifications: evidence.proofVerifications,
          cryptographicVerifications: evidence.cryptographicVerifications,
          committeeRuns: evidence.committeeRuns,
          committeeQuorumMet: evidence.committeeQuorumMet,
          summary: evidence.summary,
        },
        oracle: {
          totalResults: oracle.totalResults,
          queryKinds: oracle.queryKinds,
          settledResults: oracle.settledResults,
          marketBoundResults: oracle.marketBoundResults,
          averageConfidence: oracle.averageConfidence,
          estimatedCostWei: oracle.estimatedCostWei,
          committeeRuns: oracle.committeeRuns,
          committeeQuorumMet: oracle.committeeQuorumMet,
          committeeDisagreements: oracle.committeeDisagreements,
          committeePayoutWei: oracle.committeePayoutWei,
          summary: oracle.summary,
        },
        summary: `${evidence.summary} ${oracle.summary}`.trim(),
      },
      opportunities,
    },
  };
}

export async function generateOwnerReport(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  inference?: InferenceClient;
  periodKind: OwnerReportPeriodKind;
  nowMs?: number;
}): Promise<OwnerReportRecord> {
  const { financeSnapshot, input } = await buildOwnerReportInput(params);
  const reportId = buildReportId(params.periodKind, financeSnapshot.snapshotId);
  const inputHash = buildInputHash(input);
  const provider = inferProviderName(params.config);
  const model =
    params.config.inferenceModelRef || params.config.inferenceModel || null;
  let narrative: OwnerGeneratedNarrative | null = null;
  let generationStatus: OwnerReportRecord["generationStatus"] =
    "deterministic_only";

  if (params.config.ownerReports?.generateWithInference && params.inference) {
    const response = await params.inference.chat(
      [
        {
          role: "system",
          content:
            "You generate structured owner reports for OpenFox. Use only the deterministic JSON input. Return strict JSON with keys overview, gains, losses, opportunityDigest, anomalies, recommendations.",
        },
        {
          role: "user",
          content: JSON.stringify(input, null, 2),
        },
      ],
      {
        maxTokens: 1200,
        temperature: 0.2,
      },
    );
    const content = response.message.content || "";
    const parsed = tryParseJsonObject(content);
    narrative = normalizeNarrative(parsed ?? { overview: content.trim() });
    generationStatus = narrative ? "generated" : "deterministic_only";
  }

  const payload: OwnerReportData = {
    reportId,
    periodKind: params.periodKind,
    financeSnapshotId: financeSnapshot.snapshotId,
    generatedAt: new Date(params.nowMs ?? Date.now()).toISOString(),
    generationStatus,
    inputHash,
    provider,
    model,
    input,
    narrative,
  };

  const record: OwnerReportRecord = {
    reportId,
    periodKind: params.periodKind,
    financeSnapshotId: financeSnapshot.snapshotId,
    provider,
    model,
    inputHash,
    generationStatus,
    payload,
    createdAt: payload.generatedAt,
    updatedAt: payload.generatedAt,
  };

  params.db.upsertOwnerReport(record);
  return record;
}
