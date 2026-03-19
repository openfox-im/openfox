import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeartbeatLegacyContext, OpenFoxDatabase, TickContext } from "../types.js";
import { createTestConfig, createTestDb, createTestIdentity, MockRuntimeClient } from "./mocks.js";
import { buildMarketBindingRecord } from "../market/publisher.js";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";

const getTransactionReceiptMock = vi.fn();

vi.mock("../identity/wallet.js", () => ({
  loadWalletPrivateKey: vi.fn(
    () =>
      "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
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
      "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
    receipt: null,
  })),
}));

function createMockTickContext(db: OpenFoxDatabase): TickContext {
  return {
    tickId: "tick-market-1",
    startedAt: new Date("2026-03-09T00:05:00.000Z"),
    creditBalance: 10000,
    walletBalance: 1,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config: { entries: [], defaultIntervalMs: 60000, lowComputeMultiplier: 4 },
    db: db.raw,
  };
}

describe("heartbeat market contract retry task", () => {
  let db: OpenFoxDatabase;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("confirms pending market callbacks through the heartbeat task", async () => {
    const identity = createTestIdentity();
    const runtime = new MockRuntimeClient();
    const binding = buildMarketBindingRecord({
      kind: "oracle",
      subjectId: "result-1",
      publisherAddress: identity.address,
      capability: "oracle.resolve",
      artifactUrl: "/oracle/result/result-1",
      paymentTxHash:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      metadata: { requester_agent_id: "solver-1" },
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    db.upsertMarketBinding(binding);
    db.upsertMarketContractCallback({
      callbackId: `${binding.bindingId}:0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2`,
      bindingId: binding.bindingId,
      kind: binding.kind,
      subjectId: binding.subjectId,
      contractAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
      packageName: "OracleMarket",
      functionSignature: "bind(bytes)",
      payloadMode: "canonical_binding",
      payloadHex: "0x1234",
      payloadHash:
        "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
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
        marketContracts: {
          enabled: true,
          retryBatchSize: 10,
          retryAfterSeconds: 120,
          bounty: {
            enabled: false,
            gas: "260000",
            valueTomi: "0",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
            payloadMode: "canonical_binding",
            maxAttempts: 3,
          },
          observation: {
            enabled: false,
            gas: "260000",
            valueTomi: "0",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
            payloadMode: "canonical_binding",
            maxAttempts: 3,
          },
          oracle: {
            enabled: true,
            gas: "260000",
            valueTomi: "0",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
            payloadMode: "canonical_binding",
            maxAttempts: 3,
            contractAddress:
              "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
            packageName: "OracleMarket",
            functionSignature: "bind(bytes)",
          },
        },
      }),
      db,
      runtime,
    };

    const result = await BUILTIN_TASKS.retry_market_contract_callbacks(
      createMockTickContext(db),
      taskCtx,
    );

    expect(result.shouldWake).toBe(false);
    const updated = db.getMarketContractCallbackByBindingId(binding.bindingId);
    expect(updated?.status).toBe("confirmed");
    const summary = JSON.parse(db.getKV("last_market_contract_retry") || "{}");
    expect(summary.confirmed).toBe(1);
  });
});
