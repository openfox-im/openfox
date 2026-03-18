/**
 * Intent Lifecycle Tests
 *
 * Tests for the intent module: creation, state transitions,
 * expiration, plan/approval/receipt lifecycle.
 */

import { describe, it, expect } from "vitest";
import {
  createIntent,
  transitionIntent,
  isIntentExpired,
  isIntentTerminal,
  createPlan,
  transitionPlan,
  createApproval,
  createReceipt,
  BOUNDARY_SCHEMA_VERSION,
} from "../intent/index.js";
import type { IntentEnvelope, PlanRecord, ApprovalRecord } from "../intent/index.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeIntent(overrides?: Partial<Parameters<typeof createIntent>[0]>): IntentEnvelope {
  return createIntent({
    action: "transfer",
    requester: "0xRequester1234567890abcdef1234567890abcdef",
    actorAgentId: "0xActor1234567890abcdef1234567890abcdef0000",
    terminalClass: "app",
    trustTier: 3,
    params: { to: "0xRecipient", value: "1000000000000000000" },
    ...overrides,
  });
}

function makePlan(intentId: string): PlanRecord {
  return createPlan({
    intentId,
    provider: "0xProvider1234567890abcdef1234567890abcdef00",
    policyHash: "0xPolicyHash1234567890abcdef1234567890abcdef",
    estimatedGas: 50000,
    estimatedValue: "1000000000000000000",
  });
}

