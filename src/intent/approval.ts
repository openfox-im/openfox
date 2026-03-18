/**
 * Approval Lifecycle State Machine
 *
 * Creates and manages ApprovalRecord transitions for intent authorization.
 */

import { ulid } from "ulid";
import { BOUNDARY_SCHEMA_VERSION, type AgentRole, type ApprovalRecord, type ApprovalScope, type ApprovalStatus, type TerminalClass, type TrustTier } from "./types.js";

const VALID_APPROVAL_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending: ["granted", "denied", "expired"],
  granted: ["revoked"],
  denied: [],
  revoked: [],
  expired: [],
};

export function createApproval(params: {
  intentId: string;
  planId: string;
  approver: string;
  approverRole: AgentRole;
  accountId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  policyHash: string;
  approvalProofRef?: string;
  scope?: ApprovalScope;
  ttlSeconds?: number;
}): ApprovalRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    approvalId: ulid(),
    intentId: params.intentId,
    planId: params.planId,
    schemaVersion: BOUNDARY_SCHEMA_VERSION,
    approver: params.approver,
    approverRole: params.approverRole,
    accountId: params.accountId,
    terminalClass: params.terminalClass,
    trustTier: params.trustTier,
    policyHash: params.policyHash,
    approvalProofRef: params.approvalProofRef,
    scope: params.scope,
    createdAt: now,
    expiresAt: now + (params.ttlSeconds ?? 60),
    status: "pending",
  };
}

export function transitionApproval(approval: ApprovalRecord, newStatus: ApprovalStatus): ApprovalRecord {
  const allowed = VALID_APPROVAL_TRANSITIONS[approval.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Invalid approval transition: ${approval.status} → ${newStatus}`);
  }
  return { ...approval, status: newStatus };
}

export function isApprovalExpired(approval: ApprovalRecord): boolean {
  return Math.floor(Date.now() / 1000) > approval.expiresAt;
}

export function isApprovalValid(approval: ApprovalRecord): boolean {
  return approval.status === "granted" && !isApprovalExpired(approval);
}
