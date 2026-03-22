import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";

const runtimeMocks = vi.hoisted(() => ({
  inspectOpenFoxSettlementRecordRuntimeBridge: vi.fn(),
  inspectOpenFoxRuntimeReceipt: vi.fn(),
  inspectOpenFoxSettlementEffect: vi.fn(),
  resolveOpenFoxSettlementRuntimeRefs: vi.fn(),
}));

vi.mock("../settlement/runtime.js", () => ({
  inspectOpenFoxSettlementRecordRuntimeBridge:
    runtimeMocks.inspectOpenFoxSettlementRecordRuntimeBridge,
  inspectOpenFoxRuntimeReceipt: runtimeMocks.inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect: runtimeMocks.inspectOpenFoxSettlementEffect,
  resolveOpenFoxSettlementRuntimeRefs: runtimeMocks.resolveOpenFoxSettlementRuntimeRefs,
}));

import { startOperatorApiServer } from "../operator/api.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await server.close();
  }
});

describe("operator settlement runtime api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.resolveOpenFoxSettlementRuntimeRefs.mockReturnValue({});
  });

  it("serves runtime receipt and settlement effect inspection endpoints", async () => {
    runtimeMocks.inspectOpenFoxRuntimeReceipt.mockResolvedValueOnce({
      receipt: { receiptRef: "0xaaa1", statusName: "success" },
      effect: { settlementRef: "0xbbb1", modeName: "PUBLIC_TRANSFER" },
    });
    runtimeMocks.inspectOpenFoxSettlementEffect.mockResolvedValueOnce({
      effect: { settlementRef: "0xbbb1", modeName: "PUBLIC_TRANSFER" },
      receipt: { receiptRef: "0xaaa1", statusName: "success" },
    });

    const db = createTestDb();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
    });
    const server = await startOperatorApiServer({ config, db });
    if (!server) {
      throw new Error("operator api server did not start");
    }
    servers.push(server);
    const headers = { Authorization: "Bearer secret-token" };

    const receiptRes = await fetch(
      `${server.url}/settlement/runtime-receipt?receipt_ref=0xaaa1`,
      { headers },
    );
    expect(receiptRes.status).toBe(200);
    const receiptJson = (await receiptRes.json()) as {
      receipt?: { receiptRef?: string };
      effect?: { settlementRef?: string };
    };
    expect(receiptJson.receipt?.receiptRef).toBe("0xaaa1");
    expect(receiptJson.effect?.settlementRef).toBe("0xbbb1");
    expect(runtimeMocks.inspectOpenFoxRuntimeReceipt).toHaveBeenCalledWith({
      rpcUrl: "http://127.0.0.1:8545",
      receiptRef: "0xaaa1",
    });

    const effectRes = await fetch(
      `${server.url}/settlement/runtime-effect?settlement_ref=0xbbb1`,
      { headers },
    );
    expect(effectRes.status).toBe(200);
    const effectJson = (await effectRes.json()) as {
      effect?: { settlementRef?: string };
      receipt?: { receiptRef?: string };
    };
    expect(effectJson.effect?.settlementRef).toBe("0xbbb1");
    expect(effectJson.receipt?.receiptRef).toBe("0xaaa1");
    expect(runtimeMocks.inspectOpenFoxSettlementEffect).toHaveBeenCalledWith({
      rpcUrl: "http://127.0.0.1:8545",
      settlementRef: "0xbbb1",
    });

    db.close();
  });

  it("rejects runtime settlement inspection requests without required refs", async () => {
    const db = createTestDb();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
    });
    const server = await startOperatorApiServer({ config, db });
    if (!server) {
      throw new Error("operator api server did not start");
    }
    servers.push(server);
    const headers = { Authorization: "Bearer secret-token" };

    const receiptRes = await fetch(`${server.url}/settlement/runtime-receipt`, {
      headers,
    });
    expect(receiptRes.status).toBe(400);
    const receiptJson = (await receiptRes.json()) as { error?: string };
    expect(receiptJson.error).toBe("missing receipt_ref");

    const effectRes = await fetch(`${server.url}/settlement/runtime-effect`, {
      headers,
    });
    expect(effectRes.status).toBe(400);
    const effectJson = (await effectRes.json()) as { error?: string };
    expect(effectJson.error).toBe("missing settlement_ref");

    db.close();
  });

  it("serves local-to-runtime settlement bridge inspection by receipt id", async () => {
    runtimeMocks.resolveOpenFoxSettlementRuntimeRefs.mockReturnValue({
      runtimeReceiptRef: "0xaaa1",
      runtimeSettlementRef: "0xbbb1",
    });
    runtimeMocks.inspectOpenFoxSettlementRecordRuntimeBridge.mockResolvedValueOnce({
      runtimeReceiptRef: "0xaaa1",
      runtimeSettlementRef: "0xbbb1",
      receipt: { receiptRef: "0xaaa1", statusName: "success" },
      effect: { settlementRef: "0xbbb1", modeName: "PUBLIC_TRANSFER" },
    });

    const db = createTestDb();
    db.upsertSettlementReceipt({
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
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
    });
    const server = await startOperatorApiServer({ config, db });
    if (!server) {
      throw new Error("operator api server did not start");
    }
    servers.push(server);
    const headers = { Authorization: "Bearer secret-token" };

    const res = await fetch(
      `${server.url}/settlement/bridge?receipt_id=bounty%3Ab1`,
      { headers },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      record?: { receiptId?: string };
      runtimeBridge?: { runtimeReceiptRef?: string };
    };
    expect(json.record?.receiptId).toBe("bounty:b1");
    expect(json.runtimeBridge?.runtimeReceiptRef).toBe("0xaaa1");
    expect(runtimeMocks.inspectOpenFoxSettlementRecordRuntimeBridge).toHaveBeenCalledWith({
      rpcUrl: "http://127.0.0.1:8545",
      record: expect.objectContaining({ receiptId: "bounty:b1" }),
    });

    db.close();
  });
});
