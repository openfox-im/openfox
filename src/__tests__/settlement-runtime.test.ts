import { beforeEach, describe, expect, it, vi } from "vitest";

const chainMocks = vi.hoisted(() => ({
  call: vi.fn(),
}));

vi.mock("../chain/client.js", () => ({
  ChainRpcClient: vi.fn().mockImplementation(() => ({
    call: chainMocks.call,
  })),
}));

import {
  inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect,
} from "../settlement/runtime.js";

describe("settlement runtime inspection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inspects a runtime receipt and joins the linked settlement effect", async () => {
    chainMocks.call
      .mockResolvedValueOnce({
        receiptRef: "0xaaa1",
        settlementRef: "0xbbb1",
        statusName: "success",
      })
      .mockResolvedValueOnce({
        settlementRef: "0xbbb1",
        receiptRef: "0xaaa1",
        modeName: "PUBLIC_TRANSFER",
      });

    const surface = await inspectOpenFoxRuntimeReceipt({
      rpcUrl: "http://127.0.0.1:8545",
      receiptRef: "0xaaa1",
    });

    expect(chainMocks.call).toHaveBeenNthCalledWith(1, "settlement_getRuntimeReceipt", [
      "0xaaa1",
    ]);
    expect(chainMocks.call).toHaveBeenNthCalledWith(2, "settlement_getSettlementEffect", [
      "0xbbb1",
    ]);
    expect(surface.receipt?.receiptRef).toBe("0xaaa1");
    expect(surface.effect?.settlementRef).toBe("0xbbb1");
  });

  it("inspects a settlement effect and joins the linked runtime receipt", async () => {
    chainMocks.call
      .mockResolvedValueOnce({
        settlementRef: "0xbbb1",
        receiptRef: "0xaaa1",
        modeName: "REFUND_PUBLIC",
      })
      .mockResolvedValueOnce({
        receiptRef: "0xaaa1",
        settlementRef: "0xbbb1",
        statusName: "failure",
      });

    const surface = await inspectOpenFoxSettlementEffect({
      rpcUrl: "http://127.0.0.1:8545",
      settlementRef: "0xbbb1",
    });

    expect(chainMocks.call).toHaveBeenNthCalledWith(1, "settlement_getSettlementEffect", [
      "0xbbb1",
    ]);
    expect(chainMocks.call).toHaveBeenNthCalledWith(2, "settlement_getRuntimeReceipt", [
      "0xaaa1",
    ]);
    expect(surface.effect?.settlementRef).toBe("0xbbb1");
    expect(surface.receipt?.receiptRef).toBe("0xaaa1");
  });
});
