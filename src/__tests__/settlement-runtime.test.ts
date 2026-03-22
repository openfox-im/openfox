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
  inspectOpenFoxSettlementRecordRuntimeBridge,
  inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect,
  resolveOpenFoxSettlementRuntimeRefs,
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

  it("resolves runtime refs from local settlement records and joins by receipt ref", async () => {
    const record = {
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
      runtimeSettlementRef: null,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    } as const;

    expect(resolveOpenFoxSettlementRuntimeRefs(record).runtimeReceiptRef).toBe("0xaaa1");

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

    const surface = await inspectOpenFoxSettlementRecordRuntimeBridge({
      rpcUrl: "http://127.0.0.1:8545",
      record,
    });

    expect(surface.runtimeReceiptRef).toBe("0xaaa1");
    expect(surface.receipt?.receiptRef).toBe("0xaaa1");
    expect(surface.effect?.settlementRef).toBe("0xbbb1");
  });
});
