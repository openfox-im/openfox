/**
 * Policy Templates by Account Type and Trust Tier
 *
 * Predefined policy configurations covering the matrix of account types
 * (personal, merchant, agent, institutional) and trust levels
 * (conservative, standard, permissive).
 */

import { createPolicyFromTemplate, type PolicyDraft } from "./authoring.js";

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  accountType: "personal" | "merchant" | "agent" | "institutional";
  trustLevel: "conservative" | "standard" | "permissive";
  draft: PolicyDraft;
}

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  // ── Personal accounts ──────────────────────────────────────────
  {
    id: "personal-conservative",
    name: "Personal Conservative",
    description: "Strict personal wallet with low limits, allowlist enforcement, and guardian approval for most actions. Ideal for cold-storage or savings accounts.",
    accountType: "personal",
    trustLevel: "conservative",
    draft: createPolicyFromTemplate("personal", "conservative"),
  },
  {
    id: "personal-standard",
    name: "Personal Standard",
    description: "Balanced personal wallet with moderate limits and escalation for high-value or restricted actions. Suitable for daily use.",
    accountType: "personal",
    trustLevel: "standard",
    draft: createPolicyFromTemplate("personal", "standard"),
  },
  {
    id: "personal-permissive",
    name: "Personal Permissive",
    description: "High-limit personal wallet with broad permissions and minimal escalation. For power users comfortable with self-custody risk.",
    accountType: "personal",
    trustLevel: "permissive",
    draft: createPolicyFromTemplate("personal", "permissive"),
  },

  // ── Merchant accounts ──────────────────────────────────────────
  {
    id: "merchant-pos",
    name: "Merchant POS",
    description: "Standard merchant point-of-sale policy with elevated limits for retail volume. Supports transfer and subscription actions.",
    accountType: "merchant",
    trustLevel: "standard",
    draft: createPolicyFromTemplate("merchant", "standard"),
  },
  {
    id: "merchant-online",
    name: "Merchant Online",
    description: "Conservative merchant policy for online/e-commerce. Lower limits with allowlist and guardian protection against fraud.",
    accountType: "merchant",
    trustLevel: "conservative",
    draft: createPolicyFromTemplate("merchant", "conservative"),
  },

  // ── Agent accounts ─────────────────────────────────────────────
  {
    id: "agent-autonomous",
    name: "Agent Autonomous",
    description: "Permissive agent policy for fully autonomous operation. High limits and broad action set with minimal human-in-the-loop.",
    accountType: "agent",
    trustLevel: "permissive",
    draft: createPolicyFromTemplate("agent", "permissive"),
  },
  {
    id: "agent-supervised",
    name: "Agent Supervised",
    description: "Standard agent policy requiring approval escalation for significant actions. Suitable for semi-autonomous agents with human oversight.",
    accountType: "agent",
    trustLevel: "standard",
    draft: createPolicyFromTemplate("agent", "standard"),
  },

  // ── Institutional accounts ─────────────────────────────────────
  {
    id: "institutional-treasury",
    name: "Institutional Treasury",
    description: "Conservative institutional treasury policy with very high absolute limits but strict guardian approval, allowlist enforcement, and multi-sig escalation.",
    accountType: "institutional",
    trustLevel: "conservative",
    draft: createPolicyFromTemplate("institutional", "conservative"),
  },
];

/**
 * Get all templates matching a given account type.
 */
export function getTemplatesForAccountType(accountType: string): PolicyTemplate[] {
  return POLICY_TEMPLATES.filter((t) => t.accountType === accountType);
}

/**
 * Get a single template by its ID.
 */
export function getTemplate(id: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.id === id);
}
