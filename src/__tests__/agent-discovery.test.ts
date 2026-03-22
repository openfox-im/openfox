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

  it("falls back across providers and uses feedback to reorder future execution selection", async () => {
    const { requestObservationOnce } =
      await import("../agent-discovery/client.js");
    const config = makeConfig();
    config.agentDiscovery = {
      ...config.agentDiscovery!,
      endpoints: [{ kind: "http", url: "http://provider-a.example/observe" }],
      capabilities: [{ name: "observation.once", mode: "sponsored" }],
    };
    const identity = makeIdentity();

    const providerAConfig = {
      ...config,
      agentDiscovery: {
        ...config.agentDiscovery!,
        endpoints: [{ kind: "http", url: "http://provider-a.example/observe" }],
        capabilities: [{ name: "observation.once", mode: "sponsored" }],
      },
    };
    const providerBConfig = {
      ...config,
      agentDiscovery: {
        ...config.agentDiscovery!,
        endpoints: [{ kind: "http", url: "http://provider-b.example/observe" }],
        capabilities: [{ name: "observation.once", mode: "sponsored" }],
      },
    };

    const providerACard = await buildSignedAgentDiscoveryCard({
      identity,
      config: providerAConfig,
      agentDiscovery: providerAConfig.agentDiscovery!,
      address: config.walletAddress!,
      discoveryNodeId: "node-provider-a",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 50,
    });
    const providerBCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: providerBConfig,
      agentDiscovery: providerBConfig.agentDiscovery!,
      address: config.walletAddress!,
      discoveryNodeId: "node-provider-b",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 49,
    });

    const db = {
      store: new Map<string, string>(),
      getKV(key: string) {
        return this.store.get(key);
      },
      setKV(key: string, value: string) {
        this.store.set(key, value);
      },
    };

    const attempts: string[] = [];
    let providerAFails = true;

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8545") {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          id: number;
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
                    nodeId: "node-provider-a",
                    nodeRecord: "enr:provider-a",
                    primaryIdentity: config.walletAddress,
                    connectionModes: 3,
                    cardSequence: 50,
                    trust: {
                      registered: true,
                      suspended: false,
                      stake: "100",
                      reputation: "100",
                      ratingCount: "5",
                      capabilityRegistered: true,
                      hasOnchainCapability: true,
                      localRankScore: 95,
                    },
                  },
                  {
                    nodeId: "node-provider-b",
                    nodeRecord: "enr:provider-b",
                    primaryIdentity: config.walletAddress,
                    connectionModes: 3,
                    cardSequence: 49,
                    trust: {
                      registered: true,
                      suspended: false,
                      stake: "50",
                      reputation: "50",
                      ratingCount: "2",
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
            const isA = nodeRecord === "enr:provider-a";
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  nodeId: isA ? "node-provider-a" : "node-provider-b",
                  nodeRecord,
                  cardJson: JSON.stringify(isA ? providerACard : providerBCard),
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
      }

      if (url === "http://provider-a.example/observe") {
        attempts.push("A");
        if (providerAFails) {
          return new Response(
            JSON.stringify({ error: "provider a failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            status: "ok",
            observed_at: 1770000001,
            target_url: "https://target.example/data",
            http_status: 200,
            content_type: "application/json",
            body_json: { provider: "a" },
            body_sha256: "0xaaa",
            size_bytes: 12,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "http://provider-b.example/observe") {
        attempts.push("B");
        return new Response(
          JSON.stringify({
            status: "ok",
            observed_at: 1770000002,
            target_url: "https://target.example/data",
            http_status: 200,
            content_type: "application/json",
            body_json: { provider: "b" },
            body_sha256: "0xbbb",
            size_bytes: 12,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`unexpected fetch url ${url}`);
    }) as typeof fetch;

    const first = await requestObservationOnce({
      identity,
      config,
      address: config.walletAddress!,
      targetUrl: "https://target.example/data",
      db: db as any,
    });

    expect(first.provider.search.nodeId).toBe("node-provider-b");
    expect(attempts[0]).toBe("A");
    expect(attempts.at(-1)).toBe("B");
    expect(attempts.filter((entry) => entry === "B")).toHaveLength(1);

    const feedbackA = JSON.parse(
      db.getKV(
        "agent_discovery:provider_feedback:node-provider-a:observation.once",
      ) || "{}",
    ) as { failureCount?: number };
    const feedbackB = JSON.parse(
      db.getKV(
        "agent_discovery:provider_feedback:node-provider-b:observation.once",
      ) || "{}",
    ) as { successCount?: number };
    expect(feedbackA.failureCount).toBe(1);
    expect(feedbackB.successCount).toBe(1);

    attempts.length = 0;
    providerAFails = false;

    const second = await requestObservationOnce({
      identity,
      config,
      address: config.walletAddress!,
      targetUrl: "https://target.example/data",
      db: db as any,
    });

    expect(second.provider.search.nodeId).toBe("node-provider-b");
    expect(attempts[0]).toBe("B");
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
      if (
        (url === "https://provider.example/expensive" ||
          url === "https://provider.example/cheap") &&
        (init?.method || "GET") === "HEAD"
      ) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "tos:1666",
                maxAmountRequired: "10",
                payToAddress: config.walletAddress,
                requiredDeadlineSeconds: 300,
              },
            ],
          }),
          { status: 402, headers: { "Content-Type": "application/json" } },
        );
      }
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

  it("applies execution-policy mode and advertised-fee preferences when ranking providers", async () => {
    const { discoverCapabilityProviders } =
      await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();

    const expensiveConfig = makeConfig();
    expensiveConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/news-fetch-expensive" },
    ];
    expensiveConfig.agentDiscovery!.capabilities = [
      {
        name: "news.fetch",
        mode: "paid",
        policy: { per_request_fee_tos: "9" },
      },
    ];
    const expensiveCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: expensiveConfig,
      agentDiscovery: expensiveConfig.agentDiscovery!,
      address: expensiveConfig.walletAddress!,
      discoveryNodeId: "node-expensive",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 60,
    });

    const cheapConfig = makeConfig();
    cheapConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/news-fetch-cheap" },
    ];
    cheapConfig.agentDiscovery!.capabilities = [
      {
        name: "news.fetch",
        mode: "paid",
        policy: { per_request_fee_tos: "2" },
      },
    ];
    const cheapCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: cheapConfig,
      agentDiscovery: cheapConfig.agentDiscovery!,
      address: cheapConfig.walletAddress!,
      discoveryNodeId: "node-cheap",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 40,
    });

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (
        (url === "https://provider.example/news-fetch-expensive" ||
          url === "https://provider.example/news-fetch-cheap") &&
        (init?.method || "GET") === "HEAD"
      ) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "tos:1666",
                maxAmountRequired: "10",
                payToAddress: config.walletAddress,
                requiredDeadlineSeconds: 300,
              },
            ],
          }),
          { status: 402, headers: { "Content-Type": "application/json" } },
        );
      }
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
                  nodeId: "node-expensive",
                  nodeRecord: "enr:expensive",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 2,
                  cardSequence: 60,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 100,
                  },
                },
                {
                  nodeId: "node-cheap",
                  nodeRecord: "enr:cheap",
                  primaryIdentity: config.walletAddress,
                  connectionModes: 2,
                  cardSequence: 40,
                  trust: {
                    registered: true,
                    suspended: false,
                    stake: "10",
                    reputation: "10",
                    ratingCount: "1",
                    capabilityRegistered: true,
                    hasOnchainCapability: true,
                    localRankScore: 100,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        case "tos_agentDiscoveryGetCard": {
          const nodeRecord = String(body.params[0]);
          const card =
            nodeRecord === "enr:expensive" ? expensiveCard : cheapCard;
          const nodeId =
            nodeRecord === "enr:expensive" ? "node-expensive" : "node-cheap";
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

    const defaultRanked = await discoverCapabilityProviders({
      config,
      capability: "news.fetch",
      limit: 10,
      executionPolicy: {
        preferLowerAdvertisedFee: false,
      },
    });
    expect(defaultRanked.map((provider) => provider.search.nodeId)).toEqual([
      "node-expensive",
      "node-cheap",
    ]);

    const feeAwareRanked = await discoverCapabilityProviders({
      config,
      capability: "news.fetch",
      limit: 10,
      executionPolicy: {
        preferLowerAdvertisedFee: true,
        preferredModes: ["paid", "hybrid", "sponsored"],
      },
    });
    expect(feeAwareRanked.map((provider) => provider.search.nodeId)).toEqual([
      "node-cheap",
      "node-expensive",
    ]);
  });

  it("limits provider fallback depth through execution policy", async () => {
    const { requestObservationOnce } = await import("../agent-discovery/client.js");
    const config = makeConfig();
    const identity = makeIdentity();

    const firstConfig = makeConfig();
    firstConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/observe-primary" },
    ];
    firstConfig.agentDiscovery!.capabilities = [
      {
        name: "observation.once",
        mode: "paid",
        policy: { per_request_fee_tos: "3" },
      },
    ];
    const firstCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: firstConfig,
      agentDiscovery: firstConfig.agentDiscovery!,
      address: firstConfig.walletAddress!,
      discoveryNodeId: "node-primary",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 70,
    });

    const secondConfig = makeConfig();
    secondConfig.agentDiscovery!.endpoints = [
      { kind: "https", url: "https://provider.example/observe-secondary" },
    ];
    secondConfig.agentDiscovery!.capabilities = [
      {
        name: "observation.once",
        mode: "paid",
        policy: { per_request_fee_tos: "4" },
      },
    ];
    const secondCard = await buildSignedAgentDiscoveryCard({
      identity,
      config: secondConfig,
      agentDiscovery: secondConfig.agentDiscovery!,
      address: secondConfig.walletAddress!,
      discoveryNodeId: "node-secondary",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 69,
    });

    const providerHits: string[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (
        (url === "https://provider.example/observe-primary" ||
          url === "https://provider.example/observe-secondary") &&
        (init?.method || "GET") === "HEAD"
      ) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "tos:1666",
                maxAmountRequired: "10",
                payToAddress: config.walletAddress,
                requiredDeadlineSeconds: 300,
              },
            ],
          }),
          { status: 402, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "http://127.0.0.1:8545") {
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
                    nodeId: "node-primary",
                    nodeRecord: "enr:primary",
                    primaryIdentity: config.walletAddress,
                    connectionModes: 2,
                    cardSequence: 70,
                    trust: {
                      registered: true,
                      suspended: false,
                      stake: "10",
                      reputation: "10",
                      ratingCount: "1",
                      capabilityRegistered: true,
                      hasOnchainCapability: true,
                      localRankScore: 100,
                    },
                  },
                  {
                    nodeId: "node-secondary",
                    nodeRecord: "enr:secondary",
                    primaryIdentity: config.walletAddress,
                    connectionModes: 2,
                    cardSequence: 69,
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
                ],
              }),
              { status: 200 },
            );
          case "tos_agentDiscoveryGetCard": {
            const nodeRecord = String(body.params[0]);
            const card =
              nodeRecord === "enr:primary" ? firstCard : secondCard;
            const nodeId =
              nodeRecord === "enr:primary" ? "node-primary" : "node-secondary";
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
      }
      if (url === "https://provider.example/observe-primary") {
        providerHits.push("primary");
        return new Response("upstream failed", { status: 502 });
      }
      if (url === "https://provider.example/observe-secondary") {
        providerHits.push("secondary");
        return new Response(
          JSON.stringify({
            status: "ok",
            observed_at: Math.floor(Date.now() / 1000),
            target_url: "https://example.com",
            http_status: 200,
            content_type: "text/plain",
            body_sha256:
              "0x1111111111111111111111111111111111111111111111111111111111111111",
            size_bytes: 2,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch url ${url}`);
    }) as typeof fetch;

    await expect(
      requestObservationOnce({
        identity,
        config,
        address: config.walletAddress!,
        targetUrl: "https://example.com",
        executionPolicy: {
          maxFallbackProviders: 1,
          preferredModes: ["paid", "hybrid", "sponsored"],
        },
      }),
    ).rejects.toThrow(/All providers failed/);
    expect(providerHits.length).toBeGreaterThan(0);
    expect(new Set(providerHits)).toEqual(new Set(["primary"]));

    providerHits.length = 0;

    const success = await requestObservationOnce({
      identity,
      config,
      address: config.walletAddress!,
      targetUrl: "https://example.com",
      executionPolicy: {
        maxFallbackProviders: 2,
        preferredModes: ["paid", "hybrid", "sponsored"],
      },
    });
    expect(success.provider.search.nodeId).toBe("node-secondary");
    expect(providerHits).toContain("primary");
    expect(providerHits).toContain("secondary");
  });
});
