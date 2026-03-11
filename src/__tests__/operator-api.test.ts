import { afterEach, describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import { startOperatorApiServer } from "../operator/api.js";
import { isHeartbeatPaused, isOperatorDrained } from "../state/database.js";
import {
  DEFAULT_OPERATOR_AUTOPILOT_CONFIG,
  type PaymasterAuthorizationRecord,
} from "../types.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await server.close();
  }
});

describe("operator api", () => {
  function toHexId(value: string): `0x${string}` {
    return `0x${Buffer.from(value, "utf8")
      .toString("hex")
      .slice(0, 64)
      .padEnd(64, "a")}` as `0x${string}`;
  }

  function createAutopilotConfig() {
    return createTestConfig({
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
      operatorAutopilot: {
        ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG,
        enabled: true,
        queuePolicies: {
          payments: {
            ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.payments,
            enabled: false,
          },
          settlement: {
            ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.settlement,
            enabled: false,
          },
          market: {
            ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.market,
            enabled: false,
          },
          signer: {
            ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.signer,
            enabled: false,
          },
          paymaster: {
            ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.paymaster,
            enabled: false,
          },
        },
        storageMaintenance: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.storageMaintenance,
          enabled: false,
        },
        artifactMaintenance: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.artifactMaintenance,
          enabled: false,
        },
        providerQuarantine: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.providerQuarantine,
          enabled: true,
          quarantineMinEvents: 3,
          maxProvidersPerRun: 1,
        },
      },
    });
  }

  function createFailedPaymasterAuthorization(
    authorizationId: string,
    providerAddress: `0x${string}`,
  ): PaymasterAuthorizationRecord {
    const now = new Date().toISOString();
    return {
      authorizationId,
      quoteId: `quote-${authorizationId}`,
      chainId: "1666",
      requestKey: `paymaster:${authorizationId}`,
      requestHash: toHexId(authorizationId),
      providerAddress,
      sponsorAddress:
        "0xabababababababababababababababababababababababababababababababab",
      sponsorSignerType: "secp256k1",
      walletAddress:
        "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
      requesterAddress:
        "0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef",
      requesterSignerType: "secp256k1",
      targetAddress:
        "0x9898989898989898989898989898989898989898989898989898989898989898",
      valueWei: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-2",
      policyHash:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      scopeHash:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      trustTier: "self_hosted",
      requestNonce: "1",
      requestExpiresAt: Date.now() + 60_000,
      executionNonce: "1",
      sponsorNonce: "1",
      sponsorExpiry: Date.now() + 60_000,
      status: "failed",
      createdAt: now,
      updatedAt: now,
    };
  }

  it("serves healthz without auth and protects operator endpoints", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/operator",
          authToken: "secret-token",
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const healthz = await fetch(`${server.url}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.json()).toEqual({ ok: true });

    const unauthorized = await fetch(`${server.url}/status`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${server.url}/status`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(authorized.status).toBe(200);
    const snapshot = (await authorized.json()) as { configured: boolean; operatorApi: { enabled: boolean } | null };
    expect(snapshot.configured).toBe(true);
    expect(snapshot.operatorApi?.enabled).toBe(true);

    db.close();
  });

  it("returns 404 for disabled doctor and service status endpoints", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/ops",
          authToken: "secret-token",
          exposeDoctor: false,
          exposeServiceStatus: false,
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
    };
    const doctor = await fetch(`${server.url}/doctor`, { headers });
    expect(doctor.status).toBe(404);

    const service = await fetch(`${server.url}/service/status`, { headers });
    expect(service.status).toBe(404);

    db.close();
  });

  it("serves component-specific storage, artifacts, signer, and paymaster status snapshots", async () => {
    const db = createTestDb();
    const config = createTestConfig({
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
      signerProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4898,
        pathPrefix: "/signer",
        capabilityPrefix: "signer",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        quotePriceWei: "0",
        submitPriceWei: "1000",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          walletAddress:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          allowedTargets: [
            "0x9999999999999999999999999999999999999999999999999999999999999999",
          ],
          allowedFunctionSelectors: [],
          maxValueWei: "1000",
          allowSystemAction: false,
        },
      },
      paymasterProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4899,
        pathPrefix: "/paymaster",
        capabilityPrefix: "paymaster",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        authorizationValiditySeconds: 600,
        quotePriceWei: "0",
        authorizePriceWei: "1000",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "paymaster-policy",
          sponsorAddress:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          delegateIdentity: "delegate:paymaster",
          allowedWallets: [],
          allowedTargets: [
            "0x8888888888888888888888888888888888888888888888888888888888888888",
          ],
          allowedFunctionSelectors: [],
          maxValueWei: "1000",
          allowSystemAction: false,
        },
      },
      storage: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4895,
        pathPrefix: "/storage",
        capabilityPrefix: "storage.ipfs",
        storageDir: "/tmp/openfox-storage",
        quoteValiditySeconds: 300,
        defaultTtlSeconds: 86400,
        maxTtlSeconds: 2592000,
        maxBundleBytes: 8 * 1024 * 1024,
        minimumPriceWei: "1000",
        pricePerMiBWei: "1000",
        publishToDiscovery: true,
        allowAnonymousGet: true,
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
        leaseHealth: {
          autoAudit: true,
          auditIntervalSeconds: 3600,
          autoRenew: true,
          renewalLeadSeconds: 1800,
          autoReplicate: false,
        },
        replication: {
          enabled: true,
          targetCopies: 2,
          providerBaseUrls: ["https://replica-1.example.com/storage"],
        },
      },
      artifacts: {
        enabled: true,
        publishToDiscovery: true,
        defaultProviderBaseUrl: "http://127.0.0.1:4895/storage",
        defaultTtlSeconds: 604800,
        autoAnchorOnStore: false,
        captureCapability: "public_news.capture",
        evidenceCapability: "oracle.evidence",
        aggregateCapability: "oracle.aggregate",
        verificationCapability: "artifact.verify",
        service: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4896,
          pathPrefix: "/artifacts",
          requireNativeIdentity: true,
          maxBodyBytes: 256 * 1024,
          maxTextChars: 32 * 1024,
        },
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
      },
    });
    const server = await startOperatorApiServer({
      config,
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
    };

    const storage = await fetch(`${server.url}/storage/status`, { headers });
    expect(storage.status).toBe(200);
    const storageJson = (await storage.json()) as { kind: string; enabled: boolean; summary: string };
    expect(storageJson.kind).toBe("storage");
    expect(storageJson.enabled).toBe(true);
    expect(storageJson.summary).toContain("active lease");

    const artifacts = await fetch(`${server.url}/artifacts/status`, { headers });
    expect(artifacts.status).toBe(200);
    const artifactsJson = (await artifacts.json()) as { kind: string; enabled: boolean; summary: string };
    expect(artifactsJson.kind).toBe("artifacts");
    expect(artifactsJson.enabled).toBe(true);

    const signer = await fetch(`${server.url}/signer/status`, { headers });
    expect(signer.status).toBe(200);
    const signerJson = (await signer.json()) as { kind: string; enabled: boolean; summary: string };
    expect(signerJson.kind).toBe("signer");
    expect(signerJson.enabled).toBe(true);

    const paymaster = await fetch(`${server.url}/paymaster/status`, { headers });
    expect(paymaster.status).toBe(200);
    const paymasterJson = (await paymaster.json()) as { kind: string; enabled: boolean; summary: string };
    expect(paymasterJson.kind).toBe("paymaster");
    expect(paymasterJson.enabled).toBe(true);

    const wallet = await fetch(`${server.url}/wallet/status`, { headers });
    expect(wallet.status).toBe(200);
    const walletJson = (await wallet.json()) as { kind: string; address: string; summary: string };
    expect(walletJson.kind).toBe("wallet");
    expect(walletJson.address).toBe(config.walletAddress);

    const finance = await fetch(`${server.url}/finance/status`, { headers });
    expect(finance.status).toBe(200);
    const financeJson = (await finance.json()) as { kind: string; address: string; summary: string };
    expect(financeJson.kind).toBe("finance");
    expect(financeJson.address).toBe(config.walletAddress);
    expect(financeJson.summary).toContain("30d revenue=");

    const payments = await fetch(`${server.url}/payments/status`, { headers });
    expect(payments.status).toBe(200);
    const paymentsJson = (await payments.json()) as { kind: string; summary: string };
    expect(paymentsJson.kind).toBe("payments");

    const settlement = await fetch(`${server.url}/settlement/status`, { headers });
    expect(settlement.status).toBe(200);
    const settlementJson = (await settlement.json()) as { kind: string; summary: string };
    expect(settlementJson.kind).toBe("settlement");

    const market = await fetch(`${server.url}/market/status`, { headers });
    expect(market.status).toBe(200);
    const marketJson = (await market.json()) as { kind: string; summary: string };
    expect(marketJson.kind).toBe("market");

    db.close();
  });

  it("accepts authenticated storage and artifact maintenance requests", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/operator",
          authToken: "secret-token",
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
        storage: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4895,
          pathPrefix: "/storage",
          capabilityPrefix: "storage.ipfs",
          storageDir: "/tmp/openfox-storage",
          quoteValiditySeconds: 300,
          defaultTtlSeconds: 86400,
          maxTtlSeconds: 2592000,
          maxBundleBytes: 8 * 1024 * 1024,
          minimumPriceWei: "1000",
          pricePerMiBWei: "1000",
          publishToDiscovery: true,
          allowAnonymousGet: true,
          anchor: {
            enabled: false,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
          leaseHealth: {
            autoAudit: true,
            auditIntervalSeconds: 3600,
            autoRenew: true,
            renewalLeadSeconds: 1800,
            autoReplicate: false,
          },
          replication: {
            enabled: false,
            targetCopies: 1,
            providerBaseUrls: [],
          },
        },
        artifacts: {
          enabled: true,
          publishToDiscovery: true,
          defaultProviderBaseUrl: "http://127.0.0.1:4895/storage",
          defaultTtlSeconds: 604800,
          autoAnchorOnStore: false,
          captureCapability: "public_news.capture",
          evidenceCapability: "oracle.evidence",
          aggregateCapability: "oracle.aggregate",
          verificationCapability: "artifact.verify",
          service: {
            enabled: true,
            bindHost: "127.0.0.1",
            port: 4896,
            pathPrefix: "/artifacts",
            requireNativeIdentity: true,
            maxBodyBytes: 256 * 1024,
            maxTextChars: 32 * 1024,
          },
          anchor: {
            enabled: false,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    };
    const storage = await fetch(`${server.url}/storage/maintain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ limit: 2 }),
    });
    expect(storage.status).toBe(200);
    expect(await storage.json()).toMatchObject({
      kind: "storage",
      enabled: true,
    });

    const artifacts = await fetch(`${server.url}/artifacts/maintain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ limit: 2 }),
    });
    expect(artifacts.status).toBe(200);
    expect(await artifacts.json()).toMatchObject({
      kind: "artifacts",
      enabled: true,
    });

    const leaseHealth = await fetch(`${server.url}/storage/lease-health?limit=5`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(leaseHealth.status).toBe(200);
    expect(await leaseHealth.json()).toMatchObject({
      totalLeases: expect.any(Number),
      summary: expect.any(String),
    });

    const providers = await fetch(`${server.url}/providers/reputation?limit=5`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(providers.status).toBe(200);
    expect(await providers.json()).toMatchObject({
      totalProviders: expect.any(Number),
      summary: expect.any(String),
      entries: expect.any(Array),
    });

    db.close();
  });

  it("supports bounded control actions and records control events", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/operator",
          authToken: "secret-token",
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    };

    const pause = await fetch(`${server.url}/control/pause`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "maintenance" }),
    });
    expect(pause.status).toBe(200);
    const pauseJson = (await pause.json()) as { status: string; changed: boolean };
    expect(pauseJson.status).toBe("applied");
    expect(pauseJson.changed).toBe(true);
    expect(isHeartbeatPaused(db.raw)).toBe(true);

    const controlStatus = await fetch(`${server.url}/control/status`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(controlStatus.status).toBe(200);
    const controlStatusJson = (await controlStatus.json()) as {
      heartbeatPaused: boolean;
      drained: boolean;
      recentEvents: Array<{ action: string; status: string }>;
    };
    expect(controlStatusJson.heartbeatPaused).toBe(true);
    expect(controlStatusJson.drained).toBe(false);
    expect(controlStatusJson.recentEvents[0]?.action).toBe("pause");

    const drain = await fetch(`${server.url}/control/drain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "queue recovery" }),
    });
    expect(drain.status).toBe(200);
    const drainJson = (await drain.json()) as { status: string };
    expect(drainJson.status).toBe("applied");
    expect(isHeartbeatPaused(db.raw)).toBe(true);
    expect(isOperatorDrained(db.raw)).toBe(true);

    const resume = await fetch(`${server.url}/control/resume`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "done" }),
    });
    expect(resume.status).toBe(200);
    expect(isHeartbeatPaused(db.raw)).toBe(false);
    expect(isOperatorDrained(db.raw)).toBe(false);

    const retryPayments = await fetch(`${server.url}/control/retry/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "recover" }),
    });
    expect(retryPayments.status).toBe(409);
    const retryJson = (await retryPayments.json()) as { status: string };
    expect(retryJson.status).toBe("failed");

    const events = await fetch(`${server.url}/control/events?limit=10`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(events.status).toBe(200);
    const eventsJson = (await events.json()) as {
      items: Array<{ action: string; status: string; actor: string }>;
    };
    expect(eventsJson.items.length).toBeGreaterThanOrEqual(4);
    expect(eventsJson.items.some((item) => item.action === "retry_payments" && item.status === "failed")).toBe(true);
    expect(eventsJson.items.some((item) => item.action === "drain" && item.actor === "test-suite")).toBe(true);

    db.close();
  });

  it("serves autopilot status, approvals, and run surfaces", async () => {
    const db = createTestDb();
    const config = createAutopilotConfig();
    const providerAddress =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    db.upsertPaymasterAuthorization(
      createFailedPaymasterAuthorization("auto-1", providerAddress),
    );
    db.upsertPaymasterAuthorization(
      createFailedPaymasterAuthorization("auto-2", providerAddress),
    );
    db.upsertPaymasterAuthorization(
      createFailedPaymasterAuthorization("auto-3", providerAddress),
    );
    const server = await startOperatorApiServer({ config, db });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    };

    const status = await fetch(`${server.url}/autopilot/status`, {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(status.status).toBe(200);
    const statusJson = (await status.json()) as {
      enabled: boolean;
      approvals: { pending: number };
    };
    expect(statusJson.enabled).toBe(true);
    expect(statusJson.approvals.pending).toBe(0);

    const request = await fetch(`${server.url}/autopilot/approvals/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "treasury_policy_change",
        scope: "treasury.max_daily_transfer",
        reason: "raise ceiling",
      }),
    });
    expect(request.status).toBe(200);
    const requestJson = (await request.json()) as { requestId: string; status: string };
    expect(requestJson.status).toBe("pending");

    const approvals = await fetch(
      `${server.url}/autopilot/approvals?status=pending&limit=10`,
      {
        headers: { Authorization: "Bearer secret-token" },
      },
    );
    expect(approvals.status).toBe(200);
    const approvalsJson = (await approvals.json()) as {
      items: Array<{ requestId: string; status: string }>;
    };
    expect(approvalsJson.items[0]?.requestId).toBe(requestJson.requestId);

    const approve = await fetch(
      `${server.url}/autopilot/approvals/${requestJson.requestId}/approve`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ decisionNote: "approved by test" }),
      },
    );
    expect(approve.status).toBe(200);
    const approveJson = (await approve.json()) as { status: string };
    expect(approveJson.status).toBe("approved");

    const run = await fetch(`${server.url}/autopilot/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite" }),
    });
    expect(run.status).toBe(200);
    const runJson = (await run.json()) as {
      enabled: boolean;
      actions: Array<{ action: string; changed: boolean }>;
    };
    expect(runJson.enabled).toBe(true);
    expect(
      runJson.actions.find((item) => item.action === "quarantine_provider")?.changed,
    ).toBe(true);

    db.close();
  });
});
