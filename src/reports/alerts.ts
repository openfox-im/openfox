import { keccak256, toHex } from "tosdk";
import { ulid } from "ulid";
import { createOperatorApprovalRequest } from "../operator/autopilot.js";
import {
  collectOpportunityItems,
  rankOpportunityItems,
  type OpportunityItem,
} from "../opportunity/scout.js";
import { buildOpportunityExecutionTemplate } from "./opportunity-execution.js";
import { getCurrentStrategyProfile } from "../opportunity/strategy.js";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OwnerOpportunityActionKind,
  OwnerOpportunityAlertRecord,
} from "../types.js";

function buildOpportunityHash(item: OpportunityItem): `0x${string}` {
  return keccak256(
    toHex(
      JSON.stringify({
        kind: item.kind,
        providerClass: item.providerClass,
        title: item.title,
        capability: item.capability ?? null,
        baseUrl: item.baseUrl ?? null,
        bountyId: item.bountyId ?? null,
        campaignId: item.campaignId ?? null,
        providerAgentId: item.providerAgentId ?? null,
        providerAddress: item.providerAddress ?? null,
      }),
    ),
  );
}

function buildSuggestedAction(item: OpportunityItem): string {
  if (item.kind === "campaign") {
    return "Review the campaign and open the most attractive bounded task under the current strategy.";
  }
  if (item.kind === "bounty") {
    return "Open the bounty details and submit a bounded solver response if it fits the current strategy.";
  }
  if (item.providerClass === "observation" || item.providerClass === "oracle") {
    return "Inspect the provider and issue one paid request if the result is worth the expected cost.";
  }
  if (item.providerClass === "sponsored_execution") {
    return "Inspect the sponsored execution policy and use it only if the trust tier and caps fit the strategy.";
  }
  if (item.providerClass === "storage_artifacts") {
    return "Inspect storage or artifact routes and decide whether this provider should be part of the current operating set.";
  }
  return "Inspect this opportunity and take one bounded action if it fits the current strategy and policy.";
}

function buildSummary(item: OpportunityItem): string {
  const reward = item.rewardWei ? `reward=${item.rewardWei}` : "reward=n/a";
  const margin = `margin=${item.marginWei}`;
  const score =
    item.strategyScore == null ? "score=n/a" : `score=${item.strategyScore}`;
  const trust = `trust=${item.trustTier}`;
  const capability = item.capability ? ` capability=${item.capability}` : "";
  return `${reward} ${margin} ${score} ${trust}${capability} — ${item.description}`;
}

function shouldSkipByDedupe(params: {
  existing?: OwnerOpportunityAlertRecord;
  dedupeHours: number;
  nowMs: number;
}): boolean {
  if (!params.existing) return false;
  const updatedAtMs = Date.parse(params.existing.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return params.nowMs - updatedAtMs < params.dedupeHours * 3_600_000;
}

export interface OwnerOpportunityAlertGenerationResult {
  created: number;
  skipped: number;
  items: OwnerOpportunityAlertRecord[];
}

export function queueOwnerOpportunityAlertAction(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  alertId: string;
  actionKind: OwnerOpportunityActionKind;
  requestedBy?: string;
  reason?: string;
  ttlSeconds?: number;
}): {
  alert: OwnerOpportunityAlertRecord;
  request: ReturnType<typeof createOperatorApprovalRequest>;
} {
  const alert = params.db.getOwnerOpportunityAlert(params.alertId);
  if (!alert) {
    throw new Error(`Owner opportunity alert not found: ${params.alertId}`);
  }
  if (alert.actionRequestId) {
    const existing = params.db.getOperatorApprovalRequest(alert.actionRequestId);
    if (existing) {
      return { alert, request: existing };
    }
  }
  const request = createOperatorApprovalRequest({
    db: params.db,
    config: params.config,
    kind: "opportunity_action",
    scope: `owner-alert:${alert.alertId}:${params.actionKind}`,
    requestedBy: params.requestedBy?.trim() || "owner-alert",
    reason:
      params.reason?.trim() ||
      `${params.actionKind} opportunity alert: ${alert.title}`,
    payload: {
      alertId: alert.alertId,
      opportunityHash: alert.opportunityHash,
      actionKind: params.actionKind,
      title: alert.title,
      summary: alert.summary,
      suggestedAction: alert.suggestedAction,
      capability: alert.capability ?? null,
      baseUrl: alert.baseUrl ?? null,
      payload: alert.payload,
    },
    ttlSeconds: params.ttlSeconds,
  });
  const linked =
    params.db.linkOwnerOpportunityAlertActionRequest(
      alert.alertId,
      params.actionKind,
      request.requestId,
    ) ?? alert;
  if (linked.status === "unread") {
    params.db.updateOwnerOpportunityAlertStatus(alert.alertId, "read");
  }
  const updated = params.db.getOwnerOpportunityAlert(alert.alertId) ?? linked;
  return { alert: updated, request };
}

