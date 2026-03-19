/**
 * Policy Simulation
 *
 * Simulate actions against a PolicyDraft to determine whether they would be
 * allowed, escalated, or blocked. Includes a standard battery of test
 * scenarios and table-formatted output.
 */

import type { TerminalClass, TrustTier } from "../intent/types.js";
import type { PolicyDraft } from "./authoring.js";

export interface SimulationScenario {
  action: string;
  value: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  recipient?: string;
  isPrivacy?: boolean;
}

export interface SimulationResult {
  scenario: SimulationScenario;
  allowed: boolean;
  escalationLevel: string;
  blockedBy?: string;
  explanation: string;
}

/** Compare two tomi strings. Returns true if a > b. */
function weiAbove(a: string, b: string): boolean {
  return BigInt(a || "0") > BigInt(b || "0");
}

/** Privacy-tier actions. */
const PRIVACY_ACTIONS = new Set(["shield", "unshield", "priv_transfer"]);

/**
 * Simulate a single scenario against a policy draft.
 */
export function simulateScenario(policy: PolicyDraft, scenario: SimulationScenario): SimulationResult {
  const { action, value, terminalClass, trustTier, recipient, isPrivacy } = scenario;

  // 1. Check terminal policy
  const termConfig = policy.terminalPolicies.get(terminalClass);
  if (!termConfig || !termConfig.enabled) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "terminal_disabled",
      explanation: `Terminal class "${terminalClass}" is disabled in this policy.`,
    };
  }

  // 2. Check trust tier
  if (trustTier < termConfig.minTrustTier) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "trust_tier",
      explanation: `Trust tier ${trustTier} is below the minimum ${termConfig.minTrustTier} for "${terminalClass}".`,
    };
  }

  // 3. Check allowed actions on this terminal
  if (!termConfig.allowedActions.includes(action)) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "action_not_allowed",
      explanation: `Action "${action}" is not allowed on "${terminalClass}". Allowed: ${termConfig.allowedActions.join(", ")}.`,
    };
  }

  // 4. Check terminal single-tx value limit
  if (weiAbove(value, termConfig.maxSingleValue)) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "terminal_single_value",
      explanation: `Value exceeds terminal single-tx limit for "${terminalClass}".`,
    };
  }

  // 5. Check terminal daily value limit (stateless, just checks single tx against daily)
  if (weiAbove(value, termConfig.maxDailyValue)) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "terminal_daily_value",
      explanation: `Value exceeds terminal daily limit for "${terminalClass}".`,
    };
  }

  // 6. Check global spend caps
  if (weiAbove(value, policy.spendCaps.singleTx)) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "global_single_cap",
      explanation: `Value exceeds global single-transaction spend cap.`,
    };
  }
  if (weiAbove(value, policy.spendCaps.daily)) {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "global_daily_cap",
      explanation: `Value exceeds global daily spend cap.`,
    };
  }

  // 7. Check privacy restrictions
  const isPrivacyAction = isPrivacy || PRIVACY_ACTIONS.has(action);
  if (isPrivacyAction) {
    if (policy.privacyRestrictions.weakTerminalBlocked && trustTier < 2) {
      return {
        scenario,
        allowed: false,
        escalationLevel: "deny",
        blockedBy: "privacy_weak_terminal",
        explanation: `Privacy action blocked on weak terminal (trust tier ${trustTier}).`,
      };
    }
    if (weiAbove(value, policy.privacyRestrictions.maxPrivateValue)) {
      return {
        scenario,
        allowed: false,
        escalationLevel: "deny",
        blockedBy: "privacy_value_limit",
        explanation: `Privacy action value exceeds max private value limit.`,
      };
    }
  }

  // 8. Check allowlist
  if (policy.allowlist.enabled && recipient) {
    if (policy.allowlist.addresses.length > 0 && !policy.allowlist.addresses.includes(recipient)) {
      return {
        scenario,
        allowed: false,
        escalationLevel: "deny",
        blockedBy: "allowlist",
        explanation: `Recipient "${recipient}" is not in the allowlist.`,
      };
    }
  }

  // 9. Evaluate escalation rules
  let highestEscalation = "none";
  let escalationReason = "";

  for (const rule of policy.escalationRules) {
    let triggered = false;

    switch (rule.condition) {
      case "value_above":
        if (rule.threshold && weiAbove(value, rule.threshold)) triggered = true;
        break;
      case "recipient_unknown":
        if (recipient && policy.allowlist.enabled && policy.allowlist.addresses.length > 0
            && !policy.allowlist.addresses.includes(recipient)) {
          triggered = true;
        } else if (!recipient) {
          triggered = true;
        }
        break;
      case "terminal_low_trust": {
        const minTier = rule.threshold ? parseInt(rule.threshold, 10) : 2;
        if (trustTier < minTier) triggered = true;
        break;
      }
      case "action_restricted":
        if (rule.threshold) {
          const restricted = rule.threshold.split(",").map((s) => s.trim());
          if (restricted.includes(action)) triggered = true;
        }
        break;
      case "privacy_action_weak_terminal":
        if (isPrivacyAction) {
          const minTier = rule.threshold ? parseInt(rule.threshold, 10) : 2;
          if (trustTier < minTier) triggered = true;
        }
        break;
      case "privacy_action_high_value":
        if (isPrivacyAction && rule.threshold && weiAbove(value, rule.threshold)) {
          triggered = true;
        }
        break;
    }

    if (triggered) {
      const levelPriority: Record<string, number> = { none: 0, require_approval: 1, require_guardian: 2, deny: 3 };
      const currentPriority = levelPriority[highestEscalation] ?? 0;
      const rulePriority = levelPriority[rule.action] ?? 0;
      if (rulePriority > currentPriority) {
        highestEscalation = rule.action === "require_approval" ? "approval"
          : rule.action === "require_guardian" ? "guardian"
            : rule.action === "deny" ? "deny" : "none";
        escalationReason = `Escalation rule "${rule.condition}" triggered -> ${rule.action}`;
      }
    }
  }

  if (highestEscalation === "deny") {
    return {
      scenario,
      allowed: false,
      escalationLevel: "deny",
      blockedBy: "escalation_rule",
      explanation: escalationReason,
    };
  }

  if (highestEscalation !== "none") {
    return {
      scenario,
      allowed: true,
      escalationLevel: highestEscalation,
      explanation: `Allowed with ${highestEscalation}. ${escalationReason}`,
    };
  }

  return {
    scenario,
    allowed: true,
    escalationLevel: "none",
    explanation: `Action "${action}" with value ${value} tomi is fully permitted.`,
  };
}

