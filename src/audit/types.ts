/**
 * Audit Journal Types
 *
 * GTOS 2046 Phase 6: Audit, Proof, and Receipt Convergence
 * Defines types for the append-only audit journal and grouped reporting.
 */

export type AuditEntryKind =
  | "intent_created"
  | "intent_transition"
  | "plan_created"
  | "plan_selected"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "sponsor_selected"
  | "execution_submitted"
  | "execution_settled"
  | "execution_failed"
  | "policy_decision"
  | "terminal_session_created"
  | "terminal_session_revoked"
  | "delegation_granted"
  | "delegation_revoked"
  | "recovery_initiated"
  | "recovery_completed";

export interface AuditEntry {
  entryId: string;            // ULID
  kind: AuditEntryKind;
  timestamp: number;          // unix seconds

  // Cross-reference IDs
  intentId?: string;
  planId?: string;
  approvalId?: string;
  receiptId?: string;

  // Actor info
  actorAddress?: string;
  actorRole?: string;         // "requester", "provider", "sponsor", etc.

  // Terminal info
  terminalClass?: string;
  terminalId?: string;
  trustTier?: number;

  // Policy info
  policyHash?: string;
  policyDecision?: string;    // "allow", "deny", "escalate"

  // Transaction info
  txHash?: string;
  sponsorAddress?: string;
  value?: string;

  // Details
  summary: string;            // human-readable one-line summary
  details?: Record<string, unknown>;
}

export interface AuditQuery {
  intentId?: string;
  planId?: string;
  actorAddress?: string;
  terminalClass?: string;
  sponsorAddress?: string;
  kind?: AuditEntryKind | AuditEntryKind[];
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
  offset?: number;
}

export interface AuditReport {
  title: string;
  generatedAt: number;
  entries: AuditEntry[];
  summary: AuditReportSummary;
}

export interface AuditReportSummary {
  totalEntries: number;
  byKind: Record<string, number>;
  byTerminal: Record<string, number>;
  byActor: Record<string, number>;
  bySponsor: Record<string, number>;
  totalValue: string;
  timeRange: { from: number; to: number };
}
