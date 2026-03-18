import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../chain/client.js", () => ({
  sendNativeTransfer: vi.fn(async () => ({
    txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    receipt: { status: "0x1" },
  })),
}));

import { createNativeSettlementPublisher } from "../settlement/publisher.js";
import { createTestDb, createTestIdentity } from "./mocks.js";
import { DEFAULT_SETTLEMENT_CONFIG } from "../types.js";
import { sendNativeTransfer } from "../chain/client.js";

describe("settlement publisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes and stores an idempotent settlement anchor", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const publisher = createNativeSettlementPublisher({
      db,
      rpcUrl: "http://127.0.0.1:8545",
      privateKey:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      config: {
        ...DEFAULT_SETTLEMENT_CONFIG,
        enabled: true,
        sinkAddress:
          "0xa65c6a8098b54b791cf3a2582b3e07b704d087d56f8f8fbdba35995dae0b8241",
      },
      publisherAddress: identity.address,
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const first = await publisher.publish({
      kind: "bounty",
      subjectId: "bounty-1",
      publisherAddress: identity.address,
      capability: "task.result",
      solverAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
      result: { decision: "accepted", confidence: 0.97 },
      artifactUrl: "/bounties/bounty-1/result",
    });

    const second = await publisher.publish({
      kind: "bounty",
      subjectId: "bounty-1",
      publisherAddress: identity.address,
      capability: "task.result",
      solverAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
      result: { confidence: 0.97, decision: "accepted" },
      artifactUrl: "/bounties/bounty-1/result",
    });

    expect(first.receiptId).toBe("bounty:bounty-1");
    expect(first.settlementTxHash).toBe(
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    );
    expect(second.receiptHash).toBe(first.receiptHash);
    expect(second.settlementTxHash).toBe(first.settlementTxHash);
    expect(sendNativeTransfer).toHaveBeenCalledTimes(1);

    const stored = db.getSettlementReceipt("bounty", "bounty-1");
    expect(stored?.receiptId).toBe(first.receiptId);
    expect(stored?.settlementTxHash).toBe(first.settlementTxHash);
    db.close();
  });
});
