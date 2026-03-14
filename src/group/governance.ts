/**
 * OpenFox Group Governance Engine (v2)
 *
 * Full quorum + threshold voting system for group proposals.
 * This is the operational layer; the view/snapshot layer lives
 * in src/metaworld/governance.ts (v1, untouched).
 */

import { ulid } from "ulid";
import { keccak256, toHex, type Hex, type PrivateKeyAccount } from "tosdk";
import { createLogger } from "../observability/logger.js";
import type { OpenFoxDatabase } from "../types.js";
import { getGroup, listGroupMembers, type GroupMemberRecord } from "./store.js";

const logger = createLogger("group-governance");

// ─── Types ──────────────────────────────────────────────────────

export type GovernanceProposalType =
  | "spend"
  | "policy_change"
  | "member_action"
  | "config_change"
  | "treasury_config"
  | "external_action";

export type GovernanceProposalStatus =
  | "active"
  | "approved"
  | "rejected"
  | "expired"
  | "executed";

export type GovernanceVote = "approve" | "reject";

export interface GovernanceProposalRecord {
  proposalId: string;
  groupId: string;
  proposalType: GovernanceProposalType;
  title: string;
  description: string;
  params: Record<string, unknown>;
  proposerAddress: string;
  openedEventId: string;
  quorum: number;
  thresholdNumerator: number;
  thresholdDenominator: number;
  status: GovernanceProposalStatus;
  votesApprove: number;
  votesReject: number;
  votesTotal: number;
  resolvedEventId: string | null;
  executedEventId: string | null;
  executionResult: Record<string, unknown> | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceVoteRecord {
  voteId: string;
  proposalId: string;
  groupId: string;
  voterAddress: string;
  vote: GovernanceVote;
  reason: string | null;
  eventId: string;
  createdAt: string;
}

export interface GovernancePolicyRecord {
  groupId: string;
  proposalType: GovernanceProposalType;
  quorum: number;
  thresholdNumerator: number;
  thresholdDenominator: number;
  allowedProposerRoles: string[];
  allowedVoterRoles: string[];
  defaultDurationHours: number;
}

export interface GovernanceSnapshot {
  groupId: string;
  activeProposals: GovernanceProposalRecord[];
  recentOutcomes: GovernanceProposalRecord[];
  policy: GovernancePolicyRecord[];
  totalProposals: number;
  totalApproved: number;
  totalRejected: number;
  totalExpired: number;
}

// ─── Internal helpers ───────────────────────────────────────────

const textEncoder = new TextEncoder();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAddressLike(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("address cannot be empty");
  }
  return normalized;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
  );
  return `{${parts.join(",")}}`;
}

function hashCanonical(value: unknown): Hex {
  return keccak256(toHex(textEncoder.encode(stableStringify(value)))) as Hex;
}

async function buildSignedGovernanceEvent(params: {
  account: PrivateKeyAccount;
  groupId: string;
  kind: string;
  epoch: number;
  actorAddress: string;
  actorAgentId?: string | null;
  payload: Record<string, unknown>;
  createdAt?: string;
}): Promise<{
  eventId: string;
  groupId: string;
  kind: string;
  epoch: number;
  actorAddress: string;
  actorAgentId: string | null;
  payload: Record<string, unknown>;
  signature: Hex;
  eventHash: Hex;
  createdAt: string;
}> {
  const createdAt = params.createdAt ?? nowIso();
  const unsigned = {
    version: 1,
    event_id: `gev_${ulid()}`,
    group_id: params.groupId,
    kind: params.kind,
    epoch: params.epoch,
    channel_id: null,
    actor_address: normalizeAddressLike(params.actorAddress),
    actor_agent_id: params.actorAgentId?.trim() || null,
    parent_event_ids: [],
    payload: params.payload,
    created_at: createdAt,
    expires_at: null,
  };
  const canonical = stableStringify(unsigned);
  const eventHash = hashCanonical(unsigned);
  const signature = await params.account.signMessage({
    message: `OpenFox:group:v1:${canonical}`,
  });

  return {
    eventId: unsigned.event_id,
    groupId: unsigned.group_id,
    kind: unsigned.kind,
    epoch: unsigned.epoch,
    actorAddress: unsigned.actor_address,
    actorAgentId: unsigned.actor_agent_id,
    payload: params.payload,
    signature: signature as Hex,
    eventHash,
    createdAt,
  };
}

