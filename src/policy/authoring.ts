/**
 * Policy Authoring
 *
 * Create, validate, explain, and diff policy drafts for OpenFox accounts.
 * Supports template-based creation across account types and trust levels.
 */

import type { TerminalClass, TrustTier } from "../intent/types.js";
import type { EscalationRule } from "../intent/escalation.js";

export interface TerminalPolicyConfig {
  enabled: boolean;
  maxSingleValue: string;
  maxDailyValue: string;
  minTrustTier: TrustTier;
  allowedActions: string[];
}

export interface PolicyDraft {
  name: string;
  accountType: "personal" | "merchant" | "agent" | "institutional";
  terminalPolicies: Map<TerminalClass, TerminalPolicyConfig>;
  spendCaps: { daily: string; singleTx: string };
  allowlist: { enabled: boolean; addresses: string[] };
  delegation: { enabled: boolean; maxDelegates: number; defaultExpiry: number };
  guardian: { address?: string; recoveryTimelock: number };
  escalationRules: EscalationRule[];
  privacyRestrictions: { weakTerminalBlocked: boolean; maxPrivateValue: string };
}

/** Compare two wei strings numerically. Returns negative if a < b, 0 if equal, positive if a > b. */
function compareWei(a: string, b: string): number {
  const aBig = BigInt(a || "0");
  const bBig = BigInt(b || "0");
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}

/** Format a wei string to a human-friendly token string. */
function formatWei(wei: string): string {
  if (!wei || wei === "0") return "0 TOS";
  if (wei.length <= 18) return "<1 TOS";
  const integerPart = wei.slice(0, wei.length - 18);
  return `${integerPart} TOS`;
}

// ── Default terminal configs by trust level ──────────────────────

const TERMINAL_CLASSES: TerminalClass[] = ["app", "card", "pos", "voice", "kiosk", "robot", "api"];

interface TrustProfile {
  maxSingleBase: string;
  maxDailyBase: string;
  kiosk: { enabled: boolean; minTrust: TrustTier };
  robot: { enabled: boolean; minTrust: TrustTier };
  actions: string[];
}

const TRUST_PROFILES: Record<string, TrustProfile> = {
  conservative: {
    maxSingleBase: "10000000000000000000",     // 10 TOS
    maxDailyBase: "50000000000000000000",       // 50 TOS
    kiosk: { enabled: false, minTrust: 3 },
    robot: { enabled: false, minTrust: 4 },
    actions: ["transfer"],
  },
  standard: {
    maxSingleBase: "100000000000000000000",    // 100 TOS
    maxDailyBase: "1000000000000000000000",     // 1000 TOS
    kiosk: { enabled: true, minTrust: 2 },
    robot: { enabled: true, minTrust: 2 },
    actions: ["transfer", "subscribe", "swap"],
  },
  permissive: {
    maxSingleBase: "10000000000000000000000",  // 10000 TOS
    maxDailyBase: "100000000000000000000000",   // 100000 TOS
    kiosk: { enabled: true, minTrust: 1 },
    robot: { enabled: true, minTrust: 1 },
    actions: ["transfer", "subscribe", "swap", "stake", "delegate", "withdraw"],
  },
};

// Multipliers per account type (applied to the trust profile base values)
const ACCOUNT_MULTIPLIERS: Record<string, bigint> = {
  personal: 1n,
  merchant: 5n,
  agent: 2n,
  institutional: 50n,
};

function buildTerminalPolicies(
  trustLevel: string,
  accountType: string,
): Map<TerminalClass, TerminalPolicyConfig> {
  const profile = TRUST_PROFILES[trustLevel] ?? TRUST_PROFILES["standard"]!;
  const multiplier = ACCOUNT_MULTIPLIERS[accountType] ?? 1n;
  const map = new Map<TerminalClass, TerminalPolicyConfig>();

  for (const tc of TERMINAL_CLASSES) {
    const isRestricted = tc === "kiosk" || tc === "robot";
    const restrictedConf = tc === "kiosk" ? profile.kiosk : tc === "robot" ? profile.robot : null;

    const enabled = restrictedConf ? restrictedConf.enabled : true;
    const minTrust: TrustTier = restrictedConf ? restrictedConf.minTrust : (tc === "api" ? 2 : 1) as TrustTier;

    const maxSingle = String(BigInt(profile.maxSingleBase) * multiplier * (isRestricted ? 1n : 1n));
    const maxDaily = String(BigInt(profile.maxDailyBase) * multiplier * (isRestricted ? 1n : 1n));

    map.set(tc, {
      enabled,
      maxSingleValue: maxSingle,
      maxDailyValue: maxDaily,
      minTrustTier: minTrust,
      allowedActions: isRestricted ? profile.actions.slice(0, 1) : [...profile.actions],
    });
  }

  return map;
}

