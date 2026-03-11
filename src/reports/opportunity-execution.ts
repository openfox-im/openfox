import type {
  OpportunityItem,
} from "../opportunity/scout.js";
import type {
  OpenFoxDatabase,
  OwnerOpportunityActionExecutionRecord,
  OwnerOpportunityActionRecord,
  OwnerOpportunityExecutionTemplate,
  OwnerStrategyExecutionSummary,
} from "../types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getActionFollowUpDepth(
  action: Pick<OwnerOpportunityActionRecord, "payload">,
): number {
  const payload = asRecord(action.payload);
  const raw = payload.followUpDepth;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : 0;
}

export function isFollowUpAction(
  action: Pick<OwnerOpportunityActionRecord, "payload">,
): boolean {
  return getActionFollowUpDepth(action) > 0;
}

export function isFollowUpExecution(
  execution: Pick<OwnerOpportunityActionExecutionRecord, "requestPayload" | "resultPayload">,
): boolean {
  const requestPayload = asRecord(execution.requestPayload);
  const resultPayload = asRecord(execution.resultPayload);
  const requestDepth = requestPayload.followUpDepth;
  const resultDepth = resultPayload.followUpDepth;
  return (
    (typeof requestDepth === "number" && Number.isFinite(requestDepth) && requestDepth > 0) ||
    (typeof resultDepth === "number" && Number.isFinite(resultDepth) && resultDepth > 0)
  );
}

export function buildOpportunityExecutionTemplate(
  item: OpportunityItem,
): OwnerOpportunityExecutionTemplate {
  if (item.kind === "bounty" && item.baseUrl && item.bountyId) {
    return {
      executionCapable: true,
      ready: true,
      actionKind: "pursue",
      executionKind: "remote_bounty_solve",
      targetKind: "bounty",
      targetRef: item.bountyId,
      capability: item.capability ?? null,
      remoteBaseUrl: item.baseUrl,
      reason: "Submit one bounded solver response for this bounty.",
      followUpEligible: false,
      requiresOperatorInput: false,
      inputHint: null,
    };
  }
  if (item.kind === "campaign" && item.baseUrl && item.campaignId) {
    return {
      executionCapable: true,
      ready: true,
      actionKind: "pursue",
      executionKind: "remote_campaign_solve",
      targetKind: "campaign",
      targetRef: item.campaignId,
      capability: item.capability ?? null,
      remoteBaseUrl: item.baseUrl,
      reason: "Submit one bounded solver response to the best open campaign bounty.",
      followUpEligible: true,
      requiresOperatorInput: false,
      inputHint: null,
    };
  }
  if (
    item.kind === "provider" &&
    item.providerClass === "oracle" &&
    item.baseUrl &&
    item.capability
  ) {
    return {
      executionCapable: true,
      ready: true,
      actionKind: "delegate",
      executionKind: "remote_oracle_request",
      targetKind: "provider",
      targetRef: item.providerAgentId ?? item.capability ?? item.baseUrl,
      capability: item.capability,
      remoteBaseUrl: item.baseUrl,
      reason: "Issue one bounded oracle request using the recommendation title as the query.",
      followUpEligible: false,
      requiresOperatorInput: false,
      inputHint: null,
    };
  }
  if (
    item.kind === "provider" &&
    item.providerClass === "observation" &&
    item.baseUrl &&
    item.capability
  ) {
    return {
      executionCapable: true,
      ready: false,
      actionKind: "delegate",
      executionKind: "remote_observation_request",
      targetKind: "provider",
      targetRef: item.providerAgentId ?? item.capability ?? item.baseUrl,
      capability: item.capability,
      remoteBaseUrl: item.baseUrl,
      reason: "Issue one bounded observation request after choosing a concrete target URL.",
      followUpEligible: false,
      requiresOperatorInput: true,
      inputHint: "Set payload.targetUrl before auto-executing this observation request.",
    };
  }
  return {
    executionCapable: false,
    ready: false,
    actionKind: "review",
    capability: item.capability ?? null,
    remoteBaseUrl: item.baseUrl ?? null,
    reason: "Review this opportunity manually before taking action.",
    followUpEligible: false,
    requiresOperatorInput: false,
    inputHint: null,
  };
}

export function buildOwnerStrategyExecutionSummary(params: {
  db: OpenFoxDatabase;
  config: {
    autoExecutePursue: boolean;
    autoExecuteDelegate: boolean;
    autoQueueFollowUps: boolean;
    maxFollowUpDepth: number;
    maxFollowUpsPerRun: number;
  };
}): OwnerStrategyExecutionSummary {
  const recentActions = params.db.listOwnerOpportunityActions(10);
  const recentExecutions = params.db.listOwnerOpportunityActionExecutions(10);
  const queuedActions = params.db.listOwnerOpportunityActions(100, {
    status: "queued",
  }).length;
  const runningExecutions = params.db.listOwnerOpportunityActionExecutions(100, {
    status: "running",
  }).length;
  const recentFollowUpActions = recentActions.filter((item) => isFollowUpAction(item)).length;
  const queuedFollowUpActions = params.db
    .listOwnerOpportunityActions(100, { status: "queued" })
    .filter((item) => isFollowUpAction(item)).length;
  const recentFollowUpExecutions = recentExecutions.filter((item) =>
    isFollowUpExecution(item),
  ).length;
  return {
    autoExecutePursue: params.config.autoExecutePursue,
    autoExecuteDelegate: params.config.autoExecuteDelegate,
    autoQueueFollowUps: params.config.autoQueueFollowUps,
    maxFollowUpDepth: params.config.maxFollowUpDepth,
    maxFollowUpsPerRun: params.config.maxFollowUpsPerRun,
    queuedActions,
    runningExecutions,
    recentActions: recentActions.map((item) => ({
      actionId: item.actionId,
      kind: item.kind,
      status: item.status,
      title: item.title,
      resolutionKind: item.resolutionKind ?? null,
      resolutionRef: item.resolutionRef ?? null,
      followUpDepth: getActionFollowUpDepth(item),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    recentExecutions: recentExecutions.map((item) => ({
      executionId: item.executionId,
      actionId: item.actionId,
      kind: item.kind,
      status: item.status,
      targetKind: item.targetKind,
      targetRef: item.targetRef,
      executionRef: item.executionRef ?? null,
      followUp: isFollowUpExecution(item),
      updatedAt: item.updatedAt,
    })),
    recentFollowUpActions,
    queuedFollowUpActions,
    recentFollowUpExecutions,
  };
}
