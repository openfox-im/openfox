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
    };

export interface ExecuteOwnerOpportunityActionResult {
  action: OwnerOpportunityActionRecord;
  execution: OwnerOpportunityActionExecutionRecord;
}

function buildUnsupportedExecutionPlan(
  action: OwnerOpportunityActionRecord,
): SupportedActionExecutionPlan {
  return {
    kind: "remote_bounty_solve",
    targetKind: "bounty",
    targetRef: action.actionId,
    remoteBaseUrl: action.baseUrl || "",
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
  if (action.kind !== "pursue") {
    return null;
  }
  const payload = asRecord(action.payload);
  const nested = nestedPayload(action);
  const remoteBaseUrl = firstString(
    action.baseUrl,
    payload.baseUrl,
    nested.baseUrl,
  );
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
    const reward = BigInt(right.rewardWei) - BigInt(left.rewardWei);
    if (reward !== 0n) {
      return reward > 0n ? 1 : -1;
    }
    return left.createdAt.localeCompare(right.createdAt);
  })[0] ?? null;
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
  resolutionKind: "bounty" | "campaign";
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
        "owner action is not auto-executable; only pursue actions with remote bounty or campaign targets are supported",
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
    params.db.upsertOwnerOpportunityActionExecution(completed);
    const updatedAction =
      params.db.updateOwnerOpportunityActionStatus(action.actionId, "completed", completedAt, {
        kind: executed.resolutionKind,
        ref: executed.resolutionRef,
        note: `Executed automatically via ${plan.kind}`,
      }) ?? action;
    return { action: updatedAction, execution: completed };
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
    .filter((action) => action.kind === "pursue");
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
