import { describe, expect, it } from "vitest";
import type { Hex } from "tosdk";
import { createTestConfig, createTestDb, createTestIdentity } from "./mocks.js";
import { startSignerProviderServer } from "../signer/http.js";
import type { X402PaymentRecord } from "../types.js";

async function postJson(url: string, body: unknown): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

function buildPaymentRecord(overrides?: Partial<X402PaymentRecord>): X402PaymentRecord {
  const now = new Date().toISOString();
  return {
    paymentId: "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02" as Hex,
    serviceKind: "signer",
    requestKey: "signer:test",
    requestHash:
      "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6" as Hex,
    payerAddress:
      "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143" as `0x${string}`,
    providerAddress:
      "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2" as `0x${string}`,
    chainId: "1666",
    txNonce: "1",
    txHash:
      "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022" as Hex,
    rawTransaction:
      "0xb20d45fcf230c1d4053087f6df71ef5a43960ff5f61d976acb1fcfb4c40d9a10" as Hex,
    amountTomi: "5",
    confirmationPolicy: "receipt",
    status: "confirmed",
    attemptCount: 1,
    maxAttempts: 5,
    receipt: { status: "0x1" },
    lastError: null,
    nextAttemptAt: null,
    boundKind: null,
    boundSubjectId: null,
    artifactUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("signer provider", () => {
  it("quotes, executes, and returns an idempotent response for the same request key", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 1666,
      x402Server: {
        enabled: true,
        confirmationPolicy: "receipt",
        receiptTimeoutMs: 15000,
        receiptPollIntervalMs: 1000,
        retryBatchSize: 10,
        retryAfterSeconds: 30,
        maxAttempts: 5,
      },
      signerProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/signer",
        capabilityPrefix: "signer",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        quotePriceTomi: "0",
        submitPriceTomi: "5",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          walletAddress: identity.address,
          allowedTargets: [
            "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01" as `0x${string}`,
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
          allowSystemAction: false,
        },
      },
    });
    const payment = buildPaymentRecord();
    db.upsertX402Payment(payment);
    const bound: Array<{ paymentId: Hex; boundKind: string; boundSubjectId: string }> = [];
    const provider = await startSignerProviderServer({
      identity,
      config,
      db,
      address: identity.address,
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      signerConfig: config.signerProvider!,
      paymentManager: {
        async requirePayment() {
          return { state: "ready", payment };
        },
        bindPayment(binding) {
          bound.push(binding);
        },
      },
      async sendTransaction() {
        return {
          signed: {
            rawTransaction:
              "0xdeadbeef" as Hex,
            txHash:
              "0xffd5a4c82ff6c618d999d2315b4ffa704f7689e5b9f02d3597591aa4ef4b6b09" as Hex,
          },
          txHash:
            "0xffd5a4c82ff6c618d999d2315b4ffa704f7689e5b9f02d3597591aa4ef4b6b09" as Hex,
          receipt: { status: "0x1", blockNumber: "0x10" },
        };
      },
    });
    const quote = await postJson(`${provider.url}/quote`, {
      requester: {
        identity: {
          kind: "tos",
          value:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        },
      },
      target:
        "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
      value_tomi: "7",
      reason: "unit-test",
    });
    expect(quote.status).toBe(200);
    expect(quote.json.quote_id).toBeTypeOf("string");
    expect(quote.json.policy_id).toBe("policy-test");

    const payload = {
      quote_id: quote.json.quote_id,
      requester: {
        identity: {
          kind: "tos",
          value:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        },
      },
      request_nonce: "abc12345",
      request_expires_at: Math.floor(Date.now() / 1000) + 300,
      target:
        "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
      value_tomi: "7",
      reason: "unit-test",
    };
    const first = await postJson(`${provider.url}/submit`, payload);
    expect(first.status).toBe(200);
    expect(first.json.status).toBe("ok");
    expect(first.json.execution_id).toBeTypeOf("string");
    expect(first.json.payment_tx_hash).toBe(payment.txHash);

    const second = await postJson(`${provider.url}/submit`, payload);
    expect(second.status).toBe(200);
    expect(second.json.execution_id).toBe(first.json.execution_id);
    expect(second.json.idempotent).toBe(true);

    expect(db.listSignerQuotes(5).at(0)?.status).toBe("used");
    expect(db.listSignerExecutions(5).length).toBe(1);
    expect(bound).toHaveLength(1);
    expect(bound[0]?.boundKind).toBe("signer_execution");

    await provider.close();
    db.close();
  });

  it("rejects a quote outside the configured signer policy", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      signerProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/signer",
        capabilityPrefix: "signer",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        quotePriceTomi: "0",
        submitPriceTomi: "0",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          allowedTargets: [
            "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01" as `0x${string}`,
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
          allowSystemAction: false,
        },
      },
    });
    const provider = await startSignerProviderServer({
      identity,
      config,
      db,
      address: identity.address,
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      signerConfig: config.signerProvider!,
    });

    const response = await postJson(`${provider.url}/quote`, {
      requester: {
        identity: {
          kind: "tos",
          value:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        },
      },
      target:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      value_tomi: "1",
    });
    expect(response.status).toBe(400);
    expect(response.json.status).toBe("rejected");
    expect(String(response.json.reason)).toContain("target is not allowed");

    await provider.close();
    db.close();
  });

  it("advertises a payment requirement for paid signer submissions", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 1666,
      signerProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/signer",
        capabilityPrefix: "signer",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        quotePriceTomi: "0",
        submitPriceTomi: "99",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          allowedTargets: [
            "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01" as `0x${string}`,
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
          allowSystemAction: false,
        },
      },
    });
    const provider = await startSignerProviderServer({
      identity,
      config,
      db,
      address: identity.address,
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      signerConfig: config.signerProvider!,
    });

    const response = await fetch(`${provider.url}/submit`, { method: "HEAD" });
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBeTruthy();
    expect(response.headers.get("x-payment-required")).toBeTruthy();

    await provider.close();
    db.close();
  });
});
