/**
 * Intent Store - SQLite Persistence
 *
 * Provides CRUD operations for intent pipeline records using better-sqlite3.
 * Follows the same patterns as src/state/database.ts.
 */

import type BetterSqlite3 from "better-sqlite3";
import type {
  IntentEnvelope,
  IntentStatus,
  PlanRecord,
  PlanStatus,
  ApprovalRecord,
  ApprovalStatus,
  ExecutionReceipt,
} from "./types.js";

type DatabaseType = BetterSqlite3.Database;

export interface IntentListFilter {
  status?: IntentStatus;
  requester?: string;
  action?: string;
  limit?: number;
}

export interface IntentStore {
  // Intents
  saveIntent(intent: IntentEnvelope): void;
  getIntent(intentId: string): IntentEnvelope | undefined;
  listIntents(filter?: IntentListFilter): IntentEnvelope[];
  updateIntentStatus(intentId: string, status: IntentStatus): void;

  // Plans
  savePlan(plan: PlanRecord): void;
  getPlan(planId: string): PlanRecord | undefined;
  listPlansForIntent(intentId: string): PlanRecord[];

  // Approvals
  saveApproval(approval: ApprovalRecord): void;
  getApproval(approvalId: string): ApprovalRecord | undefined;

  // Receipts
  saveReceipt(receipt: ExecutionReceipt): void;
  getReceipt(receiptId: string): ExecutionReceipt | undefined;
  getReceiptByIntent(intentId: string): ExecutionReceipt | undefined;

  // Maintenance
  expireStaleIntents(): number;
}

// ─── Row Deserializers ──────────────────────────────────────────

