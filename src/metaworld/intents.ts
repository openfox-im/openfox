/**
 * Generalized Intent System for OpenFox MetaWorld.
 *
 * Intents represent work requests, opportunities, procurements,
 * collaborations, and custom offers published into the world.
 * Solvers can respond, get matched, execute, and settle.
 */

import { ulid } from "ulid";
import type { OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("intents");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentKind = "work" | "opportunity" | "procurement" | "collaboration" | "custom";
export type IntentStatus = "open" | "matching" | "matched" | "in_progress" | "review" | "completed" | "cancelled" | "expired";
export type IntentResponseStatus = "pending" | "accepted" | "rejected" | "withdrawn";
export type IntentReviewStatus = "pending" | "approved" | "revision_requested" | "rejected";

export interface IntentRequirement {
  kind: "capability" | "reputation" | "membership" | "custom";
  capability_name?: string;
  reputation_dimension?: string;
  reputation_minimum?: number;
  required_group_id?: string;
  description?: string;
}

export interface IntentRecord {
  intentId: string;
  publisherAddress: string;
  groupId: string | null;
  kind: IntentKind;
  title: string;
  description: string;
  requirements: IntentRequirement[];
  budgetWei: string | null;
  budgetLine: string | null;
  budgetToken: string;
  status: IntentStatus;
  matchedSolverAddress: string | null;
  matchedAt: string | null;
  completedAt: string | null;
  settlementProposalId: string | null;
  settlementTxHash: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntentResponseRecord {
  responseId: string;
  intentId: string;
  solverAddress: string;
  proposalText: string;
  proposedAmountWei: string | null;
  capabilityRefs: string[];
  status: IntentResponseStatus;
  artifactIds: string[];
  reviewStatus: IntentReviewStatus | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

interface IntentRow {
  intent_id: string;
  publisher_address: string;
  group_id: string | null;
  kind: string;
  title: string;
  description: string;
  requirements_json: string;
  budget_wei: string | null;
  budget_line: string | null;
  budget_token: string;
  status: string;
  matched_solver_address: string | null;
  matched_at: string | null;
  completed_at: string | null;
  settlement_proposal_id: string | null;
  settlement_tx_hash: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface ResponseRow {
  response_id: string;
  intent_id: string;
  solver_address: string;
  proposal_text: string;
  proposed_amount_wei: string | null;
  capability_refs_json: string;
  status: string;
  artifact_ids_json: string;
  review_status: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value || value.trim().length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToIntent(row: IntentRow): IntentRecord {
  return {
    intentId: row.intent_id,
    publisherAddress: row.publisher_address,
    groupId: row.group_id,
    kind: row.kind as IntentKind,
    title: row.title,
    description: row.description,
    requirements: parseJsonSafe<IntentRequirement[]>(row.requirements_json, []),
    budgetWei: row.budget_wei,
    budgetLine: row.budget_line,
    budgetToken: row.budget_token,
    status: row.status as IntentStatus,
    matchedSolverAddress: row.matched_solver_address,
    matchedAt: row.matched_at,
    completedAt: row.completed_at,
    settlementProposalId: row.settlement_proposal_id,
    settlementTxHash: row.settlement_tx_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToResponse(row: ResponseRow): IntentResponseRecord {
  return {
    responseId: row.response_id,
    intentId: row.intent_id,
    solverAddress: row.solver_address,
    proposalText: row.proposal_text,
    proposedAmountWei: row.proposed_amount_wei,
    capabilityRefs: parseJsonSafe<string[]>(row.capability_refs_json, []),
    status: row.status as IntentResponseStatus,
    artifactIds: parseJsonSafe<string[]>(row.artifact_ids_json, []),
    reviewStatus: row.review_status as IntentReviewStatus | null,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Valid status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<IntentStatus, Set<IntentStatus>> = {
  open: new Set<IntentStatus>(["matching", "matched", "cancelled", "expired"]),
  matching: new Set<IntentStatus>(["matched", "cancelled", "expired"]),
  matched: new Set<IntentStatus>(["in_progress", "cancelled"]),
  in_progress: new Set<IntentStatus>(["review", "cancelled"]),
  review: new Set<IntentStatus>(["completed", "in_progress"]),
  completed: new Set<IntentStatus>(),
  cancelled: new Set<IntentStatus>(),
  expired: new Set<IntentStatus>(),
};

function assertTransition(from: IntentStatus, to: IntentStatus): void {
  if (!VALID_TRANSITIONS[from].has(to)) {
    throw new Error(`Invalid intent status transition: ${from} -> ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

export function createIntent(
  db: OpenFoxDatabase,
  options: {
    publisherAddress: string;
    groupId?: string;
    kind: IntentKind;
    title: string;
    description?: string;
    requirements?: IntentRequirement[];
    budgetWei?: string;
    budgetLine?: string;
    expiresInHours?: number;
  },
): IntentRecord {
  const now = new Date().toISOString();
  const intentId = ulid();
  const expiresInHours = options.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  db.raw
    .prepare(
      `INSERT INTO world_intents
        (intent_id, publisher_address, group_id, kind, title, description,
         requirements_json, budget_wei, budget_line, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .run(
      intentId,
      options.publisherAddress,
      options.groupId ?? null,
      options.kind,
      options.title,
      options.description ?? "",
      JSON.stringify(options.requirements ?? []),
      options.budgetWei ?? null,
      options.budgetLine ?? null,
      expiresAt,
      now,
      now,
    );

  logger.info(`Intent created: ${intentId} (${options.kind}) by ${options.publisherAddress}`);
  return getIntent(db, intentId)!;
}

export function getIntent(db: OpenFoxDatabase, intentId: string): IntentRecord | null {
  const row = db.raw
    .prepare(`SELECT * FROM world_intents WHERE intent_id = ?`)
    .get(intentId) as IntentRow | undefined;
  return row ? rowToIntent(row) : null;
}

export function listIntents(
  db: OpenFoxDatabase,
  options?: {
    groupId?: string;
    kind?: IntentKind;
    status?: IntentStatus;
    publisherAddress?: string;
    limit?: number;
  },
): IntentRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.groupId) {
    conditions.push("group_id = ?");
    params.push(options.groupId);
  }
  if (options?.kind) {
    conditions.push("kind = ?");
    params.push(options.kind);
  }
  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options?.publisherAddress) {
    conditions.push("publisher_address = ?");
    params.push(options.publisherAddress);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, options?.limit ?? 50);

  const rows = db.raw
    .prepare(`SELECT * FROM world_intents ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as IntentRow[];

  return rows.map(rowToIntent);
}

export function respondToIntent(
  db: OpenFoxDatabase,
  options: {
    intentId: string;
    solverAddress: string;
    proposalText?: string;
    proposedAmountWei?: string;
    capabilityRefs?: string[];
  },
): IntentResponseRecord {
  const intent = getIntent(db, options.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${options.intentId}`);
  }
  if (intent.status !== "open" && intent.status !== "matching") {
    throw new Error(`Cannot respond to intent with status: ${intent.status}`);
  }

  const now = new Date().toISOString();
  const responseId = ulid();

  try {
    db.raw
      .prepare(
        `INSERT INTO world_intent_responses
          (response_id, intent_id, solver_address, proposal_text,
           proposed_amount_wei, capability_refs_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        responseId,
        options.intentId,
        options.solverAddress,
        options.proposalText ?? "",
        options.proposedAmountWei ?? null,
        JSON.stringify(options.capabilityRefs ?? []),
        now,
        now,
      );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
      throw new Error(
        `Solver ${options.solverAddress} has already responded to intent ${options.intentId}`,
      );
    }
    throw err;
  }

  logger.info(`Response ${responseId} from ${options.solverAddress} on intent ${options.intentId}`);
  return getIntentResponse(db, responseId)!;
}

function getIntentResponse(db: OpenFoxDatabase, responseId: string): IntentResponseRecord | null {
  const row = db.raw
    .prepare(`SELECT * FROM world_intent_responses WHERE response_id = ?`)
    .get(responseId) as ResponseRow | undefined;
  return row ? rowToResponse(row) : null;
}

export function listIntentResponses(
  db: OpenFoxDatabase,
  intentId: string,
): IntentResponseRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM world_intent_responses WHERE intent_id = ? ORDER BY created_at ASC`,
    )
    .all(intentId) as ResponseRow[];
  return rows.map(rowToResponse);
}

export function acceptIntentResponse(
  db: OpenFoxDatabase,
  options: {
    intentId: string;
    solverAddress: string;
    actorAddress: string;
  },
): IntentRecord {
  const intent = getIntent(db, options.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${options.intentId}`);
  }
  if (intent.publisherAddress !== options.actorAddress) {
    throw new Error("Only the intent publisher can accept a response");
  }
  assertTransition(intent.status, "matched");

  const now = new Date().toISOString();

  // Accept the chosen response
  db.raw
    .prepare(
      `UPDATE world_intent_responses
       SET status = 'accepted', updated_at = ?
       WHERE intent_id = ? AND solver_address = ? AND status = 'pending'`,
    )
    .run(now, options.intentId, options.solverAddress);

  // Reject all other pending responses
  db.raw
    .prepare(
      `UPDATE world_intent_responses
       SET status = 'rejected', updated_at = ?
       WHERE intent_id = ? AND solver_address != ? AND status = 'pending'`,
    )
    .run(now, options.intentId, options.solverAddress);

  // Update intent
  db.raw
    .prepare(
      `UPDATE world_intents
       SET status = 'matched', matched_solver_address = ?, matched_at = ?, updated_at = ?
       WHERE intent_id = ?`,
    )
    .run(options.solverAddress, now, now, options.intentId);

  logger.info(`Intent ${options.intentId} matched to solver ${options.solverAddress}`);
  return getIntent(db, options.intentId)!;
}

export function startIntentExecution(
  db: OpenFoxDatabase,
  intentId: string,
  solverAddress: string,
): IntentRecord {
  const intent = getIntent(db, intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${intentId}`);
  }
  if (intent.matchedSolverAddress !== solverAddress) {
    throw new Error("Only the matched solver can start execution");
  }
  assertTransition(intent.status, "in_progress");

  const now = new Date().toISOString();
  db.raw
    .prepare(
      `UPDATE world_intents SET status = 'in_progress', updated_at = ? WHERE intent_id = ?`,
    )
    .run(now, intentId);

  logger.info(`Intent ${intentId} execution started by ${solverAddress}`);
  return getIntent(db, intentId)!;
}

export function submitIntentArtifacts(
  db: OpenFoxDatabase,
  options: {
    intentId: string;
    solverAddress: string;
    artifactIds: string[];
  },
): IntentRecord {
  const intent = getIntent(db, options.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${options.intentId}`);
  }
  if (intent.matchedSolverAddress !== options.solverAddress) {
    throw new Error("Only the matched solver can submit artifacts");
  }
  assertTransition(intent.status, "review");

  const now = new Date().toISOString();

  // Update response with artifacts
  db.raw
    .prepare(
      `UPDATE world_intent_responses
       SET artifact_ids_json = ?, review_status = 'pending', updated_at = ?
       WHERE intent_id = ? AND solver_address = ?`,
    )
    .run(JSON.stringify(options.artifactIds), now, options.intentId, options.solverAddress);

  // Move intent to review
  db.raw
    .prepare(
      `UPDATE world_intents SET status = 'review', updated_at = ? WHERE intent_id = ?`,
    )
    .run(now, options.intentId);

  logger.info(`Intent ${options.intentId} artifacts submitted, moved to review`);
  return getIntent(db, options.intentId)!;
}

export function approveIntentCompletion(
  db: OpenFoxDatabase,
  options: {
    intentId: string;
    actorAddress: string;
  },
): { intent: IntentRecord; settlementProposalId?: string } {
  const intent = getIntent(db, options.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${options.intentId}`);
  }
  if (intent.publisherAddress !== options.actorAddress) {
    throw new Error("Only the intent publisher can approve completion");
  }
  assertTransition(intent.status, "completed");

  const now = new Date().toISOString();
  const settlementProposalId = intent.budgetWei ? ulid() : undefined;

  // Approve the response review
  db.raw
    .prepare(
      `UPDATE world_intent_responses
       SET review_status = 'approved', updated_at = ?
       WHERE intent_id = ? AND solver_address = ?`,
    )
    .run(now, options.intentId, intent.matchedSolverAddress);

  // Complete the intent
  db.raw
    .prepare(
      `UPDATE world_intents
       SET status = 'completed', completed_at = ?, settlement_proposal_id = ?, updated_at = ?
       WHERE intent_id = ?`,
    )
    .run(now, settlementProposalId ?? null, now, options.intentId);

  logger.info(`Intent ${options.intentId} completed`);
  return {
    intent: getIntent(db, options.intentId)!,
    settlementProposalId,
  };
}

export function requestIntentRevision(
  db: OpenFoxDatabase,
  options: {
    intentId: string;
    actorAddress: string;
    note: string;
  },
): IntentRecord {
  const intent = getIntent(db, options.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${options.intentId}`);
  }
  if (intent.publisherAddress !== options.actorAddress) {
    throw new Error("Only the intent publisher can request a revision");
  }
  assertTransition(intent.status, "in_progress");

  const now = new Date().toISOString();

  // Update response review status
  db.raw
    .prepare(
      `UPDATE world_intent_responses
       SET review_status = 'revision_requested', review_note = ?, updated_at = ?
       WHERE intent_id = ? AND solver_address = ?`,
    )
    .run(options.note, now, options.intentId, intent.matchedSolverAddress);

  // Move intent back to in_progress
  db.raw
    .prepare(
      `UPDATE world_intents SET status = 'in_progress', updated_at = ? WHERE intent_id = ?`,
    )
    .run(now, options.intentId);

  logger.info(`Intent ${options.intentId} revision requested`);
  return getIntent(db, options.intentId)!;
}

export function cancelIntent(
  db: OpenFoxDatabase,
  options: {
    intentId: string;
    actorAddress: string;
  },
): IntentRecord {
  const intent = getIntent(db, options.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${options.intentId}`);
  }

  // Only the publisher can cancel (group admin check could be added later)
  if (intent.publisherAddress !== options.actorAddress) {
    throw new Error("Only the intent publisher can cancel the intent");
  }
  assertTransition(intent.status, "cancelled");

  const now = new Date().toISOString();
  db.raw
    .prepare(
      `UPDATE world_intents SET status = 'cancelled', updated_at = ? WHERE intent_id = ?`,
    )
    .run(now, options.intentId);

  // Withdraw all pending responses
  db.raw
    .prepare(
      `UPDATE world_intent_responses
       SET status = 'withdrawn', updated_at = ?
       WHERE intent_id = ? AND status = 'pending'`,
    )
    .run(now, options.intentId);

  logger.info(`Intent ${options.intentId} cancelled by ${options.actorAddress}`);
  return getIntent(db, options.intentId)!;
}

export function expireStaleIntents(db: OpenFoxDatabase, now?: string): number {
  const cutoff = now ?? new Date().toISOString();
  const result = db.raw
    .prepare(
      `UPDATE world_intents
       SET status = 'expired', updated_at = ?
       WHERE status IN ('open', 'matching') AND expires_at <= ?`,
    )
    .run(cutoff, cutoff);

  const count = result.changes;
  if (count > 0) {
    // Also withdraw pending responses for expired intents
    db.raw
      .prepare(
        `UPDATE world_intent_responses
         SET status = 'withdrawn', updated_at = ?
         WHERE intent_id IN (
           SELECT intent_id FROM world_intents WHERE status = 'expired'
         ) AND status = 'pending'`,
      )
      .run(cutoff);

    logger.info(`Expired ${count} stale intent(s)`);
  }
  return count;
}

export interface IntentMatch {
  intentId: string;
  solverAddress: string;
  matchedCapabilities: string[];
}

export function matchOpenIntents(db: OpenFoxDatabase): IntentMatch[] {
  const openIntents = listIntents(db, { status: "open" });
  const matches: IntentMatch[] = [];

  for (const intent of openIntents) {
    const capabilityRequirements = intent.requirements.filter(
      (r) => r.kind === "capability" && r.capability_name,
    );
    if (capabilityRequirements.length === 0) continue;

    const capNames = capabilityRequirements.map((r) => r.capability_name!);

    // Search world_search_index for foxes whose searchable_text contains the capability names
    const foxRows = db.raw
      .prepare(
        `SELECT source_id, searchable_text FROM world_search_index WHERE entry_kind = 'fox'`,
      )
      .all() as Array<{ source_id: string; searchable_text: string }>;

    for (const fox of foxRows) {
      const text = fox.searchable_text.toLowerCase();
      const matched = capNames.filter((cap) => text.includes(cap.toLowerCase()));
      if (matched.length > 0) {
        matches.push({
          intentId: intent.intentId,
          solverAddress: fox.source_id,
          matchedCapabilities: matched,
        });
      }
    }
  }

  if (matches.length > 0) {
    logger.info(`Matched ${matches.length} solver(s) to open intents`);
  }
  return matches;
}
