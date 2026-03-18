import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../chain/client.js", () => ({
  ChainRpcClient: class {
    async getTransactionReceipt() {
      return { status: "0x1" };
    }
  },
  sendNativeTransfer: vi.fn(async () => ({
    txHash:
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    receipt: { status: "0x1" },
  })),
}));

import { createMarketContractDispatcher } from "../market/contracts.js";
import { buildMarketBindingRecord } from "../market/publisher.js";
import { createTestDb, createTestIdentity } from "./mocks.js";
import { sendNativeTransfer } from "../chain/client.js";
import { DEFAULT_MARKET_CONTRACT_CONFIG } from "../types.js";

describe("market contract callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches a confirmed contract callback for a market binding", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const binding = buildMarketBindingRecord({
      kind: "bounty",
      subjectId: "bounty-1",
      publisherAddress: identity.address,
      capability: "task.submit",
      artifactUrl: "/bounty/bounty-1",
      metadata: { title: "test" },
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    db.upsertMarketBinding(binding);

    const dispatcher = createMarketContractDispatcher({
      db,
      rpcUrl: "http://127.0.0.1:8545",
      privateKey:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      config: {
        ...DEFAULT_MARKET_CONTRACT_CONFIG,
        enabled: true,
        bounty: {
          ...DEFAULT_MARKET_CONTRACT_CONFIG.bounty,
          enabled: true,
          contractAddress:
            "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
          packageName: "TaskMarket",
          functionSignature: "bind(bytes)",
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const result = await dispatcher.dispatch(binding);

    expect(result.action).toBe("confirmed");
    expect(result.callback?.status).toBe("confirmed");
    expect(sendNativeTransfer).toHaveBeenCalledTimes(1);
    expect(
      db.getMarketContractCallbackByBindingId(binding.bindingId)?.status,
    ).toBe("confirmed");
    expect(
      db.getMarketBinding("bounty", "bounty-1")?.callbackTxHash,
    ).toBe(
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    );
    db.close();
  });
});
