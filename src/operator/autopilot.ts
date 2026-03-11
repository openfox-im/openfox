import { ulid } from "ulid";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OperatorApprovalKind,
  OperatorApprovalRequestRecord,
  OperatorApprovalStatus,
  OperatorAutopilotConfig,
} from "../types.js";
import {
  applyOperatorControlAction,
  listQuarantinedProviders,
  type OperatorProviderQuarantineRecord,
} from "./control.js";
import { buildProviderReputationSnapshot } from "./provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "./storage-health.js";

export interface OperatorAutopilotActionSnapshot {
  action: string;
  backlog: number;
  threshold: number;
  cooldownUntil?: string | null;
  triggered: boolean;
  changed: boolean;
  summary: string;
}

export interface OperatorAutopilotSnapshot {
  enabled: boolean;
  lastRunAt: string | null;
  queueBacklogs: {
    payments: number;
    settlement: number;
    market: number;
    signer: number;
    paymaster: number;
  };
  storageBacklog: {
    dueRenewals: number;
    dueAudits: number;
    critical: number;
    underReplicated: number;
  };
  artifactBacklog: {
    stored: number;
    verified: number;
  };
  approvals: {
    pending: number;
    recent: OperatorApprovalRequestRecord[];
  };
  quarantinedProviders: OperatorProviderQuarantineRecord[];
  recentActions: OperatorAutopilotActionSnapshot[];
  summary: string;
}

export interface OperatorAutopilotRunResult {
  ranAt: string;
  enabled: boolean;
  actions: OperatorAutopilotActionSnapshot[];
  expiredApprovals: number;
  summary: string;
}

export function buildOperatorAutopilotReport(
  snapshot: OperatorAutopilotSnapshot,
): string {
  const lines = [
    "=== OPENFOX AUTOPILOT ===",
    `Enabled: ${snapshot.enabled ? "yes" : "no"}`,
    `Last run: ${snapshot.lastRunAt || "(never)"}`,
    `Queue backlogs: payments=${snapshot.queueBacklogs.payments}, settlement=${snapshot.queueBacklogs.settlement}, market=${snapshot.queueBacklogs.market}, signer=${snapshot.queueBacklogs.signer}, paymaster=${snapshot.queueBacklogs.paymaster}`,
    `Storage backlog: renewals=${snapshot.storageBacklog.dueRenewals}, audits=${snapshot.storageBacklog.dueAudits}, critical=${snapshot.storageBacklog.critical}, under_replicated=${snapshot.storageBacklog.underReplicated}`,
    `Artifact backlog: stored=${snapshot.artifactBacklog.stored}, verified=${snapshot.artifactBacklog.verified}`,
    `Pending approvals: ${snapshot.approvals.pending}`,
    `Quarantined providers: ${snapshot.quarantinedProviders.length}`,
    `Summary: ${snapshot.summary}`,
  ];
  if (snapshot.recentActions.length) {
    lines.push("", "Recent actions:");
    for (const action of snapshot.recentActions.slice(0, 10)) {
      lines.push(
        `  - ${action.action}: ${action.summary}${action.cooldownUntil ? ` (cooldown until ${action.cooldownUntil})` : ""}`,
      );
    }
  }
  lines.push("=========================");
  return lines.join("\n");
}

const AUTOPILOT_LAST_RUN_KEY = "operator.autopilot.last_run_at";
const AUTOPILOT_COOLDOWN_PREFIX = "operator.autopilot.cooldown.";

function nowIso(): string {
  return new Date().toISOString();
}

function addSeconds(dateIso: string, seconds: number): string {
  return new Date(Date.parse(dateIso) + seconds * 1000).toISOString();
}

function getQueueBacklogs(db: OpenFoxDatabase) {
  return {
    payments: db.listPendingX402Payments(500).length,
    settlement: db.listPendingSettlementCallbacks(500).length,
    market: db.listPendingMarketContractCallbacks(500).length,
    signer:
      db.listSignerExecutions(500, { status: "pending" }).length +
      db.listSignerExecutions(500, { status: "submitted" }).length,
    paymaster:
      db.listPaymasterAuthorizations(500, { status: "authorized" }).length +
      db.listPaymasterAuthorizations(500, { status: "submitted" }).length,
  };
}

function getArtifactBacklog(db: OpenFoxDatabase) {
  return {
    stored: db.listArtifacts(500, { status: "stored" }).length,
    verified: db.listArtifacts(500, { status: "verified" }).length,
  };
}

function cooldownKey(action: string): string {
  return `${AUTOPILOT_COOLDOWN_PREFIX}${action}`;
}

