import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "tosdk/accounts";
import {
  DEFAULT_NEWS_FETCH_SKILL_STAGES,
  DEFAULT_PROOF_VERIFY_SKILL_STAGES,
  DEFAULT_PROVIDER_BACKEND_MODE,
  DEFAULT_STORAGE_GET_SKILL_STAGES,
  DEFAULT_STORAGE_PUT_SKILL_STAGES,
} from "../agent-discovery/provider-skill-spec.js";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createDatabase } from "../state/database.js";
import { createEvidenceWorkflowCoordinator } from "../evidence-workflow/coordinator.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;
const RPC_URL = "http://127.0.0.1:8545";

function makeBaseConfig(walletAddress: `0x${string}`): OpenFoxConfig {
  return {
    name: "EvidenceFox",
    genesisPrompt: "test",
    creatorAddress: walletAddress,
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
    walletAddress,
    rpcUrl: RPC_URL,
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
    },
  };
}

function makeIdentity(privateKey = TEST_PRIVATE_KEY): OpenFoxIdentity {
  const account = privateKeyToAccount(privateKey);
  return {
    name: "EvidenceFox",
    address: account.address,
    account,
    creatorAddress: account.address,
    sandboxId: "",
    apiKey: "",
    createdAt: new Date().toISOString(),
  };
}

function makeDb(root: string, file = "state.db"): OpenFoxDatabase {
  return createDatabase(path.join(root, ".openfox", file));
}

describe("evidence workflow coordinator", () => {
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

  it("runs a paid M-of-N evidence workflow and stores an aggregate bundle", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-evidence-workflow-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = RPC_URL;
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const identity = makeIdentity();
    const providerAddress = identity.address;
    const newsConfig = makeBaseConfig(providerAddress);
    newsConfig.agentDiscovery!.newsFetchServer = {
      enabled: true,
      bindHost: "127.0.0.1",
      port: 0,
      path: "/agent-discovery/news-fetch",
      capability: "news.fetch",
      priceWei: "3000000000000000",
      maxSourceUrlChars: 2048,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      allowPrivateTargets: true,
      maxArticleChars: 4000,
      backendMode: DEFAULT_PROVIDER_BACKEND_MODE,
      skillStages: DEFAULT_NEWS_FETCH_SKILL_STAGES.map((stage) => ({ ...stage })),
    };

    const proofConfig = makeBaseConfig(providerAddress);
    proofConfig.agentDiscovery!.proofVerifyServer = {
      enabled: true,
      bindHost: "127.0.0.1",
      port: 0,
      path: "/agent-discovery/proof-verify",
      capability: "proof.verify",
      priceWei: "2000000000000000",
      maxPayloadChars: 16384,
      requestTimeoutMs: 5000,
      maxFetchBytes: 65536,
      allowPrivateTargets: true,
      backendMode: DEFAULT_PROVIDER_BACKEND_MODE,
      skillStages: DEFAULT_PROOF_VERIFY_SKILL_STAGES.map((stage) => ({ ...stage })),
    };

    const storageDir = path.join(tempHome, ".openfox", "storage-provider");
    const storageConfig = makeBaseConfig(providerAddress);
    storageConfig.agentDiscovery!.storageServer = {
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
      defaultTtlSeconds: 120,
      maxTtlSeconds: 600,
      pruneExpiredOnRead: true,
      putBackendMode: DEFAULT_PROVIDER_BACKEND_MODE,
      getBackendMode: DEFAULT_PROVIDER_BACKEND_MODE,
      putSkillStages: DEFAULT_STORAGE_PUT_SKILL_STAGES.map((stage) => ({ ...stage })),
      getSkillStages: DEFAULT_STORAGE_GET_SKILL_STAGES.map((stage) => ({ ...stage })),
    };

    const providerDb = makeDb(tempHome, "provider.db");
    const workflowDb = makeDb(tempHome, "workflow.db");

    const { startAgentDiscoveryNewsFetchServer } = await import("../agent-discovery/news-fetch-server.js");
    const { startAgentDiscoveryProofVerifyServer } = await import("../agent-discovery/proof-verify-server.js");
    const { startAgentDiscoveryStorageServer } = await import("../agent-discovery/storage-server.js");

    const newsServer = await startAgentDiscoveryNewsFetchServer({
      identity,
      config: newsConfig,
      address: providerAddress,
      db: providerDb,
      newsFetchConfig: newsConfig.agentDiscovery!.newsFetchServer!,
    });
    const proofServer = await startAgentDiscoveryProofVerifyServer({
      identity,
      config: proofConfig,
      address: providerAddress,
      db: providerDb,
      proofVerifyConfig: proofConfig.agentDiscovery!.proofVerifyServer!,
    });
    const storageServer = await startAgentDiscoveryStorageServer({
      identity,
      config: storageConfig,
      address: providerAddress,
      db: providerDb,
      storageConfig: storageConfig.agentDiscovery!.storageServer!,
    });

    let submittedPayments = 0;
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url === RPC_URL) {
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
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: `0x${submittedPayments.toString(16).padStart(64, "0")}`,
              }),
              { status: 200 },
            );
          default:
            throw new Error(`unexpected RPC method ${body.method}`);
        }
      }
      if (url === "https://news.example/story-1") {
        return new Response(
          "<html><head><title>Story One</title></head><body><article>The first fox evidence payload.</article></body></html>",
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      if (url === "https://news.example/story-2") {
        return new Response(
          "<html><head><title>Story Two</title></head><body><article>The second fox evidence payload.</article></body></html>",
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const coordinator = createEvidenceWorkflowCoordinator({
        identity,
        config: makeBaseConfig(identity.address),
        db: workflowDb,
        account: identity.account,
      });

      const record = await coordinator.run({
        title: "Election evidence bundle",
        question: "Did both trusted sources report the same event?",
        sourceUrls: [
          "https://news.example/story-1",
          "https://news.example/story-2",
        ],
        newsFetchBaseUrl: newsServer.url,
        proofVerifyBaseUrl: proofServer.url,
        storageBaseUrl: storageServer.url,
        quorumM: 2,
        quorumN: 2,
        ttlSeconds: 300,
      });

      expect(record.status).toBe("completed");
      expect(record.validCount).toBe(2);
      expect(record.sourceRecords).toHaveLength(2);
      expect(record.sourceRecords.every((entry) => entry.status === "verified")).toBe(true);
      expect(record.aggregateObjectId).toBeTruthy();
      expect(record.aggregateResultUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/storage\/object\//);
      expect(record.payments).toHaveLength(5);
      expect(submittedPayments).toBe(5);

      const listed = coordinator.list(10);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.runId).toBe(record.runId);

      const fetched = coordinator.get(record.runId);
      expect(fetched?.aggregateObjectId).toBe(record.aggregateObjectId);

      const aggregateMeta = await originalFetch(record.aggregateResultUrl!);
      expect(aggregateMeta.status).toBe(200);
      const aggregateJson = (await aggregateMeta.json()) as { object_id: string; ttl_seconds: number };
      expect(aggregateJson.object_id).toBe(record.aggregateObjectId);
      expect(aggregateJson.ttl_seconds).toBe(300);
    } finally {
      await newsServer.close();
      await proofServer.close();
      await storageServer.close();
      providerDb.close();
      workflowDb.close();
    }
  });
});
