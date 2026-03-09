import { beforeEach, describe, expect, it, vi } from "vitest";

const getTransactionReceiptMock = vi.fn();
const sendTOSNativeTransferMock = vi.fn();

vi.mock("../tos/client.js", () => ({
  TOSRpcClient: class {
    async getTransactionReceipt(txHash: string) {
      return getTransactionReceiptMock(txHash);
    }
  },
  sendTOSNativeTransfer: (...args: unknown[]) => sendTOSNativeTransferMock(...args),
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

    sendTOSNativeTransferMock.mockResolvedValue({
      txHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      receipt: { status: "0x1" },
    });

    const dispatcher = createNativeSettlementCallbackDispatcher({
      db,
      rpcUrl: "http://127.0.0.1:8545",
      privateKey:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      config: {
        ...DEFAULT_SETTLEMENT_CONFIG.callbacks,
        enabled: true,
        bounty: {
          ...DEFAULT_SETTLEMENT_CONFIG.callbacks.bounty,
          enabled: true,
          contractAddress:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const result = await dispatcher.dispatch(settlement);

    expect(result.action).toBe("confirmed");
    expect(result.callback?.status).toBe("confirmed");
    expect(result.callback?.callbackTxHash).toBe(
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );
    expect(sendTOSNativeTransferMock).toHaveBeenCalledTimes(1);
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
      callbackId: `${settlement.receiptId}:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
      receiptId: settlement.receiptId,
      kind: settlement.kind,
      subjectId: settlement.subjectId,
      contractAddress:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      payloadMode: "canonical_receipt",
      payloadHex: "0x1234",
      payloadHash:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
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
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      config: {
        ...DEFAULT_SETTLEMENT_CONFIG.callbacks,
        enabled: true,
        observation: {
          ...DEFAULT_SETTLEMENT_CONFIG.callbacks.observation,
          enabled: true,
          contractAddress:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
      now: () => new Date("2026-03-09T00:05:00.000Z"),
    });

    const retried = await dispatcher.retryPending();

    expect(retried.processed).toBe(1);
    expect(retried.confirmed).toBe(1);
    expect(sendTOSNativeTransferMock).not.toHaveBeenCalled();
    expect(
      db.getSettlementCallbackByReceiptId(settlement.receiptId)?.status,
    ).toBe("confirmed");
    db.close();
  });
});