function readCooldownUntil(db: OpenFoxDatabase, action: string): string | null {
  return db.getKV(cooldownKey(action)) ?? null;
}

function setCooldownUntil(
  db: OpenFoxDatabase,
  action: string,
  untilIso: string,
): void {
  db.setKV(cooldownKey(action), untilIso);
}

function isCooldownActive(
  db: OpenFoxDatabase,
  action: string,
  nowMs: number,
): { active: boolean; until: string | null } {
  const until = readCooldownUntil(db, action);
  if (!until) return { active: false, until: null };
  const untilMs = Date.parse(until);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) {
    return { active: false, until: null };
  }
  return { active: true, until };
}

function expirePendingApprovals(db: OpenFoxDatabase, nowMs: number): number {
  let expired = 0;
  for (const request of db.listOperatorApprovalRequests(500, { status: "pending" })) {
    if (!request.expiresAt) continue;
    const expiresMs = Date.parse(request.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs > nowMs) continue;
    db.updateOperatorApprovalRequest(request.requestId, {
      status: "expired",
      decidedAt: new Date(nowMs).toISOString(),
      decidedBy: "autopilot",
      decisionNote: "expired automatically",
    });
    expired += 1;
  }
  return expired;
}

function summarizeActions(actions: OperatorAutopilotActionSnapshot[]): string {
  const triggered = actions.filter((action) => action.triggered).length;
  const changed = actions.filter((action) => action.changed).length;
  return `enabled actions=${actions.length}, triggered=${triggered}, changed=${changed}`;
}

export function createOperatorApprovalRequest(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  kind: OperatorApprovalKind;
  scope: string;
  requestedBy?: string;
  reason?: string;
  payload?: unknown;
  ttlSeconds?: number;
}): OperatorApprovalRequestRecord {
  const ttlSeconds =
    params.ttlSeconds ??
    params.config.operatorAutopilot?.approvals.defaultTtlSeconds ??
    86400;
  const createdAt = nowIso();
  const record: OperatorApprovalRequestRecord = {
    requestId: ulid(),
    kind: params.kind,
    scope: params.scope.trim(),
    requestedBy: params.requestedBy?.trim() || "operator",
    reason: params.reason?.trim() || null,
    payload: params.payload ?? null,
    status: "pending",
    expiresAt: addSeconds(createdAt, ttlSeconds),
    createdAt,
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
  };
  params.db.insertOperatorApprovalRequest(record);
  return record;
}

export function decideOperatorApprovalRequest(params: {
  db: OpenFoxDatabase;
  requestId: string;
  status: Extract<OperatorApprovalStatus, "approved" | "rejected">;
  decidedBy?: string;
  decisionNote?: string;
}): OperatorApprovalRequestRecord {
  const current = params.db.getOperatorApprovalRequest(params.requestId);
  if (!current) {
    throw new Error(`approval request not found: ${params.requestId}`);
  }
  params.db.updateOperatorApprovalRequest(params.requestId, {
    status: params.status,
    decidedAt: nowIso(),
    decidedBy: params.decidedBy?.trim() || "operator",
    decisionNote: params.decisionNote?.trim() || null,
  });
  const updated = params.db.getOperatorApprovalRequest(params.requestId);
  if (!updated) {
    throw new Error(`failed to update approval request: ${params.requestId}`);
  }
  return updated;
}

export function buildOperatorAutopilotSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): OperatorAutopilotSnapshot {
  const queueBacklogs = getQueueBacklogs(db);
  const storageHealth = buildStorageLeaseHealthSnapshot({
    config,
    db,
    limit: 200,
  });
  const artifactBacklog = getArtifactBacklog(db);
  const approvals = db.listOperatorApprovalRequests(20);
  const pendingApprovals = approvals.filter(
    (item) => item.status === "pending",
  ).length;
  const quarantinedProviders = listQuarantinedProviders(db, 50);
  const recentActions = db
    .listOperatorControlEvents(20)
    .map((event) => ({
      action: event.action,
      backlog: 0,
      threshold: 0,
      cooldownUntil: null,
      triggered: event.status !== "noop",
      changed: event.status === "applied",
      summary: event.summary || event.action,
    }));

  return {
    enabled: config.operatorAutopilot?.enabled === true,
    lastRunAt: db.getKV(AUTOPILOT_LAST_RUN_KEY) ?? null,
    queueBacklogs,
    storageBacklog: {
      dueRenewals: storageHealth.dueRenewals,
      dueAudits: storageHealth.dueAudits,
      critical: storageHealth.critical,
      underReplicated: storageHealth.underReplicated,
    },
    artifactBacklog,
    approvals: {
      pending: pendingApprovals,
      recent: approvals,
    },
    quarantinedProviders,
    recentActions,
    summary: `enabled=${config.operatorAutopilot?.enabled === true ? "yes" : "no"}, pending_approvals=${pendingApprovals}, quarantined=${quarantinedProviders.length}`,
  };
}

