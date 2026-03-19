import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import type { Address } from "tosdk";
import type {
  BountyRecord,
  InferenceClient,
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
  OwnerOpportunityActionExecutionKind,
  OwnerOpportunityActionExecutionRecord,
  OwnerOpportunityActionRecord,
} from "../types.js";
import {
  fetchRemoteBounty,
  fetchRemoteCampaign,
  solveRemoteBounty,
} from "../bounty/client.js";
import type {
  ObservationInvocationRequest,
  ObservationInvocationResponse,
  OracleResolutionRequest,
  OracleResolutionResponse,
  OracleResolutionQueryKind,
} from "../agent-discovery/types.js";
import { x402Fetch } from "../runtime/x402.js";
import { getActionFollowUpDepth } from "./opportunity-execution.js";

type SupportedActionExecutionPlan =
  | {
      kind: "remote_bounty_solve";
      targetKind: "bounty";
      targetRef: string;
      remoteBaseUrl: string;
      bountyId: string;
    }
  | {
      kind: "remote_campaign_solve";
      targetKind: "campaign";
      targetRef: string;
      remoteBaseUrl: string;
      campaignId: string;
    }
  | {
      kind: "remote_observation_request";
      targetKind: "provider";
      targetRef: string;
      remoteBaseUrl: string;
      capability: string;
      targetUrl: string;
      reason: string;
    }
  | {
      kind: "remote_oracle_request";
      targetKind: "provider";
      targetRef: string;
      remoteBaseUrl: string;
      capability: string;
      query: string;
      queryKind: OracleResolutionQueryKind;
      options?: string[];
      context?: string;
      reason: string;
    };

export interface ExecuteOwnerOpportunityActionResult {
  action: OwnerOpportunityActionRecord;
  execution: OwnerOpportunityActionExecutionRecord;
}

