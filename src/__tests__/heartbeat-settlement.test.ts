import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeartbeatLegacyContext, OpenFoxDatabase, TickContext } from "../types.js";
import { createTestConfig, createTestDb, createTestIdentity, MockRuntimeClient } from "./mocks.js";

const getTransactionReceiptMock = vi.fn();

vi.mock("../identity/wallet.js", () => ({
  loadWalletPrivateKey: vi.fn(
    () =>
      "0x1111111111111111111111111111111111111111111111111111111111111111",
  ),
}));

vi.mock("../chain/client.js", () => ({
  ChainRpcClient: class {
    async getTransactionReceipt(txHash: string) {
      return getTransactionReceiptMock(txHash);
    }
  },
  sendNativeTransfer: vi.fn(async () => ({
    txHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    receipt: null,
  })),
}));

import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import { buildSettlementReceiptRecord } from "../settlement/publisher.js";

function createMockTickContext(db: OpenFoxDatabase): TickContext {
  return {
    tickId: "tick-1",
    startedAt: new Date("2026-03-09T00:05:00.000Z"),
    creditBalance: 10000,
    walletBalance: 1,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config: { entries: [], defaultIntervalMs: 60000, lowComputeMultiplier: 4 },
    db: db.raw,
  };
}

describe("heartbeat settlement retry task", () => {
  let db: OpenFoxDatabase;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("confirms pending settlement callbacks through the heartbeat task", async () => {
    const identity = createTestIdentity();
    const runtime = new MockRuntimeClient();
    const settlement = buildSettlementReceiptRecord({
      kind: "oracle",
      subjectId: "result-1",
      publisherAddress: identity.address,
      capability: "oracle.resolve",
      result: { canonical_result: "yes" },
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
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      status: "pending",
      attemptCount: 1,
      maxAttempts: 3,
      callbackTxHash:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      callbackReceipt: null,
      lastError: null,
      nextAttemptAt: "2026-03-09T00:00:00.000Z",
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });
    getTransactionReceiptMock.mockResolvedValue({ status: "0x1" });

    const taskCtx: HeartbeatLegacyContext = {
      identity,
      config: createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        settlement: {
          enabled: true,
          gas: "160000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
          publishBounties: true,
          publishObservations: true,
          publishOracleResults: true,
          callbacks: {
            enabled: true,
            retryBatchSize: 10,
            retryAfterSeconds: 120,
            bounty: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
            observation: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
            oracle: {
              enabled: true,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
              contractAddress:
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
        },
      }),
      db,
      runtime,
    };

    const result = await BUILTIN_TASKS.retry_settlement_callbacks(
      createMockTickContext(db),
      taskCtx,
    );

    expect(result.shouldWake).toBe(false);
    const updated = db.getSettlementCallbackByReceiptId(settlement.receiptId);
    expect(updated?.status).toBe("confirmed");
    const summary = JSON.parse(db.getKV("last_settlement_callback_retry") || "{}");
    expect(summary.confirmed).toBe(1);
  });
});