export async function generateOwnerOpportunityAlerts(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  nowMs?: number;
  items?: OpportunityItem[];
}): Promise<OwnerOpportunityAlertGenerationResult> {
  const alertsConfig = params.config.ownerReports?.alerts;
  if (!params.config.ownerReports?.enabled || !alertsConfig?.enabled) {
    return { created: 0, skipped: 0, items: [] };
  }

  const strategy = getCurrentStrategyProfile(params.db);
  if (!strategy) {
    return { created: 0, skipped: 0, items: [] };
  }

  const nowMs = params.nowMs ?? Date.now();
  const items =
    params.items ??
    (await collectOpportunityItems({
      config: params.config,
      db: params.db,
    }));
  const ranked = rankOpportunityItems({
    items,
    strategy,
    maxItems: alertsConfig.maxItemsPerRun,
  });

  const selected = ranked.filter((item) => {
    if (alertsConfig.requireStrategyMatched && item.strategyMatched !== true) {
      return false;
    }
    if ((item.strategyScore ?? Number.NEGATIVE_INFINITY) < alertsConfig.minStrategyScore) {
      return false;
    }
    if (item.marginBps < alertsConfig.minMarginBps) {
      return false;
    }
    return true;
  });

  const created: OwnerOpportunityAlertRecord[] = [];
  let skipped = 0;

  for (const item of selected) {
    const opportunityHash = buildOpportunityHash(item);
    const existing =
      params.db.getLatestOwnerOpportunityAlertByOpportunityHash(opportunityHash);
    if (
      shouldSkipByDedupe({
        existing,
        dedupeHours: alertsConfig.dedupeHours,
        nowMs,
      })
    ) {
      skipped += 1;
      continue;
    }
    const nowIso = new Date(nowMs).toISOString();
    const executionTemplate = buildOpportunityExecutionTemplate(item);
    const record: OwnerOpportunityAlertRecord = {
      alertId: `owner-alert:${ulid()}`,
      opportunityHash,
      kind: item.kind,
      providerClass: item.providerClass,
      trustTier: item.trustTier,
      title: item.title,
      summary: buildSummary(item),
      suggestedAction: buildSuggestedAction(item),
      capability: item.capability ?? null,
      baseUrl: item.baseUrl ?? null,
      rewardWei: item.rewardWei ?? null,
      estimatedCostWei: item.estimatedCostWei,
      marginWei: item.marginWei,
      marginBps: item.marginBps,
      strategyScore: item.strategyScore ?? null,
      strategyMatched: item.strategyMatched === true,
      strategyReasons: item.strategyReasons ?? [],
      payload: {
        ...item,
        executionTemplate,
        ...(executionTemplate.executionKind === "remote_oracle_request"
          ? {
              query: item.title,
              context: item.description,
            }
          : {}),
      },
      status: "unread",
      actionKind: null,
      actionRequestId: null,
      actionRequestedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      readAt: null,
      dismissedAt: null,
    };
    params.db.upsertOwnerOpportunityAlert(record);
    created.push(record);
  }

  return {
    created: created.length,
    skipped,
    items: created,
  };
}
