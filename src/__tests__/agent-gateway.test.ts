import http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { startAgentDiscoveryFaucetServer } from "../agent-discovery/faucet-server.js";
import { normalizeAgentDiscoveryConfig } from "../agent-discovery/types.js";
import { buildSignedAgentDiscoveryCard } from "../agent-discovery/card.js";
import { startAgentGatewayServer } from "../agent-gateway/server.js";
import {
  startAgentGatewayProviderSession,
  startAgentGatewayProviderSessions,
} from "../agent-gateway/client.js";
import { canonicalizeGatewayBootnodeListPayload } from "../agent-gateway/bootnodes.js";
import {
  buildGatewayProviderRoutes,
  buildPublishedAgentDiscoveryConfig,
} from "../agent-gateway/publish.js";
import {
  AGENT_GATEWAY_E2E_HEADER,
  AGENT_GATEWAY_E2E_SCHEME,
  maybeDecryptAgentGatewayResponse,
  prepareAgentGatewayEncryptedRequest,
} from "../agent-gateway/e2e.js";
import { buildStableGatewayPathToken } from "../agent-gateway/types.js";
import {
  buildX402Payment,
  formatNetwork,
} from "../chain/client.js";
import { deriveAddressFromPrivateKey } from "../chain/address.js";

const getBalanceMock = vi.fn(async () => 10_000_000_000_000_000_000n);
const getChainIdMock = vi.fn(async () => 1666n);
const getTransactionCountMock = vi.fn(async () => 1n);
const sendRawTransactionMock = vi.fn(
  async () =>
    "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed",
);
const sendTransferMock = vi.fn(async () => ({
  signed: {
    nonce: 1n,
    gas: 21_000n,
    rawTransaction: "0xraw",
  },
  txHash: "0xgatewaytxhash",
}));

vi.mock("../chain/client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../chain/client.js")>(
      "../chain/client.js"
    );
  return {
    ...actual,
    ChainRpcClient: class {
      async getBalance() {
        return getBalanceMock();
      }
      async getChainId() {
        return getChainIdMock();
      }
      async getTransactionCount() {
        return getTransactionCountMock();
      }
      async sendRawTransaction(rawTransaction: string) {
        return sendRawTransactionMock(rawTransaction);
      }
      async getTransactionReceipt() {
        return { status: "0x1" };
      }
    },
    sendNativeTransfer: (...args: unknown[]) => sendTransferMock(...args),
  };
});

const PROVIDER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;
const GATEWAY_PRIVATE_KEY =
  "0x8b3a350cf5c34c9194ca3a9d8b7f43c795b2d451dc0c6d8f9d7f7a8e9c0d1e2f" as const;
const REQUESTER_PRIVATE_KEY =
  "0x6c8754f4d7c08d12f9d3c839d4f57d3dc56c8d32eeeb9a4216f72ccb316f52d1" as const;

function makeProviderConfig(): OpenFoxConfig {
  return {
    name: "ProviderFox",
    genesisPrompt: "test",
    creatorAddress:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    registeredRemotely: false,
    sandboxId: "",
    runtimeApiUrl: undefined,
    runtimeApiKey: undefined,
    openaiApiKey: undefined,
    anthropicApiKey: undefined,
    ollamaBaseUrl: undefined,
    inferenceModel: "gpt-5.2",
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: "~/.openfox/heartbeat.yml",
    dbPath: "~/.openfox/state.db",
    logLevel: "info",
    walletAddress:
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentDiscovery: {
      enabled: true,
      publishCard: true,
      cardTtlSeconds: 3600,
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
      gatewayClient: {
        enabled: true,
        gatewayAgentId: undefined,
        gatewayUrl: undefined,
        gatewayBootnodes: [],
        sessionTtlSeconds: 3600,
        requestTimeoutMs: 5000,
        maxGatewaySessions: 1,
        enableE2E: false,
        feedback: {
          enabled: false,
          successDelta: "1",
          failureDelta: "-1",
          timeoutDelta: "-2",
          malformedDelta: "-2",
          gas: "120000",
          reasonPrefix: "agent-gateway",
        },
        routes: [],
      },
      faucetServer: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        path: "/agent-discovery/faucet",
        capability: "sponsor.topup.testnet",
        payoutAmountTomi: "10000000000000000",
        maxAmountTomi: "10000000000000000",
        cooldownSeconds: 60,
        requireNativeIdentity: true,
      },
    },
  };
}