function defaultEscalationRules(trustLevel: string): EscalationRule[] {
  switch (trustLevel) {
    case "conservative":
      return [
        { condition: "value_above", threshold: "50000000000000000000", action: "require_guardian" },
        { condition: "value_above", threshold: "10000000000000000000", action: "require_approval" },
        { condition: "recipient_unknown", action: "require_approval" },
        { condition: "terminal_low_trust", threshold: "3", action: "deny" },
        { condition: "action_restricted", threshold: "stake,delegate,withdraw", action: "deny" },
        { condition: "privacy_action_weak_terminal", threshold: "3", action: "deny" },
        { condition: "privacy_action_high_value", threshold: "25000000000000000000", action: "require_guardian" },
      ];
    case "permissive":
      return [
        { condition: "value_above", threshold: "5000000000000000000000", action: "require_guardian" },
        { condition: "value_above", threshold: "1000000000000000000000", action: "require_approval" },
        { condition: "privacy_action_weak_terminal", threshold: "2", action: "deny" },
        { condition: "privacy_action_high_value", threshold: "2000000000000000000000", action: "require_guardian" },
      ];
    default: // standard
      return [
        { condition: "value_above", threshold: "1000000000000000000000", action: "require_guardian" },
        { condition: "value_above", threshold: "100000000000000000000", action: "require_approval" },
        { condition: "recipient_unknown", action: "require_approval" },
        { condition: "terminal_low_trust", threshold: "2", action: "require_approval" },
        { condition: "action_restricted", threshold: "stake,delegate,withdraw", action: "require_guardian" },
        { condition: "privacy_action_weak_terminal", threshold: "2", action: "deny" },
        { condition: "privacy_action_high_value", threshold: "500000000000000000000", action: "require_guardian" },
      ];
  }
}

/**
 * Create a policy draft from a template based on account type and trust level.
 */
export function createPolicyFromTemplate(
  accountType: string,
  trustLevel: string,
): PolicyDraft {
  const validAccounts = ["personal", "merchant", "agent", "institutional"];
  const validTrust = ["conservative", "standard", "permissive"];
  const acct = validAccounts.includes(accountType) ? accountType as PolicyDraft["accountType"] : "personal";
  const trust = validTrust.includes(trustLevel) ? trustLevel : "standard";

  const multiplier = ACCOUNT_MULTIPLIERS[acct] ?? 1n;
  const profile = TRUST_PROFILES[trust] ?? TRUST_PROFILES["standard"]!;

  return {
    name: `${acct}-${trust}`,
    accountType: acct,
    terminalPolicies: buildTerminalPolicies(trust, acct),
    spendCaps: {
      daily: String(BigInt(profile.maxDailyBase) * multiplier),
      singleTx: String(BigInt(profile.maxSingleBase) * multiplier),
    },
    allowlist: {
      enabled: trust === "conservative",
      addresses: [],
    },
    delegation: {
      enabled: acct !== "personal" || trust === "permissive",
      maxDelegates: acct === "institutional" ? 10 : acct === "merchant" ? 5 : 3,
      defaultExpiry: trust === "conservative" ? 3600 : trust === "standard" ? 86400 : 604800,
    },
    guardian: {
      recoveryTimelock: trust === "conservative" ? 172800 : trust === "standard" ? 86400 : 43200,
    },
    escalationRules: defaultEscalationRules(trust),
    privacyRestrictions: {
      weakTerminalBlocked: trust !== "permissive",
      maxPrivateValue: trust === "conservative"
        ? "25000000000000000000"
        : trust === "standard"
          ? "500000000000000000000"
          : "2000000000000000000000",
    },
  };
}

/**
 * Validate a policy draft for consistency.
 * Returns errors for misconfigurations and logical inconsistencies.
 */