function buildUnsupportedExecutionPlan(
  action: OwnerOpportunityActionRecord,
): SupportedActionExecutionPlan {
  const payload = asRecord(action.payload);
  const nested = nestedPayload(action);
  const remoteBaseUrl = firstString(
    action.baseUrl,
    payload.baseUrl,
    nested.baseUrl,
  ) || "";
  const capability = firstString(action.capability, payload.capability, nested.capability);
  const targetRef =
    firstString(payload.providerAgentId, nested.providerAgentId, capability, remoteBaseUrl, action.actionId) ||
    action.actionId;
  if (action.kind === "delegate") {
    return {
      kind: "remote_observation_request",
      targetKind: "provider",
      targetRef,
      remoteBaseUrl,
      capability: capability || "provider.call",
      targetUrl: firstString(payload.targetUrl, nested.targetUrl) || "",
      reason: "unsupported delegated provider request",
    };
  }
  return {
    kind: "remote_bounty_solve",
    targetKind: "bounty",
    targetRef: action.actionId,
    remoteBaseUrl,
    bountyId: action.actionId,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function nestedPayload(action: OwnerOpportunityActionRecord): Record<string, unknown> {
  const payload = asRecord(action.payload);
  return asRecord(payload.payload);
}

function buildExecutionPlan(
  action: OwnerOpportunityActionRecord,
): SupportedActionExecutionPlan | null {
  const payload = asRecord(action.payload);
  const nested = nestedPayload(action);
  const remoteBaseUrl = firstString(
    action.baseUrl,
    payload.baseUrl,
    nested.baseUrl,
  );
  const capability = firstString(action.capability, payload.capability, nested.capability);
  const targetRef =
    firstString(payload.providerAgentId, nested.providerAgentId, capability, remoteBaseUrl, action.actionId) ||
    action.actionId;
  if (action.kind === "delegate" && remoteBaseUrl && capability) {
    if (capability.startsWith("observation.")) {
      const targetUrl = firstString(payload.targetUrl, nested.targetUrl);
      if (!targetUrl) {
        return null;
      }
      return {
        kind: "remote_observation_request",
        targetKind: "provider",
        targetRef,
        remoteBaseUrl,
        capability,
        targetUrl,
        reason:
          firstString(payload.reason, nested.reason, action.summary, action.title) ||
          "owner delegated paid observation",
      };
    }
    if (capability.startsWith("oracle.")) {
      const query = firstString(payload.query, nested.query, action.summary, action.title);
      if (!query) {
        return null;
      }
      const queryKindRaw = firstString(payload.queryKind, nested.queryKind)?.toLowerCase();
      const queryKind =
        queryKindRaw === "binary" ||
        queryKindRaw === "enum" ||
        queryKindRaw === "scalar" ||
        queryKindRaw === "text"
          ? queryKindRaw
          : "text";
      const optionsValue = Array.isArray(payload.options)
        ? payload.options
        : Array.isArray(nested.options)
          ? nested.options
          : [];
      const options = optionsValue.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      return {
        kind: "remote_oracle_request",
        targetKind: "provider",
        targetRef,
        remoteBaseUrl,
        capability,
        query,
        queryKind,
        options: options.length ? options : undefined,
        context: firstString(payload.context, nested.context),
        reason:
          firstString(payload.reason, nested.reason, action.summary, action.title) ||
          "owner delegated oracle resolution",
      };
    }
    return null;
  }

  if (action.kind !== "pursue") {
    return null;
  }
  const bountyId = firstString(payload.bountyId, nested.bountyId);
  if (remoteBaseUrl && bountyId) {
    return {
      kind: "remote_bounty_solve",
      targetKind: "bounty",
      targetRef: bountyId,
      remoteBaseUrl,
      bountyId,
    };
  }
  const campaignId = firstString(payload.campaignId, nested.campaignId);
  if (remoteBaseUrl && campaignId) {
    return {
      kind: "remote_campaign_solve",
      targetKind: "campaign",
      targetRef: campaignId,
      remoteBaseUrl,
      campaignId,
    };
  }
  return null;
}

async function invokeDirectProvider<TRequest, TResponse>(params: {
  identity: OpenFoxIdentity;
  remoteBaseUrl: string;
  request: TRequest;
}): Promise<TResponse> {
  const result = await x402Fetch(
    params.remoteBaseUrl,
    params.identity.account,
    "POST",
    JSON.stringify(params.request),
    { Accept: "application/json" },
  );
  if (!result.success) {
    throw new Error(result.error || `provider request failed with status ${result.status}`);
  }
  const response =
    typeof result.response === "string"
      ? (JSON.parse(result.response) as TResponse)
      : (result.response as TResponse);
  return response;
}

function resolveSolverSkillInstructions(
  db: OpenFoxDatabase,
  bounty: BountyRecord,
): string | undefined {
  const explicit = bounty.skillName
    ? db.getSkillByName(bounty.skillName)?.instructions
    : undefined;
  if (explicit) return explicit;
  const fallbackName =
    bounty.kind === "translation"
      ? "translation-bounty-solver"
      : bounty.kind === "social_proof"
        ? "social-bounty-solver"
        : bounty.kind === "problem_solving"
          ? "problem-bounty-solver"
          : bounty.kind === "public_news_capture"
            ? "public-news-capture-solver"
            : bounty.kind === "oracle_evidence_capture"
              ? "oracle-evidence-capture-solver"
              : "question-bounty-solver";
  return db.getSkillByName(fallbackName)?.instructions;
}

function extractSubmissionId(
  payload: unknown,
): string | undefined {
  const record = asRecord(payload);
  const submission = asRecord(record.submission);
  return typeof submission.submissionId === "string"
    ? submission.submissionId
    : undefined;
}

function createExecutionRecord(params: {
  action: OwnerOpportunityActionRecord;
  plan: SupportedActionExecutionPlan;
  status: OwnerOpportunityActionExecutionRecord["status"];
  requestPayload: Record<string, unknown>;
  resultPayload?: Record<string, unknown> | null;
  executionRef?: string | null;
  errorMessage?: string | null;
  nowIso?: string;
}): OwnerOpportunityActionExecutionRecord {
  const timestamp = params.nowIso || new Date().toISOString();
  return {
    executionId: `owner-action-exec:${ulid()}`,
    actionId: params.action.actionId,
    kind: params.plan.kind,
    targetKind: params.plan.targetKind,
    targetRef: params.plan.targetRef,
    remoteBaseUrl: params.plan.remoteBaseUrl,
    status: params.status,
    requestPayload: params.requestPayload,
    resultPayload: params.resultPayload ?? null,
    executionRef: params.executionRef ?? null,
    errorMessage: params.errorMessage ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: params.status === "completed" ? timestamp : null,
    failedAt:
      params.status === "failed" || params.status === "skipped" ? timestamp : null,
  };
}

function pickCampaignBounty(
  bounties: BountyRecord[],
): BountyRecord | null {
  const open = bounties.filter((bounty) => bounty.status === "open");
  if (!open.length) return null;
  return open.sort((left, right) => {
    const reward = BigInt(right.rewardTomi) - BigInt(left.rewardTomi);
    if (reward !== 0n) {
      return reward > 0n ? 1 : -1;
    }
    return left.createdAt.localeCompare(right.createdAt);
  })[0] ?? null;
}

function pickNextCampaignBounty(
  bounties: BountyRecord[],
  excludedBountyIds: string[],
): BountyRecord | null {
  const excluded = new Set(excludedBountyIds);
  const open = bounties.filter(
    (bounty) => bounty.status === "open" && !excluded.has(bounty.bountyId),
  );
  if (!open.length) return null;
  return pickCampaignBounty(open);
}

function countQueuedFollowUpsForParent(params: {
  db: OpenFoxDatabase;
  parentActionId: string;
}): number {
  return params.db
    .listOwnerOpportunityActions(200, { status: "queued" })
    .filter((item) => {
      const payload = asRecord(item.payload);
      return payload.parentActionId === params.parentActionId;
    }).length;
}

function queueCampaignFollowUpAction(params: {
  db: OpenFoxDatabase;
  action: OwnerOpportunityActionRecord;
  execution: OwnerOpportunityActionExecutionRecord;
  nextBounty: BountyRecord;
}): OwnerOpportunityActionRecord {
  const nowIso = new Date().toISOString();
  const payload = asRecord(params.action.payload);
  const nextDepth = getActionFollowUpDepth(params.action) + 1;
  const followUpAction: OwnerOpportunityActionRecord = {
    actionId: `owner-action:${ulid()}`,
    alertId: `owner-followup-alert:${ulid()}`,
    requestId: `owner-followup-request:${ulid()}`,
    kind: "pursue",
    title: `Follow up: ${params.nextBounty.title.slice(0, 96)}`,
    summary: `Auto-queued follow-up bounty from campaign ${params.execution.targetRef}.`,
    capability: params.action.capability,
    baseUrl: params.action.baseUrl,
    requestedBy: params.action.requestedBy,
    approvedBy: params.action.approvedBy ?? "openfox-follow-up",
    approvedAt: nowIso,
    decisionNote: `Auto-queued follow-up after ${params.execution.kind}`,
    payload: {
      ...payload,
      bountyId: params.nextBounty.bountyId,
      followUpDepth: nextDepth,
      parentActionId: params.action.actionId,
      parentExecutionId: params.execution.executionId,
      parentCampaignId: params.execution.targetRef,
      inheritedFromActionId: params.action.actionId,
      inheritedFromExecutionId: params.execution.executionId,
    },
    status: "queued",
    resolutionKind: null,
    resolutionRef: null,
    resolutionNote: null,
    queuedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    cancelledAt: null,
  };
  params.db.upsertOwnerOpportunityAction(followUpAction);
  return params.db.getOwnerOpportunityAction(followUpAction.actionId) ?? followUpAction;
}

async function maybeQueueFollowUp(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  action: OwnerOpportunityActionRecord;
  execution: OwnerOpportunityActionExecutionRecord;
}): Promise<{
  queued: OwnerOpportunityActionRecord[];
  reason?: string;
}> {
  const executionConfig = params.config.ownerReports?.actionExecution;
  if (!executionConfig?.enabled || executionConfig.autoQueueFollowUps !== true) {
    return { queued: [], reason: "follow-up queueing disabled" };
  }
  if (params.execution.kind !== "remote_campaign_solve") {
    return { queued: [], reason: "follow-up queueing is only enabled for campaign solves" };
  }
  const currentDepth = getActionFollowUpDepth(params.action);
  if (currentDepth >= executionConfig.maxFollowUpDepth) {
    return { queued: [], reason: "follow-up depth limit reached" };
  }
  const alreadyQueued = countQueuedFollowUpsForParent({
    db: params.db,
    parentActionId: params.action.actionId,
  });
  if (alreadyQueued >= executionConfig.maxFollowUpsPerRun) {
    return { queued: [], reason: "follow-up run limit reached" };
  }
  const resultPayload = asRecord(params.execution.resultPayload);
  const selectedBountyId = firstString(
    resultPayload.selectedBountyId,
    asRecord(params.execution.requestPayload).selectedBountyId,
  );
  const campaign = await fetchRemoteCampaign(
    params.execution.remoteBaseUrl,
    params.execution.targetRef,
  );
  const nextBounty = pickNextCampaignBounty(
    campaign.bounties,
    selectedBountyId ? [selectedBountyId] : [],
  );
  if (!nextBounty) {
    return { queued: [], reason: "campaign has no additional open bounty" };
  }
  const queued: OwnerOpportunityActionRecord[] = [];
  const remaining = executionConfig.maxFollowUpsPerRun - alreadyQueued;
  if (remaining <= 0) {
    return { queued, reason: "follow-up run limit reached" };
  }
  queued.push(
    queueCampaignFollowUpAction({
      db: params.db,
      action: params.action,
      execution: params.execution,
      nextBounty,
    }),
  );
  return { queued };
}

async function executePlan(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  action: OwnerOpportunityActionRecord;
  plan: SupportedActionExecutionPlan;
}): Promise<{
  requestPayload: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
  executionRef?: string | null;
  resolutionKind: "bounty" | "campaign" | "provider_call";
  resolutionRef: string;
}> {
  if (params.plan.kind === "remote_bounty_solve") {
    const bounty = (await fetchRemoteBounty(
      params.plan.remoteBaseUrl,
      params.plan.bountyId,
    )).bounty;
    const details = await solveRemoteBounty({
      baseUrl: params.plan.remoteBaseUrl,
      bountyId: params.plan.bountyId,
      solverAddress: params.identity.address,
      solverAgentId: params.config.agentId || params.identity.address,
      inference: params.inference,
      skillInstructions: resolveSolverSkillInstructions(params.db, bounty),
    });
    const resultPayload = {
      bountyId: params.plan.bountyId,
      answer: details.answer,
      submission: details.submissionResult,
    };
    const submissionId = extractSubmissionId(details.submissionResult);
    return {
      requestPayload: {
        kind: params.plan.kind,
        bountyId: params.plan.bountyId,
        remoteBaseUrl: params.plan.remoteBaseUrl,
      },
      resultPayload,
      executionRef: submissionId ?? params.plan.bountyId,
      resolutionKind: "bounty",
      resolutionRef: submissionId ?? params.plan.bountyId,
    };
  }

  if (params.plan.kind === "remote_observation_request") {
    const request: ObservationInvocationRequest = {
      capability: params.plan.capability,
      requester: {
        agent_id: params.config.agentId || params.identity.address.toLowerCase(),
        identity: {
          kind: "tos",
          value: params.identity.address.toLowerCase(),
        },
      },
      request_nonce: randomBytes(16).toString("hex"),
      request_expires_at: Math.floor(Date.now() / 1000) + 300,
      target_url: params.plan.targetUrl,
      reason: params.plan.reason,
    };
    const response = await invokeDirectProvider<
      ObservationInvocationRequest,
      ObservationInvocationResponse
    >({
      identity: params.identity,
      remoteBaseUrl: params.plan.remoteBaseUrl,
      request,
    });
    if (!response || response.status !== "ok") {
      throw new Error("provider returned an invalid observation response");
    }
    return {
      requestPayload: request as unknown as Record<string, unknown>,
      resultPayload: response as unknown as Record<string, unknown>,
      executionRef: response.job_id ?? params.plan.targetRef,
      resolutionKind: "provider_call",
      resolutionRef: response.job_id ?? params.plan.targetRef,
    };
  }

  if (params.plan.kind === "remote_oracle_request") {
    const request: OracleResolutionRequest = {
      capability: params.plan.capability,
      requester: {
        agent_id: params.config.agentId || params.identity.address.toLowerCase(),
        identity: {
          kind: "tos",
          value: params.identity.address.toLowerCase(),
        },
      },
      request_nonce: randomBytes(16).toString("hex"),
      request_expires_at: Math.floor(Date.now() / 1000) + 300,
      query: params.plan.query,
      query_kind: params.plan.queryKind,
      ...(params.plan.options?.length ? { options: params.plan.options } : {}),
      ...(params.plan.context ? { context: params.plan.context } : {}),
      reason: params.plan.reason,
    };
    const response = await invokeDirectProvider<
      OracleResolutionRequest,
      OracleResolutionResponse
    >({
      identity: params.identity,
      remoteBaseUrl: params.plan.remoteBaseUrl,
      request,
    });
    if (!response || response.status !== "ok") {
      throw new Error("provider returned an invalid oracle response");
    }
    return {
      requestPayload: request as unknown as Record<string, unknown>,
      resultPayload: response as unknown as Record<string, unknown>,
      executionRef: response.result_id ?? params.plan.targetRef,
      resolutionKind: "provider_call",
      resolutionRef: response.result_id ?? params.plan.targetRef,
    };
  }

  const campaign = await fetchRemoteCampaign(
    params.plan.remoteBaseUrl,
    params.plan.campaignId,
  );
  const selectedBounty = pickCampaignBounty(campaign.bounties);
  if (!selectedBounty) {
    throw new Error(`campaign has no open bounty: ${params.plan.campaignId}`);
  }
  const solved = await solveRemoteBounty({
    baseUrl: params.plan.remoteBaseUrl,
    bountyId: selectedBounty.bountyId,
    solverAddress: params.identity.address,
    solverAgentId: params.config.agentId || params.identity.address,
    inference: params.inference,
    skillInstructions: resolveSolverSkillInstructions(params.db, selectedBounty),
  });
  const submissionId = extractSubmissionId(solved.submissionResult);
  return {
    requestPayload: {
      kind: params.plan.kind,
      campaignId: params.plan.campaignId,
      selectedBountyId: selectedBounty.bountyId,
      remoteBaseUrl: params.plan.remoteBaseUrl,
    },
    resultPayload: {
      campaignId: params.plan.campaignId,
      selectedBountyId: selectedBounty.bountyId,
      answer: solved.answer,
      submission: solved.submissionResult,
    },
    executionRef: submissionId ?? selectedBounty.bountyId,
    resolutionKind: "campaign",
    resolutionRef: params.plan.campaignId,
  };
}

