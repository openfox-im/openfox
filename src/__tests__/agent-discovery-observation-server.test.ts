import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeConfig(): OpenFoxConfig {
  return {
    name: "ProviderFox",
    genesisPrompt: "test",
    creatorAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
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
    walletAddress: "0x0000000000000000000000000000000000000000000000000000000000000042",
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
      observationServer: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        path: "/agent-discovery/observe-once",
        capability: "observation.once",
        priceWei: "1000000000000000",
        requestTimeoutMs: 5000,
        maxResponseBytes: 65536,
        allowPrivateTargets: true,
      },
    },
  };
}

function makeIdentity(): OpenFoxIdentity {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  return {
    name: "ProviderFox",
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

describe("agent discovery observation server", () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  const originalTosRpcUrl = process.env.TOS_RPC_URL;
  let tempHome = "";

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
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
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  it("serves a paid observation and rejects duplicate nonces before charging again", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-observe-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({
        privateKey: TEST_PRIVATE_KEY,
        createdAt: new Date().toISOString(),
      }),
    );

    const config = makeConfig();
    const { startAgentDiscoveryObservationServer } = await import("../agent-discovery/observation-server.js");
    const { x402Fetch } = await import("../runtime/x402.js");
    const server = await startAgentDiscoveryObservationServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db: makeDb(),
      observationConfig: config.agentDiscovery!.observationServer!,
    });

    const requester = makeIdentity();
    let submittedPayments = 0;

    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === config.rpcUrl) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          id: number;
          method: string;
        };
        switch (body.method) {
          case "tos_chainId":
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x682" }), {
              status: 200,
            });
          case "tos_getTransactionCount":
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }), {
              status: 200,
            });
          case "tos_sendRawTransaction":
            submittedPayments += 1;
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: `0xpay${submittedPayments}` }),
              { status: 200 },
            );
          default:
            throw new Error(`unexpected RPC method ${body.method}`);
        }
      }
      if (url === "https://target.example/data") {
        return new Response(JSON.stringify({ ok: true, value: 42 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const body = {
        capability: "observation.once",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: {
            kind: "tos",
            value: config.walletAddress!,
          },
        },
        request_nonce: "nonce-observe-1",
        request_expires_at: Math.floor(Date.now() / 1000) + 120,
        target_url: "https://target.example/data",
        reason: "test observation",
      };

      const first = await x402Fetch(
        server.url,
        requester.account,
        "POST",
        JSON.stringify(body),
        { Accept: "application/json" },
      );
      expect(first.success).toBe(true);
      expect((first.response as { status: string }).status).toBe("ok");
      expect(submittedPayments).toBe(1);

      const second = await x402Fetch(
        server.url,
        requester.account,
        "POST",
        JSON.stringify(body),
        { Accept: "application/json" },
      );
      expect(second.success).toBe(false);
      expect(second.status).toBe(400);
      expect(submittedPayments).toBe(1);
    } finally {
      await server.close();
    }
  });
});
