/**
 * Intent Lifecycle State Machine
 *
 * Creates and manages IntentEnvelope transitions through the
 * intent processing pipeline.
 */

import { ulid } from "ulid";
import { BOUNDARY_SCHEMA_VERSION, type IntentEnvelope, type IntentStatus, type TerminalClass, type TrustTier } from "./types.js";

// Valid state transitions
const VALID_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  pending: ["planning", "cancelled", "expired"],
  planning: ["approved", "failed", "cancelled", "expired"],
  approved: ["executing", "cancelled", "expired"],
  executing: ["settled", "failed"],
  settled: [],
  failed: [],
  expired: [],
  cancelled: [],
};

export function createIntent(params: {
  action: string;
  requester: string;
  actorAgentId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  params: Record<string, unknown>;
  constraints?: IntentEnvelope["constraints"];
  ttlSeconds?: number;
}): IntentEnvelope {
  const now = Math.floor(Date.now() / 1000);
  return {
    intentId: ulid(),
    schemaVersion: BOUNDARY_SCHEMA_VERSION,
    action: params.action,
    requester: params.requester,
    actorAgentId: params.actorAgentId,
    terminalClass: params.terminalClass,
    trustTier: params.trustTier,
    params: params.params,
    constraints: params.constraints,
    createdAt: now,
    expiresAt: now + (params.ttlSeconds ?? 300),
    status: "pending",
  };
}

export function transitionIntent(intent: IntentEnvelope, newStatus: IntentStatus): IntentEnvelope {
  const allowed = VALID_TRANSITIONS[intent.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Invalid intent transition: ${intent.status} → ${newStatus}`);
  }
  return { ...intent, status: newStatus };
}

export function isIntentExpired(intent: IntentEnvelope): boolean {
  return Math.floor(Date.now() / 1000) > intent.expiresAt;
}

export function isIntentTerminal(intent: IntentEnvelope): boolean {
  return ["settled", "failed", "expired", "cancelled"].includes(intent.status);
}