function insertGovernanceEvent(
  db: OpenFoxDatabase,
  event: {
    eventId: string;
    groupId: string;
    kind: string;
    epoch: number;
    actorAddress: string;
    actorAgentId: string | null;
    payload: Record<string, unknown>;
    signature: Hex;
    eventHash: Hex;
    createdAt: string;
  },
): void {
  db.raw
    .prepare(
      `INSERT INTO group_events (
        event_id, group_id, kind, epoch, channel_id,
        actor_address, actor_agent_id, parent_event_ids_json,
        payload_json, signature, event_hash,
        created_at, expires_at, received_at,
        source_kind, reducer_status, rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      event.groupId,
      event.kind,
      event.epoch,
      null,
      event.actorAddress,
      event.actorAgentId,
      "[]",
      JSON.stringify(event.payload),
      event.signature,
      event.eventHash,
      event.createdAt,
      null,
      event.createdAt,
      "local",
      "accepted",
      null,
    );
}

function mapProposalRow(row: any): GovernanceProposalRecord {
  return {
    proposalId: row.proposal_id,
    groupId: row.group_id,
    proposalType: row.proposal_type as GovernanceProposalType,
    title: row.title,
    description: row.description,
    params: JSON.parse(row.params_json || "{}"),
    proposerAddress: row.proposer_address,
    openedEventId: row.opened_event_id,
    quorum: row.quorum,
    thresholdNumerator: row.threshold_numerator,
    thresholdDenominator: row.threshold_denominator,
    status: row.status as GovernanceProposalStatus,
    votesApprove: row.votes_approve,
    votesReject: row.votes_reject,
    votesTotal: row.votes_total,
    resolvedEventId: row.resolved_event_id ?? null,
    executedEventId: row.executed_event_id ?? null,
    executionResult: row.execution_result_json
      ? JSON.parse(row.execution_result_json)
      : null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVoteRow(row: any): GovernanceVoteRecord {
  return {
    voteId: row.vote_id,
    proposalId: row.proposal_id,
    groupId: row.group_id,
    voterAddress: row.voter_address,
    vote: row.vote as GovernanceVote,
    reason: row.reason ?? null,
    eventId: row.event_id,
    createdAt: row.created_at,
  };
}

function mapPolicyRow(row: any): GovernancePolicyRecord {
  return {
    groupId: row.group_id,
    proposalType: row.proposal_type as GovernanceProposalType,
    quorum: row.quorum,
    thresholdNumerator: row.threshold_numerator,
    thresholdDenominator: row.threshold_denominator,
    allowedProposerRoles: JSON.parse(row.allowed_proposer_roles || '["owner","admin"]'),
    allowedVoterRoles: JSON.parse(row.allowed_voter_roles || '["owner","admin"]'),
    defaultDurationHours: row.default_duration_hours,
  };
}

function getDefaultPolicy(
  groupId: string,
  proposalType: GovernanceProposalType,
): GovernancePolicyRecord {
  return {
    groupId,
    proposalType,
    quorum: 1,
    thresholdNumerator: 2,
    thresholdDenominator: 3,
    allowedProposerRoles: ["owner", "admin"],
    allowedVoterRoles: ["owner", "admin"],
    defaultDurationHours: 168,
  };
}

function hasAnyRole(
  db: OpenFoxDatabase,
  groupId: string,
  address: string,
  roles: string[],
): boolean {
  const normalized = normalizeAddressLike(address);
  const placeholders = roles.map(() => "?").join(",");
  const row = db.raw
    .prepare(
      `SELECT 1
       FROM group_member_roles
       WHERE group_id = ? AND member_address = ? AND active = 1 AND role IN (${placeholders})
       LIMIT 1`,
    )
    .get(groupId, normalized, ...roles) as { 1: number } | undefined;
  return !!row;
}

function countEligibleVoters(
  db: OpenFoxDatabase,
  groupId: string,
  allowedRoles: string[],
): number {
  const members = listGroupMembers(db, groupId);
  const activeMembers = members.filter((m) => m.membershipState === "active");
  let count = 0;
  for (const member of activeMembers) {
    if (hasAnyRole(db, groupId, member.memberAddress, allowedRoles)) {
      count++;
    }
  }
  return count;
}

// ─── Public API ─────────────────────────────────────────────────

export function getGovernancePolicy(
  db: OpenFoxDatabase,
  groupId: string,
  proposalType: GovernanceProposalType,
): GovernancePolicyRecord {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_governance_policy
       WHERE group_id = ? AND proposal_type = ?`,
    )
    .get(groupId, proposalType) as any | undefined;
  return row ? mapPolicyRow(row) : getDefaultPolicy(groupId, proposalType);
}

