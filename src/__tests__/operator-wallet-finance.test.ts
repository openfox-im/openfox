import { describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import {
  buildOperatorFinanceReport,
  buildOperatorFinanceSnapshot,
  buildOperatorWalletReport,
  buildOperatorWalletSnapshot,
} from "../operator/wallet-finance.js";
import {
  inferenceInsertCost,
  insertSpendRecord,
  onchainTxInsert,
} from "../state/database.js";

describe("operator wallet and finance snapshots", () => {
  it("computes wallet reserves, pending flows, and finance periods from runtime records", async () => {
    const db = createTestDb();
    const config = createTestConfig({
      rpcUrl: undefined,
    });
    const now = Date.parse("2027-03-11T12:00:00.000Z");
    const day = "2027-03-11";
    const hour = "2027-03-11 12";
    const hostAddress = config.walletAddress;
    const solverAddress =
      "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143";
    const otherHostAddress =
      "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2";
    const providerAddress =
      "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed";

    try {
      db.insertBounty({
        bountyId: "bounty-open",
        hostAgentId: "host-open",
        hostAddress,
        kind: "question",
        title: "Open bounty",
        taskPrompt: "Open bounty task",
        referenceOutput: "ref",
        rewardTomi: "100",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        judgeMode: "local_model",
        status: "open",
        createdAt: "2027-03-11T00:00:00.000Z",
        updatedAt: "2027-03-11T00:00:00.000Z",
      });

      db.insertBounty({
        bountyId: "bounty-approved",
        hostAgentId: "host-approved",
        hostAddress,
        kind: "question",
        title: "Approved bounty",
        taskPrompt: "Approved bounty task",
        referenceOutput: "ref",
        rewardTomi: "50",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        judgeMode: "local_model",
        status: "approved",
        createdAt: "2027-03-11T00:00:00.000Z",
        updatedAt: "2027-03-11T00:00:00.000Z",
      });

      db.insertBounty({
        bountyId: "bounty-receivable",
        hostAgentId: "host-external",
        hostAddress: otherHostAddress,
        kind: "question",
        title: "Solver reward",
        taskPrompt: "Solver reward task",
        referenceOutput: "ref",
        rewardTomi: "70",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        judgeMode: "local_model",
        status: "approved",
        createdAt: "2027-03-11T00:00:00.000Z",
        updatedAt: "2027-03-11T00:00:00.000Z",
      });
      db.insertBountySubmission({
        submissionId: "submission-receivable",
        bountyId: "bounty-receivable",
        solverAddress: hostAddress,
        submissionText: "answer",
        status: "accepted",
        submittedAt: "2027-03-11T01:00:00.000Z",
        updatedAt: "2027-03-11T01:00:00.000Z",
      });
      db.upsertBountyResult({
        bountyId: "bounty-receivable",
        winningSubmissionId: "submission-receivable",
        decision: "accepted",
        confidence: 0.95,
        judgeReason: "correct",
        createdAt: "2027-03-11T02:00:00.000Z",
        updatedAt: "2027-03-11T02:00:00.000Z",
      });

      db.insertBounty({
        bountyId: "bounty-solver-paid",
        hostAgentId: "host-external-paid",
        hostAddress: otherHostAddress,
        kind: "question",
        title: "Solver paid",
        taskPrompt: "Solver paid task",
        referenceOutput: "ref",
        rewardTomi: "110",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        judgeMode: "local_model",
        status: "paid",
        createdAt: "2027-03-10T00:00:00.000Z",
        updatedAt: "2027-03-10T00:00:00.000Z",
      });
      db.insertBountySubmission({
        submissionId: "submission-solver-paid",
        bountyId: "bounty-solver-paid",
        solverAddress: hostAddress,
        submissionText: "paid answer",
        status: "accepted",
        submittedAt: "2027-03-10T01:00:00.000Z",
        updatedAt: "2027-03-10T01:00:00.000Z",
      });
      db.upsertBountyResult({
        bountyId: "bounty-solver-paid",
        winningSubmissionId: "submission-solver-paid",
        decision: "accepted",
        confidence: 0.99,
        judgeReason: "paid",
        payoutTxHash:
          "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
        createdAt: "2027-03-10T02:00:00.000Z",
        updatedAt: "2027-03-11T05:00:00.000Z",
      });

      db.insertBounty({
        bountyId: "bounty-host-paid",
        hostAgentId: "host-self-paid",
        hostAddress,
        kind: "question",
        title: "Host paid",
        taskPrompt: "Host paid task",
        referenceOutput: "ref",
        rewardTomi: "90",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        judgeMode: "local_model",
        status: "paid",
        createdAt: "2027-03-09T00:00:00.000Z",
        updatedAt: "2027-03-09T00:00:00.000Z",
      });
      db.insertBountySubmission({
        submissionId: "submission-host-paid",
        bountyId: "bounty-host-paid",
        solverAddress: solverAddress,
        submissionText: "solver answer",
        status: "accepted",
        submittedAt: "2027-03-09T01:00:00.000Z",
        updatedAt: "2027-03-09T01:00:00.000Z",
      });
      db.upsertBountyResult({
        bountyId: "bounty-host-paid",
        winningSubmissionId: "submission-host-paid",
        decision: "accepted",
        confidence: 0.97,
        judgeReason: "paid out",
        payoutTxHash:
          "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
        createdAt: "2027-03-09T02:00:00.000Z",
        updatedAt: "2027-03-11T04:00:00.000Z",
      });

      db.upsertX402Payment({
        paymentId:
          "0x3000000000000000000000000000000000000000000000000000000000000000",
        serviceKind: "oracle",
        requestKey: "incoming-pending",
        requestHash:
          "0x3000000000000000000000000000000000000000000000000000000000000001",
        payerAddress: solverAddress,
        providerAddress: hostAddress,
        chainId: "1666",
        txNonce: "1",
        txHash:
          "0x3000000000000000000000000000000000000000000000000000000000000002",
        rawTransaction:
          "0x3000000000000000000000000000000000000000000000000000000000000003",
        amountTomi: "30",
        confirmationPolicy: "receipt",
        status: "verified",
        attemptCount: 0,
        maxAttempts: 3,
        createdAt: "2027-03-11T03:00:00.000Z",
        updatedAt: "2027-03-11T03:00:00.000Z",
      });
      db.upsertX402Payment({
        paymentId:
          "0x4000000000000000000000000000000000000000000000000000000000000000",
        serviceKind: "storage",
        requestKey: "outgoing-pending",
        requestHash:
          "0x4000000000000000000000000000000000000000000000000000000000000001",
        payerAddress: hostAddress,
        providerAddress,
        chainId: "1666",
        txNonce: "2",
        txHash:
          "0x4000000000000000000000000000000000000000000000000000000000000002",
        rawTransaction:
          "0x4000000000000000000000000000000000000000000000000000000000000003",
        amountTomi: "20",
        confirmationPolicy: "receipt",
        status: "submitted",
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: "2027-03-11T03:30:00.000Z",
        updatedAt: "2027-03-11T03:30:00.000Z",
      });
      db.upsertX402Payment({
        paymentId:
          "0x5000000000000000000000000000000000000000000000000000000000000000",
        serviceKind: "observation",
        requestKey: "incoming-confirmed",
        requestHash:
          "0x5000000000000000000000000000000000000000000000000000000000000001",
        payerAddress: solverAddress,
        providerAddress: hostAddress,
        chainId: "1666",
        txNonce: "3",
        txHash:
          "0x5000000000000000000000000000000000000000000000000000000000000002",
        rawTransaction:
          "0x5000000000000000000000000000000000000000000000000000000000000003",
        amountTomi: "40",
        confirmationPolicy: "receipt",
        status: "confirmed",
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: "2027-03-11T04:00:00.000Z",
        updatedAt: "2027-03-11T04:00:00.000Z",
      });
      db.upsertX402Payment({
        paymentId:
          "0x6000000000000000000000000000000000000000000000000000000000000000",
        serviceKind: "gateway_request",
        requestKey: "outgoing-confirmed",
        requestHash:
          "0x6000000000000000000000000000000000000000000000000000000000000001",
        payerAddress: hostAddress,
        providerAddress,
        chainId: "1666",
        txNonce: "4",
        txHash:
          "0x6000000000000000000000000000000000000000000000000000000000000002",
        rawTransaction:
          "0x6000000000000000000000000000000000000000000000000000000000000003",
        amountTomi: "25",
        confirmationPolicy: "receipt",
        status: "confirmed",
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: "2027-03-11T04:30:00.000Z",
        updatedAt: "2027-03-11T04:30:00.000Z",
      });
      db.upsertX402Payment({
        paymentId:
          "0x7000000000000000000000000000000000000000000000000000000000000000",
        serviceKind: "oracle",
        requestKey: "failed-retryable",
        requestHash:
          "0x7000000000000000000000000000000000000000000000000000000000000001",
        payerAddress: hostAddress,
        providerAddress,
        chainId: "1666",
        txNonce: "5",
        txHash:
          "0x7000000000000000000000000000000000000000000000000000000000000002",
        rawTransaction:
          "0x7000000000000000000000000000000000000000000000000000000000000003",
        amountTomi: "15",
        confirmationPolicy: "receipt",
        status: "failed",
        attemptCount: 2,
        maxAttempts: 3,
        nextAttemptAt: "2027-03-11T06:00:00.000Z",
        createdAt: "2027-03-11T05:00:00.000Z",
        updatedAt: "2027-03-11T05:00:00.000Z",
      });

      db.upsertSettlementCallback({
        callbackId: "settlement-retry",
        receiptId: "receipt-1",
        kind: "bounty",
        subjectId: "bounty-host-paid",
        contractAddress: hostAddress,
        payloadMode: "canonical_receipt",
        payloadHex:
          "0x1234",
        payloadHash:
          "0x8000000000000000000000000000000000000000000000000000000000000000",
        status: "failed",
        attemptCount: 1,
        maxAttempts: 3,
        nextAttemptAt: "2027-03-11T06:00:00.000Z",
        createdAt: "2027-03-11T05:10:00.000Z",
        updatedAt: "2027-03-11T05:10:00.000Z",
      });

      db.upsertMarketContractCallback({
        callbackId: "market-retry",
        bindingId: "binding-1",
        kind: "bounty",
        subjectId: "bounty-host-paid",
        contractAddress: hostAddress,
        packageName: "market.pkg",
        functionSignature: "settle(bytes)",
        payloadMode: "canonical_binding",
        payloadHex: "0xabcd",
        payloadHash:
          "0x9000000000000000000000000000000000000000000000000000000000000000",
        status: "failed",
        attemptCount: 1,
        maxAttempts: 3,
        nextAttemptAt: "2027-03-11T06:00:00.000Z",
        createdAt: "2027-03-11T05:15:00.000Z",
        updatedAt: "2027-03-11T05:15:00.000Z",
      });

      inferenceInsertCost(db.raw, {
        sessionId: "session-1",
        turnId: "turn-1",
        model: "mock-model",
        provider: "mock",
        inputTokens: 100,
        outputTokens: 50,
        costCents: 125,
        latencyMs: 100,
        tier: "normal",
        taskType: "agent_turn",
        cacheHit: false,
      });
      insertSpendRecord(db.raw, {
        id: "spend-1",
        toolName: "gateway",
        amountCents: 250,
        recipient: "provider",
        domain: "example.com",
        category: "other",
        windowHour: hour,
        windowDay: day,
      });
      // Backdate created_at so cost queries match the test's virtual "now"
      db.raw.prepare("UPDATE spend_tracking SET created_at = ? WHERE id = ?").run("2027-03-11 10:00:00", "spend-1");
      db.raw.prepare("UPDATE inference_costs SET created_at = ? WHERE session_id = ?").run("2027-03-11 10:00:00", "session-1");
      onchainTxInsert(db.raw, {
        id: "tx-pending",
        txHash:
          "0xa000000000000000000000000000000000000000000000000000000000000000",
        chain: "tos:1666",
        operation: "payout",
        status: "pending",
        gasUsed: null,
        metadata: "{}",
        createdAt: "2027-03-11T05:20:00.000Z",
      });
      onchainTxInsert(db.raw, {
        id: "tx-failed",
        txHash:
          "0xa100000000000000000000000000000000000000000000000000000000000000",
        chain: "tos:1666",
        operation: "payment",
        status: "failed",
        gasUsed: null,
        metadata: "{}",
        createdAt: "2027-03-11T05:25:00.000Z",
      });

      const wallet = await buildOperatorWalletSnapshot(config, db, now);
      expect(wallet.kind).toBe("wallet");
      expect(wallet.rpcReachable).toBe(false);
      expect(wallet.reservedBalanceTomi).toBe("150");
      expect(wallet.pendingReceivablesTomi).toBe("100");
      expect(wallet.pendingPayablesTomi).toBe("70");
      expect(wallet.retryableFailedItems).toBe(3);
      expect(wallet.pendingOnchainTransactions).toBe(1);
      expect(wallet.failedOnchainTransactions).toBe(1);
      expect(buildOperatorWalletReport(wallet)).toContain("Reserved: 0.000000 TOS");

      const finance = await buildOperatorFinanceSnapshot(config, db, now);
      expect(finance.kind).toBe("finance");
      expect(finance.periods.today.revenueTomi).toBe("150");
      expect(finance.periods.today.costTomi).toBe("115");
      expect(finance.periods.today.netTomi).toBe("35");
      expect(finance.periods.today.operatingCostCents).toBe(375);
      expect(finance.pendingReceivablesTomi).toBe("100");
      expect(finance.pendingPayablesTomi).toBe("70");
      expect(finance.retryableFailedItems).toBe(3);
      expect(finance.revenueSources.x402ConfirmedTomi30d).toBe("40");
      expect(finance.revenueSources.bountySolverRewardsTomi30d).toBe("110");
      expect(finance.costSources.x402ConfirmedTomi30d).toBe("25");
      expect(finance.costSources.bountyHostPayoutsTomi30d).toBe("90");
      const report = buildOperatorFinanceReport(finance);
      expect(report).toContain("Trailing 30d:");
      expect(report).toContain("Operating cost: $3.75");
    } finally {
      db.close();
    }
  });
});