function makeGatewayConfig(
  overrides?: Partial<
    NonNullable<OpenFoxConfig["agentDiscovery"]>["gatewayServer"]
  >,
): NonNullable<OpenFoxConfig["agentDiscovery"]>["gatewayServer"] {
  return {
    enabled: true,
    bindHost: "127.0.0.1",
    port: 0,
    sessionPath: "/agent-gateway/session",
    publicPathPrefix: "/a",
    publicBaseUrl: "http://127.0.0.1:0",
    capability: "gateway.relay",
    mode: "sponsored",
    priceModel: "sponsored",
    sessionTtlSeconds: 3600,
    requestTimeoutMs: 5000,
    maxRoutesPerSession: 8,
    maxRequestBodyBytes: 131072,
    relayPaymentEnabled: false,
    relayPriceTomi: "1000000000000000",
    relayPaymentDescription: "OpenFox gateway relay payment",
    relayPaymentRequiredDeadlineSeconds: 300,
    registerCapabilityOnStartup: false,
    paymentDirection: "requester_pays",
    sessionFeeTomi: "0",
    perRequestFeeTomi: "0",
    maxSessions: 200,
    maxBandwidthKbps: 10000,
    supportedTransports: ["wss"],
    latencySloMs: 1000,
    availabilitySlo: "best-effort",
    ...overrides,
  };
}

function makeIdentity(privateKey: `0x${string}`, name: string): OpenFoxIdentity {
  const account = privateKeyToAccount(privateKey);
  return {
    name,
    address: account.address,
    account,
    creatorAddress: account.address,
    sandboxId: "",
    apiKey: "",
    createdAt: new Date().toISOString(),
  };
}

function makeDb(): OpenFoxDatabase {
  const store = new Map<string, string>();
  return {
    getKV(key: string) {
      return store.get(key);
    },
    setKV(key: string, value: string) {
      store.set(key, value);
    },
  } as OpenFoxDatabase;
}

async function signGatewayBootnodeList(params: {
  signerPrivateKey: `0x${string}`;
  networkId: number;
  entries: Array<{
    agentId: string;
    url: string;
    payToAddress?: `0x${string}`;
    paymentDirection?: "provider_pays" | "requester_pays" | "split";
    sessionFeeTomi?: string;
    perRequestFeeTomi?: string;
  }>;
  issuedAt?: number;
}) {
  const account = privateKeyToAccount(params.signerPrivateKey);
  const payload = {
    version: 1,
    networkId: params.networkId,
    entries: params.entries,
    issuedAt: params.issuedAt ?? 1770000000,
  };
  const signature = await account.signMessage({
    message: canonicalizeGatewayBootnodeListPayload(payload),
  });
  return {
    ...payload,
    signer: account.address,
    signature,
  };
}

async function startJsonServer(
  handler: (body: unknown) => unknown,
  headers?: Record<string, string>,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    const payload = JSON.stringify(handler(body));
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      ...(headers ?? {}),
    });
    res.end(payload);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected bound server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function startStreamServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: alpha\n\n");
    setTimeout(() => {
      res.write("data: beta\n\n");
      res.end();
    }, 10);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected bound stream server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function decodePaymentRequired(resp: Response): {
  accepts: Array<{
    scheme: "exact";
    network: string;
    maxAmountRequired: string;
    payToAddress: `0x${string}`;
    asset?: string;
    requiredDeadlineSeconds?: number;
    description?: string;
  }>;
} {
  const header =
    resp.headers.get("Payment-Required") ||
    resp.headers.get("X-Payment-Required");
  if (!header) {
    throw new Error("missing payment required header");
  }
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    accepts: Array<{
      scheme: "exact";
      network: string;
      maxAmountRequired: string;
      payToAddress: `0x${string}`;
      asset?: string;
      requiredDeadlineSeconds?: number;
      description?: string;
    }>;
  };
}