async function maybeRunQueueAction(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  action: "retry_payments" | "retry_settlement" | "retry_market" | "retry_signer" | "retry_paymaster";
  backlog: number;
  policy: OperatorAutopilotConfig["queuePolicies"]["payments"];
  actor: string;
  reason?: string;
  nowMs: number;
}): Promise<OperatorAutopilotActionSnapshot> {
  const cooldown = isCooldownActive(params.db, params.action, params.nowMs);
  if (!params.policy.enabled) {
    return {
      action: params.action,
      backlog: params.backlog,
      threshold: params.policy.pendingThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: "disabled",
    };
  }
  if (params.backlog < params.policy.pendingThreshold) {
    return {
      action: params.action,
      backlog: params.backlog,
      threshold: params.policy.pendingThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: "below threshold",
    };
  }
  if (cooldown.active) {
    return {
      action: params.action,
      backlog: params.backlog,
      threshold: params.policy.pendingThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: `cooldown active until ${cooldown.until}`,
    };
  }
  const result = await applyOperatorControlAction({
    config: params.config,
    db: params.db,
    action: params.action,
    actor: params.actor,
    reason: params.reason,
    limit: params.policy.limit,
  });
  setCooldownUntil(
    params.db,
    params.action,
    addSeconds(nowIso(), params.policy.cooldownSeconds),
  );
  return {
    action: params.action,
    backlog: params.backlog,
    threshold: params.policy.pendingThreshold,
    cooldownUntil: readCooldownUntil(params.db, params.action),
    triggered: true,
    changed: result.changed,
    summary: result.summary,
  };
}

async function maybeRunMaintenanceAction(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  action: "maintain_storage" | "maintain_artifacts";
  backlog: number;
  policy: OperatorAutopilotConfig["storageMaintenance"];
  actor: string;
  reason?: string;
  nowMs: number;
}): Promise<OperatorAutopilotActionSnapshot> {
  const cooldown = isCooldownActive(params.db, params.action, params.nowMs);
  if (!params.policy.enabled) {
    return {
      action: params.action,
      backlog: params.backlog,
      threshold: params.policy.triggerThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: "disabled",
    };
  }
  if (params.backlog < params.policy.triggerThreshold) {
    return {
      action: params.action,
      backlog: params.backlog,
      threshold: params.policy.triggerThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: "below threshold",
    };
  }
  if (cooldown.active) {
    return {
      action: params.action,
      backlog: params.backlog,
      threshold: params.policy.triggerThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: `cooldown active until ${cooldown.until}`,
    };
  }
  const result = await applyOperatorControlAction({
    config: params.config,
    db: params.db,
    action: params.action,
    actor: params.actor,
    reason: params.reason,
    limit: params.policy.limit,
  });
  setCooldownUntil(
    params.db,
    params.action,
    addSeconds(nowIso(), params.policy.cooldownSeconds),
  );
  return {
    action: params.action,
    backlog: params.backlog,
    threshold: params.policy.triggerThreshold,
    cooldownUntil: readCooldownUntil(params.db, params.action),
    triggered: true,
    changed: result.changed,
    summary: result.summary,
  };
}

