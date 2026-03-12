import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "tosdk/accounts";

const TEST_PRIVATE_KEY =
  "0x45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8" as const;
const TEST_TOS_RPC_URL = "http://tos-rpc.local";
const TEST_API_URL = "https://paid.example.com/resource";
const TEST_PAY_TO =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalTosRpcUrl = process.env.TOS_RPC_URL;

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("x402 chain payments", () => {
  let tempHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();

    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "autos-x402-tos-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = TEST_TOS_RPC_URL;

    const openfoxDir = path.join(tempHome, ".openfox");
    fs.mkdirSync(openfoxDir, { recursive: true });
    fs.writeFileSync(
      path.join(openfoxDir, "wallet.json"),
      JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        createdAt: new Date().toISOString(),
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalTosRpcUrl === undefined) {
      delete process.env.TOS_RPC_URL;
    } else {
      process.env.TOS_RPC_URL = originalTosRpcUrl;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("accepts chain exact payment requirements", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    let paidRequestHeaders: Headers | null = null;

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === TEST_API_URL) {
        const headers = new Headers(init?.headers);
        const paymentHeader = headers.get("Payment-Signature");

        if (!paymentHeader) {
          const paymentRequired = {
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "tos:1337",
                maxAmountRequired: "12345",
                payToAddress: TEST_PAY_TO,
                asset: "native",
              },
            ],
          };
          return jsonResponse(402, paymentRequired, {
            "Payment-Required": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
          });
        }

        paidRequestHeaders = headers;
        return jsonResponse(200, { ok: true });
      }

      if (url === TEST_TOS_RPC_URL) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          id: number;
          method: string;
        };
        switch (body.method) {
          case "tos_chainId":
            return jsonResponse(200, {
              jsonrpc: "2.0",
              id: body.id,
              result: "0x539",
            });
          case "tos_getTransactionCount":
            return jsonResponse(200, {
              jsonrpc: "2.0",
              id: body.id,
              result: "0x2a",
            });
          default:
            throw new Error(`unexpected TOS RPC method: ${body.method}`);
        }
      }

      throw new Error(`unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const { x402Fetch } = await import("../runtime/x402.js");
    const result = await x402Fetch(TEST_API_URL, account);

    expect(result.success).toBe(true);
    expect(result.response).toEqual({ ok: true });
    expect(paidRequestHeaders).not.toBeNull();

    const paymentHeader = paidRequestHeaders!.get("Payment-Signature");
    expect(paymentHeader).toBeTruthy();
    expect(paidRequestHeaders!.get("X-Payment")).toBe(paymentHeader);

    const envelope = JSON.parse(
      Buffer.from(paymentHeader!, "base64").toString("utf8"),
    ) as {
      x402Version: number;
      scheme: string;
      network: string;
      payload: { rawTransaction: string };
    };

    expect(envelope.x402Version).toBe(1);
    expect(envelope.scheme).toBe("exact");
    expect(envelope.network).toBe("tos:1337");
    expect(envelope.payload.rawTransaction.startsWith("0x00")).toBe(true);
  });
});