export function setGovernancePolicy(
  db: OpenFoxDatabase,
  groupId: string,
  proposalType: GovernanceProposalType,
  policy: Partial<
    Pick<
      GovernancePolicyRecord,
      | "quorum"
      | "thresholdNumerator"
      | "thresholdDenominator"
      | "allowedProposerRoles"
      | "allowedVoterRoles"
      | "defaultDurationHours"
    >
  >,
): GovernancePolicyRecord {
  const current = getGovernancePolicy(db, groupId, proposalType);
  const merged: GovernancePolicyRecord = {
    groupId,
    proposalType,
    quorum: policy.quorum ?? current.quorum,
    thresholdNumerator: policy.thresholdNumerator ?? current.thresholdNumerator,
    thresholdDenominator:
      policy.thresholdDenominator ?? current.thresholdDenominator,
    allowedProposerRoles:
      policy.allowedProposerRoles ?? current.allowedProposerRoles,
    allowedVoterRoles: policy.allowedVoterRoles ?? current.allowedVoterRoles,
    defaultDurationHours:
      policy.defaultDurationHours ?? current.defaultDurationHours,
  };
  db.raw
    .prepare(
      `INSERT INTO group_governance_policy (
        group_id, proposal_type, quorum, threshold_numerator,
        threshold_denominator, allowed_proposer_roles, allowed_voter_roles,
        default_duration_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id, proposal_type) DO UPDATE SET
        quorum = excluded.quorum,
        threshold_numerator = excluded.threshold_numerator,
        threshold_denominator = excluded.threshold_denominator,
        allowed_proposer_roles = excluded.allowed_proposer_roles,
        allowed_voter_roles = excluded.allowed_voter_roles,
        default_duration_hours = excluded.default_duration_hours`,
    )
    .run(
      merged.groupId,
      merged.proposalType,
      merged.quorum,
      merged.thresholdNumerator,
      merged.thresholdDenominator,
      JSON.stringify(merged.allowedProposerRoles),
      JSON.stringify(merged.allowedVoterRoles),
      merged.defaultDurationHours,
    );
  logger.info(
    `governance policy updated for ${groupId} / ${proposalType}`,
  );
  return merged;
}

