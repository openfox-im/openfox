/**
 * Intent Explanation, Policy Presets & Escalation Tests
 *
 * Tests for human-readable explanations, policy preset lookup,
 * policy simulation, and escalation evaluation.
 */

import { describe, it, expect } from "vitest";
import {
  createIntent,
  createPlan,
  explainIntent,
  explainPlan,
  formatApprovalPrompt,
  getPresetForTerminal,
  simulatePolicy,
  evaluateEscalation,
  POLICY_PRESETS,
  DEFAULT_ESCALATION_RULES,
} from "../intent/index.js";
import type { IntentEnvelope, PlanRecord, EscalationRule } from "../intent/index.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeIntent(overrides?: Partial<Parameters<typeof createIntent>[0]>): IntentEnvelope {
  return createIntent({
    action: "transfer",
    requester: "0xRequester1234567890abcdef1234567890abcdef",
    actorAgentId: "0xActor1234567890abcdef1234567890abcdef0000",
    terminalClass: "app",
    trustTier: 3,
    params: { to: "0xRecipient1234567890abcdef1234567890abcdef", value: "1000000000000000000" },
    ...overrides,
  });
}

function makePlan(intentId: string, overrides?: Partial<Parameters<typeof createPlan>[0]>): PlanRecord {
  return createPlan({
    intentId,
    provider: "0xProvider1234567890abcdef1234567890abcdef00",
    policyHash: "0xPolicyHash1234567890abcdef1234567890abcdef",
    estimatedGas: 50000,
    estimatedValue: "1000000000000000000",
    ...overrides,
  });
}

// ─── Explain Tests ───────────────────────────────────────────────

describe("Human-Readable Explanations", () => {
  describe("explainIntent", () => {
    it("generates readable text with action, terminal, and trust", () => {
      const intent = makeIntent();
      const text = explainIntent(intent);

      expect(text).toContain("Transfer");
      expect(text).toContain("app");
      expect(text).toContain("high trust");
    });

    it("includes value and recipient when present in params", () => {
      const intent = makeIntent({
        params: { to: "0xRecipient1234567890abcdef1234567890abcdef", value: "1000000000000000000" },
      });
      const text = explainIntent(intent);

      expect(text).toContain("to");
      expect(text).toContain("TOS");
    });
  });

  describe("explainPlan", () => {
    it("generates readable text with provider info", () => {
      const plan = makePlan("intent-123");
      const text = explainPlan(plan);

      expect(text).toContain("Execute via provider");
      expect(text).toContain("est. gas: 50000");
    });

    it("includes sponsor when present", () => {
      const plan = makePlan("intent-123", {
        sponsor: "0xSponsor1234567890abcdef1234567890abcdef00",
      });
      const text = explainPlan(plan);

      expect(text).toContain("sponsored by");
    });
  });

  describe("formatApprovalPrompt", () => {
    it("generates multi-line prompt with intent and plan details", () => {
      const intent = makeIntent();
      const plan = makePlan(intent.intentId);

      const prompt = formatApprovalPrompt(intent, plan);
      const lines = prompt.split("\n");

      expect(lines.length).toBeGreaterThan(5);
      expect(prompt).toContain("=== Intent Approval Required ===");
      expect(prompt).toContain("Action: transfer");
      expect(prompt).toContain(intent.intentId);
      expect(prompt).toContain("--- Execution Plan ---");
      expect(prompt).toContain("Estimated gas: 50000");
      expect(prompt).toContain("================================");
    });

    it("includes parameters section", () => {
      const intent = makeIntent({
        params: { to: "0xRecipient", value: "5000000000000000000" },
      });
      const plan = makePlan(intent.intentId);

      const prompt = formatApprovalPrompt(intent, plan);
      expect(prompt).toContain("Parameters:");
      expect(prompt).toContain("to: 0xRecipient");
    });
  });
});

// ─── Policy Presets Tests ────────────────────────────────────────

describe("Policy Presets", () => {
  describe("getPresetForTerminal", () => {
    it("returns correct preset for kiosk", () => {
      const preset = getPresetForTerminal("kiosk");
      expect(preset.terminalClass).toBe("kiosk");
      expect(preset.requiresApproval).toBe(true);
    });

    it("returns correct preset for pos", () => {
      const preset = getPresetForTerminal("pos");
      expect(preset.terminalClass).toBe("pos");
      expect(preset.trustTier).toBe(2);
    });

    it("returns correct preset for app", () => {
      const preset = getPresetForTerminal("app");
      expect(preset.terminalClass).toBe("app");
      expect(preset.trustTier).toBe(4);
    });

    it("returns correct preset for card", () => {
      const preset = getPresetForTerminal("card");
      expect(preset.terminalClass).toBe("card");
    });

    it("returns correct preset for voice", () => {
      const preset = getPresetForTerminal("voice");
      expect(preset.terminalClass).toBe("voice");
    });

    it("returns correct preset for robot", () => {
      const preset = getPresetForTerminal("robot");
      expect(preset.terminalClass).toBe("robot");
    });

    it("falls back to low-trust-public-terminal for unknown class", () => {
      const preset = getPresetForTerminal("api" as any);
      expect(preset.name).toBe("Low-Trust Public Terminal");
    });
  });

  describe("simulatePolicy", () => {
    it("allows valid action within limits", () => {
      const preset = POLICY_PRESETS["full-trust-app"]!;
      const result = simulatePolicy(preset, "transfer", "1000000000000000000"); // 1 TOS
      expect(result.allowed).toBe(true);
    });

    it("denies action not in allowed list", () => {
      const preset = POLICY_PRESETS["low-trust-public-terminal"]!;
      const result = simulatePolicy(preset, "stake", "0");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not permitted");
    });

    it("denies value exceeding single-transaction limit", () => {
      const preset = POLICY_PRESETS["low-trust-public-terminal"]!;
      // 100 TOS > 10 TOS limit
      const result = simulatePolicy(preset, "transfer", "100000000000000000000");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds single-transaction limit");
    });

    it("allows but notes approval requirement for kiosk preset", () => {
      const preset = POLICY_PRESETS["low-trust-public-terminal"]!;
      const result = simulatePolicy(preset, "transfer", "1000000000000000000"); // 1 TOS
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("requires approval");
    });

    it("allows without approval when below threshold", () => {
      const preset = POLICY_PRESETS["full-trust-app"]!;
      const result = simulatePolicy(preset, "transfer", "1000000000000000000"); // 1 TOS
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("without approval");
    });
  });
});