function deserializeIntent(row: any): IntentEnvelope {
  return {
    intentId: row.intent_id,
    schemaVersion: row.schema_version,
    action: row.action,
    requester: row.requester,
    actorAgentId: row.actor_agent_id,
    terminalClass: row.terminal_class,
    trustTier: row.trust_tier,
    params: JSON.parse(row.params),
    constraints: row.constraints ? JSON.parse(row.constraints) : undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

function deserializePlan(row: any): PlanRecord {
  return {
    planId: row.plan_id,
    intentId: row.intent_id,
    schemaVersion: row.schema_version,
    provider: row.provider,
    sponsor: row.sponsor ?? undefined,
    artifactRef: row.artifact_ref ?? undefined,
    abiRef: row.abi_ref ?? undefined,
    policyHash: row.policy_hash,
    sponsorPolicyHash: row.sponsor_policy_hash ?? undefined,
    effectsHash: row.effects_hash ?? undefined,
    estimatedGas: row.estimated_gas,
    estimatedValue: row.estimated_value,
    route: row.route ? JSON.parse(row.route) : undefined,
    fallbackPlanId: row.fallback_plan_id ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

function deserializeApproval(row: any): ApprovalRecord {
  return {
    approvalId: row.approval_id,
    intentId: row.intent_id,
    planId: row.plan_id,
    schemaVersion: row.schema_version,
    approver: row.approver,
    approverRole: row.approver_role,
    accountId: row.account_id,
    terminalClass: row.terminal_class,
    trustTier: row.trust_tier,
    policyHash: row.policy_hash,
    approvalProofRef: row.approval_proof_ref ?? undefined,
    scope: row.scope ? JSON.parse(row.scope) : undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

function deserializeReceipt(row: any): ExecutionReceipt {
  return {
    receiptId: row.receipt_id,
    intentId: row.intent_id,
    planId: row.plan_id,
    approvalId: row.approval_id,
    schemaVersion: row.schema_version,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    from: row.from_addr,
    to: row.to_addr,
    sponsor: row.sponsor ?? undefined,
    actorAgentId: row.actor_agent_id,
    terminalClass: row.terminal_class,
    trustTier: row.trust_tier,
    policyHash: row.policy_hash,
    sponsorPolicyHash: row.sponsor_policy_hash ?? undefined,
    artifactRef: row.artifact_ref ?? undefined,
    effectsHash: row.effects_hash ?? undefined,
    gasUsed: row.gas_used,
    value: row.value,
    receiptStatus: row.receipt_status,
    proofRef: row.proof_ref ?? undefined,
    receiptRef: row.receipt_ref ?? undefined,
    settledAt: row.settled_at,
  };
}

// ─── Store Factory ──────────────────────────────────────────────

export function createIntentStore(db: DatabaseType): IntentStore {
  // ─── Intents ────────────────────────────────────────────────

  const saveIntent = (intent: IntentEnvelope): void => {
    db.prepare(
      `INSERT INTO intents (intent_id, schema_version, action, requester, actor_agent_id, terminal_class, trust_tier, params, constraints, created_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      intent.intentId,
      intent.schemaVersion,
      intent.action,
      intent.requester,
      intent.actorAgentId,
      intent.terminalClass,
      intent.trustTier,
      JSON.stringify(intent.params),
      intent.constraints ? JSON.stringify(intent.constraints) : null,
      intent.createdAt,
      intent.expiresAt,
      intent.status,
    );
  };

  const getIntent = (intentId: string): IntentEnvelope | undefined => {
    const row = db
      .prepare("SELECT * FROM intents WHERE intent_id = ?")
      .get(intentId) as any | undefined;
    return row ? deserializeIntent(row) : undefined;
  };

  const listIntents = (filter?: IntentListFilter): IntentEnvelope[] => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.requester) {
      conditions.push("requester = ?");
      params.push(filter.requester);
    }
    if (filter?.action) {
      conditions.push("action = ?");
      params.push(filter.action);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 100;
    const rows = db
      .prepare(`SELECT * FROM intents ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as any[];

    return rows.map(deserializeIntent);
  };

  const updateIntentStatus = (intentId: string, status: IntentStatus): void => {
    db.prepare("UPDATE intents SET status = ? WHERE intent_id = ?").run(status, intentId);
  };

  // ─── Plans ──────────────────────────────────────────────────

  const savePlan = (plan: PlanRecord): void => {
    db.prepare(
      `INSERT INTO plans (plan_id, intent_id, schema_version, provider, sponsor, artifact_ref, abi_ref, policy_hash, sponsor_policy_hash, effects_hash, estimated_gas, estimated_value, route, fallback_plan_id, created_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      plan.planId,
      plan.intentId,
      plan.schemaVersion,
      plan.provider,
      plan.sponsor ?? null,
      plan.artifactRef ?? null,
      plan.abiRef ?? null,
      plan.policyHash,
      plan.sponsorPolicyHash ?? null,
      plan.effectsHash ?? null,
      plan.estimatedGas,
      plan.estimatedValue,
      plan.route ? JSON.stringify(plan.route) : null,
      plan.fallbackPlanId ?? null,
      plan.createdAt,
      plan.expiresAt,
      plan.status,
    );
  };

  const getPlan = (planId: string): PlanRecord | undefined => {
    const row = db
      .prepare("SELECT * FROM plans WHERE plan_id = ?")
      .get(planId) as any | undefined;
    return row ? deserializePlan(row) : undefined;
  };

  const listPlansForIntent = (intentId: string): PlanRecord[] => {
    const rows = db
      .prepare("SELECT * FROM plans WHERE intent_id = ? ORDER BY created_at DESC")
      .all(intentId) as any[];
    return rows.map(deserializePlan);
  };

  // ─── Approvals ──────────────────────────────────────────────

  const saveApproval = (approval: ApprovalRecord): void => {
    db.prepare(
      `INSERT INTO approvals (approval_id, intent_id, plan_id, schema_version, approver, approver_role, account_id, terminal_class, trust_tier, policy_hash, approval_proof_ref, scope, created_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approval.approvalId,
      approval.intentId,
      approval.planId,
      approval.schemaVersion,
      approval.approver,
      approval.approverRole,
      approval.accountId,
      approval.terminalClass,
      approval.trustTier,
      approval.policyHash,
      approval.approvalProofRef ?? null,
      approval.scope ? JSON.stringify(approval.scope) : null,
      approval.createdAt,
      approval.expiresAt,
      approval.status,
    );
  };

  const getApproval = (approvalId: string): ApprovalRecord | undefined => {
    const row = db
      .prepare("SELECT * FROM approvals WHERE approval_id = ?")
      .get(approvalId) as any | undefined;
    return row ? deserializeApproval(row) : undefined;
  };

  // ─── Receipts ─────────────────────────────────────────────

  const saveReceipt = (receipt: ExecutionReceipt): void => {
    db.prepare(
      `INSERT INTO execution_receipts (receipt_id, intent_id, plan_id, approval_id, schema_version, tx_hash, block_number, block_hash, from_addr, to_addr, sponsor, actor_agent_id, terminal_class, trust_tier, policy_hash, sponsor_policy_hash, artifact_ref, effects_hash, gas_used, value, receipt_status, proof_ref, receipt_ref, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      receipt.receiptId,
      receipt.intentId,
      receipt.planId,
      receipt.approvalId,
      receipt.schemaVersion,
      receipt.txHash,
      receipt.blockNumber,
      receipt.blockHash,
      receipt.from,
      receipt.to,
      receipt.sponsor ?? null,
      receipt.actorAgentId,
      receipt.terminalClass,
      receipt.trustTier,
      receipt.policyHash,
      receipt.sponsorPolicyHash ?? null,
      receipt.artifactRef ?? null,
      receipt.effectsHash ?? null,
      receipt.gasUsed,
      receipt.value,
      receipt.receiptStatus,
      receipt.proofRef ?? null,
      receipt.receiptRef ?? null,
      receipt.settledAt,
    );
  };

  const getReceipt = (receiptId: string): ExecutionReceipt | undefined => {
    const row = db
      .prepare("SELECT * FROM execution_receipts WHERE receipt_id = ?")
      .get(receiptId) as any | undefined;
    return row ? deserializeReceipt(row) : undefined;
  };

  const getReceiptByIntent = (intentId: string): ExecutionReceipt | undefined => {
    const row = db
      .prepare("SELECT * FROM execution_receipts WHERE intent_id = ? ORDER BY settled_at DESC LIMIT 1")
      .get(intentId) as any | undefined;
    return row ? deserializeReceipt(row) : undefined;
  };

  // ─── Maintenance ──────────────────────────────────────────

  const expireStaleIntents = (): number => {
    const now = Math.floor(Date.now() / 1000);
    let totalChanged = 0;

    // Expire stale intents
    const intentResult = db.prepare(
      `UPDATE intents SET status = 'expired' WHERE expires_at < ? AND status NOT IN ('settled', 'failed', 'expired', 'cancelled')`,
    ).run(now);
    totalChanged += intentResult.changes;

    // Expire stale plans
    const planResult = db.prepare(
      `UPDATE plans SET status = 'expired' WHERE expires_at < ? AND status NOT IN ('completed', 'failed', 'expired')`,
    ).run(now);
    totalChanged += planResult.changes;

    // Expire stale approvals
    const approvalResult = db.prepare(
      `UPDATE approvals SET status = 'expired' WHERE expires_at < ? AND status NOT IN ('denied', 'revoked', 'expired')`,
    ).run(now);
    totalChanged += approvalResult.changes;

    return totalChanged;
  };

  return {
    saveIntent,
    getIntent,
    listIntents,
    updateIntentStatus,
    savePlan,
    getPlan,
    listPlansForIntent,
    saveApproval,
    getApproval,
    saveReceipt,
    getReceipt,
    getReceiptByIntent,
    expireStaleIntents,
  };
}
