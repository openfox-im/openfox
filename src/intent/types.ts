/**
 * Intent Module - Shared Boundary Types & Intent Types
 *
 * Defines the GTOS 2046 boundary types and intent lifecycle types
 * used across the OpenFox intent processing pipeline.
 */

// === Shared Boundary Types (matching GTOS boundary package) ===

export const BOUNDARY_SCHEMA_VERSION = "0.1.0";

export type TerminalClass = "app" | "card" | "pos" | "voice" | "kiosk" | "robot" | "api";

export type TrustTier = 0 | 1 | 2 | 3 | 4;
export const TrustTierLabels: Record<TrustTier, string> = {
  0: "untrusted",
  1: "low",
  2: "medium",
  3: "high",
  4: "full",
};

export type AgentRole = "requester" | "actor" | "provider" | "sponsor" | "signer" | "gateway" | "oracle" | "counterparty" | "guardian";

// === Intent Types ===

export type IntentStatus = "pending" | "planning" | "approved" | "executing" | "settled" | "failed" | "expired" | "cancelled";

export interface IntentConstraints {
  maxValue?: string;          // tomi string
  allowedRecipients?: string[];
  requiredTrustTier?: TrustTier;
  maxGas?: number;
  deadline?: number;          // unix timestamp
}

export interface IntentEnvelope {
  intentId: string;
  schemaVersion: string;
  action: string;             // "transfer", "swap", "subscribe", etc.
  requester: string;          // address
  actorAgentId: string;       // address
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  params: Record<string, unknown>;
  constraints?: IntentConstraints;
  createdAt: number;
  expiresAt: number;
  status: IntentStatus;
}

export type PlanStatus = "draft" | "ready" | "approved" | "executing" | "completed" | "failed" | "expired";

export interface RouteStep {
  target: string;
  action: string;
  value?: string;
  artifactRef?: string;
}

export interface PlanRecord {
  planId: string;
  intentId: string;
  schemaVersion: string;
  provider: string;
  sponsor?: string;
  artifactRef?: string;
  abiRef?: string;
  policyHash: string;
  sponsorPolicyHash?: string;
  effectsHash?: string;
  estimatedGas: number;
  estimatedValue: string;
  route?: RouteStep[];
  fallbackPlanId?: string;
  createdAt: number;
  expiresAt: number;
  status: PlanStatus;
}

export type ApprovalStatus = "pending" | "granted" | "denied" | "revoked" | "expired";

export interface ApprovalScope {
  maxValue?: string;
  allowedActions?: string[];
  allowedTargets?: string[];
  terminalClasses?: TerminalClass[];
  minTrustTier?: TrustTier;
}

export interface ApprovalRecord {
  approvalId: string;
  intentId: string;
  planId: string;
  schemaVersion: string;
  approver: string;
  approverRole: AgentRole;
  accountId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  policyHash: string;
  approvalProofRef?: string;
  scope?: ApprovalScope;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
}

export type ReceiptStatus = "success" | "failed" | "reverted";

export interface ExecutionReceipt {
  receiptId: string;
  intentId: string;
  planId: string;
  approvalId: string;
  schemaVersion: string;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  from: string;
  to: string;
  sponsor?: string;
  actorAgentId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  policyHash: string;
  sponsorPolicyHash?: string;
  artifactRef?: string;
  effectsHash?: string;
  gasUsed: number;
  value: string;
  receiptStatus: ReceiptStatus;
  proofRef?: string;
  receiptRef?: string;
  settledAt: number;
}
