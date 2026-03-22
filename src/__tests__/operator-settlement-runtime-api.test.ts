import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";

const runtimeMocks = vi.hoisted(() => ({
  inspectOpenFoxRuntimeReceipt: vi.fn(),
  inspectOpenFoxSettlementEffect: vi.fn(),
}));

vi.mock("../settlement/runtime.js", () => ({
  inspectOpenFoxRuntimeReceipt: runtimeMocks.inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect: runtimeMocks.inspectOpenFoxSettlementEffect,
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
});
