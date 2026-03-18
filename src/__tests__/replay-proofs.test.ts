/**
 * Replay Inspector and Proof Display Tests
 *
 * Tests for ReplayInspector (timeline building, proof collection,
 * proof chain verification, timeline formatting) and proof-display
 * formatting functions.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { ReplayInspector } from "../audit/replay.js";
import type { ProofRef, ReplayTimeline } from "../audit/replay.js";
import { formatProofRef, generateProofSummary } from "../audit/proof-display.js";
import type { AuditEntry, AuditEntryKind } from "../audit/types.js";
import type { AuditJournal } from "../audit/journal.js";
import type { IntentStore } from "../intent/store.js";
import type {
  IntentEnvelope,
  PlanRecord,
  ApprovalRecord,
  ExecutionReceipt,
} from "../intent/types.js";

// ── Mock Factories ───────────────────────────────────────────────

function makeAuditEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    entryId: "ENTRY001",
    kind: "intent_created",
    timestamp: 1700000000,
    intentId: "intent-001",
    summary: "Intent created",
    ...overrides,
  };
}

function makeIntent(overrides?: Partial<IntentEnvelope>): IntentEnvelope {
  return {
    intentId: "intent-001",
    schemaVersion: "0.1.0",
    action: "transfer",
    requester: "0xREQUESTER",
    actorAgentId: "0xAGENT",
    terminalClass: "app",
    trustTier: 2,
    params: { to: "0xRECIPIENT", value: "1000000000000000000" },
    createdAt: 1700000000,
    expiresAt: 1700003600,
    status: "settled",
    ...overrides,
  };
}

function makePlan(overrides?: Partial<PlanRecord>): PlanRecord {
  return {
    planId: "plan-001",
    intentId: "intent-001",
    schemaVersion: "0.1.0",
    provider: "0xPROVIDER",
    policyHash: "0xPLAN_POLICY",
    estimatedGas: 21000,
    estimatedValue: "1000000000000000000",
    createdAt: 1700000010,
    expiresAt: 1700003600,
    status: "completed",
    ...overrides,
  };
}

function makeApproval(overrides?: Partial<ApprovalRecord>): ApprovalRecord {
  return {
    approvalId: "approval-001",
    intentId: "intent-001",
    planId: "plan-001",
    schemaVersion: "0.1.0",
    approver: "0xAPPROVER",
    approverRole: "owner",
    accountId: "0xACCOUNT",
    terminalClass: "app",
    trustTier: 2,
    policyHash: "0xAPPROVAL_POLICY",
    createdAt: 1700000020,
    expiresAt: 1700003600,
    status: "granted",
    ...overrides,
  };
}

function makeReceipt(overrides?: Partial<ExecutionReceipt>): ExecutionReceipt {
  return {
    receiptId: "receipt-001",
    intentId: "intent-001",
    planId: "plan-001",
    approvalId: "approval-001",
    schemaVersion: "0.1.0",
    txHash: "0xTX_HASH_001",
    blockNumber: 12345,
    blockHash: "0xBLOCK_HASH",
    from: "0xFROM",
    to: "0xTO",
    actorAgentId: "0xAGENT",
    terminalClass: "app",
    trustTier: 2,
    policyHash: "0xRECEIPT_POLICY",
    gasUsed: 21000,
    value: "1000000000000000000",
    receiptStatus: "success",
    settledAt: 1700000100,
    ...overrides,
  };
}

// ── Mock AuditJournal and IntentStore ────────────────────────────

function createMockJournal(entries: AuditEntry[]): AuditJournal {
  return {
    getIntentTimeline: (_intentId: string) =>
      entries.filter((e) => e.intentId === _intentId),
  } as unknown as AuditJournal;
}

function createMockIntentStore(opts: {
  intent?: IntentEnvelope;
  plans?: PlanRecord[];
  approvals?: ApprovalRecord[];
  receipt?: ExecutionReceipt;
}): IntentStore {
  return {
    getIntent: (_id: string) => opts.intent,
    listPlansForIntent: (_id: string) => opts.plans ?? [],
    getApproval: (approvalId: string) =>
      (opts.approvals ?? []).find((a) => a.approvalId === approvalId),
    getReceiptByIntent: (_id: string) => opts.receipt,
  } as unknown as IntentStore;
}

// ── ReplayInspector ──────────────────────────────────────────────

describe("ReplayInspector", () => {
  it("builds timeline from audit entries", () => {
    const entries: AuditEntry[] = [
      makeAuditEntry({ entryId: "E1", kind: "intent_created", timestamp: 1700000000 }),
      makeAuditEntry({ entryId: "E2", kind: "plan_created", timestamp: 1700000010 }),
      makeAuditEntry({
        entryId: "E3",
        kind: "approval_granted",
        timestamp: 1700000020,
        approvalId: "approval-001",
      }),
      makeAuditEntry({
        entryId: "E4",
        kind: "execution_settled",
        timestamp: 1700000100,
        txHash: "0xTX_HASH_001",
      }),
    ];

    const intent = makeIntent();
    const plans = [makePlan()];
    const approvals = [makeApproval()];
    const receipt = makeReceipt();

    const journal = createMockJournal(entries);
    const store = createMockIntentStore({ intent, plans, approvals, receipt });
    const inspector = new ReplayInspector(journal, store);

    const timeline = inspector.buildTimeline("intent-001");

    expect(timeline.intentId).toBe("intent-001");
    expect(timeline.entries).toHaveLength(4);
    expect(timeline.intent).toBeDefined();
    expect(timeline.intent!.action).toBe("transfer");
    expect(timeline.plans).toHaveLength(1);
    expect(timeline.approvals).toHaveLength(1);
    expect(timeline.receipt).toBeDefined();
    expect(timeline.receipt!.txHash).toBe("0xTX_HASH_001");
  });

  it("collects proof references", () => {
    const entries: AuditEntry[] = [
      makeAuditEntry({
        entryId: "E1",
        kind: "execution_settled",
        txHash: "0xTX_HASH_001",
        summary: "Execution settled",
      }),
      makeAuditEntry({
        entryId: "E2",
        kind: "policy_decision",
        policyHash: "0xPOLICY_HASH",
        policyDecision: "allow",
        summary: "Policy decision",
      }),
      makeAuditEntry({
        entryId: "E3",
        kind: "sponsor_selected",
        sponsorAddress: "0xSPONSOR_ADDR_LONG_ENOUGH",
        policyHash: "0xSPONSOR_POLICY",
        summary: "Sponsor selected",
      }),
      makeAuditEntry({
        entryId: "E4",
        kind: "terminal_session_created",
        terminalClass: "app",
        summary: "Terminal session created",
      }),
    ];

    const receipt = makeReceipt({ txHash: "0xTX_HASH_001", proofRef: "ipfs://proof" });
    const journal = createMockJournal(entries);
    const store = createMockIntentStore({ receipt });
    const inspector = new ReplayInspector(journal, store);

    const proofs = inspector.collectProofs("intent-001");

    // Should have: tx_receipt, policy_decision, sponsor_auth, session, settlement, sponsor_auth (from receipt)
    const txProofs = proofs.filter((p) => p.type === "tx_receipt");
    expect(txProofs.length).toBeGreaterThanOrEqual(1);
    expect(txProofs[0].hash).toBe("0xTX_HASH_001");

    const policyProofs = proofs.filter((p) => p.type === "policy_decision");
    expect(policyProofs.length).toBeGreaterThanOrEqual(1);
    expect(policyProofs[0].hash).toBe("0xPOLICY_HASH");

    const sponsorProofs = proofs.filter((p) => p.type === "sponsor_auth");
    expect(sponsorProofs.length).toBeGreaterThanOrEqual(1);

    const sessionProofs = proofs.filter((p) => p.type === "session");
    expect(sessionProofs).toHaveLength(1);

    const settlementProofs = proofs.filter((p) => p.type === "settlement");
    expect(settlementProofs).toHaveLength(1);
    expect(settlementProofs[0].hash).toBe("0xTX_HASH_001");
    expect(settlementProofs[0].blockNumber).toBe(12345);
  });

  it("verifies proof chain for complete intent", () => {
    const entries: AuditEntry[] = [
      makeAuditEntry({
        entryId: "E1",
        kind: "intent_created",
        timestamp: 1700000000,
      }),
      makeAuditEntry({
        entryId: "E2",
        kind: "plan_created",
        timestamp: 1700000010,
        policyHash: "0xPLAN_POLICY",
        policyDecision: "allow",
      }),
      makeAuditEntry({
        entryId: "E3",
        kind: "approval_granted",
        timestamp: 1700000020,
        approvalId: "approval-001",
      }),
      makeAuditEntry({
        entryId: "E4",
        kind: "execution_settled",
        timestamp: 1700000100,
        txHash: "0xTX_HASH_001",
      }),
    ];

    const intent = makeIntent({ status: "settled" });
    const plans = [makePlan({ policyHash: "0xPLAN_POLICY" })];
    const approvals = [makeApproval()];
    const receipt = makeReceipt({ txHash: "0xTX_HASH_001" });

    const journal = createMockJournal(entries);
    const store = createMockIntentStore({ intent, plans, approvals, receipt });
    const inspector = new ReplayInspector(journal, store);

    const timeline = inspector.buildTimeline("intent-001");
    const result = inspector.verifyProofChain(timeline);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("detects missing steps in proof chain", () => {
    // Settled intent with no receipt -> should report issue
    const entries: AuditEntry[] = [
      makeAuditEntry({ entryId: "E1", kind: "intent_created", timestamp: 1700000000 }),
    ];

    const intent = makeIntent({ status: "settled" });
    // No plans, no approvals, no receipt
    const journal = createMockJournal(entries);
    const store = createMockIntentStore({ intent, plans: [], approvals: [] });
    const inspector = new ReplayInspector(journal, store);

    const timeline = inspector.buildTimeline("intent-001");
    const result = inspector.verifyProofChain(timeline);

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    // Should detect missing plans for non-pending intent
    expect(result.issues.some((i) => i.includes("No plans found"))).toBe(true);
    // Should detect missing receipt for settled intent
    expect(result.issues.some((i) => i.includes("missing execution receipt"))).toBe(true);
    // Should detect missing approval
    expect(result.issues.some((i) => i.includes("No approval records found"))).toBe(true);
  });

  it("formats timeline as readable text", () => {
    const entries: AuditEntry[] = [
      makeAuditEntry({
        entryId: "E1",
        kind: "intent_created",
        timestamp: 1700000000,
        actorAddress: "0xREQUESTER_ADDR_LONG_FOR_TRUNCATION",
        actorRole: "requester",
      }),
      makeAuditEntry({
        entryId: "E2",
        kind: "execution_settled",
        timestamp: 1700000100,
        txHash: "0xTX_HASH_001",
      }),
    ];

    const intent = makeIntent();
    const plans = [makePlan()];
    const receipt = makeReceipt();

    const journal = createMockJournal(entries);
    const store = createMockIntentStore({ intent, plans, receipt });
    const inspector = new ReplayInspector(journal, store);

    const timeline = inspector.buildTimeline("intent-001");
    const text = inspector.formatTimeline(timeline);

    expect(text).toContain("=== Replay Timeline: intent-001 ===");
    expect(text).toContain("--- Intent ---");
    expect(text).toContain("Action: transfer");
    expect(text).toContain("Status: settled");
    expect(text).toContain("--- Plans (1) ---");
    expect(text).toContain("--- Execution Receipt ---");
    expect(text).toContain("0xTX_HASH_001");
    expect(text).toContain("--- Audit Entries (2) ---");
    expect(text).toContain("intent_created");
    expect(text).toContain("execution_settled");
  });
});

// ── Proof Display ────────────────────────────────────────────────

describe("Proof Display", () => {
  it("formats proof reference for display", () => {
    const txRef: ProofRef = {
      type: "tx_receipt",
      hash: "0xABCDEF1234567890",
      description: "Transaction for transfer",
    };
    const display = formatProofRef(txRef);

    expect(display.title).toBe("Transaction Receipt");
    expect(display.type).toBe("tx_receipt");
    expect(display.hash).toBe("0xABCDEF1234567890");
    expect(display.verifiable).toBe(true);
    expect(display.explorerUrl).toBe("https://etherscan.io/tx/0xABCDEF1234567890");
    expect(display.details["Tx Hash"]).toBe("0xABCDEF1234567890");
    expect(display.details["Description"]).toBe("Transaction for transfer");
  });

  it("formats different proof types correctly", () => {
    const policyRef: ProofRef = {
      type: "policy_decision",
      hash: "0xPOLICY123",
      description: "Policy allow for plan_created",
    };
    const policyDisplay = formatProofRef(policyRef);
    expect(policyDisplay.title).toBe("Policy Decision");
    expect(policyDisplay.verifiable).toBe(true);
    expect(policyDisplay.explorerUrl).toBeUndefined();
    expect(policyDisplay.details["Policy Hash"]).toBe("0xPOLICY123");

    const sessionRef: ProofRef = {
      type: "session",
      hash: "SESSION_ID_001",
      description: "Terminal session created (app)",
    };
    const sessionDisplay = formatProofRef(sessionRef);
    expect(sessionDisplay.title).toBe("Terminal Session");
    expect(sessionDisplay.verifiable).toBe(false);
    expect(sessionDisplay.details["Session Ref"]).toBe("SESSION_ID_001");

    const settlementRef: ProofRef = {
      type: "settlement",
      hash: "0xSETTLE_TX",
      blockNumber: 99999,
      description: "Settlement success at block 99999",
    };
    const settlementDisplay = formatProofRef(settlementRef);
    expect(settlementDisplay.title).toBe("Settlement Confirmation");
    expect(settlementDisplay.verifiable).toBe(true);
    expect(settlementDisplay.explorerUrl).toContain("0xSETTLE_TX");
    expect(settlementDisplay.details["Block Number"]).toBe("99999");
  });

  it("uses custom explorer base URL", () => {
    const ref: ProofRef = {
      type: "tx_receipt",
      hash: "0xHASH",
      description: "test",
    };
    const display = formatProofRef(ref, "https://custom-explorer.io");
    expect(display.explorerUrl).toBe("https://custom-explorer.io/tx/0xHASH");
  });

  it("generates proof summary text", () => {
    const proofs = [
      {
        title: "Transaction Receipt",
        type: "tx_receipt",
        hash: "0xTXHASH",
        details: { "Tx Hash": "0xTXHASH", Description: "test tx" },
        verifiable: true,
        explorerUrl: "https://etherscan.io/tx/0xTXHASH",
      },
      {
        title: "Terminal Session",
        type: "session",
        hash: "SESSION01",
        details: { "Session Ref": "SESSION01", Description: "session" },
        verifiable: false,
      },
    ];

    const summary = generateProofSummary(proofs);

    expect(summary).toContain("=== Proof Summary (2 references) ===");
    expect(summary).toContain("Verifiable: 1/2");
    expect(summary).toContain("1. Transaction Receipt [verifiable]");
    expect(summary).toContain("2. Terminal Session [non-verifiable]");
    expect(summary).toContain("Explorer: https://etherscan.io/tx/0xTXHASH");
  });
});