describe("agent gateway", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  function mockChainRpc(rpcUrl: string) {
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === rpcUrl) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          id: number;
          method: string;
        };
        switch (body.method) {
          case "tos_chainId":
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x682" }),
              { status: 200 },
            );
          case "tos_getTransactionCount":
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }),
              { status: 200 },
            );
          case "tos_sendRawTransaction":
            sendRawTransactionMock(String(init?.body ?? ""));
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result:
                  "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed",
              }),
              { status: 200 },
            );
          default:
            throw new Error(`unexpected RPC method ${body.method}`);
        }
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;
  }

  it("relays a faucet capability through a gateway-backed public endpoint", async () => {
    const providerConfig = makeProviderConfig();
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const providerDb = makeDb();
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");

    const faucetServer = await startAgentDiscoveryFaucetServer({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db: providerDb,
      faucetConfig: providerConfig.agentDiscovery!.faucetServer!,
    });

    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });

    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayAgentId: gatewayServer.gatewayAgentId,
      gatewayUrl: gatewayServer.sessionUrl,
    };

    const routes = buildGatewayProviderRoutes({
      config: providerConfig,
      faucetUrl: faucetServer.url,
    });

    const providerSession = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes,
    });

    const baseConfig = normalizeAgentDiscoveryConfig(providerConfig.agentDiscovery)!;
    const publishedConfig = buildPublishedAgentDiscoveryConfig({
      baseConfig,
      providerSession,
      providerRoutes: routes,
    });
    const card = await buildSignedAgentDiscoveryCard({
      identity: providerIdentity,
      config: providerConfig,
      agentDiscovery: publishedConfig,
      address: providerConfig.walletAddress!,
      discoveryNodeId: "node-provider",
    });
    const endpoint = card.endpoints.find(
      (entry) =>
        entry.url.includes(`/a/${providerSession.publicPathToken}/faucet`),
    );

    try {
      expect(endpoint?.via_gateway).toBe(gatewayServer.gatewayAgentId);
      expect(endpoint?.kind).toBe("http");

      const response = await fetch(endpoint!.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "sponsor.topup.testnet",
          requester: {
            agent_id: "requester",
            identity: {
              kind: "tos",
              value:
                "0x0000000000000000000000000000000000000000000000000000000000000042",
            },
          },
          request_nonce: "gateway-nonce-1",
          request_expires_at: Math.floor(Date.now() / 1000) + 120,
          requested_amount: "9000000000000000",
          reason: "bootstrap",
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        tx_hash: string;
        amount: string;
      };
      expect(body.status).toBe("approved");
      expect(body.tx_hash).toBe("0xgatewaytxhash");
      expect(body.amount).toBe("9000000000000000");
      expect(sendTransferMock).toHaveBeenCalledTimes(1);
    } finally {
      await providerSession.close();
      await gatewayServer.close();
      await faucetServer.close();
    }
  });

  it("discovers a gateway.relay provider before falling back to bootnodes", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.rpcUrl = "http://agent-discovery.test/rpc";
    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayAgentId: undefined,
      gatewayUrl: undefined,
      gatewayBootnodes: [],
    };

    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });

    const gatewayCard = await buildSignedAgentDiscoveryCard({
      identity: gatewayIdentity,
      config: {
        ...providerConfig,
        agentDiscovery: {
          ...providerConfig.agentDiscovery!,
          endpoints: [
            { kind: "ws", url: gatewayServer.sessionUrl, role: "provider_relay" },
            {
              kind: "http",
              url: gatewayServer.publicBaseUrl,
              role: "requester_invocation",
            },
          ],
          capabilities: [
            {
              name: "gateway.relay",
              mode: "sponsored",
              priceModel: "sponsored",
            },
          ],
        },
      },
      agentDiscovery: {
        ...providerConfig.agentDiscovery!,
        endpoints: [
          { kind: "ws", url: gatewayServer.sessionUrl, role: "provider_relay" },
          {
            kind: "http",
            url: gatewayServer.publicBaseUrl,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          {
            name: "gateway.relay",
            mode: "sponsored",
            priceModel: "sponsored",
          },
        ],
      },
      address:
        "0x00000000000000000000000000000000000000000000000000000000000000bb",
      discoveryNodeId: "node-gateway",
    });

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "http://agent-discovery.test/rpc") {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
        };
        switch (body.method) {
          case "tos_agentDiscoverySearch":
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: [
                  {
                    nodeId: "node-gateway",
                    nodeRecord: "enr:gateway",
                    primaryIdentity:
                      "0x00000000000000000000000000000000000000000000000000000000000000bb",
                    trust: {
                      registered: true,
                      suspended: false,
                      stake: "10",
                      reputation: "5",
                      ratingCount: "2",
                      capabilityRegistered: true,
                      hasOnchainCapability: true,
                    },
                  },
                ],
              }),
              { status: 200 },
            );
          case "tos_agentDiscoveryGetCard":
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  nodeId: "node-gateway",
                  nodeRecord: "enr:gateway",
                  cardJson: JSON.stringify(gatewayCard),
                },
              }),
              { status: 200 },
            );
          default:
            throw new Error(`unexpected discovery method ${body.method}`);
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      db: makeDb(),
      privateKey: PROVIDER_PRIVATE_KEY,
      routes: [
        {
          path: "/faucet",
          capability: "sponsor.topup.testnet",
          mode: "sponsored",
          targetUrl: "http://127.0.0.1:9/unused",
        },
      ],
    });

    try {
      expect(session.gatewayAgentId).toBe(gatewayIdentity.address.toLowerCase());
      expect(session.gatewayUrl).toBe(gatewayServer.sessionUrl);
      expect(session.allocatedEndpoints).toHaveLength(1);
      expect(session.provider?.nodeId).toBe("node-gateway");
    } finally {
      await session.close();
      await gatewayServer.close();
    }
  });

  it("publishes multi-gateway endpoints and gateway policy metadata", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.agentDiscovery!.enabled = false;
    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      maxGatewaySessions: 2,
      gatewayAgentId: undefined,
      gatewayUrl: undefined,
      gatewayBootnodes: [],
    };

    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const providerDb = makeDb();
    const gatewayA = await startAgentGatewayServer({
      identity: makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFoxA"),
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig({
        publicBaseUrl: "http://127.0.0.1:0",
        latencySloMs: 850,
        availabilitySlo: "99.9%",
      }),
    });
    const gatewayB = await startAgentGatewayServer({
      identity: makeIdentity(
        "0x5de4111af7b68c3f4eb3154b1b2b516de57f1742bcf3361193536a0cf0f4de4b",
        "GatewayFoxB",
      ),
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig({
        publicBaseUrl: "http://127.0.0.1:0",
        latencySloMs: 700,
        availabilitySlo: "99.95%",
      }),
    });

    providerConfig.agentDiscovery!.gatewayClient!.gatewayBootnodes = [
      { agentId: gatewayA.gatewayAgentId, url: gatewayA.sessionUrl },
      { agentId: gatewayB.gatewayAgentId, url: gatewayB.sessionUrl },
    ];

    const faucetServer = await startAgentDiscoveryFaucetServer({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db: providerDb,
      faucetConfig: providerConfig.agentDiscovery!.faucetServer!,
    });
    const routes = buildGatewayProviderRoutes({
      config: providerConfig,
      faucetUrl: faucetServer.url,
    });

    const sessions = await startAgentGatewayProviderSessions({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes,
    });

    try {
      expect(sessions.sessions).toHaveLength(2);

      const baseConfig =
        normalizeAgentDiscoveryConfig(providerConfig.agentDiscovery) ?? {
          ...providerConfig.agentDiscovery!,
          endpoints: [],
          capabilities: [],
          faucetServer: {
            ...providerConfig.agentDiscovery!.faucetServer!,
            enabled: false,
          },
        };
      const publishedConfig = buildPublishedAgentDiscoveryConfig({
        baseConfig,
        gatewayServer: gatewayA,
        gatewayServerConfig: makeGatewayConfig({
          latencySloMs: 850,
          availabilitySlo: "99.9%",
        }),
        providerSessions: sessions.sessions,
        providerRoutes: routes,
      });
      const relayEndpoints = publishedConfig.endpoints.filter(
        (entry) =>
          entry.viaGateway &&
          entry.url.includes("/faucet"),
      );
      expect(relayEndpoints).toHaveLength(2);
      const gatewayCapability = publishedConfig.capabilities.find(
        (entry) => entry.name === "gateway.relay",
      );
      expect(gatewayCapability?.policy).toMatchObject({
        payment_direction: "requester_pays",
        max_routes_per_session: 8,
        session_ttl_seconds: 3600,
        supported_transports: ["wss"],
        latency_slo_ms: 850,
        availability_slo: "99.9%",
      });
      expect(
        publishedConfig.endpoints.some(
          (entry) => entry.role === "provider_relay" && entry.url === gatewayA.sessionUrl,
        ),
      ).toBe(true);
      expect(
        publishedConfig.endpoints.some(
          (entry) =>
            entry.role === "requester_invocation" &&
            entry.url === gatewayA.publicBaseUrl,
        ),
      ).toBe(true);
    } finally {
      await sessions.close();
      await gatewayA.close();
      await gatewayB.close();
      await faucetServer.close();
    }
  });

  it("enforces TOS x402 relay payment before forwarding the request", async () => {
    const providerConfig = makeProviderConfig();
    mockChainRpc(providerConfig.rpcUrl!);
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const requesterAccount = privateKeyToAccount(REQUESTER_PRIVATE_KEY);
    const providerDb = makeDb();

    const faucetServer = await startAgentDiscoveryFaucetServer({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db: providerDb,
      faucetConfig: providerConfig.agentDiscovery!.faucetServer!,
    });

    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig({
        paymentDirection: "requester_pays",
        perRequestFeeTomi: "12345",
      }),
    });

    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayAgentId: gatewayServer.gatewayAgentId,
      gatewayUrl: gatewayServer.sessionUrl,
    };

    const routes = buildGatewayProviderRoutes({
      config: providerConfig,
      faucetUrl: faucetServer.url,
    });
    const providerSession = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes,
    });
    const publicUrl = providerSession.allocatedEndpoints[0]!.public_url;
    const requestBody = JSON.stringify({
      capability: "sponsor.topup.testnet",
      requester: {
        agent_id: requesterAccount.address.toLowerCase(),
        identity: {
          kind: "tos",
          value: deriveAddressFromPrivateKey(REQUESTER_PRIVATE_KEY),
        },
      },
      request_nonce: "gateway-payment-nonce",
      request_expires_at: Math.floor(Date.now() / 1000) + 120,
      requested_amount: "9000000000000000",
      reason: "bootstrap",
    });

    try {
      const unpaid = await fetch(publicUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      expect(unpaid.status).toBe(402);
      const requirement = decodePaymentRequired(unpaid).accepts[0]!;
      expect(requirement.network).toBe(formatNetwork(1666n));
      expect(requirement.maxAmountRequired).toBe("12345");

      const payment = await buildX402Payment({
        privateKey: REQUESTER_PRIVATE_KEY,
        rpcUrl: providerConfig.rpcUrl!,
        requirement,
      });
      const paymentHeader = Buffer.from(JSON.stringify(payment)).toString("base64");
      const paid = await fetch(publicUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Payment-Signature": paymentHeader,
          "X-Payment": paymentHeader,
        },
        body: requestBody,
      });

      expect(paid.status).toBe(200);
      expect(sendRawTransactionMock).toHaveBeenCalledTimes(1);
      expect(sendTransferMock).toHaveBeenCalledTimes(1);
      const body = (await paid.json()) as { status: string };
      expect(body.status).toBe("approved");
    } finally {
      await providerSession.close();
      await gatewayServer.close();
      await faucetServer.close();
    }
  });

  it("forwards streaming responses over the gateway relay", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.agentDiscovery!.enabled = false;
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const streamServer = await startStreamServer();
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });

    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayAgentId: gatewayServer.gatewayAgentId,
      gatewayUrl: gatewayServer.sessionUrl,
    };

    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes: [
        {
          path: "/stream",
          capability: "observation.once",
          mode: "paid",
          targetUrl: streamServer.url,
          stream: true,
        },
      ],
    });

    try {
      const response = await fetch(session.allocatedEndpoints[0]!.public_url, {
        method: "GET",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const body = await response.text();
      expect(body).toContain("data: alpha");
      expect(body).toContain("data: beta");
    } finally {
      await session.close();
      await gatewayServer.close();
      await streamServer.close();
    }
  });

  it("verifies signed gateway bootnode lists before using them", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.agentDiscovery!.enabled = false;
    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayBootnodes: [
        {
          agentId: "0xdeadbeef",
          url: "ws://127.0.0.1:9/invalid",
        },
      ],
      requireSignedBootnodeList: true,
    };

    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });

    providerConfig.agentDiscovery!.gatewayClient!.gatewayBootnodeList =
      await signGatewayBootnodeList({
        signerPrivateKey: GATEWAY_PRIVATE_KEY,
        networkId: 1666,
        entries: [
          {
            agentId: gatewayServer.gatewayAgentId,
            url: gatewayServer.sessionUrl,
            payToAddress: providerConfig.walletAddress!,
          },
        ],
      });

    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db: makeDb(),
      routes: [
        {
          path: "/faucet",
          capability: "sponsor.topup.testnet",
          mode: "sponsored",
          targetUrl: "http://127.0.0.1:9/unused",
        },
      ],
    });

    try {
      expect(session.gatewayUrl).toBe(gatewayServer.sessionUrl);
      expect(session.gatewayAgentId).toBe(gatewayServer.gatewayAgentId);
    } finally {
      await session.close();
      await gatewayServer.close();
    }
  });

  it("resumes sessions with a stable public path token", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.agentDiscovery!.enabled = false;
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const db = makeDb();

    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });
    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayBootnodes: [
        {
          agentId: gatewayServer.gatewayAgentId,
          url: gatewayServer.sessionUrl,
          payToAddress: providerConfig.walletAddress!,
        },
      ],
    };

    const routes = [
      {
        path: "/faucet",
        capability: "sponsor.topup.testnet",
        mode: "sponsored" as const,
        targetUrl: "http://127.0.0.1:9/unused",
      },
    ];

    const first = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db,
      routes,
    });
    const firstPublicUrl = first.allocatedEndpoints[0]!.public_url;
    const expectedToken = buildStableGatewayPathToken(providerIdentity.address);
    expect(first.publicPathToken).toBe(expectedToken);

    await first.close();

    const second = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db,
      routes,
    });

    try {
      expect(second.publicPathToken).toBe(expectedToken);
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.allocatedEndpoints[0]!.public_url).toBe(firstPublicUrl);
    } finally {
      await second.close();
      await gatewayServer.close();
    }
  });

  it("updates routes without reopening the provider session", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.agentDiscovery!.enabled = false;
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const firstServer = await startJsonServer(() => ({ status: "first" }));
    const secondServer = await startJsonServer(() => ({ status: "second" }));
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });

    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayBootnodes: [
        {
          agentId: gatewayServer.gatewayAgentId,
          url: gatewayServer.sessionUrl,
          payToAddress: providerConfig.walletAddress!,
        },
      ],
    };

    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes: [
        {
          path: "/first",
          capability: "observation.once",
          mode: "paid",
          targetUrl: firstServer.url,
        },
      ],
    });

    try {
      const added = await session.addRoutes([
        {
          path: "/second",
          capability: "observation.once",
          mode: "paid",
          targetUrl: secondServer.url,
        },
      ]);
      expect(added).toHaveLength(1);
      const secondEndpoint = added[0]!.public_url;

      const secondResponse = await fetch(secondEndpoint, { method: "POST" });
      expect(secondResponse.status).toBe(200);
      expect(await secondResponse.json()).toMatchObject({ status: "second" });

      const removed = await session.removeRoutes(["/second"]);
      expect(removed).toEqual(["/second"]);

      const removedResponse = await fetch(secondEndpoint, { method: "POST" });
      expect(removedResponse.status).toBe(404);
    } finally {
      await session.close();
      await gatewayServer.close();
      await firstServer.close();
      await secondServer.close();
    }
  });

  it("charges provider session fees in provider-pays mode", async () => {
    const providerConfig = makeProviderConfig();
    mockChainRpc(providerConfig.rpcUrl!);
    providerConfig.agentDiscovery!.enabled = false;
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const providerDb = makeDb();

    const faucetServer = await startAgentDiscoveryFaucetServer({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db: providerDb,
      faucetConfig: providerConfig.agentDiscovery!.faucetServer!,
    });
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig({
        paymentDirection: "provider_pays",
        sessionFeeTomi: "777",
        perRequestFeeTomi: "0",
      }),
    });

    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayBootnodes: [
        {
          agentId: gatewayServer.gatewayAgentId,
          url: gatewayServer.sessionUrl,
          payToAddress: providerConfig.walletAddress!,
          paymentDirection: "provider_pays",
          sessionFeeTomi: "777",
          perRequestFeeTomi: "0",
        },
      ],
    };

    const routes = buildGatewayProviderRoutes({
      config: providerConfig,
      faucetUrl: faucetServer.url,
    });

    sendRawTransactionMock.mockClear();
    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes,
    });

    try {
      expect(sendRawTransactionMock).toHaveBeenCalledTimes(1);
      const response = await fetch(session.allocatedEndpoints[0]!.public_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "sponsor.topup.testnet",
          requester: {
            agent_id: "requester",
            identity: {
              kind: "tos",
              value:
                "0x0000000000000000000000000000000000000000000000000000000000000042",
            },
          },
          request_nonce: "provider-pays-nonce",
          request_expires_at: Math.floor(Date.now() / 1000) + 120,
          requested_amount: "9000000000000000",
          reason: "bootstrap",
        }),
      });
      expect(response.status).toBe(200);
    } finally {
      await session.close();
      await gatewayServer.close();
      await faucetServer.close();
    }
  });

  it("charges both provider session fees and requester relay fees in split mode", async () => {
    const providerConfig = makeProviderConfig();
    mockChainRpc(providerConfig.rpcUrl!);
    providerConfig.agentDiscovery!.enabled = false;
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const requesterAccount = privateKeyToAccount(REQUESTER_PRIVATE_KEY);
    const providerDb = makeDb();

    const faucetServer = await startAgentDiscoveryFaucetServer({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      db: providerDb,
      faucetConfig: providerConfig.agentDiscovery!.faucetServer!,
    });
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig({
        paymentDirection: "split",
        sessionFeeTomi: "777",
        perRequestFeeTomi: "12345",
      }),
    });

    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      gatewayBootnodes: [
        {
          agentId: gatewayServer.gatewayAgentId,
          url: gatewayServer.sessionUrl,
          payToAddress: providerConfig.walletAddress!,
          paymentDirection: "split",
          sessionFeeTomi: "777",
          perRequestFeeTomi: "12345",
        },
      ],
    };

    const routes = buildGatewayProviderRoutes({
      config: providerConfig,
      faucetUrl: faucetServer.url,
    });

    sendRawTransactionMock.mockClear();
    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes,
    });
    const publicUrl = session.allocatedEndpoints[0]!.public_url;
    const requestBody = JSON.stringify({
      capability: "sponsor.topup.testnet",
      requester: {
        agent_id: requesterAccount.address.toLowerCase(),
        identity: {
          kind: "tos",
          value: deriveAddressFromPrivateKey(REQUESTER_PRIVATE_KEY),
        },
      },
      request_nonce: "split-payment-nonce",
      request_expires_at: Math.floor(Date.now() / 1000) + 120,
      requested_amount: "9000000000000000",
      reason: "bootstrap",
    });

    try {
      expect(sendRawTransactionMock).toHaveBeenCalledTimes(1);

      const unpaid = await fetch(publicUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      expect(unpaid.status).toBe(402);
      const requirement = decodePaymentRequired(unpaid).accepts[0]!;
      expect(requirement.maxAmountRequired).toBe("12345");

      const payment = await buildX402Payment({
        privateKey: REQUESTER_PRIVATE_KEY,
        rpcUrl: providerConfig.rpcUrl!,
        requirement,
      });
      const paymentHeader = Buffer.from(JSON.stringify(payment)).toString("base64");
      const paid = await fetch(publicUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Payment-Signature": paymentHeader,
          "X-Payment": paymentHeader,
        },
        body: requestBody,
      });

      expect(paid.status).toBe(200);
      expect(sendRawTransactionMock).toHaveBeenCalledTimes(2);
    } finally {
      await session.close();
      await gatewayServer.close();
      await faucetServer.close();
    }
  });

  it("supports optional end-to-end encrypted gateway invocation payloads", async () => {
    const providerConfig = makeProviderConfig();
    providerConfig.agentDiscovery!.enabled = false;
    providerConfig.agentDiscovery!.gatewayClient = {
      ...providerConfig.agentDiscovery!.gatewayClient!,
      enabled: true,
      enableE2E: true,
    };
    const providerIdentity = makeIdentity(PROVIDER_PRIVATE_KEY, "ProviderFox");
    const gatewayIdentity = makeIdentity(GATEWAY_PRIVATE_KEY, "GatewayFox");
    const echoServer = await startJsonServer((body) => ({
      status: "ok",
      echoed: body,
    }));
    const gatewayServer = await startAgentGatewayServer({
      identity: gatewayIdentity,
      config: providerConfig,
      db: makeDb(),
      gatewayConfig: makeGatewayConfig(),
    });

    providerConfig.agentDiscovery!.gatewayClient!.gatewayAgentId =
      gatewayServer.gatewayAgentId;
    providerConfig.agentDiscovery!.gatewayClient!.gatewayUrl =
      gatewayServer.sessionUrl;

    const session = await startAgentGatewayProviderSession({
      identity: providerIdentity,
      config: providerConfig,
      address: providerConfig.walletAddress!,
      privateKey: PROVIDER_PRIVATE_KEY,
      routes: [
        {
          path: "/echo",
          capability: "observation.once",
          mode: "paid",
          targetUrl: echoServer.url,
        },
      ],
    });

    try {
      const prepared = prepareAgentGatewayEncryptedRequest({
        plaintext: Buffer.from(JSON.stringify({ hello: "gateway" }), "utf8"),
        recipientPublicKey:
          providerIdentity.account.publicKey!.toLowerCase() as `0x${string}`,
      });
      const response = await fetch(session.allocatedEndpoints[0]!.public_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [AGENT_GATEWAY_E2E_HEADER]: AGENT_GATEWAY_E2E_SCHEME,
        },
        body: JSON.stringify(prepared.envelope),
      });
      expect(response.status).toBe(200);
      const encrypted = (await response.json()) as Record<string, unknown>;
      const decrypted = maybeDecryptAgentGatewayResponse({
        value: encrypted,
        responsePrivateKey: prepared.responsePrivateKey,
      }) as { status: string; echoed: { hello: string } };
      expect(decrypted.status).toBe("ok");
      expect(decrypted.echoed).toEqual({ hello: "gateway" });
    } finally {
      await session.close();
      await gatewayServer.close();
      await echoServer.close();
    }
  });
});
