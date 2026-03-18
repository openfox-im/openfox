/**
 * Intent-Signer/Paymaster Bridge
 *
 * Bridges intent IDs into the existing signer-provider and paymaster-provider
 * flows by attaching intent metadata to requests and extracting it from
 * responses. This allows the full intent lifecycle to be correlated with
 * on-chain signer executions and paymaster authorizations.
 */

import type { TerminalClass, TrustTier } from "./types.js";

// ── Intent-aware request wrappers ─────────────────────────────────────

/**
 * Wraps a signer execution request with intent context.
 * The extra fields are serialised as metadata headers/params so the
 * signer provider can log and correlate them.
 */
export interface IntentSignerRequest {
  intentId: string;
  planId: string;
  providerBaseUrl: string;
  requesterAddress: string;
  quoteId: string;
  target: string;
  valueWei?: string;
  data?: string;
  gas?: string;
  requestNonce: string;
  requestExpiresAt: number;
  reason?: string;
}

/**
 * Wraps a paymaster authorization request with intent context.
 */
export interface IntentPaymasterRequest {
  intentId: string;
  planId: string;
  providerBaseUrl: string;
  requesterAddress: string;
  walletAddress?: string;
  target: string;
  valueWei?: string;
  data?: string;
  gas?: string;
  requestNonce: string;
  requestExpiresAt: number;
  reason?: string;
}

// ── Metadata keys (prefixed to avoid collisions) ──────────────────────

const META_PREFIX = "x-openfox-intent-";

const META_KEYS = {
  intentId: `${META_PREFIX}id`,
  planId: `${META_PREFIX}plan-id`,
  terminalClass: `${META_PREFIX}terminal-class`,
  trustTier: `${META_PREFIX}trust-tier`,
} as const;

/**
 * Create a metadata record that can be merged into signer/paymaster
 * request headers or body fields to carry intent context through the
 * provider round-trip.
 */
export function createIntentMetadata(
  intentId: string,
  planId: string,
  terminalClass: TerminalClass,
  trustTier: TrustTier,
): Record<string, string> {
  return {
    [META_KEYS.intentId]: intentId,
    [META_KEYS.planId]: planId,
    [META_KEYS.terminalClass]: terminalClass,
    [META_KEYS.trustTier]: String(trustTier),
  };
}

/**
 * Extract intent metadata from a completed signer or paymaster execution
 * response. Returns the intentId and planId if present, or undefined
 * fields if the execution did not carry intent metadata.
 */
export function extractIntentFromExecution(
  execution: Record<string, unknown>,
): { intentId?: string; planId?: string } {
  // Check top-level fields first (provider may echo metadata back)
  const intentId = extractString(execution, META_KEYS.intentId)
    ?? extractString(execution, "intentId")
    ?? extractString(execution, "intent_id");

  const planId = extractString(execution, META_KEYS.planId)
    ?? extractString(execution, "planId")
    ?? extractString(execution, "plan_id");

  // Check nested metadata/headers objects
  if (intentId || planId) {
    return { intentId: intentId ?? undefined, planId: planId ?? undefined };
  }

  // Try nested metadata object
  const meta = execution["metadata"] ?? execution["headers"];
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const nested = meta as Record<string, unknown>;
    return {
      intentId: extractString(nested, META_KEYS.intentId)
        ?? extractString(nested, "intentId")
        ?? extractString(nested, "intent_id")
        ?? undefined,
      planId: extractString(nested, META_KEYS.planId)
        ?? extractString(nested, "planId")
        ?? extractString(nested, "plan_id")
        ?? undefined,
    };
  }

  return {};
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}