// ─── Escalation Tests ────────────────────────────────────────────

describe("Escalation", () => {
  describe("evaluateEscalation", () => {
    it("triggers on high value (above 1000 TOS)", () => {
      const intent = makeIntent({
        trustTier: 3,
        params: { to: "0xRecipient1234567890abcdef1234567890abcdef", value: "2000000000000000000000" },
        constraints: {
          allowedRecipients: ["0xRecipient1234567890abcdef1234567890abcdef"],
        },
      });
      const plan = makePlan(intent.intentId, {
        estimatedValue: "2000000000000000000000", // 2000 TOS
      });

      const result = evaluateEscalation(intent, plan, DEFAULT_ESCALATION_RULES);

      expect(result.escalated).toBe(true);
      expect(result.level).toBe("guardian");
      expect(result.reason).toContain("exceeds threshold");
    });

    it("triggers on low trust terminal (tier < 2)", () => {
      const intent = makeIntent({
        trustTier: 1, // low trust
        params: { to: "0xRecipient1234567890abcdef1234567890abcdef", value: "1000000000000000000" },
        constraints: {
          allowedRecipients: ["0xRecipient1234567890abcdef1234567890abcdef"],
        },
      });
      const plan = makePlan(intent.intentId, {
        estimatedValue: "1000000000000000000", // 1 TOS, below value thresholds
      });

      const result = evaluateEscalation(intent, plan, DEFAULT_ESCALATION_RULES);

      expect(result.escalated).toBe(true);
      expect(result.rules_triggered.some((r) => r.condition === "terminal_low_trust")).toBe(true);
    });

    it("does not trigger when all conditions are satisfied", () => {
      const intent = makeIntent({
        trustTier: 3, // above threshold of 2
        params: { to: "0xRecipient1234567890abcdef1234567890abcdef", value: "1000000000000000000" },
        constraints: {
          allowedRecipients: ["0xRecipient1234567890abcdef1234567890abcdef"],
        },
      });
      const plan = makePlan(intent.intentId, {
        estimatedValue: "1000000000000000000", // 1 TOS, below both value thresholds
      });

      const result = evaluateEscalation(intent, plan, DEFAULT_ESCALATION_RULES);

      // The only rule that should trigger is recipient_unknown (no whitelist triggers it)
      // Wait - we have allowedRecipients that includes the recipient, so it should pass
      // value_above 100 TOS: 1 TOS < 100, pass
      // value_above 1000 TOS: 1 TOS < 1000, pass
      // recipient_unknown: recipient is in whitelist, pass
      // terminal_low_trust: trust 3 >= 2, pass
      // action_restricted: "transfer" not in "stake,delegate,withdraw", pass
      expect(result.escalated).toBe(false);
      expect(result.level).toBe("none");
    });

    it("triggers on restricted action", () => {
      const intent = makeIntent({
        action: "stake",
        trustTier: 3,
        params: { to: "0xRecipient1234567890abcdef1234567890abcdef", value: "1000000000000000000" },
        constraints: {
          allowedRecipients: ["0xRecipient1234567890abcdef1234567890abcdef"],
        },
      });
      const plan = makePlan(intent.intentId, {
        estimatedValue: "1000000000000000000",
      });

      const result = evaluateEscalation(intent, plan, DEFAULT_ESCALATION_RULES);

      expect(result.escalated).toBe(true);
      expect(result.rules_triggered.some((r) => r.condition === "action_restricted")).toBe(true);
      expect(result.level).toBe("guardian");
    });

    it("returns no escalation when rules array is empty", () => {
      const intent = makeIntent();
      const plan = makePlan(intent.intentId);

      const result = evaluateEscalation(intent, plan, []);
      expect(result.escalated).toBe(false);
      expect(result.level).toBe("none");
      expect(result.rules_triggered).toHaveLength(0);
    });

    it("escalation level is deny when a deny rule triggers", () => {
      const denyRules: EscalationRule[] = [
        { condition: "value_above", threshold: "0", action: "deny" },
      ];
      const intent = makeIntent({
        params: { value: "1" },
      });
      const plan = makePlan(intent.intentId, { estimatedValue: "1" });

      const result = evaluateEscalation(intent, plan, denyRules);
      expect(result.escalated).toBe(true);
      expect(result.level).toBe("deny");
    });
  });
});
