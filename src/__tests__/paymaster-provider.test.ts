import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount, type Hex, type Signature } from "tosdk";
import { createTestConfig, createTestDb } from "./mocks.js";
import { startPaymasterProviderServer } from "../paymaster/http.js";
import type { OpenFoxIdentity, X402PaymentRecord } from "../types.js";

const servers: http.Server[] = [];

async function startRpcServer(): Promise<{ url: string }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id: number;
      method: string;
      params?: unknown[];
    };

    const respond = (result: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    };

    switch (body.method) {
      case "tos_chainId":
        respond("0x682");
        return;
      case "tos_getSponsorNonce":
        respond("0x17");
        return;
      case "tos_getTransactionReceipt":
        respond(null);
        return;
      case "tos_getTransactionByHash":
        respond(null);
        return;
      default:
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: `unsupported method ${body.method}` },
          }),
        );
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind rpc test server");
  }
  return { url: `http://127.0.0.1:${address.port}` };
}

async function postJson(url: string, body: unknown): Promise<{
  status: number;
  json: Record<string, unknown>;
  headers: Headers;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    headers: response.headers,
  };
}

function toJsonSignature(signature: Signature): Record<string, unknown> {
  return {
    r: signature.r,
    s: signature.s,
    yParity: signature.yParity,
  };
}

