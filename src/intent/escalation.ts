/**
 * Approval Escalation Logic
 *
 * Evaluates intent+plan pairs against escalation rules to determine
 * whether additional approval, guardian intervention, or denial is
 * required before execution proceeds.
 */

import { TrustTierLabels, type IntentEnvelope, type PlanRecord, type TrustTier } from "./types.js";

export interface EscalationRule {
  condition: "value_above" | "recipient_unknown" | "terminal_low_trust" | "action_restricted" | "privacy_action_weak_terminal" | "privacy_action_high_value" | "contract_high_risk";
  /** Wei string threshold for value_above / privacy_action_high_value; trust tier threshold for terminal_low_trust / privacy_action_weak_terminal. */
  threshold?: string;
  action: "require_approval" | "require_guardian" | "deny";
}

/** Actions classified as privacy-tier operations. */
const PRIVACY_ACTIONS = ["shield", "unshield", "priv_transfer"] as const;

function isPrivacyAction(action: string): boolean {
  return (PRIVACY_ACTIONS as readonly string[]).includes(action);
}

export interface EscalationResult {
  escalated: boolean;
  level: "none" | "approval" | "guardian" | "deny";
  reason: string;
  rules_triggered: EscalationRule[];
}

/** Compare two wei strings. Returns true if a > b. */
function weiAbove(a: string, b: string): boolean {
  return BigInt(a || "0") > BigInt(b || "0");
}

/** Resolve the effective value from the plan or intent params. */
function resolveValue(intent: IntentEnvelope, plan: PlanRecord): string {
  // Prefer plan's estimated value, fall back to intent params
  if (plan.estimatedValue && plan.estimatedValue !== "0") return plan.estimatedValue;
  if (typeof intent.params["value"] === "string") return intent.params["value"] as string;
  return "0";
}

/** Resolve the recipient from intent params. */
function resolveRecipient(intent: IntentEnvelope): string | undefined {
  if (typeof intent.params["to"] === "string") return intent.params["to"] as string;
  if (typeof intent.params["recipient"] === "string") return intent.params["recipient"] as string;
  return undefined;
}

/**
 * Evaluate a single rule against an intent and plan.
 * Returns a reason string if the rule triggers, or undefined if it does not.
 */
function evaluateRule(
  rule: EscalationRule,
  intent: IntentEnvelope,
  plan: PlanRecord,
): string | undefined {
  switch (rule.condition) {
    case "value_above": {
      if (!rule.threshold) return undefined;
      const value = resolveValue(intent, plan);
      if (weiAbove(value, rule.threshold)) {
        return `Transaction value (${value} wei) exceeds threshold (${rule.threshold} wei)`;
      }
      return undefined;
    }

    case "recipient_unknown": {
      const recipient = resolveRecipient(intent);
      if (!recipient) {
        return "No recipient specified in the intent";
      }
      // Check against allowed recipients in constraints
      const allowed = intent.constraints?.allowedRecipients;
      if (allowed && allowed.length > 0 && !allowed.includes(recipient)) {
        return `Recipient ${recipient} is not in the allowed recipients list`;
      }
      // If no constraint list exists, the recipient is considered unknown when the
      // rule is present — the rule's purpose is to flag any transfer without a
      // pre-approved recipient whitelist.
      if (!allowed || allowed.length === 0) {
        return `Recipient ${recipient} cannot be verified (no allowed-recipients whitelist)`;
      }
      return undefined;
    }

    case "terminal_low_trust": {
      const tierThreshold = rule.threshold ? parseInt(rule.threshold, 10) : 2;
      if (intent.trustTier < (tierThreshold as TrustTier)) {
        return `Terminal trust tier (${TrustTierLabels[intent.trustTier]}, ${intent.trustTier}) is below required minimum (${tierThreshold})`;
      }
      return undefined;
    }

    case "action_restricted": {
      // The threshold field encodes a comma-separated list of restricted actions
      if (!rule.threshold) return undefined;
      const restricted = rule.threshold.split(",").map((s) => s.trim());
      if (restricted.includes(intent.action)) {
        return `Action "${intent.action}" is restricted`;
      }
      return undefined;
    }

    case "privacy_action_weak_terminal": {
      if (!isPrivacyAction(intent.action)) return undefined;
      const tierThreshold = rule.threshold ? parseInt(rule.threshold, 10) : 2;
      if (intent.trustTier < (tierThreshold as TrustTier)) {
        return `Privacy action "${intent.action}" attempted from weak terminal (trust tier ${intent.trustTier} < ${tierThreshold})`;
      }
      return undefined;
    }

    case "privacy_action_high_value": {
      if (!isPrivacyAction(intent.action)) return undefined;
      if (!rule.threshold) return undefined;
      const value = resolveValue(intent, plan);
      if (weiAbove(value, rule.threshold)) {
        return `Privacy action "${intent.action}" with high value (${value} wei) exceeds threshold (${rule.threshold} wei)`;
      }
      return undefined;
    }

    case "contract_high_risk": {
      // This condition is injected by the pipeline when contract metadata
      // indicates high-risk functions. It always triggers when present
      // because the pipeline only adds it when the contract is high-risk.
      return "Contract metadata indicates high-risk functions";
    }

    default:
      return undefined;
  }
}