export function validatePolicy(draft: PolicyDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Name required
  if (!draft.name || draft.name.trim().length === 0) {
    errors.push("Policy name is required");
  }

  // Spend caps must be positive
  if (compareWei(draft.spendCaps.singleTx, "0") <= 0) {
    errors.push("Single-transaction spend cap must be greater than zero");
  }
  if (compareWei(draft.spendCaps.daily, "0") <= 0) {
    errors.push("Daily spend cap must be greater than zero");
  }

  // Single tx cap should not exceed daily cap
  if (compareWei(draft.spendCaps.singleTx, draft.spendCaps.daily) > 0) {
    errors.push("Single-transaction cap exceeds daily cap");
  }

  // Each terminal policy: maxSingleValue <= maxDailyValue
  for (const [tc, config] of draft.terminalPolicies) {
    if (config.enabled && compareWei(config.maxSingleValue, config.maxDailyValue) > 0) {
      errors.push(`Terminal ${tc}: single-tx limit exceeds daily limit`);
    }
    if (config.enabled && config.allowedActions.length === 0) {
      errors.push(`Terminal ${tc}: enabled but has no allowed actions`);
    }
    if (config.minTrustTier < 0 || config.minTrustTier > 4) {
      errors.push(`Terminal ${tc}: invalid minimum trust tier ${config.minTrustTier}`);
    }
  }

  // Delegation sanity
  if (draft.delegation.enabled && draft.delegation.maxDelegates <= 0) {
    errors.push("Delegation enabled but maxDelegates is zero or negative");
  }

  // Guardian recovery timelock
  if (draft.guardian.recoveryTimelock <= 0) {
    errors.push("Guardian recovery timelock must be positive");
  }

  // Privacy restrictions
  if (compareWei(draft.privacyRestrictions.maxPrivateValue, "0") <= 0) {
    errors.push("Max private value must be greater than zero");
  }

  // Escalation rules must have valid conditions
  const validConditions = new Set([
    "value_above", "recipient_unknown", "terminal_low_trust",
    "action_restricted", "privacy_action_weak_terminal", "privacy_action_high_value",
  ]);
  for (const rule of draft.escalationRules) {
    if (!validConditions.has(rule.condition)) {
      errors.push(`Unknown escalation condition: ${rule.condition}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate a human-readable summary of a policy draft.
 */
export function explainPolicy(draft: PolicyDraft): string {
  const lines: string[] = [];

  lines.push(`=== Policy: ${draft.name} ===`);
  lines.push(`Account type: ${draft.accountType}`);
  lines.push("");

  // Spend caps
  lines.push("Spend Caps:");
  lines.push(`  Daily:          ${formatWei(draft.spendCaps.daily)}`);
  lines.push(`  Single tx:      ${formatWei(draft.spendCaps.singleTx)}`);
  lines.push("");

  // Terminal policies
  lines.push("Terminal Policies:");
  for (const [tc, config] of draft.terminalPolicies) {
    const status = config.enabled ? "enabled" : "disabled";
    lines.push(`  ${tc}: ${status}`);
    if (config.enabled) {
      lines.push(`    Max single: ${formatWei(config.maxSingleValue)}, Max daily: ${formatWei(config.maxDailyValue)}`);
      lines.push(`    Min trust tier: ${config.minTrustTier}, Actions: ${config.allowedActions.join(", ")}`);
    }
  }
  lines.push("");

  // Allowlist
  lines.push(`Allowlist: ${draft.allowlist.enabled ? "enabled" : "disabled"}`);
  if (draft.allowlist.enabled && draft.allowlist.addresses.length > 0) {
    lines.push(`  Addresses: ${draft.allowlist.addresses.join(", ")}`);
  }
  lines.push("");

  // Delegation
  lines.push(`Delegation: ${draft.delegation.enabled ? "enabled" : "disabled"}`);
  if (draft.delegation.enabled) {
    lines.push(`  Max delegates: ${draft.delegation.maxDelegates}`);
    lines.push(`  Default expiry: ${draft.delegation.defaultExpiry}s`);
  }
  lines.push("");

  // Guardian
  lines.push("Guardian:");
  if (draft.guardian.address) {
    lines.push(`  Address: ${draft.guardian.address}`);
  } else {
    lines.push("  Address: not set");
  }
  lines.push(`  Recovery timelock: ${draft.guardian.recoveryTimelock}s`);
  lines.push("");

  // Escalation rules
  lines.push(`Escalation Rules (${draft.escalationRules.length}):`);
  for (const rule of draft.escalationRules) {
    const threshold = rule.threshold ? ` [threshold: ${rule.threshold}]` : "";
    lines.push(`  ${rule.condition} -> ${rule.action}${threshold}`);
  }
  lines.push("");

  // Privacy
  lines.push("Privacy Restrictions:");
  lines.push(`  Weak terminal blocked: ${draft.privacyRestrictions.weakTerminalBlocked}`);
  lines.push(`  Max private value: ${formatWei(draft.privacyRestrictions.maxPrivateValue)}`);

  return lines.join("\n");
}

/**
 * Diff two policies and return a list of human-readable difference descriptions.
 */
export function diffPolicies(a: PolicyDraft, b: PolicyDraft): string[] {
  const diffs: string[] = [];

  if (a.name !== b.name) {
    diffs.push(`Name: "${a.name}" -> "${b.name}"`);
  }
  if (a.accountType !== b.accountType) {
    diffs.push(`Account type: ${a.accountType} -> ${b.accountType}`);
  }

  // Spend caps
  if (a.spendCaps.daily !== b.spendCaps.daily) {
    diffs.push(`Daily spend cap: ${formatWei(a.spendCaps.daily)} -> ${formatWei(b.spendCaps.daily)}`);
  }
  if (a.spendCaps.singleTx !== b.spendCaps.singleTx) {
    diffs.push(`Single-tx spend cap: ${formatWei(a.spendCaps.singleTx)} -> ${formatWei(b.spendCaps.singleTx)}`);
  }

  // Terminal policies
  const allTerminals = new Set<TerminalClass>([...a.terminalPolicies.keys(), ...b.terminalPolicies.keys()]);
  for (const tc of allTerminals) {
    const ac = a.terminalPolicies.get(tc);
    const bc = b.terminalPolicies.get(tc);
    if (!ac && bc) {
      diffs.push(`Terminal ${tc}: added`);
    } else if (ac && !bc) {
      diffs.push(`Terminal ${tc}: removed`);
    } else if (ac && bc) {
      if (ac.enabled !== bc.enabled) {
        diffs.push(`Terminal ${tc} enabled: ${ac.enabled} -> ${bc.enabled}`);
      }
      if (ac.maxSingleValue !== bc.maxSingleValue) {
        diffs.push(`Terminal ${tc} max single: ${formatWei(ac.maxSingleValue)} -> ${formatWei(bc.maxSingleValue)}`);
      }
      if (ac.maxDailyValue !== bc.maxDailyValue) {
        diffs.push(`Terminal ${tc} max daily: ${formatWei(ac.maxDailyValue)} -> ${formatWei(bc.maxDailyValue)}`);
      }
      if (ac.minTrustTier !== bc.minTrustTier) {
        diffs.push(`Terminal ${tc} min trust: ${ac.minTrustTier} -> ${bc.minTrustTier}`);
      }
      const aActions = ac.allowedActions.join(",");
      const bActions = bc.allowedActions.join(",");
      if (aActions !== bActions) {
        diffs.push(`Terminal ${tc} actions: [${aActions}] -> [${bActions}]`);
      }
    }
  }

  // Allowlist
  if (a.allowlist.enabled !== b.allowlist.enabled) {
    diffs.push(`Allowlist enabled: ${a.allowlist.enabled} -> ${b.allowlist.enabled}`);
  }

  // Delegation
  if (a.delegation.enabled !== b.delegation.enabled) {
    diffs.push(`Delegation enabled: ${a.delegation.enabled} -> ${b.delegation.enabled}`);
  }
  if (a.delegation.maxDelegates !== b.delegation.maxDelegates) {
    diffs.push(`Max delegates: ${a.delegation.maxDelegates} -> ${b.delegation.maxDelegates}`);
  }

  // Guardian
  if (a.guardian.recoveryTimelock !== b.guardian.recoveryTimelock) {
    diffs.push(`Recovery timelock: ${a.guardian.recoveryTimelock}s -> ${b.guardian.recoveryTimelock}s`);
  }

  // Privacy
  if (a.privacyRestrictions.weakTerminalBlocked !== b.privacyRestrictions.weakTerminalBlocked) {
    diffs.push(`Weak terminal blocked: ${a.privacyRestrictions.weakTerminalBlocked} -> ${b.privacyRestrictions.weakTerminalBlocked}`);
  }
  if (a.privacyRestrictions.maxPrivateValue !== b.privacyRestrictions.maxPrivateValue) {
    diffs.push(`Max private value: ${formatWei(a.privacyRestrictions.maxPrivateValue)} -> ${formatWei(b.privacyRestrictions.maxPrivateValue)}`);
  }

  // Escalation rules count
  if (a.escalationRules.length !== b.escalationRules.length) {
    diffs.push(`Escalation rules: ${a.escalationRules.length} -> ${b.escalationRules.length}`);
  }

  return diffs;
}
