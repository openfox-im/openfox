/**
 * Policy Preset Templates
 *
 * Predefined policy configurations for common terminal classes and trust
 * scenarios. Includes simulation to test whether an action would be
 * allowed under a given preset.
 */

import type { TerminalClass, TrustTier } from "./types.js";

export interface PolicyPreset {
  name: string;
  description: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  /** Maximum value for a single transaction (wei string). */
  maxSingleValue: string;
  /** Maximum aggregate value per 24-hour window (wei string). */
  maxDailyValue: string;
  /** Whether human approval is required before execution. */
  requiresApproval: boolean;
  /** Value threshold above which approval is always required (wei string). */
  approvalThreshold: string;
  /** List of action names permitted under this preset. */
  allowedActions: string[];
}

/** Compare two wei strings numerically. Returns negative if a < b, 0 if equal, positive if a > b. */
function compareWei(a: string, b: string): number {
  const aBig = BigInt(a || "0");
  const bBig = BigInt(b || "0");
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}

export const POLICY_PRESETS: Record<string, PolicyPreset> = {
  "low-trust-public-terminal": {
    name: "Low-Trust Public Terminal",
    description: "Strict limits for untrusted public kiosks and shared terminals. Approval required for all transactions.",
    terminalClass: "kiosk",
    trustTier: 1,
    maxSingleValue: "10000000000000000000",    // 10 TOS
    maxDailyValue: "50000000000000000000",      // 50 TOS
    requiresApproval: true,
    approvalThreshold: "0",
    allowedActions: ["transfer"],
  },

  "merchant-pos": {
    name: "Merchant POS",
    description: "Standard point-of-sale terminal for retail merchants. Moderate limits with approval above threshold.",
    terminalClass: "pos",
    trustTier: 2,
    maxSingleValue: "100000000000000000000",   // 100 TOS
    maxDailyValue: "1000000000000000000000",    // 1000 TOS
    requiresApproval: false,
    approvalThreshold: "50000000000000000000",  // 50 TOS
    allowedActions: ["transfer", "subscribe"],
  },

  "personal-voice-node": {
    name: "Personal Voice Node",
    description: "Voice-activated personal assistant node with medium trust. Limited action set.",
    terminalClass: "voice",
    trustTier: 2,
    maxSingleValue: "50000000000000000000",    // 50 TOS
    maxDailyValue: "200000000000000000000",     // 200 TOS
    requiresApproval: false,
    approvalThreshold: "25000000000000000000",  // 25 TOS
    allowedActions: ["transfer", "subscribe", "swap"],
  },

  "card-present-retail": {
    name: "Card-Present Retail",
    description: "Physical card terminal for in-person retail transactions. Higher limits than POS due to card verification.",
    terminalClass: "card",
    trustTier: 3,
    maxSingleValue: "500000000000000000000",   // 500 TOS
    maxDailyValue: "5000000000000000000000",    // 5000 TOS
    requiresApproval: false,
    approvalThreshold: "200000000000000000000", // 200 TOS
    allowedActions: ["transfer", "subscribe", "swap"],
  },

  "robot-api-automation": {
    name: "Robot API Automation",
    description: "Automated robot or API integration. Restricted actions with mandatory approval for larger amounts.",
    terminalClass: "robot",
    trustTier: 2,
    maxSingleValue: "20000000000000000000",    // 20 TOS
    maxDailyValue: "100000000000000000000",     // 100 TOS
    requiresApproval: false,
    approvalThreshold: "10000000000000000000",  // 10 TOS
    allowedActions: ["transfer"],
  },

  "full-trust-app": {
    name: "Full-Trust App",
    description: "Fully trusted first-party application with high limits and broad permissions. No approval required below threshold.",
    terminalClass: "app",
    trustTier: 4,
    maxSingleValue: "10000000000000000000000",  // 10000 TOS
    maxDailyValue: "100000000000000000000000",   // 100000 TOS
    requiresApproval: false,
    approvalThreshold: "5000000000000000000000", // 5000 TOS
    allowedActions: ["transfer", "subscribe", "swap", "stake", "delegate", "withdraw"],
  },
};

/**
 * Find the best-matching preset for a given terminal class.
 * Returns the first preset whose terminalClass matches, or the
 * "low-trust-public-terminal" preset as a safe fallback.
 */
export function getPresetForTerminal(terminalClass: TerminalClass): PolicyPreset {
  for (const preset of Object.values(POLICY_PRESETS)) {
    if (preset.terminalClass === terminalClass) {
      return preset;
    }
  }
  // Fallback to the most restrictive preset
  return POLICY_PRESETS["low-trust-public-terminal"]!;
}

export interface PolicySimulationResult {
  allowed: boolean;
  reason: string;
}

/**
 * Simulate whether a given action at a given value would be permitted
 * under a policy preset. Does not track daily aggregates (stateless check).
 */
export function simulatePolicy(
  preset: PolicyPreset,
  action: string,
  value: string,
): PolicySimulationResult {
  // Check if the action is in the allowed list
  if (!preset.allowedActions.includes(action)) {
    return {
      allowed: false,
      reason: `Action "${action}" is not permitted under the "${preset.name}" policy. Allowed actions: ${preset.allowedActions.join(", ")}.`,
    };
  }

  // Check single-transaction value limit
  if (compareWei(value, preset.maxSingleValue) > 0) {
    return {
      allowed: false,
      reason: `Value exceeds single-transaction limit of ${preset.maxSingleValue} wei under the "${preset.name}" policy.`,
    };
  }

  // Check if the value exceeds the daily limit (single-tx cannot exceed daily)
  if (compareWei(value, preset.maxDailyValue) > 0) {
    return {
      allowed: false,
      reason: `Value exceeds daily limit of ${preset.maxDailyValue} wei under the "${preset.name}" policy.`,
    };
  }

  // Check if approval is always required
  if (preset.requiresApproval) {
    return {
      allowed: true,
      reason: `Action "${action}" is allowed but requires approval under the "${preset.name}" policy.`,
    };
  }

  // Check if value exceeds the approval threshold
  if (compareWei(value, preset.approvalThreshold) > 0) {
    return {
      allowed: true,
      reason: `Action "${action}" is allowed but exceeds approval threshold of ${preset.approvalThreshold} wei; approval required.`,
    };
  }

  return {
    allowed: true,
    reason: `Action "${action}" with value ${value} wei is permitted under the "${preset.name}" policy without approval.`,
  };
}