/** Determine the highest escalation level from a set of actions. */
function highestLevel(actions: EscalationRule["action"][]): "none" | "approval" | "guardian" | "deny" {
  if (actions.includes("deny")) return "deny";
  if (actions.includes("require_guardian")) return "guardian";
  if (actions.includes("require_approval")) return "approval";
  return "none";
}

/**
 * Evaluate an intent and plan against a set of escalation rules.
 *
 * Returns an EscalationResult describing whether escalation is needed,
 * which level, a human-readable reason, and the list of triggered rules.
 */
export function evaluateEscalation(
  intent: IntentEnvelope,
  plan: PlanRecord,
  rules: EscalationRule[],
): EscalationResult {
  const triggered: EscalationRule[] = [];
  const reasons: string[] = [];

  for (const rule of rules) {
    const reason = evaluateRule(rule, intent, plan);
    if (reason !== undefined) {
      triggered.push(rule);
      reasons.push(reason);
    }
  }

  if (triggered.length === 0) {
    return {
      escalated: false,
      level: "none",
      reason: "No escalation rules triggered",
      rules_triggered: [],
    };
  }

  const level = highestLevel(triggered.map((r) => r.action));
  const combinedReason = reasons.join("; ");

  return {
    escalated: true,
    level,
    reason: combinedReason,
    rules_triggered: triggered,
  };
}

// ── Approval Escalation Chains ─────────────────────────────────────

/**
 * A step in a multi-level approval escalation chain.
 * If approval is not received within `timeoutSeconds`, the request
 * automatically escalates to the next step in the chain.
 */
export interface ApprovalEscalationStep {
  /** The approval level for this step. */
  level: "approval" | "guardian" | "committee";
  /** Role required to approve at this level. */
  approverRole: "requester" | "guardian" | "owner" | "committee";
  /** Seconds to wait for approval before escalating to the next step. 0 = no timeout. */
  timeoutSeconds: number;
  /** Optional: specific approver address required at this step. */
  approverAddress?: string;
  /** Optional: human-readable label for this step. */
  label?: string;
}

/**
 * An approval escalation chain defines a sequence of escalation steps.
 * If each step times out without approval, the next step is tried.
 * If the final step times out, the action is denied.
 */
export interface ApprovalEscalationChain {
  /** Chain identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Ordered list of escalation steps (first = lowest, last = highest). */
  steps: ApprovalEscalationStep[];
  /** If true, deny the action when the final step times out. Otherwise leave pending. */
  denyOnFinalTimeout: boolean;
}

/**
 * The current state of an in-progress approval escalation.
 */
export interface ApprovalEscalationState {
  chainId: string;
  intentId: string;
  currentStepIndex: number;
  stepStartedAt: number;
  status: "pending" | "approved" | "denied" | "timed_out";
  approvedBy?: string;
  approvedAtLevel?: string;
  history: Array<{
    stepIndex: number;
    level: string;
    result: "timed_out" | "approved" | "denied";
    timestamp: number;
  }>;
}