export async function createGovernanceProposal(
  db: OpenFoxDatabase,
  params: {
    account: PrivateKeyAccount;
    groupId: string;
    proposalType: GovernanceProposalType;
    title: string;
    description?: string;
    params?: Record<string, unknown>;
    proposerAddress: string;
    proposerAgentId?: string;
    durationHours?: number;
  },
): Promise<GovernanceProposalRecord> {
  const group = getGroup(db, params.groupId);
  if (!group) {
    throw new Error(`group not found: ${params.groupId}`);
  }

  const policy = getGovernancePolicy(db, params.groupId, params.proposalType);

  // Validate proposer has an allowed role
  if (
    !hasAnyRole(
      db,
      params.groupId,
      params.proposerAddress,
      policy.allowedProposerRoles,
    )
  ) {
    throw new Error(
      `proposer ${params.proposerAddress} does not have a required role: ${policy.allowedProposerRoles.join(", ")}`,
    );
  }

  const now = nowIso();
  const durationHours = params.durationHours ?? policy.defaultDurationHours;
  const expiresAt = new Date(
    Date.now() + durationHours * 60 * 60 * 1000,
  ).toISOString();
  const proposalId = `gprop_${ulid()}`;

  const event = await buildSignedGovernanceEvent({
    account: params.account,
    groupId: params.groupId,
    kind: "governance.proposal.opened",
    epoch: group.currentEpoch,
    actorAddress: params.proposerAddress,
    actorAgentId: params.proposerAgentId,
    payload: {
      proposalId,
      proposalType: params.proposalType,
      title: params.title,
      description: params.description || "",
      params: params.params || {},
    },
    createdAt: now,
  });

  const record: GovernanceProposalRecord = {
    proposalId,
    groupId: params.groupId,
    proposalType: params.proposalType,
    title: params.title,
    description: params.description || "",
    params: params.params || {},
    proposerAddress: normalizeAddressLike(params.proposerAddress),
    openedEventId: event.eventId,
    quorum: policy.quorum,
    thresholdNumerator: policy.thresholdNumerator,
    thresholdDenominator: policy.thresholdDenominator,
    status: "active",
    votesApprove: 0,
    votesReject: 0,
    votesTotal: 0,
    resolvedEventId: null,
    executedEventId: null,
    executionResult: null,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  db.runTransaction(() => {
    insertGovernanceEvent(db, event);
    db.raw
      .prepare(
        `INSERT INTO group_governance_proposals (
          proposal_id, group_id, proposal_type, title, description,
          params_json, proposer_address, opened_event_id,
          quorum, threshold_numerator, threshold_denominator,
          status, votes_approve, votes_reject, votes_total,
          resolved_event_id, executed_event_id, execution_result_json,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.proposalId,
        record.groupId,
        record.proposalType,
        record.title,
        record.description,
        JSON.stringify(record.params),
        record.proposerAddress,
        record.openedEventId,
        record.quorum,
        record.thresholdNumerator,
        record.thresholdDenominator,
        record.status,
        record.votesApprove,
        record.votesReject,
        record.votesTotal,
        record.resolvedEventId,
        record.executedEventId,
        null,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      );
  });

  logger.info(
    `governance proposal created: ${proposalId} (${params.proposalType}) in ${params.groupId}`,
  );
  return record;
}

export async function voteOnProposal(
  db: OpenFoxDatabase,
  params: {
    account: PrivateKeyAccount;
    proposalId: string;
    voterAddress: string;
    voterAgentId?: string;
    vote: GovernanceVote;
    reason?: string;
  },
): Promise<{ vote: GovernanceVoteRecord; proposal: GovernanceProposalRecord }> {
  const proposal = getGovernanceProposal(db, params.proposalId);
  if (!proposal) {
    throw new Error(`proposal not found: ${params.proposalId}`);
  }
  if (proposal.status !== "active") {
    throw new Error(
      `proposal ${params.proposalId} is not active (status: ${proposal.status})`,
    );
  }

  const group = getGroup(db, proposal.groupId);
  if (!group) {
    throw new Error(`group not found: ${proposal.groupId}`);
  }

  const policy = getGovernancePolicy(db, proposal.groupId, proposal.proposalType);

  // Validate voter has an allowed role
  if (
    !hasAnyRole(
      db,
      proposal.groupId,
      params.voterAddress,
      policy.allowedVoterRoles,
    )
  ) {
    throw new Error(
      `voter ${params.voterAddress} does not have a required role: ${policy.allowedVoterRoles.join(", ")}`,
    );
  }

  // Check for duplicate vote
  const normalizedVoter = normalizeAddressLike(params.voterAddress);
  const existing = db.raw
    .prepare(
      `SELECT 1 FROM group_governance_votes
       WHERE proposal_id = ? AND voter_address = ?`,
    )
    .get(params.proposalId, normalizedVoter) as any | undefined;
  if (existing) {
    throw new Error(
      `voter ${normalizedVoter} has already voted on proposal ${params.proposalId}`,
    );
  }

  const now = nowIso();
  const voteId = `gvote_${ulid()}`;

  const event = await buildSignedGovernanceEvent({
    account: params.account,
    groupId: proposal.groupId,
    kind: "governance.proposal.voted",
    epoch: group.currentEpoch,
    actorAddress: params.voterAddress,
    actorAgentId: params.voterAgentId,
    payload: {
      proposalId: params.proposalId,
      voteId,
      vote: params.vote,
      reason: params.reason || null,
    },
    createdAt: now,
  });

  const voteRecord: GovernanceVoteRecord = {
    voteId,
    proposalId: params.proposalId,
    groupId: proposal.groupId,
    voterAddress: normalizedVoter,
    vote: params.vote,
    reason: params.reason ?? null,
    eventId: event.eventId,
    createdAt: now,
  };

  let updatedProposal: GovernanceProposalRecord;

  db.runTransaction(() => {
    insertGovernanceEvent(db, event);

    db.raw
      .prepare(
        `INSERT INTO group_governance_votes (
          vote_id, proposal_id, group_id, voter_address, vote,
          reason, event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        voteRecord.voteId,
        voteRecord.proposalId,
        voteRecord.groupId,
        voteRecord.voterAddress,
        voteRecord.vote,
        voteRecord.reason,
        voteRecord.eventId,
        voteRecord.createdAt,
      );

    // Update vote tallies
    if (params.vote === "approve") {
      db.raw
        .prepare(
          `UPDATE group_governance_proposals
           SET votes_approve = votes_approve + 1,
               votes_total = votes_total + 1,
               updated_at = ?
           WHERE proposal_id = ?`,
        )
        .run(now, params.proposalId);
    } else {
      db.raw
        .prepare(
          `UPDATE group_governance_proposals
           SET votes_reject = votes_reject + 1,
               votes_total = votes_total + 1,
               updated_at = ?
           WHERE proposal_id = ?`,
        )
        .run(now, params.proposalId);
    }
  });

  // Re-read updated proposal
  updatedProposal = getGovernanceProposal(db, params.proposalId)!;

  // Attempt auto-resolution
  updatedProposal = await resolveProposalIfReady(db, {
    account: params.account,
    proposalId: params.proposalId,
    actorAddress: params.voterAddress,
    actorAgentId: params.voterAgentId,
  });

  logger.info(
    `governance vote recorded: ${voteId} (${params.vote}) on ${params.proposalId}`,
  );

  return { vote: voteRecord, proposal: updatedProposal };
}

export async function resolveProposalIfReady(
  db: OpenFoxDatabase,
  params: {
    account: PrivateKeyAccount;
    proposalId: string;
    actorAddress: string;
    actorAgentId?: string;
  },
): Promise<GovernanceProposalRecord> {
  const proposal = getGovernanceProposal(db, params.proposalId);
  if (!proposal) {
    throw new Error(`proposal not found: ${params.proposalId}`);
  }
  if (proposal.status !== "active") {
    return proposal;
  }

  const group = getGroup(db, proposal.groupId);
  if (!group) {
    throw new Error(`group not found: ${proposal.groupId}`);
  }

  const policy = getGovernancePolicy(db, proposal.groupId, proposal.proposalType);
  const now = nowIso();

  // 1. Check expiry
  if (new Date(proposal.expiresAt) <= new Date(now)) {
    return await resolveProposal(db, {
      account: params.account,
      proposal,
      group,
      newStatus: "expired",
      actorAddress: params.actorAddress,
      actorAgentId: params.actorAgentId,
      now,
    });
  }

  const eligibleVoters = countEligibleVoters(
    db,
    proposal.groupId,
    policy.allowedVoterRoles,
  );

  // 2. Check quorum
  if (proposal.votesTotal < proposal.quorum) {
    return proposal;
  }

  // 3. Check threshold met (approved)
  const threshold =
    proposal.thresholdNumerator / proposal.thresholdDenominator;
  if (proposal.votesTotal > 0 && proposal.votesApprove / proposal.votesTotal >= threshold) {
    return await resolveProposal(db, {
      account: params.account,
      proposal,
      group,
      newStatus: "approved",
      actorAddress: params.actorAddress,
      actorAgentId: params.actorAgentId,
      now,
    });
  }

  // 4. Check if rejection is inevitable
  const remainingVotes = eligibleVoters - proposal.votesTotal;
  const maxPossibleApprovals = proposal.votesApprove + remainingVotes;
  const maxPossibleTotal = proposal.votesTotal + remainingVotes;
  if (
    maxPossibleTotal > 0 &&
    maxPossibleApprovals / maxPossibleTotal < threshold
  ) {
    return await resolveProposal(db, {
      account: params.account,
      proposal,
      group,
      newStatus: "rejected",
      actorAddress: params.actorAddress,
      actorAgentId: params.actorAgentId,
      now,
    });
  }

  return proposal;
}

async function resolveProposal(
  db: OpenFoxDatabase,
  params: {
    account: PrivateKeyAccount;
    proposal: GovernanceProposalRecord;
    group: { groupId: string; currentEpoch: number };
    newStatus: "approved" | "rejected" | "expired";
    actorAddress: string;
    actorAgentId?: string;
    now: string;
  },
): Promise<GovernanceProposalRecord> {
  const event = await buildSignedGovernanceEvent({
    account: params.account,
    groupId: params.proposal.groupId,
    kind: `governance.proposal.${params.newStatus}`,
    epoch: params.group.currentEpoch,
    actorAddress: params.actorAddress,
    actorAgentId: params.actorAgentId,
    payload: {
      proposalId: params.proposal.proposalId,
      status: params.newStatus,
      votesApprove: params.proposal.votesApprove,
      votesReject: params.proposal.votesReject,
      votesTotal: params.proposal.votesTotal,
    },
    createdAt: params.now,
  });

  db.runTransaction(() => {
    insertGovernanceEvent(db, event);
    db.raw
      .prepare(
        `UPDATE group_governance_proposals
         SET status = ?, resolved_event_id = ?, updated_at = ?
         WHERE proposal_id = ?`,
      )
      .run(
        params.newStatus,
        event.eventId,
        params.now,
        params.proposal.proposalId,
      );
  });

  logger.info(
    `governance proposal resolved: ${params.proposal.proposalId} -> ${params.newStatus}`,
  );

  return getGovernanceProposal(db, params.proposal.proposalId)!;
}

export async function executeApprovedProposal(
  db: OpenFoxDatabase,
  params: {
    account: PrivateKeyAccount;
    proposalId: string;
    actorAddress: string;
    actorAgentId?: string;
  },
): Promise<GovernanceProposalRecord> {
  const proposal = getGovernanceProposal(db, params.proposalId);
  if (!proposal) {
    throw new Error(`proposal not found: ${params.proposalId}`);
  }
  if (proposal.status !== "approved") {
    throw new Error(
      `proposal ${params.proposalId} is not approved (status: ${proposal.status})`,
    );
  }

  const group = getGroup(db, proposal.groupId);
  if (!group) {
    throw new Error(`group not found: ${proposal.groupId}`);
  }

  const now = nowIso();
  let executionResult: Record<string, unknown> = { executed: true };

  // Apply side effects based on proposal type
  switch (proposal.proposalType) {
    case "member_action": {
      const action = proposal.params.action as string | undefined;
      const targetAddress = proposal.params.targetAddress as
        | string
        | undefined;
      if (action && targetAddress) {
        executionResult = {
          executed: true,
          action,
          targetAddress,
          note: "member action dispatched via governance",
        };
      }
      break;
    }
    case "policy_change":
    case "config_change": {
      // Update groups table fields if provided
      const updates = proposal.params.updates as
        | Record<string, unknown>
        | undefined;
      if (updates) {
        const allowedFields = [
          "name",
          "description",
          "visibility",
          "join_mode",
          "max_members",
        ];
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          if (allowedFields.includes(key)) {
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }
        if (setClauses.length > 0) {
          values.push(now, proposal.groupId);
          db.raw
            .prepare(
              `UPDATE groups SET ${setClauses.join(", ")}, updated_at = ? WHERE group_id = ?`,
            )
            .run(...values);
          executionResult = {
            executed: true,
            updatedFields: Object.keys(updates).filter((k) =>
              allowedFields.includes(k),
            ),
          };
        }
      }
      break;
    }
    case "spend":
    case "treasury_config":
    case "external_action": {
      // Actual treasury/external execution handled by separate tasks
      executionResult = {
        executed: true,
        note: `${proposal.proposalType} marked as executed; actual execution is handled externally`,
      };
      break;
    }
  }

  const event = await buildSignedGovernanceEvent({
    account: params.account,
    groupId: proposal.groupId,
    kind: "governance.proposal.executed",
    epoch: group.currentEpoch,
    actorAddress: params.actorAddress,
    actorAgentId: params.actorAgentId,
    payload: {
      proposalId: params.proposalId,
      executionResult,
    },
    createdAt: now,
  });

  db.runTransaction(() => {
    insertGovernanceEvent(db, event);
    db.raw
      .prepare(
        `UPDATE group_governance_proposals
         SET status = 'executed', executed_event_id = ?,
             execution_result_json = ?, updated_at = ?
         WHERE proposal_id = ?`,
      )
      .run(
        event.eventId,
        JSON.stringify(executionResult),
        now,
        params.proposalId,
      );
  });

  logger.info(
    `governance proposal executed: ${params.proposalId}`,
  );

  return getGovernanceProposal(db, params.proposalId)!;
}

export async function expireStaleProposals(
  db: OpenFoxDatabase,
  groupId: string,
  account: PrivateKeyAccount,
  actorAddress: string,
): Promise<GovernanceProposalRecord[]> {
  const now = nowIso();
  const staleRows = db.raw
    .prepare(
      `SELECT * FROM group_governance_proposals
       WHERE group_id = ? AND status = 'active' AND expires_at <= ?`,
    )
    .all(groupId, now) as any[];

  const expired: GovernanceProposalRecord[] = [];
  for (const row of staleRows) {
    const proposal = mapProposalRow(row);
    const result = await resolveProposalIfReady(db, {
      account,
      proposalId: proposal.proposalId,
      actorAddress,
    });
    if (result.status === "expired") {
      expired.push(result);
    }
  }

  if (expired.length > 0) {
    logger.info(
      `expired ${expired.length} stale governance proposal(s) in ${groupId}`,
    );
  }

  return expired;
}

export function buildGovernanceV2Snapshot(
  db: OpenFoxDatabase,
  groupId: string,
): GovernanceSnapshot {
  const group = getGroup(db, groupId);
  if (!group) {
    throw new Error(`group not found: ${groupId}`);
  }

  const activeProposals = listGovernanceProposals(db, groupId, "active");
  const recentOutcomes = (
    db.raw
      .prepare(
        `SELECT * FROM group_governance_proposals
         WHERE group_id = ? AND status IN ('approved','rejected','expired','executed')
         ORDER BY updated_at DESC LIMIT 20`,
      )
      .all(groupId) as any[]
  ).map(mapProposalRow);

  const counts = db.raw
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'approved' OR status = 'executed' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired
       FROM group_governance_proposals
       WHERE group_id = ?`,
    )
    .get(groupId) as any;

  const policyRows = db.raw
    .prepare(
      `SELECT * FROM group_governance_policy WHERE group_id = ?`,
    )
    .all(groupId) as any[];

  return {
    groupId,
    activeProposals,
    recentOutcomes,
    policy: policyRows.map(mapPolicyRow),
    totalProposals: counts?.total ?? 0,
    totalApproved: counts?.approved ?? 0,
    totalRejected: counts?.rejected ?? 0,
    totalExpired: counts?.expired ?? 0,
  };
}

export function listGovernanceProposals(
  db: OpenFoxDatabase,
  groupId: string,
  status?: GovernanceProposalStatus,
): GovernanceProposalRecord[] {
  if (status) {
    return (
      db.raw
        .prepare(
          `SELECT * FROM group_governance_proposals
           WHERE group_id = ? AND status = ?
           ORDER BY created_at DESC`,
        )
        .all(groupId, status) as any[]
    ).map(mapProposalRow);
  }
  return (
    db.raw
      .prepare(
        `SELECT * FROM group_governance_proposals
         WHERE group_id = ?
         ORDER BY created_at DESC`,
      )
      .all(groupId) as any[]
  ).map(mapProposalRow);
}

export function getGovernanceProposal(
  db: OpenFoxDatabase,
  proposalId: string,
): GovernanceProposalRecord | undefined {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_governance_proposals WHERE proposal_id = ?`,
    )
    .get(proposalId) as any | undefined;
  return row ? mapProposalRow(row) : undefined;
}

export function getGovernanceProposalWithVotes(
  db: OpenFoxDatabase,
  proposalId: string,
): { proposal: GovernanceProposalRecord; votes: GovernanceVoteRecord[] } | undefined {
  const proposal = getGovernanceProposal(db, proposalId);
  if (!proposal) return undefined;
  const votes = (
    db.raw
      .prepare(
        `SELECT * FROM group_governance_votes
         WHERE proposal_id = ?
         ORDER BY created_at ASC`,
      )
      .all(proposalId) as any[]
  ).map(mapVoteRow);
  return { proposal, votes };
}
