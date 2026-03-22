import { beforeEach, describe, expect, it, vi } from "vitest";

const getTransactionReceiptMock = vi.fn();
const sendNativeTransferMock = vi.fn();

vi.mock("../chain/client.js", () => ({
  ChainRpcClient: class {
    async getTransactionReceipt(txHash: string) {
      return getTransactionReceiptMock(txHash);
    }
  },
  sendNativeTransfer: (...args: unknown[]) => sendNativeTransferMock(...args),
}));

import { createNativeSettlementCallbackDispatcher } from "../settlement/callbacks.js";
import { buildSettlementReceiptRecord } from "../settlement/publisher.js";
import { DEFAULT_SETTLEMENT_CONFIG } from "../types.js";
import { createTestDb, createTestIdentity } from "./mocks.js";

describe("settlement callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches a confirmed contract callback for a settlement receipt", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const settlement = buildSettlementReceiptRecord({
      kind: "bounty",
      subjectId: "bounty-1",
      publisherAddress: identity.address,
      capability: "task.result",
      result: { decision: "accepted" },
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    db.upsertSettlementReceipt(settlement);

    sendNativeTransferMock.mockResolvedValue({
      txHash:
        "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
      receipt: { status: "0x1" },
    });

    const dispatcher = createNativeSettlementCallbackDispatcher({
      db,
      rpcUrl: "http://127.0.0.1:8545",
      privateKey:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      config: {
        ...DEFAULT_SETTLEMENT_CONFIG.callbacks,
        enabled: true,
        bounty: {
          ...DEFAULT_SETTLEMENT_CONFIG.callbacks.bounty,
          enabled: true,
          contractAddress:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const result = await dispatcher.dispatch(settlement);

    expect(result.action).toBe("confirmed");
    expect(result.callback?.status).toBe("confirmed");
    expect(result.callback?.callbackTxHash).toBe(
      "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
    );
    expect(sendNativeTransferMock).toHaveBeenCalledTimes(1);
    expect(
      db.getSettlementCallbackByReceiptId(settlement.receiptId)?.status,
    ).toBe("confirmed");
    db.close();
  });

  it("retries and confirms a pending callback by polling the chain receipt", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const settlement = buildSettlementReceiptRecord({
      kind: "observation",
      subjectId: "job-1",
      publisherAddress: identity.address,
      capability: "observation.once",
      result: { status: "ok" },
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    db.upsertSettlementReceipt(settlement);
    db.upsertSettlementCallback({
      callbackId: `${settlement.receiptId}:0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2`,
      receiptId: settlement.receiptId,
      kind: settlement.kind,
      subjectId: settlement.subjectId,
      contractAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
      payloadMode: "canonical_receipt",
      payloadHex: "0x1234",
      payloadHash:
        "0xf4897a85e6ac20f6b7b22e2c3a8fac52fb6c36430b80655354e5aa4f5e1a3533dddddddddddddddddddddddd",
      status: "pending",
      attemptCount: 1,
      maxAttempts: 3,
      callbackTxHash:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      callbackReceipt: null,
      lastError: null,
      nextAttemptAt: "2026-03-09T00:00:00.000Z",
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });

    getTransactionReceiptMock.mockResolvedValue({ status: "0x1" });

    const dispatcher = createNativeSettlementCallbackDispatcher({
      db,
      rpcUrl: "http://127.0.0.1:8545",
      privateKey:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      config: {
        ...DEFAULT_SETTLEMENT_CONFIG.callbacks,
        enabled: true,
        observation: {
          ...DEFAULT_SETTLEMENT_CONFIG.callbacks.observation,
          enabled: true,
          contractAddress:
            "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
        },
      },
      now: () => new Date("2026-03-09T00:05:00.000Z"),
    });

    const retried = await dispatcher.retryPending();

    expect(retried.processed).toBe(1);
    expect(retried.confirmed).toBe(1);
    expect(sendNativeTransferMock).not.toHaveBeenCalled();
    expect(
      db.getSettlementCallbackByReceiptId(settlement.receiptId)?.status,
    ).toBe("confirmed");
    db.close();
  });
});