function buildPaymentRecord(overrides?: Partial<X402PaymentRecord>): X402PaymentRecord {
  const now = new Date().toISOString();
  return {
    paymentId: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
    serviceKind: "paymaster",
    requestKey: "paymaster:test",
    requestHash:
      "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
    payerAddress:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    providerAddress:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    chainId: "1666",
    txNonce: "1",
    txHash:
      "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex,
    rawTransaction:
      "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex,
    amountWei: "5",
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

function createIdentity(privateKey: Hex): OpenFoxIdentity {
  const account = privateKeyToAccount(privateKey);
  return {
    name: "test-openfox",
    address: account.address,
    account,
    creatorAddress:
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    sandboxId: "test-sandbox-id",
    apiKey: "test-api-key",
    createdAt: new Date().toISOString(),
  };
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("paymaster provider", () => {
  it("quotes, authorizes, and returns an idempotent response for the same request key", async () => {
    const rpc = await startRpcServer();
    const db = createTestDb();
    const providerKey =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as Hex;
    const requesterKey =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as Hex;
    const identity = createIdentity(providerKey);
    const requester = privateKeyToAccount(requesterKey);
    const config = createTestConfig({
      rpcUrl: rpc.url,
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
      paymasterProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/paymaster",
        capabilityPrefix: "paymaster",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        authorizationValiditySeconds: 600,
        quotePriceWei: "0",
        authorizePriceWei: "5",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          sponsorAddress: identity.address,
          delegateIdentity: "delegate:test",
          allowedWallets: [requester.address],
          allowedTargets: [
            "0x9999999999999999999999999999999999999999999999999999999999999999",
          ],
          allowedFunctionSelectors: [],
          maxValueWei: "1000",
          allowSystemAction: false,
        },
      },
    });

    const payment = buildPaymentRecord();
    db.upsertX402Payment(payment);
    const bound: Array<{ paymentId: Hex; boundKind: string; boundSubjectId: string }> = [];

    const provider = await startPaymasterProviderServer({
      identity,
      config,
      db,
      address: identity.address,
      privateKey: providerKey,
      paymasterConfig: config.paymasterProvider!,
      paymentManager: {
        async requirePayment() {
          return { state: "ready", payment };
        },
        bindPayment(binding) {
          bound.push({
            paymentId: binding.paymentId,
            boundKind: binding.boundKind,
            boundSubjectId: binding.boundSubjectId,
          });
        },
      },
      async submitSponsoredTransaction({ transaction, executionSignature }) {
        const sponsorSignature = await identity.account.signSponsoredExecution(transaction);
        expect(executionSignature.r).toMatch(/^0x[0-9a-f]+$/);
        return {
          sponsorSignature,
          rawTransaction:
            "0xdeadbeef" as Hex,
          txHash:
            "0x5555555555555555555555555555555555555555555555555555555555555555" as Hex,
          receipt: { status: "0x1", blockNumber: "0x10" },
        };
      },
    });

    const quote = await postJson(`${provider.url}/quote`, {
      requester: {
        identity: {
          kind: "tos",
          value: requester.address,
        },
      },
      wallet_address: requester.address,
      target:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      value_wei: "7",
      reason: "unit-test",
    });

    expect(quote.status).toBe(200);
    expect(quote.json.quote_id).toBeTypeOf("string");
    expect(quote.json.policy_id).toBe("policy-test");
    expect(quote.json.requester_signer_type).toBe("secp256k1");
    expect(quote.json.sponsor_signer_type).toBe("secp256k1");

    const executionSignature = await requester.signSponsoredExecution({
      type: "sponsored",
      chainId: BigInt(String(quote.json.chain_id)),
      nonce: 9n,
      gas: BigInt(String(quote.json.gas)),
      to:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      value: 7n,
      data: "0x",
      from: requester.address,
      signerType: "secp256k1",
      sponsor: String(quote.json.sponsor_address) as Hex,
      sponsorNonce: BigInt(String(quote.json.sponsor_nonce)),
      sponsorExpiry: BigInt(Number(quote.json.sponsor_expiry)),
      sponsorPolicyHash: String(quote.json.policy_hash) as Hex,
    });

    const payload = {
      quote_id: quote.json.quote_id,
      requester: {
        identity: {
          kind: "tos",
          value: requester.address,
        },
      },
      wallet_address: requester.address,
      request_nonce: "abc12345",
      request_expires_at: Math.floor(Date.now() / 1000) + 300,
      execution_nonce: "9",
      target:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      value_wei: "7",
      gas: String(quote.json.gas),
      data: "0x",
      execution_signature: toJsonSignature(executionSignature),
      reason: "unit-test",
    };

    const first = await postJson(`${provider.url}/authorize`, payload);
    expect(first.status).toBe(200);
    expect(first.json.status).toBe("ok");
    expect(first.json.authorization_id).toBeTypeOf("string");
    expect(first.json.payment_tx_hash).toBe(payment.txHash);
    expect(first.json.execution_nonce).toBe("9");
    expect(first.json.trust_tier).toBe("self_hosted");
    expect(first.json.delegate_identity).toBe("delegate:test");
    expect(first.json.requester_signer_type).toBe("secp256k1");
    expect(first.json.sponsor_signer_type).toBe("secp256k1");

    const second = await postJson(`${provider.url}/authorize`, payload);
    expect(second.status).toBe(200);
    expect(second.json.authorization_id).toBe(first.json.authorization_id);
    expect(second.json.idempotent).toBe(true);

    expect(db.listPaymasterQuotes(5).at(0)?.status).toBe("used");
    expect(db.listPaymasterAuthorizations(5)).toHaveLength(1);
    expect(bound).toHaveLength(1);
    expect(bound[0]?.boundKind).toBe("paymaster_authorization");

    await provider.close();
    db.close();
  });

  it("rejects a quote outside the configured paymaster policy", async () => {
    const rpc = await startRpcServer();
    const db = createTestDb();
    const providerKey =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as Hex;
    const identity = createIdentity(providerKey);
    const config = createTestConfig({
      rpcUrl: rpc.url,
      paymasterProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/paymaster",
        capabilityPrefix: "paymaster",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        authorizationValiditySeconds: 600,
        quotePriceWei: "0",
        authorizePriceWei: "0",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          sponsorAddress: identity.address,
          allowedWallets: [],
          allowedTargets: [
            "0x9999999999999999999999999999999999999999999999999999999999999999",
          ],
          allowedFunctionSelectors: [],
          maxValueWei: "1000",
          allowSystemAction: false,
        },
      },
    });

    const provider = await startPaymasterProviderServer({
      identity,
      config,
      db,
      address: identity.address,
      privateKey: providerKey,
      paymasterConfig: config.paymasterProvider!,
    });

    const response = await postJson(`${provider.url}/quote`, {
      requester: {
        identity: {
          kind: "tos",
          value:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
      target:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      value_wei: "1",
    });

    expect(response.status).toBe(400);
    expect(response.json.status).toBe("rejected");
    expect(String(response.json.reason)).toContain("target is not allowed");

    await provider.close();
    db.close();
  });

  it("advertises a payment requirement for paid paymaster authorization", async () => {
    const rpc = await startRpcServer();
    const db = createTestDb();
    const providerKey =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as Hex;
    const requesterKey =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as Hex;
    const identity = createIdentity(providerKey);
    const requester = privateKeyToAccount(requesterKey);
    const config = createTestConfig({
      rpcUrl: rpc.url,
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
      paymasterProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/paymaster",
        capabilityPrefix: "paymaster",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        authorizationValiditySeconds: 600,
        quotePriceWei: "0",
        authorizePriceWei: "99",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          sponsorAddress: identity.address,
          allowedWallets: [requester.address],
          allowedTargets: [
            "0x9999999999999999999999999999999999999999999999999999999999999999",
          ],
          allowedFunctionSelectors: [],
          maxValueWei: "1000",
          allowSystemAction: false,
        },
      },
    });

    const provider = await startPaymasterProviderServer({
      identity,
      config,
      db,
      address: identity.address,
      privateKey: providerKey,
      paymasterConfig: config.paymasterProvider!,
    });

    const quote = await postJson(`${provider.url}/quote`, {
      requester: {
        identity: {
          kind: "tos",
          value: requester.address,
        },
      },
      wallet_address: requester.address,
      target:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      value_wei: "1",
    });
    expect(quote.status).toBe(200);

    const executionSignature = await requester.signSponsoredExecution({
      type: "sponsored",
      chainId: BigInt(String(quote.json.chain_id)),
      nonce: 1n,
      gas: BigInt(String(quote.json.gas)),
      to:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      value: 1n,
      data: "0x",
      from: requester.address,
      signerType: "secp256k1",
      sponsor: String(quote.json.sponsor_address) as Hex,
      sponsorNonce: BigInt(String(quote.json.sponsor_nonce)),
      sponsorExpiry: BigInt(Number(quote.json.sponsor_expiry)),
      sponsorPolicyHash: String(quote.json.policy_hash) as Hex,
    });

    const response = await fetch(`${provider.url}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote_id: quote.json.quote_id,
        requester: {
          identity: {
            kind: "tos",
            value: requester.address,
          },
        },
        wallet_address: requester.address,
        request_nonce: "pay-need-1",
        request_expires_at: Math.floor(Date.now() / 1000) + 300,
        execution_nonce: "1",
        target:
          "0x9999999999999999999999999999999999999999999999999999999999999999",
        value_wei: "1",
        gas: String(quote.json.gas),
        data: "0x",
        execution_signature: toJsonSignature(executionSignature),
      }),
    });

    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBeTruthy();
    expect(response.headers.get("x-payment-required")).toBeTruthy();

    await provider.close();
    db.close();
  });
});
