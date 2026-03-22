import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createTestConfig, createTestDb } from "./mocks.js";
import {
  buildGatewayBootnodesSnapshot,
  buildGatewayStatusSnapshot,
  buildServiceHealthSnapshot,
  buildServiceStatusSnapshot,
  buildGatewayBootnodesReport,
  buildGatewayStatusReport,
  buildServiceStatusReport,
  runServiceHealthChecks,
} from "../service/operator.js";
import { canonicalizeGatewayBootnodeListPayload } from "../agent-gateway/bootnodes.js";
import {
  DEFAULT_NEWS_FETCH_SKILL_STAGES,
  DEFAULT_PROOF_VERIFY_SKILL_STAGES,
  DEFAULT_STORAGE_GET_SKILL_STAGES,
  DEFAULT_STORAGE_PUT_SKILL_STAGES,
} from "../agent-discovery/provider-skill-spec.js";

const servers: http.Server[] = [];

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }
  return { url: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("service operator", () => {
  it("builds status reports for provider and gateway roles", async () => {
    const db = createTestDb();
    db.setKV(
      "agent_gateway:last_session:agent:gateway",
      JSON.stringify({ sessionId: "abc", publicPathToken: "def" }),
    );
    db.setKV(
      "agent_gateway:server_session:gateway:agent",
      JSON.stringify({ sessionId: "xyz", publicPathToken: "123" }),
    );

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
      agentDiscovery: {
        enabled: true,
        publishCard: true,
        cardTtlSeconds: 3600,
        endpoints: [],
        capabilities: [],
        newsFetchServer: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4881,
          path: "/agent-discovery/news-fetch",
          capability: "news.fetch",
          priceTomi: "1000",
          maxSourceUrlChars: 2048,
          requestTimeoutMs: 10000,
          maxResponseBytes: 262144,
          allowPrivateTargets: false,
          maxArticleChars: 12000,
          backendMode: "skills_first",
          skillStages: DEFAULT_NEWS_FETCH_SKILL_STAGES.map((stage) => ({ ...stage })),
        },
        proofVerifyServer: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4882,
          path: "/agent-discovery/proof-verify",
          capability: "proof.verify",
          priceTomi: "1000",
          maxPayloadChars: 16384,
          requestTimeoutMs: 10000,
          maxFetchBytes: 262144,
          allowPrivateTargets: false,
          backendMode: "skills_first",
          skillStages: DEFAULT_PROOF_VERIFY_SKILL_STAGES.map((stage) => ({ ...stage })),
        },
        storageServer: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4883,
          path: "/agent-discovery/storage",
          putCapability: "storage.put",
          getCapability: "storage.get",
          putPriceTomi: "1000",
          getPriceTomi: "1000",
          maxObjectBytes: 262144,
          storageDir: "/tmp/openfox-discovery-storage",
          defaultTtlSeconds: 86400,
          maxTtlSeconds: 2592000,
          pruneExpiredOnRead: true,
          putBackendMode: "skills_first",
          getBackendMode: "skills_first",
          putSkillStages: DEFAULT_STORAGE_PUT_SKILL_STAGES.map((stage) => ({ ...stage })),
          getSkillStages: DEFAULT_STORAGE_GET_SKILL_STAGES.map((stage) => ({ ...stage })),
        },
        faucetServer: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4877,
          path: "/agent-discovery/faucet",
          capability: "sponsor.topup.testnet",
          payoutAmountTomi: "1",
          maxAmountTomi: "1",
          cooldownSeconds: 60,
          requireNativeIdentity: true,
        },
        gatewayServer: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4880,
          sessionPath: "/agent-gateway/session",
          publicPathPrefix: "/a",
          publicBaseUrl: "https://gw.example.com",
          capability: "gateway.relay",
          mode: "paid",
          sessionTtlSeconds: 3600,
          requestTimeoutMs: 5000,
          maxRoutesPerSession: 8,
          maxRequestBodyBytes: 131072,
          priceModel: "x402-exact",
          paymentDirection: "requester_pays",
        },
        gatewayClient: {
          enabled: true,
          gatewayBootnodes: [],
          sessionTtlSeconds: 3600,
          requestTimeoutMs: 5000,
          maxGatewaySessions: 2,
          routes: [],
        },
      },
      signerProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4898,
        pathPrefix: "/signer",
        capabilityPrefix: "signer",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        quotePriceTomi: "0",
        submitPriceTomi: "1000",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          walletAddress:
            "0x97b1c813eae702332ba3eaa1625f942c5472626d90abcdef1234567890abcdef",
          allowedTargets: [
            "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
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
        quotePriceTomi: "0",
        authorizePriceTomi: "1000",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "paymaster-policy",
          sponsorAddress:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
          delegateIdentity: "delegate:paymaster",
          allowedWallets: [],
          allowedTargets: [
            "0x8888888888888888888888888888888888888888888888888888888888888888",
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
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
        minimumPriceTomi: "1000",
        pricePerMiBTomi: "1000",
        publishToDiscovery: true,
        allowAnonymousGet: true,
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
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

    const snapshot = buildServiceStatusSnapshot(config, db.raw);
    expect(snapshot.roles).toEqual(["requester", "provider", "gateway"]);
    expect(snapshot.providerSurfaces.newsFetch?.backendMode).toBe("skills_first");
    expect(snapshot.providerSurfaces.newsFetch?.skillStages).toEqual([
      "newsfetch.capture",
      "zktls.prove",
      "zktls.bundle",
    ]);
    expect(snapshot.providerSurfaces.proofVerify?.backendMode).toBe("skills_first");
    expect(snapshot.providerSurfaces.proofVerify?.skillStages).toEqual([
      "proofverify.verify-attestations",
      "proofverify.verify-consensus",
    ]);
    expect(snapshot.providerSurfaces.discoveryStorage?.putBackendMode).toBe("skills_first");
    expect(snapshot.providerSurfaces.discoveryStorage?.getSkillStages).toEqual([
      "storage-object.get",
    ]);
    expect(snapshot.providerSurfaces.signer?.capabilityPrefix).toBe("signer");
    expect(snapshot.providerSurfaces.paymaster?.capabilityPrefix).toBe("paymaster");
    expect(snapshot.providerSurfaces.storage?.capabilityPrefix).toBe("storage.ipfs");
    expect(snapshot.providerSurfaces.artifacts?.captureCapability).toBe("public_news.capture");
    expect(snapshot.gatewayCache?.providerSessionCacheEntries).toBe(1);
    expect(snapshot.gatewayCache?.serverSessionCacheEntries).toBe(1);
    expect(snapshot.x402Server.enabled).toBe(true);

    const report = buildServiceStatusReport(config, db.raw);
    expect(report).toContain("Roles: requester, provider, gateway");
    expect(report).toContain("x402 server:");
    expect(report).toContain("news.fetch:");
    expect(report).toContain("backend_mode=skills_first");
    expect(report).toContain("put_backend=skills_first");
    expect(report).toContain("signer:");
    expect(report).toContain("paymaster:");
    expect(report).toContain("capability_prefix=storage.ipfs");
    expect(report).toContain("artifacts:");
    expect(report).toContain("provider session cache entries: 1");
    expect(report).toContain("server session cache entries: 1");

    const gatewaySnapshot = await buildGatewayStatusSnapshot(config, db.raw);
    expect(gatewaySnapshot.server.enabled).toBe(true);
    expect(gatewaySnapshot.client.enabled).toBe(true);

    const gatewayReport = await buildGatewayStatusReport(config, db.raw);
    expect(gatewayReport).toContain("Server: enabled");
    expect(gatewayReport).toContain("Client: enabled");
    db.close();
  });

  it("checks local service and rpc health", async () => {
    const rpc = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x682" }));
    });
    const faucet = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const gateway = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, capability: "gateway.relay" }));
    });

    const faucetUrl = new URL(faucet.url);
    const gatewayUrl = new URL(gateway.url);

    const config = createTestConfig({
      rpcUrl: rpc.url,
      chainId: 1666,
      agentDiscovery: {
        enabled: true,
        publishCard: true,
        cardTtlSeconds: 3600,
        endpoints: [],
        capabilities: [],
        faucetServer: {
          enabled: true,
          bindHost: faucetUrl.hostname,
          port: Number(faucetUrl.port),
          path: "",
          capability: "sponsor.topup.testnet",
          payoutAmountTomi: "1",
          maxAmountTomi: "1",
          cooldownSeconds: 60,
          requireNativeIdentity: true,
        },
        gatewayServer: {
          enabled: true,
          bindHost: gatewayUrl.hostname,
          port: Number(gatewayUrl.port),
          sessionPath: "/agent-gateway/session",
          publicPathPrefix: "",
          publicBaseUrl: gateway.url,
          capability: "gateway.relay",
          mode: "sponsored",
          sessionTtlSeconds: 3600,
          requestTimeoutMs: 5000,
          maxRoutesPerSession: 8,
          maxRequestBodyBytes: 131072,
        },
      },
      storage: {
        enabled: true,
        bindHost: faucetUrl.hostname,
        port: Number(faucetUrl.port),
        pathPrefix: "",
        capabilityPrefix: "storage.ipfs",
        storageDir: "/tmp/openfox-storage",
        quoteValiditySeconds: 300,
        defaultTtlSeconds: 86400,
        maxTtlSeconds: 2592000,
        maxBundleBytes: 8 * 1024 * 1024,
        minimumPriceTomi: "1000",
        pricePerMiBTomi: "1000",
        publishToDiscovery: true,
        allowAnonymousGet: true,
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
      },
      artifacts: {
        enabled: true,
        publishToDiscovery: true,
        defaultProviderBaseUrl: `${faucet.url}/storage`,
        defaultTtlSeconds: 604800,
        autoAnchorOnStore: false,
        captureCapability: "public_news.capture",
        evidenceCapability: "oracle.evidence",
        aggregateCapability: "oracle.aggregate",
        verificationCapability: "artifact.verify",
        service: {
          enabled: true,
          bindHost: faucetUrl.hostname,
          port: Number(faucetUrl.port),
          pathPrefix: "",
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

    const snapshot = await buildServiceHealthSnapshot(config);
    expect(snapshot.checks.every((check) => check.ok)).toBe(true);

    const report = await runServiceHealthChecks(config);
    expect(report).toContain("OK");
    expect(report).toContain(rpc.url);
    expect(report).toContain(gateway.url);
  });

  it("reports signed gateway bootnode lists", async () => {
    const account = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c",
    );
    const payload = {
      version: 1,
      networkId: 1666,
      entries: [
        {
          agentId: account.address,
          url: "wss://gw.example.com/agent-gateway/session",
        },
      ],
      issuedAt: 1770000000,
    };
    const signature = await account.signMessage({
      message: canonicalizeGatewayBootnodeListPayload(payload),
    });
    const config = createTestConfig({
      chainId: 1666,
      agentDiscovery: {
        enabled: true,
        publishCard: true,
        cardTtlSeconds: 3600,
        endpoints: [],
        capabilities: [],
        gatewayClient: {
          enabled: true,
          gatewayBootnodes: [],
          gatewayBootnodeList: {
            ...payload,
            signer: account.address,
            signature,
          },
          sessionTtlSeconds: 3600,
          requestTimeoutMs: 5000,
          maxGatewaySessions: 1,
          routes: [],
        },
      },
    });

    const snapshot = await buildGatewayBootnodesSnapshot(config);
    expect(snapshot.signedList.present).toBe(true);
    expect(snapshot.signedList.valid).toBe(true);
    expect(snapshot.entries[0]?.url).toBe("wss://gw.example.com/agent-gateway/session");

    const report = await buildGatewayBootnodesReport(config);
    expect(report).toContain("Signed list: valid");
    expect(report).toContain("wss://gw.example.com/agent-gateway/session");
  });
});