/**
 * Run a standard battery of test scenarios against a policy draft.
 */
export function simulateBattery(policy: PolicyDraft): SimulationResult[] {
  const scenarios: SimulationScenario[] = [
    // Basic transfers at various values
    { action: "transfer", value: "1000000000000000000", terminalClass: "app", trustTier: 3 },         // 1 TOS via app
    { action: "transfer", value: "50000000000000000000", terminalClass: "app", trustTier: 3 },        // 50 TOS via app
    { action: "transfer", value: "500000000000000000000", terminalClass: "app", trustTier: 3 },       // 500 TOS via app
    { action: "transfer", value: "5000000000000000000000", terminalClass: "app", trustTier: 3 },      // 5000 TOS via app

    // Transfers via different terminals
    { action: "transfer", value: "10000000000000000000", terminalClass: "pos", trustTier: 2 },        // 10 TOS via POS
    { action: "transfer", value: "10000000000000000000", terminalClass: "kiosk", trustTier: 1 },      // 10 TOS via kiosk low trust
    { action: "transfer", value: "10000000000000000000", terminalClass: "voice", trustTier: 2 },      // 10 TOS via voice
    { action: "transfer", value: "10000000000000000000", terminalClass: "robot", trustTier: 2 },      // 10 TOS via robot

    // Actions beyond transfer
    { action: "swap", value: "100000000000000000000", terminalClass: "app", trustTier: 3 },           // 100 TOS swap
    { action: "stake", value: "1000000000000000000000", terminalClass: "app", trustTier: 4 },         // 1000 TOS stake
    { action: "delegate", value: "500000000000000000000", terminalClass: "app", trustTier: 3 },       // 500 TOS delegate

    // Privacy actions
    { action: "shield", value: "50000000000000000000", terminalClass: "app", trustTier: 3, isPrivacy: true },
    { action: "priv_transfer", value: "1000000000000000000000", terminalClass: "app", trustTier: 3, isPrivacy: true },
    { action: "shield", value: "10000000000000000000", terminalClass: "kiosk", trustTier: 1, isPrivacy: true },

    // With unknown recipient
    { action: "transfer", value: "100000000000000000000", terminalClass: "app", trustTier: 3, recipient: "0x0000000000000000000000000000000000000001" },
  ];

  return scenarios.map((scenario) => simulateScenario(policy, scenario));
}

/**
 * Format simulation results as a readable table.
 */
export function formatSimulationResults(results: SimulationResult[]): string {
  const lines: string[] = [];

  // Header
  lines.push(
    padRight("Action", 16)
    + padRight("Terminal", 10)
    + padRight("Trust", 7)
    + padRight("Value (TOS)", 14)
    + padRight("Allowed", 9)
    + padRight("Escalation", 12)
    + "Explanation",
  );
  lines.push("-".repeat(120));

  for (const r of results) {
    const valueTos = formatTos(r.scenario.value);
    const allowed = r.allowed ? "YES" : "NO";
    const action = r.scenario.isPrivacy ? `${r.scenario.action}*` : r.scenario.action;

    lines.push(
      padRight(action, 16)
      + padRight(r.scenario.terminalClass, 10)
      + padRight(String(r.scenario.trustTier), 7)
      + padRight(valueTos, 14)
      + padRight(allowed, 9)
      + padRight(r.escalationLevel, 12)
      + truncate(r.explanation, 60),
    );
  }

  lines.push("");
  lines.push(`Total scenarios: ${results.length}`);
  lines.push(`Allowed: ${results.filter((r) => r.allowed).length}`);
  lines.push(`Blocked: ${results.filter((r) => !r.allowed).length}`);
  lines.push(`Requiring escalation: ${results.filter((r) => r.allowed && r.escalationLevel !== "none").length}`);

  return lines.join("\n");
}

function formatTos(tomi: string): string {
  if (!tomi || tomi === "0") return "0";
  if (tomi.length <= 18) return "<1";
  return tomi.slice(0, tomi.length - 18);
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 3) + "..." : s;
}
