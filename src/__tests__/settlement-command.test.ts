import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  inspectOpenFoxRuntimeReceipt: vi.fn(),
  inspectOpenFoxSettlementEffect: vi.fn(),
  inspectOpenFoxSettlementRecordRuntimeBridge: vi.fn(),
  resolveOpenFoxSettlementRuntimeRefs: vi.fn(),
  db: {
    getSettlementReceiptById: vi.fn(),
    getSettlementReceipt: vi.fn(),
    getSettlementCallbackByReceiptId: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    dbPath: "/tmp/openfox-test.db",
    rpcUrl: "http://127.0.0.1:8545",
  })),
  resolvePath: vi.fn((value: string) => value),
}));

vi.mock("../state/database.js", () => ({
  createDatabase: vi.fn(() => commandMocks.db),
}));

vi.mock("../observability/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: commandMocks.loggerInfo,
  })),
}));

vi.mock("../settlement/runtime.js", () => ({
  inspectOpenFoxSettlementRecordRuntimeBridge:
    commandMocks.inspectOpenFoxSettlementRecordRuntimeBridge,
  inspectOpenFoxRuntimeReceipt: commandMocks.inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect: commandMocks.inspectOpenFoxSettlementEffect,
  resolveOpenFoxSettlementRuntimeRefs: commandMocks.resolveOpenFoxSettlementRuntimeRefs,
}));

import { handleSettlementCommand } from "../commands/settlement.js";

describe("settlement command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandMocks.resolveOpenFoxSettlementRuntimeRefs.mockReturnValue({});
    commandMocks.db.getSettlementReceiptById.mockReset();
    commandMocks.db.getSettlementReceipt.mockReset();
    commandMocks.db.getSettlementCallbackByReceiptId.mockReset();
  });

  it("emits runtime receipt inspection as json", async () => {
    commandMocks.inspectOpenFoxRuntimeReceipt.mockResolvedValueOnce({
      receipt: { receiptRef: "0xaaa1" },
      effect: { settlementRef: "0xbbb1" },
    });

    await handleSettlementCommand([
      "runtime-receipt",
      "--receipt-ref",
      "0xaaa1",
      "--json",
    ]);

    expect(commandMocks.inspectOpenFoxRuntimeReceipt).toHaveBeenCalledWith({
      rpcUrl: "http://127.0.0.1:8545",
      receiptRef: "0xaaa1",
    });
    expect(commandMocks.loggerInfo).toHaveBeenCalledTimes(1);
    const payload = commandMocks.loggerInfo.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    expect(payload).toContain("\"receiptRef\": \"0xaaa1\"");
  });

  it("emits runtime settlement effect inspection as json", async () => {
    commandMocks.inspectOpenFoxSettlementEffect.mockResolvedValueOnce({
      effect: { settlementRef: "0xbbb1" },
      receipt: { receiptRef: "0xaaa1" },
    });

    await handleSettlementCommand([
      "runtime-effect",
      "--settlement-ref",
      "0xbbb1",
      "--json",
    ]);

    expect(commandMocks.inspectOpenFoxSettlementEffect).toHaveBeenCalledWith({
      rpcUrl: "http://127.0.0.1:8545",
      settlementRef: "0xbbb1",
    });
    expect(commandMocks.loggerInfo).toHaveBeenCalledTimes(1);
    const payload = commandMocks.loggerInfo.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    expect(payload).toContain("\"settlementRef\": \"0xbbb1\"");
  });

  it("bridges local settlement records to canonical runtime refs on get --json", async () => {
    commandMocks.db.getSettlementReceiptById.mockReturnValue({
      receiptId: "bounty:b1",
      kind: "bounty",
      subjectId: "b1",
      receipt: {
        version: 1,
        receiptId: "bounty:b1",
        kind: "bounty",
        subjectId: "b1",
        publisherAddress:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        resultHash:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        createdAt: "2026-03-22T00:00:00.000Z",
      },
      receiptHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      settlementTxHash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
      settlementReceipt: null,
      runtimeReceiptRef: "0xaaa1",
      runtimeSettlementRef: "0xbbb1",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    });
    commandMocks.resolveOpenFoxSettlementRuntimeRefs.mockReturnValue({
      runtimeReceiptRef: "0xaaa1",
      runtimeSettlementRef: "0xbbb1",
    });
    commandMocks.inspectOpenFoxSettlementRecordRuntimeBridge.mockResolvedValueOnce({
      runtimeReceiptRef: "0xaaa1",
      runtimeSettlementRef: "0xbbb1",
      receipt: { receiptRef: "0xaaa1", statusName: "success" },
      effect: { settlementRef: "0xbbb1", modeName: "PUBLIC_TRANSFER" },
    });

    await handleSettlementCommand(["get", "--receipt-id", "bounty:b1", "--json"]);

    expect(commandMocks.inspectOpenFoxSettlementRecordRuntimeBridge).toHaveBeenCalledWith({
      rpcUrl: "http://127.0.0.1:8545",
      record: expect.objectContaining({
        receiptId: "bounty:b1",
        runtimeReceiptRef: "0xaaa1",
        runtimeSettlementRef: "0xbbb1",
      }),
    });
    const payload = commandMocks.loggerInfo.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    expect(payload).toContain("\"runtimeReceiptRef\": \"0xaaa1\"");
    expect(payload).toContain("\"runtimeBridge\"");
  });
});
