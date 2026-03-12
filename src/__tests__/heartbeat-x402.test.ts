import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeartbeatLegacyContext, OpenFoxDatabase, TickContext } from "../types.js";
import { createTestConfig, createTestDb, createTestIdentity, MockRuntimeClient } from "./mocks.js";

const getTransactionReceiptMock = vi.fn();
const getTransactionByHashMock = vi.fn();
const sendRawTransactionMock = vi.fn();

vi.mock("../chain/client.js", () => ({
  ChainRpcClient: class {
    async getTransactionReceipt(txHash: string) {
      return getTransactionReceiptMock(txHash);
    }

    async getTransactionByHash(txHash: string) {
      return getTransactionByHashMock(txHash);
    }

    async sendRawTransaction(rawTransaction: string) {
      return sendRawTransactionMock(rawTransaction);
    }
  },
}));

import { BUILTIN_TASKS } from "../heartbeat/tasks.js";

function createMockTickContext(db: OpenFoxDatabase): TickContext {
  return {
    tickId: "tick-x402-1",
    startedAt: new Date("2026-03-09T00:05:00.000Z"),
    creditBalance: 10000,
    walletBalance: 1,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config: { entries: [], defaultIntervalMs: 60000, lowComputeMultiplier: 4 },
    db: db.raw,
  };
}

describe("heartbeat x402 retry task", () => {
  let db: OpenFoxDatabase;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("confirms pending x402 ledger payments through the heartbeat task", async () => {
    const identity = createTestIdentity();
    const runtime = new MockRuntimeClient();
    db.upsertX402Payment({
      paymentId:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      serviceKind: "observation",
      requestKey: "observation:req:1",
      requestHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      payerAddress:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      providerAddress:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      chainId: "1666",
      txNonce: "1",
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rawTransaction:
        "0x1234",
      amountWei: "1000",
      confirmationPolicy: "receipt",
      status: "submitted",
      attemptCount: 1,
      maxAttempts: 5,
      receipt: null,
      lastError: null,
      nextAttemptAt: "2026-03-09T00:00:00.000Z",
      boundKind: null,
      boundSubjectId: null,
      artifactUrl: null,
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });
    getTransactionReceiptMock.mockResolvedValue({ status: "0x1" });
    getTransactionByHashMock.mockResolvedValue(null);
    sendRawTransactionMock.mockResolvedValue(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    const taskCtx: HeartbeatLegacyContext = {
      identity,
      config: createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        x402Server: {
          enabled: true,
          confirmationPolicy: "receipt",
          receiptTimeoutMs: 1000,
          receiptPollIntervalMs: 10,
          retryBatchSize: 10,
          retryAfterSeconds: 30,
          maxAttempts: 5,
        },
      }),
      db,
      runtime,
    };

    const result = await BUILTIN_TASKS.retry_x402_payments(
      createMockTickContext(db),
      taskCtx,
    );

    expect(result.shouldWake).toBe(false);
    const updated = db.getX402Payment(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(updated?.status).toBe("confirmed");
    const summary = JSON.parse(db.getKV("last_x402_payment_retry") || "{}");
    expect(summary.confirmed).toBe(1);
  });
});
