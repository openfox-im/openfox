import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  inspectOpenFoxRuntimeReceipt: vi.fn(),
  inspectOpenFoxSettlementEffect: vi.fn(),
}));

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    dbPath: "/tmp/openfox-test.db",
    rpcUrl: "http://127.0.0.1:8545",
  })),
  resolvePath: vi.fn((value: string) => value),
}));

vi.mock("../state/database.js", () => ({
  createDatabase: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

vi.mock("../observability/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: commandMocks.loggerInfo,
  })),
}));

vi.mock("../settlement/runtime.js", () => ({
  inspectOpenFoxRuntimeReceipt: commandMocks.inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect: commandMocks.inspectOpenFoxSettlementEffect,
}));

import { handleSettlementCommand } from "../commands/settlement.js";

describe("settlement command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