/**
 * Select the appropriate escalation chain based on escalation result.
 * Higher escalation levels get chains with more steps and broader approver sets.
 */
export function selectEscalationChain(
  result: EscalationResult,
  chains: ApprovalEscalationChain[],
): ApprovalEscalationChain | undefined {
  if (!result.escalated || result.level === "none") return undefined;
  if (result.level === "deny") return undefined;

  // Match by level: guardian-level gets a chain with guardian step,
  // approval-level gets a simpler chain
  if (result.level === "guardian") {
    return chains.find((c) => c.steps.some((s) => s.level === "guardian")) ?? chains[0];
  }
  // For approval level, prefer a chain that starts with approval
  return chains.find((c) => c.steps[0]?.level === "approval") ?? chains[0];
}

/**
 * Start a new approval escalation for an intent.
 */
export function startApprovalEscalation(
  chain: ApprovalEscalationChain,
  intentId: string,
  now: number,
): ApprovalEscalationState {
  return {
    chainId: chain.id,
    intentId,
    currentStepIndex: 0,
    stepStartedAt: now,
    status: "pending",
    history: [],
  };
}

/**
 * Advance an escalation state: check timeouts and move to the next step if needed.
 * Returns the updated state and whether the step changed.
 */
export function advanceEscalation(
  state: ApprovalEscalationState,
  chain: ApprovalEscalationChain,
  now: number,
): { state: ApprovalEscalationState; advanced: boolean } {
  if (state.status !== "pending") {
    return { state, advanced: false };
  }

  const currentStep = chain.steps[state.currentStepIndex];
  if (!currentStep) {
    // No more steps — deny or leave timed_out
    return {
      state: { ...state, status: chain.denyOnFinalTimeout ? "denied" : "timed_out" },
      advanced: false,
    };
  }

  // Check if current step has timed out
  if (currentStep.timeoutSeconds > 0) {
    const elapsed = now - state.stepStartedAt;
    if (elapsed >= currentStep.timeoutSeconds) {
      // Record timeout in history
      const history = [
        ...state.history,
        {
          stepIndex: state.currentStepIndex,
          level: currentStep.level,
          result: "timed_out" as const,
          timestamp: now,
        },
      ];

      const nextIndex = state.currentStepIndex + 1;
      if (nextIndex >= chain.steps.length) {
        // Final step timed out
        return {
          state: {
            ...state,
            currentStepIndex: nextIndex,
            history,
            status: chain.denyOnFinalTimeout ? "denied" : "timed_out",
          },
          advanced: true,
        };
      }

      // Escalate to next step
      return {
        state: {
          ...state,
          currentStepIndex: nextIndex,
          stepStartedAt: now,
          history,
        },
        advanced: true,
      };
    }
  }

  return { state, advanced: false };
}

/**
 * Record an approval at the current escalation step.
 */
export function resolveEscalationApproval(
  state: ApprovalEscalationState,
  chain: ApprovalEscalationChain,
  approvedBy: string,
  now: number,
): ApprovalEscalationState {
  const currentStep = chain.steps[state.currentStepIndex];
  if (!currentStep || state.status !== "pending") return state;

  return {
    ...state,
    status: "approved",
    approvedBy,
    approvedAtLevel: currentStep.level,
    history: [
      ...state.history,
      {
        stepIndex: state.currentStepIndex,
        level: currentStep.level,
        result: "approved",
        timestamp: now,
      },
    ],
  };
}

/**
 * Record a denial at the current escalation step.
 */
export function resolveEscalationDenial(
  state: ApprovalEscalationState,
  chain: ApprovalEscalationChain,
  now: number,
): ApprovalEscalationState {
  const currentStep = chain.steps[state.currentStepIndex];
  if (!currentStep || state.status !== "pending") return state;

  return {
    ...state,
    status: "denied",
    history: [
      ...state.history,
      {
        stepIndex: state.currentStepIndex,
        level: currentStep.level,
        result: "denied",
        timestamp: now,
      },
    ],
  };
}

