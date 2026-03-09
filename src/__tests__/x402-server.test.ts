import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../state/database.js";
import { buildTOSX402Payment } from "../tos/client.js";
import { deriveTOSAddressFromPrivateKey } from "../tos/address.js";
import {
  createX402PaymentManager,
  hashX402RequestPayload,
  X402ServerPaymentRejectedError,
} from "../tos/x402-server.js";
import type { OpenFoxDatabase, X402ServerConfig } from "../types.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makePaymentHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

describe("x402 server payment manager", () => {
  const originalFetch = global.fetch;
  let tempDir = "";
  let db: OpenFoxDatabase | null = null;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    db?.close();
    db = null;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  function makeDb(): OpenFoxDatabase {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-x402-server-"));
    db = createDatabase(path.join(tempDir, "state.db"));
    return db;
  }

  function makeConfig(
    overrides: Partial<X402ServerConfig> = {},
  ): X402ServerConfig {
    return {
      enabled: true,
      confirmationPolicy: "broadcast",
      receiptTimeoutMs: 500,
      receiptPollIntervalMs: 10,
      retryBatchSize: 10,
      retryAfterSeconds: 0,
      maxAttempts: 5,
      ...overrides,
    };
  }

  it("recovers a paid request from the ledger after initial broadcast failure", async () => {
    const rpcUrl = "http://127.0.0.1:8545";
    const providerAddress =
      "0x0000000000000000000000000000000000000000000000000000000000000042";
    const payerAddress = deriveTOSAddressFromPrivateKey(TEST_PRIVATE_KEY);
    const requestKey = "observation:req:1";
    const requestHash = hashX402RequestPayload({
      capability: "observation.once",
      requester_identity: payerAddress,
      target_url: "https://target.example/data",
      reason: "test",
    });

    const envelope = await buildTOSX402Payment({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl,
      requirement: {
        scheme: "exact",
        network: "tos:1666",
        maxAmountRequired: "1000000000000000",
        payToAddress: providerAddress,
      },
    });

    let sendAttempts = 0;
    global.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
      switch (body.method) {
        case "tos_chainId":
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x682" }), {
            status: 200,
          });
        case "tos_getTransactionCount":
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }), {
            status: 200,
          });
        case "tos_getTransactionReceipt":
        case "tos_getTransactionByHash":
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), {
            status: 200,
          });
        case "tos_sendRawTransaction":
          sendAttempts += 1;
          if (sendAttempts === 1) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                error: { code: -32000, message: "temporary broadcast failure" },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            }),
            { status: 200 },
          );
        default:
          throw new Error(`unexpected RPC method ${body.method}`);
      }
    }) as typeof fetch;

    const paymentManager = createX402PaymentManager({
      db: makeDb(),
      rpcUrl,
      config: makeConfig(),
    });

    const first = await paymentManager.requirePayment({
      req: {
        headers: {
          "payment-signature": makePaymentHeader(envelope),
        },
      } as any,
      serviceKind: "observation",
      providerAddress,
      requestKey,
      requestHash,
      amountWei: "1000000000000000",
      description: "OpenFox observation.once payment",
    });
    expect(first.state).toBe("pending");
    const storedAfterFirst = db!.getLatestX402PaymentByRequestKey("observation", requestKey)!;
    expect(storedAfterFirst.status).toBe("failed");

    const second = await paymentManager.requirePayment({
      req: { headers: {} } as any,
      serviceKind: "observation",
      providerAddress,
      requestKey,
      requestHash,
      amountWei: "1000000000000000",
      description: "OpenFox observation.once payment",
    });
    expect(second.state).toBe("ready");
    if (second.state !== "ready") return;
    expect(second.payment.status).toBe("submitted");
    expect(sendAttempts).toBe(2);

    const bound = paymentManager.bindPayment({
      paymentId: second.payment.paymentId,
      boundKind: "observation_job",
      boundSubjectId: "job-1",
      artifactUrl: "/jobs/job-1",
    });
    expect(bound.boundSubjectId).toBe("job-1");
  });

  it("rejects replaying the same payment envelope for a different request", async () => {
    const rpcUrl = "http://127.0.0.1:8545";
    const providerAddress =
      "0x0000000000000000000000000000000000000000000000000000000000000042";
    const payerAddress = deriveTOSAddressFromPrivateKey(TEST_PRIVATE_KEY);
    const envelope = await buildTOSX402Payment({
      privateKey: TEST_PRIVATE_KEY,
      rpcUrl,
      requirement: {
        scheme: "exact",
        network: "tos:1666",
        maxAmountRequired: "2000000000000000",
        payToAddress: providerAddress,
      },
    });

    global.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
      switch (body.method) {
        case "tos_chainId":
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x682" }), {
            status: 200,
          });
        case "tos_getTransactionCount":
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }), {
            status: 200,
          });
        case "tos_getTransactionReceipt":
        case "tos_getTransactionByHash":
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), {
            status: 200,
          });
        case "tos_sendRawTransaction":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result:
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            }),
            { status: 200 },
          );
        default:
          throw new Error(`unexpected RPC method ${body.method}`);
      }
    }) as typeof fetch;

    const paymentManager = createX402PaymentManager({
      db: makeDb(),
      rpcUrl,
      config: makeConfig(),
    });

    const headers = {
      "payment-signature": makePaymentHeader(envelope),
    };
    const requestHashA = hashX402RequestPayload({
      capability: "oracle.resolve",
      requester_identity: payerAddress,
      query: "question a",
    });
    const first = await paymentManager.requirePayment({
      req: { headers } as any,
      serviceKind: "oracle",
      providerAddress,
      requestKey: "oracle:req:a",
      requestHash: requestHashA,
      amountWei: "2000000000000000",
      description: "OpenFox oracle.resolve payment",
    });
    expect(first.state).toBe("ready");

    const requestHashB = hashX402RequestPayload({
      capability: "oracle.resolve",
      requester_identity: payerAddress,
      query: "question b",
    });
    await expect(
      paymentManager.requirePayment({
        req: { headers } as any,
        serviceKind: "oracle",
        providerAddress,
        requestKey: "oracle:req:b",
        requestHash: requestHashB,
        amountWei: "2000000000000000",
        description: "OpenFox oracle.resolve payment",
      }),
    ).rejects.toBeInstanceOf(X402ServerPaymentRejectedError);
  });
});
