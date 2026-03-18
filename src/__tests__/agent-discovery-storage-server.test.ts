import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "tosdk/accounts";
import {
  DEFAULT_PROVIDER_BACKEND_MODE,
  DEFAULT_STORAGE_GET_SKILL_STAGES,
  DEFAULT_STORAGE_PUT_SKILL_STAGES,
} from "../agent-discovery/provider-skill-spec.js";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createDatabase } from "../state/database.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeConfig(storageDir: string): OpenFoxConfig {
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
      storageServer: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        path: "/agent-discovery/storage",
        putCapability: "storage.put",
        getCapability: "storage.get",
        putPriceWei: "1000000000000000",
        getPriceWei: "500000000000000",
        maxObjectBytes: 65536,
        storageDir,
        defaultTtlSeconds: 1,
        maxTtlSeconds: 60,
        pruneExpiredOnRead: true,
        putBackendMode: DEFAULT_PROVIDER_BACKEND_MODE,
        getBackendMode: DEFAULT_PROVIDER_BACKEND_MODE,
        putSkillStages: DEFAULT_STORAGE_PUT_SKILL_STAGES.map((stage) => ({ ...stage })),
        getSkillStages: DEFAULT_STORAGE_GET_SKILL_STAGES.map((stage) => ({ ...stage })),
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

function makeDb(root: string): OpenFoxDatabase {
  return createDatabase(path.join(root, ".openfox", "state.db"));
}

describe("agent discovery storage server", () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  const originalTosRpcUrl = process.env.TOS_RPC_URL;
  let tempHome = "";

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalTosRpcUrl === undefined) delete process.env.TOS_RPC_URL;
    else process.env.TOS_RPC_URL = originalTosRpcUrl;
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  it("stores immutable objects with TTL and prunes expired objects on read", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-discovery-storage-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const storageDir = path.join(tempHome, ".openfox", "storage-provider");
    const config = makeConfig(storageDir);
    const { startAgentDiscoveryStorageServer } = await import("../agent-discovery/storage-server.js");
    const { x402Fetch } = await import("../runtime/x402.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryStorageServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      storageConfig: config.agentDiscovery!.storageServer!,
    });

    const requester = makeIdentity();
    let submittedPayments = 0;
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === config.rpcUrl) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
        switch (body.method) {
          case "tos_chainId":
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x682" }), { status: 200 });
          case "tos_getTransactionReceipt":
          case "tos_getTransactionByHash":
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), { status: 200 });
          case "tos_getTransactionCount":
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }), { status: 200 });
          case "tos_sendRawTransaction":
            submittedPayments += 1;
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: `0xpay${submittedPayments}` }), { status: 200 });
          default:
            throw new Error(`unexpected RPC method ${body.method}`);
        }
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const putBody = {
        capability: "storage.put",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: { kind: "tos", value: requester.address.toLowerCase() },
        },
        request_nonce: "storageputnonce1",
        request_expires_at: Math.floor(Date.now() / 1000) + 300,
        content_text: "hello from openfox storage",
        ttl_seconds: 1,
        reason: "paid storage put",
      };
      const put = await x402Fetch(`${server.url}/put`, requester.account, "POST", JSON.stringify(putBody));
      expect(put.success).toBe(true);
      const putResponse = put.response as Record<string, unknown>;
      expect(putResponse.status).toBe("ok");
      const objectId = String(putResponse.object_id);

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
      const getBody = {
        capability: "storage.get",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: { kind: "tos", value: requester.address.toLowerCase() },
        },
        request_nonce: "storagegetnonce1",
        request_expires_at: Math.floor((Date.now() + 2000) / 1000) + 300,
        object_id: objectId,
        reason: "paid storage get",
      };
      const get = await x402Fetch(`${server.url}/get`, requester.account, "POST", JSON.stringify(getBody));
      expect(get.success).toBe(false);
      expect(get.status).toBe(410);

      const objectMeta = await fetch(`http://127.0.0.1:${new URL(server.url).port}/storage/object/${objectId}`);
      expect(objectMeta.status).toBe(404);
      nowSpy.mockRestore();
      expect(submittedPayments).toBe(1);
    } finally {
      await server.close();
      db.close();
    }
  });
});