/**
 * Get a human-readable description of the current escalation state.
 */
export function describeEscalationState(
  state: ApprovalEscalationState,
  chain: ApprovalEscalationChain,
): string {
  if (state.status === "approved") {
    return `Approved by ${state.approvedBy ?? "unknown"} at ${state.approvedAtLevel ?? "unknown"} level`;
  }
  if (state.status === "denied") {
    return `Denied at step ${state.currentStepIndex + 1} of ${chain.steps.length}`;
  }
  if (state.status === "timed_out") {
    return `Timed out after all ${chain.steps.length} escalation steps`;
  }

  const currentStep = chain.steps[state.currentStepIndex];
  if (!currentStep) return "Escalation complete (no more steps)";

  const label = currentStep.label ?? `${currentStep.level} (${currentStep.approverRole})`;
  const timeoutInfo = currentStep.timeoutSeconds > 0
    ? `, timeout ${currentStep.timeoutSeconds}s`
    : ", no timeout";

  return `Awaiting ${label} — step ${state.currentStepIndex + 1} of ${chain.steps.length}${timeoutInfo}`;
}

/**
 * Default approval escalation chains for common scenarios.
 */
export const DEFAULT_ESCALATION_CHAINS: ApprovalEscalationChain[] = [
  {
    id: "standard-approval",
    name: "Standard Approval Chain",
    steps: [
      {
        level: "approval",
        approverRole: "requester",
        timeoutSeconds: 300,
        label: "Requester self-approval",
      },
      {
        level: "guardian",
        approverRole: "guardian",
        timeoutSeconds: 3600,
        label: "Guardian review",
      },
    ],
    denyOnFinalTimeout: true,
  },
  {
    id: "guardian-approval",
    name: "Guardian Approval Chain",
    steps: [
      {
        level: "guardian",
        approverRole: "guardian",
        timeoutSeconds: 1800,
        label: "Guardian approval",
      },
      {
        level: "committee",
        approverRole: "committee",
        timeoutSeconds: 7200,
        label: "Committee override",
      },
    ],
    denyOnFinalTimeout: true,
  },
  {
    id: "institutional-approval",
    name: "Institutional Multi-Sig Chain",
    steps: [
      {
        level: "approval",
        approverRole: "requester",
        timeoutSeconds: 600,
        label: "Requester initiation",
      },
      {
        level: "guardian",
        approverRole: "guardian",
        timeoutSeconds: 3600,
        label: "Guardian co-sign",
      },
      {
        level: "committee",
        approverRole: "committee",
        timeoutSeconds: 86400,
        label: "Committee ratification",
      },
    ],
    denyOnFinalTimeout: false,
  },
];

/**
 * Default escalation rules providing reasonable safety defaults:
 * 1. High-value transactions (>1000 TOS) require guardian approval
 * 2. Medium-value transactions (>100 TOS) require standard approval
 * 3. Unknown recipients require approval
 * 4. Low-trust terminals require approval
 * 5. Restricted actions (stake, delegate) require guardian
 */
export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    condition: "value_above",
    threshold: "1000000000000000000000", // 1000 TOS
    action: "require_guardian",
  },
  {
    condition: "value_above",
    threshold: "100000000000000000000", // 100 TOS
    action: "require_approval",
  },
  {
    condition: "recipient_unknown",
    action: "require_approval",
  },
  {
    condition: "terminal_low_trust",
    threshold: "2", // require at least tier 2
    action: "require_approval",
  },
  {
    condition: "action_restricted",
    threshold: "stake,delegate,withdraw",
    action: "require_guardian",
  },
  {
    condition: "privacy_action_weak_terminal",
    threshold: "2", // require at least tier 2 for privacy actions
    action: "deny",
  },
  {
    condition: "privacy_action_high_value",
    threshold: "500000000000000000000", // 500 TOS
    action: "require_guardian",
  },
];
