import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type { OpenFoxConfig, OpenFoxIdentity } from "../types.js";
import {
  buildSignedAgentDiscoveryCard,
  verifyAgentDiscoveryCard,
} from "../agent-discovery/card.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeConfig(): OpenFoxConfig {
  return {
    name: "Fox",
    genesisPrompt: "test",
    creatorAddress:
      "0x0000000000000000000000000000000000000000" as `0x${string}`,
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
      "0x0000000000000000000000000000000000000000000000000000000000000042",
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentDiscovery: {
      enabled: true,
      publishCard: true,
      cardTtlSeconds: 3600,
      endpoints: [{ kind: "https", url: "https://provider.example/faucet" }],
      capabilities: [
        {
          name: "sponsor.topup.testnet",
          mode: "sponsored",
          maxAmount: "10000000000000000",
          rateLimit: "1/day",
        },
      ],
      directoryNodeRecords: [],
    },
  };
}

function makeIdentity(): OpenFoxIdentity {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  return {
    name: "Fox",
    address: account.address,
    account,
    creatorAddress: account.address,
    sandboxId: "",
    apiKey: "",
    createdAt: new Date().toISOString(),
  };
}

describe("agent discovery", () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  const originalTosRpcUrl = process.env.TOS_RPC_URL;
  let tempHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openfox-agent-discovery-"),
    );
    process.env.HOME = tempHome;
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        createdAt: new Date().toISOString(),
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

  it("signs and verifies an agent discovery card", async () => {
    const config = makeConfig();
    const identity = makeIdentity();
    const card = await buildSignedAgentDiscoveryCard({
      identity,
      config,
      agentDiscovery: config.agentDiscovery!,
      address: config.walletAddress!,
      discoveryNodeId: "node-1",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 7,
    });

    await expect(verifyAgentDiscoveryCard(card, "node-1")).resolves.toBe(true);
    await expect(verifyAgentDiscoveryCard(card, "node-2")).resolves.toBe(false);
  });

  it("includes optional metadata hints in the published discovery card", async () => {
    const config = makeConfig();
    config.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.settlement",
      packageVersion: "1.0.0",
      profileRef: "profile://settlement",
      routingProfile: {
        serviceKind: "settlement",
        capabilityKind: "managed_execution",
        privacyMode: "public",
        receiptMode: "required",
      },
    };
    const identity = makeIdentity();
    const card = await buildSignedAgentDiscoveryCard({
      identity,
      config,
      agentDiscovery: config.agentDiscovery!,
      address: config.walletAddress!,
      discoveryNodeId: "node-hints",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 11,
    });

    expect(card.agent_address).toBe(config.walletAddress!.toLowerCase());
    expect(card.package_name).toBe("tolang.openlib.settlement");
    expect(card.package_version).toBe("1.0.0");
    expect(card.profile_ref).toBe("profile://settlement");
    expect(card.routing_profile?.serviceKind).toBe("settlement");
    expect(card.routing_profile?.capabilityKind).toBe("managed_execution");
  });

  it("discovers a faucet provider and invokes it", async () => {
    const { requestTestnetFaucet } =
      await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();
    const providerCard = await buildSignedAgentDiscoveryCard({
      identity,
      config,
      agentDiscovery: config.agentDiscovery!,
      address: config.walletAddress!,
      discoveryNodeId: "node-provider",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 9,
    });

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8545") {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };
        switch (body.method) {
          case "tos_agentDiscoverySearch":
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: [
                  {
                    nodeId: "node-provider",
                    nodeRecord: "enr:provider",
                    primaryIdentity: config.walletAddress,
                    connectionModes: 3,
                    cardSequence: 9,
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
                  nodeId: "node-provider",
                  nodeRecord: "enr:provider",
                  cardJson: JSON.stringify(providerCard),
                },
              }),
              { status: 200 },
            );
          default:
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                error: {
                  code: -32601,
                  message: `unsupported method ${body.method}`,
                },
              }),
              { status: 200 },
            );
        }
      }

      if (url === "https://provider.example/faucet") {
        const payload = JSON.parse(String(init?.body)) as {
          capability: string;
        };
        expect(payload.capability).toBe("sponsor.topup.testnet");
        expect(typeof payload.request_expires_at).toBe("number");
        return new Response(
          JSON.stringify({
            status: "approved",
            transfer_network: "tos:1666",
            tx_hash: "0xabc",
            amount: "10000000000000000",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`unexpected fetch url ${url}`);
    }) as typeof fetch;

    const result = await requestTestnetFaucet({
      identity,
      config,
      address: config.walletAddress!,
      requestedAmountTomi: 10_000_000_000_000_000n,
      waitForReceipt: false,
    });

    expect(result.provider.search.nodeId).toBe("node-provider");
    expect(result.response.status).toBe("approved");
    expect(result.response.tx_hash).toBe("0xabc");
  });

  it("falls back to directory search and invokes a paid observation provider", async () => {
    const { requestObservationOnce } =
      await import("../agent-discovery/client.js");
    const config = makeConfig();
    config.agentDiscovery = {
      ...config.agentDiscovery!,
      endpoints: [
        { kind: "http", url: "http://provider.example/observe-once" },
      ],
      capabilities: [
        {
          name: "observation.once",
          mode: "paid",
          priceModel: "x402-exact",
        },
      ],
      directoryNodeRecords: ["enr:directory"],
    };
    const identity = makeIdentity();
    const providerCard = await buildSignedAgentDiscoveryCard({
      identity,
      config,
      agentDiscovery: config.agentDiscovery!,
      address: config.walletAddress!,
      discoveryNodeId: "node-provider",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 11,
    });

    let paidHeaderSeen = false;

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8545") {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          id: number;
        };
        switch (body.method) {
          case "tos_agentDiscoverySearch":
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: [] }),
              {
                status: 200,
              },
            );
          case "tos_agentDiscoveryDirectorySearch":
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: [
                  {
                    nodeId: "node-provider",
                    nodeRecord: "enr:provider",
                    primaryIdentity: config.walletAddress,
                    connectionModes: 3,
                    cardSequence: 11,
                  },
                ],
              }),
              { status: 200 },
            );
          case "tos_agentDiscoveryGetCard":
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  nodeId: "node-provider",
                  nodeRecord: "enr:provider",
                  cardJson: JSON.stringify(providerCard),
                },
              }),
              { status: 200 },
            );
          case "tos_chainId":
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x682" }),
              {
                status: 200,
              },
            );
          case "tos_getTransactionCount":
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }),
              {
                status: 200,
              },
            );
          default:
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32601,
                  message: `unsupported method ${body.method}`,
                },
              }),
              { status: 200 },
            );
        }
      }

      if (url === "http://provider.example/observe-once") {
        const headers = new Headers(init?.headers);
        if (init?.method === "HEAD") {
          return new Response(
            JSON.stringify({
              x402Version: 1,
              accepts: [
                {
                  scheme: "exact",
                  network: "tos:1666",
                  maxAmountRequired: "1000000000000000",
                  payToAddress:
                    "0x0000000000000000000000000000000000000000000000000000000000000042",
                  asset: "native",
                },
              ],
            }),
            {
              status: 402,
              headers: {
                "Payment-Required": Buffer.from(
                  JSON.stringify({
                    x402Version: 1,
                    accepts: [
                      {
                        scheme: "exact",
                        network: "tos:1666",
                        maxAmountRequired: "1000000000000000",
                        payToAddress:
                          "0x0000000000000000000000000000000000000000000000000000000000000042",
                        asset: "native",
                      },
                    ],
                  }),
                ).toString("base64"),
              },
            },
          );
        }
        if (!headers.get("Payment-Signature")) {
          return new Response(
            JSON.stringify({
              x402Version: 1,
              accepts: [
                {
                  scheme: "exact",
                  network: "tos:1666",
                  maxAmountRequired: "1000000000000000",
                  payToAddress:
                    "0x0000000000000000000000000000000000000000000000000000000000000042",
                  asset: "native",
                },
              ],
            }),
            {
              status: 402,
              headers: {
                "Payment-Required": Buffer.from(
                  JSON.stringify({
                    x402Version: 1,
                    accepts: [
                      {
                        scheme: "exact",
                        network: "tos:1666",
                        maxAmountRequired: "1000000000000000",
                        payToAddress:
                          "0x0000000000000000000000000000000000000000000000000000000000000042",
                        asset: "native",
                      },
                    ],
                  }),
                ).toString("base64"),
              },
            },
          );
        }
        paidHeaderSeen = true;
        return new Response(
          JSON.stringify({
            status: "ok",
            observed_at: 1770000000,
            target_url: "https://target.example/data",
            http_status: 200,
            content_type: "application/json",
            body_json: { ok: true },
            body_sha256: "0x1234",
            size_bytes: 12,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`unexpected fetch url ${url}`);
    }) as typeof fetch;

    const result = await requestObservationOnce({
      identity,
      config,
      address: config.walletAddress!,
      targetUrl: "https://target.example/data",
    });

    expect(result.provider.search.nodeId).toBe("node-provider");
    expect(result.response.status).toBe("ok");
    expect(paidHeaderSeen).toBe(true);
  });

  it("ranks providers using trust summary and excludes suspended providers", async () => {
    const { discoverCapabilityProviders } =
      await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();

    const makeProviderCard = async (
      nodeId: string,
      url: string,
      cardSequence: number,
    ) =>
      buildSignedAgentDiscoveryCard({
        identity,
        config: {
          ...config,
          agentDiscovery: {
            ...config.agentDiscovery!,
            endpoints: [{ kind: "https", url }],
            capabilities: [
              {
                name: "sponsor.topup.testnet",
                mode: "sponsored",
                maxAmount: "10000000000000000",
                rateLimit: "1/day",
              },
            ],
          },
        },
        agentDiscovery: {
          ...config.agentDiscovery!,
          endpoints: [{ kind: "https", url }],
          capabilities: [
            {
              name: "sponsor.topup.testnet",
              mode: "sponsored",
              maxAmount: "10000000000000000",
              rateLimit: "1/day",
            },
          ],
        },
        address: config.walletAddress!,
        discoveryNodeId: nodeId,
        issuedAt: Math.floor(Date.now() / 1000),
        cardSequence,
      });

    const cards = new Map<string, Awaited<ReturnType<typeof makeProviderCard>>>(
      [
        [
          "node-low",
          await makeProviderCard(
            "node-low",
            "https://provider-low.example/faucet",
            3,
          ),
        ],
        [
          "node-high",
          await makeProviderCard(
            "node-high",
            "https://provider-high.example/faucet",
            4,
          ),
        ],
        [
          "node-suspended",
          await makeProviderCard(
            "node-suspended",
            "https://provider-suspended.example/faucet",
            5,
          ),
        ],
      ],
    );

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url !== "http://127.0.0.1:8545") {
        throw new Error(`unexpected fetch url ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      switch (body.method) {
        case "tos_agentDiscoverySearch":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: [
                {
                  nodeId: "node-low",
                  nodeRecord: "enr:low",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 3,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "5",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    capabilityBit: 11,
                    hasOnchainCapability: false,
                  },
                },
                {
                  nodeId: "node-high",
                  nodeRecord: "enr:high",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 4,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "100",
                    reputation: "50",
                    ratingCount: "10",
                    capabilityRegistered: true,
                    capabilityBit: 11,
                    hasOnchainCapability: true,
                  },
                },
                {
                  nodeId: "node-suspended",
                  nodeRecord: "enr:suspended",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 5,
                  trust: {
                    registered: true,
                    suspended: true,
                    stake: "1000",
                    reputation: "100",
                    ratingCount: "20",
                    capabilityRegistered: true,
                    capabilityBit: 11,
                    hasOnchainCapability: true,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        case "tos_agentDiscoveryGetCard": {
          const nodeRecord = String(body.params[0]);
          const key =
            nodeRecord === "enr:low"
              ? "node-low"
              : nodeRecord === "enr:high"
                ? "node-high"
                : "node-suspended";
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                nodeId: key,
                nodeRecord,
                cardJson: JSON.stringify(cards.get(key)),
              },
            }),
            { status: 200 },
          );
        }
        default:
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32601,
                message: `unsupported method ${body.method}`,
              },
            }),
            { status: 200 },
          );
      }
    }) as typeof fetch;

    const providers = await discoverCapabilityProviders({
      config,
      capability: "sponsor.topup.testnet",
      limit: 10,
    });

    expect(providers.map((provider) => provider.search.nodeId)).toEqual([
      "node-high",
      "node-low",
    ]);

    const strictProviders = await discoverCapabilityProviders({
      config,
      capability: "sponsor.topup.testnet",
      limit: 10,
      selectionPolicy: {
        onchainCapabilityMode: "require_onchain",
      },
    });

    expect(strictProviders.map((provider) => provider.search.nodeId)).toEqual([
      "node-high",
    ]);
  });

  it("applies typed selection-policy hints when discovery cards advertise them", async () => {
    const { discoverCapabilityProviders } =
      await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();

    const settlementConfig = makeConfig();
    settlementConfig.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.settlement",
      routingProfile: {
        serviceKind: "settlement",
        serviceKinds: ["settlement", "marketplace"],
        capabilityKind: "managed_execution",
        privacyMode: "public",
        receiptMode: "required",
        disclosureReady: false,
      },
    };
    settlementConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/settlement" },
    ];
    const settlementCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: settlementConfig,
      agentDiscovery: settlementConfig.agentDiscovery!,
      address: settlementConfig.walletAddress!,
      discoveryNodeId: "node-settlement",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 21,
    });

    const privacyConfig = makeConfig();
    privacyConfig.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.privacy",
    };
    privacyConfig.agentDiscovery!.endpoints = [
      { kind: "ws", url: "wss://provider.example/privacy" },
    ];
    const privacyCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: privacyConfig,
      agentDiscovery: privacyConfig.agentDiscovery!,
      address: privacyConfig.walletAddress!,
      discoveryNodeId: "node-privacy",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 22,
    });

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url !== "http://127.0.0.1:8545") {
        throw new Error(`unexpected fetch url ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      switch (body.method) {
        case "tos_agentDiscoverySearch":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: [
                {
                  nodeId: "node-privacy",
                  nodeRecord: "enr:privacy",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 5,
                  cardSequence: 22,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 90,
                  },
                },
                {
                  nodeId: "node-settlement",
                  nodeRecord: "enr:settlement",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 21,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 80,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        case "tos_agentDiscoveryGetCard": {
          const nodeRecord = String(body.params[0]);
          const card =
            nodeRecord === "enr:settlement" ? settlementCard : privacyCard;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                nodeId:
                  nodeRecord === "enr:settlement"
                    ? "node-settlement"
                    : "node-privacy",
                nodeRecord,
                cardJson: JSON.stringify(card),
              },
            }),
            { status: 200 },
          );
        }
        default:
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32601,
                message: `unsupported method ${body.method}`,
              },
            }),
            { status: 200 },
          );
      }
    }) as typeof fetch;

    const providers = await discoverCapabilityProviders({
      config,
      capability: "sponsor.topup.testnet",
      limit: 10,
      selectionPolicy: {
        requiredConnectionModes: ["https"],
        packagePrefix: "tolang.openlib.settlement",
        serviceKind: "settlement",
        capabilityKind: "managed_execution",
        privacyMode: "public",
        receiptMode: "required",
        minimumTrustScore: 75,
      },
    });

    expect(providers.map((provider) => provider.search.nodeId)).toEqual([
      "node-settlement",
    ]);
    expect(providers[0]?.card.package_name).toBe("tolang.openlib.settlement");
    expect(providers[0]?.card.routing_profile?.serviceKind).toBe("settlement");
  });

  it("resolves the preferred provider and explains trust/selection failures", async () => {
    const {
      resolveCapabilityProvider,
      resolveCapabilityProviderWithDiagnostics,
    } = await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();

    const settlementConfig = makeConfig();
    settlementConfig.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.settlement",
      routingProfile: {
        serviceKind: "settlement",
        serviceKinds: ["settlement", "marketplace"],
        capabilityKind: "managed_execution",
        privacyMode: "public",
        receiptMode: "required",
        disclosureReady: false,
      },
    };
    settlementConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/settlement" },
    ];
    const settlementCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: settlementConfig,
      agentDiscovery: settlementConfig.agentDiscovery!,
      address: settlementConfig.walletAddress!,
      discoveryNodeId: "node-settlement",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 30,
    });

    const privacyConfig = makeConfig();
    privacyConfig.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.privacy",
    };
    privacyConfig.agentDiscovery!.endpoints = [
      { kind: "ws", url: "wss://provider.example/privacy" },
    ];
    const privacyCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: privacyConfig,
      agentDiscovery: privacyConfig.agentDiscovery!,
      address: privacyConfig.walletAddress!,
      discoveryNodeId: "node-privacy",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 31,
    });

    const weakConfig = makeConfig();
    weakConfig.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.settlement.weak",
      routingProfile: {
        serviceKind: "settlement",
        capabilityKind: "managed_execution",
        privacyMode: "public",
        receiptMode: "required",
      },
    };
    weakConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/weak" },
    ];
    const weakCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: weakConfig,
      agentDiscovery: weakConfig.agentDiscovery!,
      address: weakConfig.walletAddress!,
      discoveryNodeId: "node-weak",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 32,
    });

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url !== "http://127.0.0.1:8545") {
        throw new Error(`unexpected fetch url ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      switch (body.method) {
        case "tos_agentDiscoverySearch":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: [
                {
                  nodeId: "node-weak",
                  nodeRecord: "enr:weak",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 32,
                  trust: {
                    registered: false,
                    suspended: false,
                    stake: "1",
                    reputation: "0",
                    ratingCount: "0",
                    capabilityRegistered: false,
                    hasOnchainCapability: false,
                    localRankScore: 99,
                  },
                },
                {
                  nodeId: "node-privacy",
                  nodeRecord: "enr:privacy",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 5,
                  cardSequence: 31,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 90,
                  },
                },
                {
                  nodeId: "node-settlement",
                  nodeRecord: "enr:settlement",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 30,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 80,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        case "tos_agentDiscoveryGetCard": {
          const nodeRecord = String(body.params[0]);
          const card =
            nodeRecord === "enr:settlement"
              ? settlementCard
              : nodeRecord === "enr:privacy"
                ? privacyCard
                : weakCard;
          const nodeId =
            nodeRecord === "enr:settlement"
              ? "node-settlement"
              : nodeRecord === "enr:privacy"
                ? "node-privacy"
                : "node-weak";
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                nodeId,
                nodeRecord,
                cardJson: JSON.stringify(card),
              },
            }),
            { status: 200 },
          );
        }
        default:
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32601,
                message: `unsupported method ${body.method}`,
              },
            }),
            { status: 200 },
          );
      }
    }) as typeof fetch;

    const selectionPolicy = {
      onchainCapabilityMode: "require_onchain" as const,
      requiredConnectionModes: ["https"] as const,
      packagePrefix: "tolang.openlib.settlement",
      serviceKind: "settlement",
      capabilityKind: "managed_execution",
      privacyMode: "public",
      receiptMode: "required",
      minimumTrustScore: 75,
    };

    const provider = await resolveCapabilityProvider({
      config,
      capability: "sponsor.topup.testnet",
      limit: 10,
      selectionPolicy,
    });
    expect(provider?.search.nodeId).toBe("node-settlement");

    const resolved = await resolveCapabilityProviderWithDiagnostics({
      config,
      capability: "sponsor.topup.testnet",
      limit: 10,
      selectionPolicy,
    });
    expect(resolved.provider?.search.nodeId).toBe("node-settlement");

    const weak = resolved.diagnostics.find(
      (item) => item.provider.search.nodeId === "node-weak",
    );
    expect(weak?.selected).toBe(false);
    expect(weak?.trustFailures).toContain("provider not registered");
    expect(weak?.trustFailures).toContain("capability missing on-chain");

    const privacy = resolved.diagnostics.find(
      (item) => item.provider.search.nodeId === "node-privacy",
    );
    expect(privacy?.selected).toBe(false);
    expect(privacy?.selectionFailures).toContain("missing required connection mode: https");
    expect(privacy?.selectionFailures).toContain("package prefix mismatch");

    const settlement = resolved.diagnostics.find(
      (item) => item.provider.search.nodeId === "node-settlement",
    );
    expect(settlement?.selected).toBe(true);
    expect(settlement?.trustFailures).toEqual([]);
    expect(settlement?.selectionFailures).toEqual([]);
  });

  it("surfaces provider-selection diagnostics when a high-level request cannot find a match", async () => {
    const { requestTestnetFaucet } = await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();

    const settlementConfig = makeConfig();
    settlementConfig.agentDiscovery!.metadataHints = {
      packageName: "tolang.openlib.settlement",
      routingProfile: {
        serviceKind: "settlement",
        capabilityKind: "managed_execution",
        privacyMode: "public",
        receiptMode: "required",
      },
    };
    const settlementCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: settlementConfig,
      agentDiscovery: settlementConfig.agentDiscovery!,
      address: settlementConfig.walletAddress!,
      discoveryNodeId: "node-settlement",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 40,
    });

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url !== "http://127.0.0.1:8545") {
        throw new Error(`unexpected fetch url ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      switch (body.method) {
        case "tos_agentDiscoverySearch":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: [
                {
                  nodeId: "node-settlement",
                  nodeRecord: "enr:settlement",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 3,
                  cardSequence: 40,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 80,
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
              id: body.id,
              result: {
                nodeId: "node-settlement",
                nodeRecord: "enr:settlement",
                cardJson: JSON.stringify(settlementCard),
              },
            }),
            { status: 200 },
          );
        default:
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32601,
                message: `unsupported method ${body.method}`,
              },
            }),
            { status: 200 },
          );
      }
    }) as typeof fetch;

    await expect(
      requestTestnetFaucet({
        identity,
        config,
        address: config.walletAddress!,
        requestedAmountTomi: 1n,
        selectionPolicy: {
          packagePrefix: "tolang.openlib.nonexistent",
        },
      }),
    ).rejects.toThrow(/package prefix mismatch/);
  });
});