async function maybeRunProviderQuarantine(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  actor: string;
  reason?: string;
  nowMs: number;
}): Promise<OperatorAutopilotActionSnapshot> {
  const policy = params.config.operatorAutopilot?.providerQuarantine;
  const action = "quarantine_provider";
  const cooldown = isCooldownActive(params.db, action, params.nowMs);
  if (!policy?.enabled) {
    return {
      action,
      backlog: 0,
      threshold: 0,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: "disabled",
    };
  }
  const snapshot = buildProviderReputationSnapshot({
    db: params.db,
    limit: 500,
  });
  const existing = new Set(
    listQuarantinedProviders(params.db, 500).map((item) => item.providerKey),
  );
  const candidates = snapshot.entries.filter(
    (entry) =>
      entry.totalEvents >= policy.quarantineMinEvents &&
      entry.score <= policy.quarantineScoreThreshold &&
      !existing.has(entry.providerKey),
  );
  if (!candidates.length) {
    return {
      action,
      backlog: 0,
      threshold: policy.quarantineScoreThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: "no weak providers crossed the quarantine threshold",
    };
  }
  if (cooldown.active) {
    return {
      action,
      backlog: candidates.length,
      threshold: policy.quarantineScoreThreshold,
      cooldownUntil: cooldown.until,
      triggered: false,
      changed: false,
      summary: `cooldown active until ${cooldown.until}`,
    };
  }
  let quarantined = 0;
  for (const entry of candidates.slice(0, policy.maxProvidersPerRun)) {
    const result = await applyOperatorControlAction({
      config: params.config,
      db: params.db,
      action,
      actor: params.actor,
      reason:
        params.reason ??
        `autopilot quarantine: ${entry.kind} provider score ${entry.score}`,
      providerKey: entry.providerKey,
      providerKind: entry.kind,
      providerAddress: entry.providerAddress ?? undefined,
      providerBaseUrl: entry.providerBaseUrl ?? undefined,
      providerScore: entry.score,
      providerGrade: entry.grade,
      providerTotalEvents: entry.totalEvents,
    });
    if (result.changed) quarantined += 1;
  }
  setCooldownUntil(
    params.db,
    action,
    addSeconds(nowIso(), policy.cooldownSeconds),
  );
  return {
    action,
    backlog: candidates.length,
    threshold: policy.quarantineScoreThreshold,
    cooldownUntil: readCooldownUntil(params.db, action),
    triggered: true,
    changed: quarantined > 0,
    summary: `quarantined ${quarantined} provider(s) out of ${candidates.length} candidate(s)`,
  };
}

export async function runOperatorAutopilot(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  actor?: string;
  reason?: string;
}): Promise<OperatorAutopilotRunResult> {
  const ranAt = nowIso();
  const actor = params.actor?.trim() || "operator-autopilot";
  const nowMs = Date.parse(ranAt);
  const expiredApprovals = expirePendingApprovals(params.db, nowMs);

  if (!params.config.operatorAutopilot?.enabled) {
    params.db.setKV(AUTOPILOT_LAST_RUN_KEY, ranAt);
    return {
      ranAt,
      enabled: false,
      actions: [],
      expiredApprovals,
      summary: "operator autopilot is disabled",
    };
  }

  const queueBacklogs = getQueueBacklogs(params.db);
  const storageHealth = buildStorageLeaseHealthSnapshot({
    config: params.config,
    db: params.db,
    limit: 500,
  });
  const artifactBacklog = getArtifactBacklog(params.db);
  const autopilot = params.config.operatorAutopilot;
  const actions: OperatorAutopilotActionSnapshot[] = [];

  actions.push(
    await maybeRunQueueAction({
      db: params.db,
      config: params.config,
      action: "retry_payments",
      backlog: queueBacklogs.payments,
      policy: autopilot.queuePolicies.payments,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );
  actions.push(
    await maybeRunQueueAction({
      db: params.db,
      config: params.config,
      action: "retry_settlement",
      backlog: queueBacklogs.settlement,
      policy: autopilot.queuePolicies.settlement,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );
  actions.push(
    await maybeRunQueueAction({
      db: params.db,
      config: params.config,
      action: "retry_market",
      backlog: queueBacklogs.market,
      policy: autopilot.queuePolicies.market,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );
  actions.push(
    await maybeRunQueueAction({
      db: params.db,
      config: params.config,
      action: "retry_signer",
      backlog: queueBacklogs.signer,
      policy: autopilot.queuePolicies.signer,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );
  actions.push(
    await maybeRunQueueAction({
      db: params.db,
      config: params.config,
      action: "retry_paymaster",
      backlog: queueBacklogs.paymaster,
      policy: autopilot.queuePolicies.paymaster,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );

  actions.push(
    await maybeRunMaintenanceAction({
      db: params.db,
      config: params.config,
      action: "maintain_storage",
      backlog:
        storageHealth.dueRenewals +
        storageHealth.dueAudits +
        storageHealth.critical +
        storageHealth.underReplicated,
      policy: autopilot.storageMaintenance,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );
  actions.push(
    await maybeRunMaintenanceAction({
      db: params.db,
      config: params.config,
      action: "maintain_artifacts",
      backlog: artifactBacklog.stored + artifactBacklog.verified,
      policy: autopilot.artifactMaintenance,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );
  actions.push(
    await maybeRunProviderQuarantine({
      db: params.db,
      config: params.config,
      actor,
      reason: params.reason,
      nowMs,
    }),
  );

  params.db.setKV(AUTOPILOT_LAST_RUN_KEY, ranAt);

  return {
    ranAt,
    enabled: true,
    actions,
    expiredApprovals,
    summary: summarizeActions(actions),
  };
}
