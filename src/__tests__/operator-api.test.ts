import { afterEach, describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import { startOperatorApiServer } from "../operator/api.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await server.close();
  }
});

describe("operator api", () => {
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

    db.close();
  });
});