export async function executeOwnerOpportunityAction(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  actionId: string;
}): Promise<ExecuteOwnerOpportunityActionResult> {
  const action = params.db.getOwnerOpportunityAction(params.actionId);
  if (!action) {
    throw new Error(`owner opportunity action not found: ${params.actionId}`);
  }
  if (action.status !== "queued") {
    throw new Error(
      `owner opportunity action is not queued: ${action.actionId} (${action.status})`,
    );
  }

  const plan = buildExecutionPlan(action);
  if (!plan) {
    const skipped = createExecutionRecord({
      action,
      plan: buildUnsupportedExecutionPlan(action),
      status: "skipped",
      requestPayload: {
        actionKind: action.kind,
        payload: action.payload,
      },
      errorMessage:
        "owner action is not auto-executable; only pursue actions with remote bounty/campaign targets or delegate actions with supported provider targets are supported",
    });
    params.db.upsertOwnerOpportunityActionExecution(skipped);
    return { action, execution: skipped };
  }

  const running = createExecutionRecord({
    action,
    plan,
    status: "running",
    requestPayload: {
      actionKind: action.kind,
      targetRef: plan.targetRef,
      remoteBaseUrl: plan.remoteBaseUrl,
    },
  });
  params.db.upsertOwnerOpportunityActionExecution(running);

  try {
    const executed = await executePlan({
      identity: params.identity,
      config: params.config,
      db: params.db,
      inference: params.inference,
      action,
      plan,
    });
    const completedAt = new Date().toISOString();
    const completed = {
      ...running,
      status: "completed" as const,
      requestPayload: executed.requestPayload,
      resultPayload: executed.resultPayload,
      executionRef: executed.executionRef ?? null,
      updatedAt: completedAt,
      completedAt,
      failedAt: null,
      errorMessage: null,
    };
    const followUp = await maybeQueueFollowUp({
      config: params.config,
      db: params.db,
      action,
      execution: completed,
    });
    const completedWithFollowUp = {
      ...completed,
      resultPayload: {
        ...(completed.resultPayload ?? {}),
        followUpDepth: getActionFollowUpDepth(action),
        followUp: {
          queuedActionIds: followUp.queued.map((item) => item.actionId),
          queuedCount: followUp.queued.length,
          reason: followUp.reason ?? null,
        },
      },
    };
    params.db.upsertOwnerOpportunityActionExecution(completedWithFollowUp);
    const updatedAction =
      params.db.updateOwnerOpportunityActionStatus(action.actionId, "completed", completedAt, {
        kind: executed.resolutionKind,
        ref: executed.resolutionRef,
        note:
          followUp.queued.length > 0
            ? `Executed automatically via ${plan.kind}; queued ${followUp.queued.length} follow-up action${followUp.queued.length === 1 ? "" : "s"}`
            : `Executed automatically via ${plan.kind}`,
      }) ?? action;
    return { action: updatedAction, execution: completedWithFollowUp };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failed = {
      ...running,
      status: "failed" as const,
      updatedAt: failedAt,
      failedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    params.db.upsertOwnerOpportunityActionExecution(failed);
    throw error;
  }
}

export async function executeQueuedOwnerOpportunityActions(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  limit?: number;
  cooldownSeconds?: number;
  autoExecutePursue?: boolean;
  autoExecuteDelegate?: boolean;
}): Promise<{
  attempted: number;
  completed: number;
  failed: number;
  skipped: number;
  items: OwnerOpportunityActionExecutionRecord[];
}> {
  if (params.autoExecutePursue === false) {
    return {
      attempted: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      items: [],
    };
  }
  const actions = params.db
    .listOwnerOpportunityActions(params.limit ?? 10, { status: "queued" })
    .filter((action) =>
      action.kind === "pursue"
        ? params.autoExecutePursue !== false
        : action.kind === "delegate"
          ? params.autoExecuteDelegate === true
          : false,
    );
  const items: OwnerOpportunityActionExecutionRecord[] = [];
  let attempted = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const cooldownMs = Math.max(0, params.cooldownSeconds ?? 0) * 1000;
  const nowMs = Date.now();

  for (const action of actions) {
    const latest = params.db.listOwnerOpportunityActionExecutions(1, {
      actionId: action.actionId,
    })[0];
    if (
      latest &&
      cooldownMs > 0 &&
      nowMs - Date.parse(latest.updatedAt) < cooldownMs
    ) {
      continue;
    }
    attempted += 1;
    try {
      const result = await executeOwnerOpportunityAction({
        identity: params.identity,
        config: params.config,
        db: params.db,
        inference: params.inference,
        actionId: action.actionId,
      });
      items.push(result.execution);
      if (result.execution.status === "completed") {
        completed += 1;
      } else if (result.execution.status === "skipped") {
        skipped += 1;
      }
    } catch {
      const failedExecution = params.db.listOwnerOpportunityActionExecutions(1, {
        actionId: action.actionId,
      })[0];
      if (failedExecution) {
        items.push(failedExecution);
      }
      failed += 1;
    }
  }

  return {
    attempted,
    completed,
    failed,
    skipped,
    items,
  };
}