function makeApproval(intentId: string, planId: string): ApprovalRecord {
  return createApproval({
    intentId,
    planId,
    approver: "0xApprover1234567890abcdef1234567890abcdef00",
    approverRole: "guardian",
    accountId: "0xAccount1234567890abcdef1234567890abcdef0000",
    terminalClass: "app",
    trustTier: 3,
    policyHash: "0xPolicyHash1234567890abcdef1234567890abcdef",
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Intent Lifecycle", () => {
  describe("createIntent", () => {
    it("creates valid IntentEnvelope with correct defaults", () => {
      const intent = makeIntent();

      expect(intent.intentId).toBeTruthy();
      expect(intent.schemaVersion).toBe(BOUNDARY_SCHEMA_VERSION);
      expect(intent.action).toBe("transfer");
      expect(intent.requester).toContain("0xRequester");
      expect(intent.actorAgentId).toContain("0xActor");
      expect(intent.terminalClass).toBe("app");
      expect(intent.trustTier).toBe(3);
      expect(intent.status).toBe("pending");
      expect(intent.createdAt).toBeGreaterThan(0);
      expect(intent.expiresAt).toBe(intent.createdAt + 300); // default TTL
    });

    it("respects custom TTL", () => {
      const intent = makeIntent({ ttlSeconds: 600 });
      expect(intent.expiresAt).toBe(intent.createdAt + 600);
    });

    it("includes constraints when provided", () => {
      const intent = makeIntent({
        constraints: { maxValue: "5000000000000000000", maxGas: 100000 },
      });
      expect(intent.constraints?.maxValue).toBe("5000000000000000000");
      expect(intent.constraints?.maxGas).toBe(100000);
    });
  });

  describe("transitionIntent", () => {
    it("allows valid transitions: pending → planning", () => {
      const intent = makeIntent();
      const updated = transitionIntent(intent, "planning");
      expect(updated.status).toBe("planning");
    });

    it("allows valid transitions: planning → approved", () => {
      const intent = transitionIntent(makeIntent(), "planning");
      const updated = transitionIntent(intent, "approved");
      expect(updated.status).toBe("approved");
    });

    it("allows valid transitions: approved → executing", () => {
      let intent = makeIntent();
      intent = transitionIntent(intent, "planning");
      intent = transitionIntent(intent, "approved");
      const updated = transitionIntent(intent, "executing");
      expect(updated.status).toBe("executing");
    });

    it("allows valid transitions: executing → settled", () => {
      let intent = makeIntent();
      intent = transitionIntent(intent, "planning");
      intent = transitionIntent(intent, "approved");
      intent = transitionIntent(intent, "executing");
      const updated = transitionIntent(intent, "settled");
      expect(updated.status).toBe("settled");
    });

    it("allows cancellation from pending", () => {
      const intent = makeIntent();
      const cancelled = transitionIntent(intent, "cancelled");
      expect(cancelled.status).toBe("cancelled");
    });

    it("rejects invalid transitions: settled → pending", () => {
      let intent = makeIntent();
      intent = transitionIntent(intent, "planning");
      intent = transitionIntent(intent, "approved");
      intent = transitionIntent(intent, "executing");
      intent = transitionIntent(intent, "settled");
      expect(() => transitionIntent(intent, "pending")).toThrow("Invalid intent transition");
    });

    it("rejects invalid transitions: cancelled → planning", () => {
      const intent = transitionIntent(makeIntent(), "cancelled");
      expect(() => transitionIntent(intent, "planning")).toThrow("Invalid intent transition");
    });

    it("rejects invalid transitions: failed → approved", () => {
      const intent = transitionIntent(
        transitionIntent(makeIntent(), "planning"),
        "failed",
      );
      expect(() => transitionIntent(intent, "approved")).toThrow("Invalid intent transition");
    });
  });

  describe("isIntentExpired", () => {
    it("returns true for expired intents", () => {
      const intent = makeIntent({ ttlSeconds: -1 });
      expect(isIntentExpired(intent)).toBe(true);
    });

    it("returns false for non-expired intents", () => {
      const intent = makeIntent({ ttlSeconds: 9999 });
      expect(isIntentExpired(intent)).toBe(false);
    });
  });

  describe("isIntentTerminal", () => {
    it("returns true for terminal states", () => {
      for (const status of ["settled", "failed", "expired", "cancelled"] as const) {
        const intent = makeIntent();
        // Directly set status for testing
        const modified = { ...intent, status };
        expect(isIntentTerminal(modified)).toBe(true);
      }
    });

    it("returns false for non-terminal states", () => {
      for (const status of ["pending", "planning", "approved", "executing"] as const) {
        const intent = { ...makeIntent(), status };
        expect(isIntentTerminal(intent)).toBe(false);
      }
    });
  });
});

describe("Plan Lifecycle", () => {
  describe("createPlan", () => {
    it("creates valid PlanRecord with correct defaults", () => {
      const plan = makePlan("intent-123");

      expect(plan.planId).toBeTruthy();
      expect(plan.intentId).toBe("intent-123");
      expect(plan.schemaVersion).toBe(BOUNDARY_SCHEMA_VERSION);
      expect(plan.provider).toContain("0xProvider");
      expect(plan.estimatedGas).toBe(50000);
      expect(plan.estimatedValue).toBe("1000000000000000000");
      expect(plan.status).toBe("draft");
      expect(plan.expiresAt).toBe(plan.createdAt + 120); // default TTL
    });
  });

  describe("transitionPlan", () => {
    it("allows valid transitions: draft → ready → approved → executing → completed", () => {
      let plan = makePlan("intent-123");
      plan = transitionPlan(plan, "ready");
      expect(plan.status).toBe("ready");

      plan = transitionPlan(plan, "approved");
      expect(plan.status).toBe("approved");

      plan = transitionPlan(plan, "executing");
      expect(plan.status).toBe("executing");

      plan = transitionPlan(plan, "completed");
      expect(plan.status).toBe("completed");
    });

    it("rejects invalid transitions: completed → draft", () => {
      let plan = makePlan("intent-123");
      plan = transitionPlan(plan, "ready");
      plan = transitionPlan(plan, "approved");
      plan = transitionPlan(plan, "executing");
      plan = transitionPlan(plan, "completed");
      expect(() => transitionPlan(plan, "draft")).toThrow("Invalid plan transition");
    });

    it("allows draft → expired", () => {
      const plan = makePlan("intent-123");
      const expired = transitionPlan(plan, "expired");
      expect(expired.status).toBe("expired");
    });
  });
});

describe("Approval Lifecycle", () => {
  describe("createApproval", () => {
    it("creates valid ApprovalRecord", () => {
      const approval = makeApproval("intent-123", "plan-456");

      expect(approval.approvalId).toBeTruthy();
      expect(approval.intentId).toBe("intent-123");
      expect(approval.planId).toBe("plan-456");
      expect(approval.schemaVersion).toBe(BOUNDARY_SCHEMA_VERSION);
      expect(approval.approverRole).toBe("guardian");
      expect(approval.terminalClass).toBe("app");
      expect(approval.trustTier).toBe(3);
      expect(approval.status).toBe("pending");
      expect(approval.expiresAt).toBe(approval.createdAt + 60); // default TTL
    });
  });
});

describe("Execution Receipt", () => {
  describe("createReceipt", () => {
    it("creates valid ExecutionReceipt from components", () => {
      const intent = makeIntent();
      const plan = makePlan(intent.intentId);
      const approval = makeApproval(intent.intentId, plan.planId);

      const receipt = createReceipt({
        intent,
        plan,
        approval,
        chainReceipt: {
          txHash: "0xTxHash1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
          blockNumber: 12345,
          blockHash: "0xBlockHash1234567890abcdef1234567890abcdef1234567890abcdef12345678",
          from: "0xFrom1234567890abcdef1234567890abcdef123456",
          to: "0xTo001234567890abcdef1234567890abcdef123456",
          gasUsed: 42000,
          value: "1000000000000000000",
          status: "success",
        },
      });

      expect(receipt.receiptId).toBeTruthy();
      expect(receipt.intentId).toBe(intent.intentId);
      expect(receipt.planId).toBe(plan.planId);
      expect(receipt.approvalId).toBe(approval.approvalId);
      expect(receipt.schemaVersion).toBe(BOUNDARY_SCHEMA_VERSION);
      expect(receipt.txHash).toContain("0xTxHash");
      expect(receipt.blockNumber).toBe(12345);
      expect(receipt.gasUsed).toBe(42000);
      expect(receipt.value).toBe("1000000000000000000");
      expect(receipt.receiptStatus).toBe("success");
      expect(receipt.actorAgentId).toBe(intent.actorAgentId);
      expect(receipt.terminalClass).toBe(intent.terminalClass);
      expect(receipt.trustTier).toBe(intent.trustTier);
      expect(receipt.settledAt).toBeGreaterThan(0);
    });
  });
});
