/**
 * Pipeline Types
 *
 * GTOS 2046: End-to-end intent execution pipeline types.
 * Defines configuration, result, and step types for the
 * orchestration flow that wires together all 2046 modules.
 */

export interface PipelineConfig {
  defaultTTL: number;
  sponsorPolicy: import("../sponsor/types.js").SponsorPolicy;
  routingPolicy: import("../routing/types.js").RoutingPolicy;
  escalationRules: import("../intent/escalation.js").EscalationRule[];
  autoApprove: boolean;         // auto-approve if escalation level is "none"
  auditEnabled: boolean;
}

export interface PipelineResult {
  success: boolean;
  intentId: string;
  planId?: string;
  approvalId?: string;
  receiptId?: string;
  txHash?: string;
  error?: string;
  timeline: string[];           // human-readable step log
}

export type PipelineStep =
  | "create_intent"
  | "evaluate_terminal"
  | "discover_route"
  | "select_sponsor"
  | "create_plan"
  | "evaluate_escalation"
  | "request_approval"
  | "execute"
  | "create_receipt"
  | "audit_log";
