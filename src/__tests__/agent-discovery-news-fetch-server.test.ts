import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "tosdk/accounts";
import {
  buildTOSX402Payment,
  encodeTOSX402PaymentHeader,
} from "../tos/client.js";
import {
  DEFAULT_NEWS_FETCH_SKILL_STAGES,
  DEFAULT_PROVIDER_BACKEND_MODE,
} from "../agent-discovery/provider-skill-spec.js";
import { buildZkTlsBundleSummary, listZkTlsBundleRecords } from "../proof-market/records.js";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createDatabase } from "../state/database.js";

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
      newsFetchServer: {
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

function makeRustWorkerConfig(binName: string) {
  const manifestPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../workers/Cargo.toml",
  );
  execFileSync("cargo", ["+stable", "build", "--quiet", "--manifest-path", manifestPath, "--bin", binName], {
    stdio: "inherit",
  });
  const binaryPath = path.resolve(
    path.dirname(manifestPath),
    `target/debug/${binName}`,
  );
  return {
    command: binaryPath,
    args: [],
    timeoutMs: 10_000,
  } as const;
}

async function postPaid(
  url: string,
  body: Record<string, unknown>,
  rpcUrl: string,
): Promise<{ success: boolean; status: number; response: unknown }> {
  const initial = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const paymentRequired = (await initial.json()) as {
    accepts?: Array<{
      scheme: "exact";
      network: string;
      maxAmountRequired: string;
      payToAddress: `0x${string}`;
      asset?: string;
      requiredDeadlineSeconds?: number;
    }>;
  };
  const requirement = paymentRequired.accepts?.[0];
  if (initial.status !== 402 || !requirement) {
    return {
      success: initial.ok,
      status: initial.status,
      response: paymentRequired,
    };
  }
  const payment = await buildTOSX402Payment({
    privateKey: TEST_PRIVATE_KEY,
    requirement,
    rpcUrl,
  });
  const paymentHeader = encodeTOSX402PaymentHeader(payment);
  const paid = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Payment-Signature": paymentHeader,
      "X-Payment": paymentHeader,
    },
    body: JSON.stringify(body),
  });
  const response = await paid.json().catch(() => paid.text());
  return { success: paid.ok, status: paid.status, response };
}

describe.sequential("agent discovery news.fetch server", () => {
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

  it("captures a paid news article and replays duplicate nonces idempotently", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-news-fetch-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const config = makeConfig();
    const { startAgentDiscoveryNewsFetchServer } = await import("../agent-discovery/news-fetch-server.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryNewsFetchServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      newsFetchConfig: config.agentDiscovery!.newsFetchServer!,
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
      if (url === "https://news.example/story") {
        return new Response(
          "<html><head><title>Bounded Capture Headline</title></head><body><article>The quick brown fox verified the capture lane.</article></body></html>",
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const body = {
        capability: "news.fetch",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: { kind: "tos", value: requester.address.toLowerCase() },
        },
        request_nonce: "newsfetchnonce1",
        request_expires_at: Math.floor(Date.now() / 1000) + 300,
        source_url: "https://news.example/story",
        reason: "paid news fetch",
      };

      const first = await postPaid(server.url, body, config.rpcUrl!);
      expect(first.success).toBe(true);
      const firstBody = first.response as Record<string, unknown>;
      expect(firstBody.status).toBe("ok");
      expect(firstBody.headline).toBe("Bounded Capture Headline");
      expect(firstBody.article_sha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(firstBody.zktls_bundle_format).toBe("bounded_http_capture_v0");
      expect(firstBody.verification_mode).toBe("fallback_integrity");
      expect(firstBody.native_proof_status).toBe("fallback_only");
      expect(firstBody.zktls_attestation_sha256).toBeUndefined();
      expect(firstBody.zktls_attestation_url).toBeUndefined();
      expect((firstBody.metadata as Record<string, unknown>).provider_backend).toEqual({
        kind: "builtin",
        stages: ["builtin:news.fetch"],
      });

      const second = await postPaid(server.url, body, config.rpcUrl!);
      expect(second.success).toBe(true);
      const secondBody = second.response as Record<string, unknown>;
      expect(secondBody.idempotent).toBe(true);
      expect(submittedPayments).toBe(1);
      const records = listZkTlsBundleRecords(db, 10);
      expect(records).toHaveLength(1);
      expect(records[0]?.originClaims.sourcePolicyId ?? null).toBeNull();
      expect(records[0]?.integrity.bundleSha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(records[0]?.verificationMode).toBe("fallback_integrity");
      expect(records[0]?.nativeProofStatus).toBe("fallback_only");
      const summary = buildZkTlsBundleSummary(db, 10);
      expect(summary.totalBundles).toBe(1);
      expect(summary.nativeAttestedBundles).toBe(0);
      expect(summary.fallbackBundles).toBe(1);
      expect(summary.sourcePolicies["(unspecified)"]).toBe(1);
    } finally {
      await server.close();
      db.close();
    }
  });

  it("can route zktls.bundle through a configured CLI worker", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-news-fetch-worker-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const config = makeConfig();
    config.agentDiscovery!.newsFetchServer!.zktlsWorker = makeRustWorkerConfig(
      "openfox-zktls-bundler",
    );
    const { startAgentDiscoveryNewsFetchServer } = await import("../agent-discovery/news-fetch-server.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryNewsFetchServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      newsFetchConfig: config.agentDiscovery!.newsFetchServer!,
    });

    const requester = makeIdentity();
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
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0xpay1" }), { status: 200 });
          default:
            throw new Error(`unexpected RPC method ${body.method}`);
        }
      }
      if (url === "https://news.example/story") {
        return new Response(
          "<html><head><title>CLI Worker Headline</title></head><body><article>hello</article></body></html>",
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const body = {
        capability: "news.fetch",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: { kind: "tos", value: requester.address.toLowerCase() },
        },
        request_nonce: "newsfetchworker1",
        request_expires_at: Math.floor(Date.now() / 1000) + 300,
        source_url: "https://news.example/story",
        reason: "paid news fetch",
      };

      const result = await postPaid(server.url, body, config.rpcUrl!);
      expect(result.success).toBe(true);
      const response = result.response as Record<string, unknown>;
      expect(response.status).toBe("ok");
      expect(response.zktls_bundle_format).toBe("zktls_bundle_v1");
      expect(response.zktls_bundle_sha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(response.verification_mode).toBe("native_attestation");
      expect(response.native_proof_status).toBe("native_attested");
      expect(response.zktls_attestation_sha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(String(response.zktls_attestation_url)).toContain("/news/fetch/attestation/");
      expect((response.metadata as Record<string, unknown>).bundle).toMatchObject({
        backend: "rust_fixture_zktls_v0",
        source_policy_id: "news.fetch",
      });
      const records = listZkTlsBundleRecords(db, 10);
      expect(records).toHaveLength(1);
      expect(records[0]?.verifierMaterialReferences[0]?.kind).toBeTruthy();
      expect(records[0]?.integrity.bundleSha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(records[0]?.verificationMode).toBe("native_attestation");
      expect(records[0]?.nativeProofStatus).toBe("native_attested");
    } finally {
      await server.close();
      db.close();
    }
  });
});
