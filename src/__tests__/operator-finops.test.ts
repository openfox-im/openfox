import { describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import {
  buildOperatorMarketSnapshot,
  buildOperatorPaymentsSnapshot,
  buildOperatorSettlementSnapshot,
} from "../operator/finops.js";

describe("operator finops snapshots", () => {
  it("builds payment, settlement, and market attribution snapshots", async () => {
    const db = createTestDb();
    const config = createTestConfig();
    const counterparty =
      "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143";

    try {
      db.upsertX402Payment({
        paymentId:
          "0x1000000000000000000000000000000000000000000000000000000000000001",
        serviceKind: "oracle",
        requestKey: "oracle-1",
        requestHash:
          "0x1000000000000000000000000000000000000000000000000000000000000002",
        payerAddress: counterparty,
        providerAddress: config.walletAddress,
        chainId: "1666",
        txNonce: "1",
        txHash:
          "0x1000000000000000000000000000000000000000000000000000000000000003",
        rawTransaction:
          "0x1000000000000000000000000000000000000000000000000000000000000004",
        amountWei: "50",
        confirmationPolicy: "receipt",
        status: "confirmed",
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: "2026-03-11T01:00:00.000Z",
        updatedAt: "2026-03-11T01:00:00.000Z",
      });
      db.upsertX402Payment({
        paymentId:
          "0x2000000000000000000000000000000000000000000000000000000000000001",
        serviceKind: "storage",
        requestKey: "storage-1",
        requestHash:
          "0x2000000000000000000000000000000000000000000000000000000000000002",
        payerAddress: config.walletAddress,
        providerAddress: counterparty,
        chainId: "1666",
        txNonce: "2",
        txHash:
          "0x2000000000000000000000000000000000000000000000000000000000000003",
        rawTransaction:
          "0x2000000000000000000000000000000000000000000000000000000000000004",
        amountWei: "20",
        confirmationPolicy: "receipt",
        status: "submitted",
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: "2026-03-11T02:00:00.000Z",
        updatedAt: "2026-03-11T02:00:00.000Z",
      });
      db.upsertX402Payment({
        paymentId:
          "0x3000000000000000000000000000000000000000000000000000000000000001",
        serviceKind: "gateway_request",
        requestKey: "gateway-1",
        requestHash:
          "0x3000000000000000000000000000000000000000000000000000000000000002",
        payerAddress: config.walletAddress,
        providerAddress: counterparty,
        chainId: "1666",
        txNonce: "3",
        txHash:
          "0x3000000000000000000000000000000000000000000000000000000000000003",
        rawTransaction:
          "0x3000000000000000000000000000000000000000000000000000000000000004",
        amountWei: "5",
        confirmationPolicy: "receipt",
        status: "failed",
        attemptCount: 2,
        maxAttempts: 3,
        createdAt: "2026-03-11T03:00:00.000Z",
        updatedAt: "2026-03-11T03:00:00.000Z",
      });

      db.upsertSettlementReceipt({
        receiptId: "bounty:b1",
        kind: "bounty",
        subjectId: "b1",
        receipt: {
          version: 1,
          receiptId: "bounty:b1",
          kind: "bounty",
          subjectId: "b1",
          publisherAddress: config.walletAddress,
          payoutTxHash:
            "0xb20d45fcf230c1d4053087f6df71ef5a43960ff5f61d976acb1fcfb4c40d9a10",
          resultHash:
            "0xffd5a4c82ff6c618d999d2315b4ffa704f7689e5b9f02d3597591aa4ef4b6b09",
          createdAt: "2026-03-11T04:00:00.000Z",
        },
        receiptHash:
          "0x6666666666666666666666666666666666666666666666666666666666666666",
        payoutTxHash:
          "0xb20d45fcf230c1d4053087f6df71ef5a43960ff5f61d976acb1fcfb4c40d9a10",
        createdAt: "2026-03-11T04:00:00.000Z",
        updatedAt: "2026-03-11T04:00:00.000Z",
      });
      db.upsertSettlementCallback({
        callbackId: "settle-cb-1",
        receiptId: "bounty:b1",
        kind: "bounty",
        subjectId: "b1",
        contractAddress:
          "0x7777777777777777777777777777777777777777777777777777777777777777",
        payloadMode: "canonical_receipt",
        payloadHex: "0x1234",
        payloadHash:
          "0x8888888888888888888888888888888888888888888888888888888888888888",
        status: "pending",
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: "2026-03-11T04:01:00.000Z",
        updatedAt: "2026-03-11T04:01:00.000Z",
      });

      db.upsertMarketBinding({
        bindingId: "oracle:o1",
        kind: "oracle",
        subjectId: "o1",
        receipt: {
          version: 1,
          bindingId: "oracle:o1",
          kind: "oracle",
          subjectId: "o1",
          publisherAddress: config.walletAddress,
          createdAt: "2026-03-11T05:00:00.000Z",
        },
        receiptHash:
          "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
        createdAt: "2026-03-11T05:00:00.000Z",
        updatedAt: "2026-03-11T05:00:00.000Z",
      });
      db.upsertMarketContractCallback({
        callbackId: "market-cb-1",
        bindingId: "oracle:o1",
        kind: "oracle",
        subjectId: "o1",
        contractAddress:
          "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        packageName: "market.pkg",
        functionSignature: "apply(bytes)",
        payloadMode: "canonical_binding",
        payloadHex: "0xabcd",
        payloadHash:
          "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
        status: "failed",
        attemptCount: 2,
        maxAttempts: 3,
        createdAt: "2026-03-11T05:01:00.000Z",
        updatedAt: "2026-03-11T05:01:00.000Z",
      });

      const payments = await buildOperatorPaymentsSnapshot(config, db);
      expect(payments.kind).toBe("payments");
      expect(payments.totals.confirmedRevenueWei).toBe("50");
      expect(payments.totals.pendingCostWei).toBe("20");
      expect(payments.totals.failedCount).toBe(1);
      expect(payments.capabilities[0]?.capability).toBe("oracle");
      expect(payments.counterparties[0]?.address).toBe(counterparty);

      const settlement = await buildOperatorSettlementSnapshot(config, db);
      expect(settlement.kind).toBe("settlement");
      expect(settlement.receiptsTotal).toBe(1);
      expect(settlement.callbackPending).toBe(1);
      expect(settlement.delayedSubjects[0]?.subjectId).toBe("b1");

      const market = await buildOperatorMarketSnapshot(config, db);
      expect(market.kind).toBe("market");
      expect(market.bindingsTotal).toBe(1);
      expect(market.callbackFailed).toBe(1);
      expect(market.delayedSubjects[0]?.subjectId).toBe("o1");
    } finally {
      db.close();
    }
  });
});
