import fs from "fs";
import http from "http";
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
  DEFAULT_PROOF_VERIFY_SKILL_STAGES,
  DEFAULT_PROVIDER_BACKEND_MODE,
} from "../agent-discovery/provider-skill-spec.js";
import {
  buildProofVerificationSummary,
  listProofVerificationRecords,
} from "../proof-market/records.js";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createDatabase } from "../state/database.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;
const SUBJECT_SHA =
  "0x5c9799ab4b4d5d9e77c982b6914b4094c343f9d52966698218510d168c2ce9a6";

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
      proofVerifyServer: {
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

describe.sequential("agent discovery proof.verify server", () => {
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

  it("verifies bundle and subject hashes through the bounded verifier backend", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-proof-verify-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const config = makeConfig();
    const { startAgentDiscoveryProofVerifyServer } = await import("../agent-discovery/proof-verify-server.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryProofVerifyServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      proofVerifyConfig: config.agentDiscovery!.proofVerifyServer!,
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
      if (url === "https://news.example/article.txt") {
        return new Response("proof verify subject payload", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      if (url === "https://proofs.example/bundle.json") {
        return new Response(
          JSON.stringify({
            article_sha256: SUBJECT_SHA,
            verifier_backend: "bounded_http_capture_v0",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const body = {
        capability: "proof.verify",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: { kind: "tos", value: requester.address.toLowerCase() },
        },
        request_nonce: "proofverifynonce1",
        request_expires_at: Math.floor(Date.now() / 1000) + 300,
        subject_url: "https://news.example/article.txt",
        subject_sha256: SUBJECT_SHA,
        proof_bundle_url: "https://proofs.example/bundle.json",
        reason: "paid proof verify",
      };

      const result = await postPaid(server.url, body, config.rpcUrl!);
      expect(result.success).toBe(true);
      const response = result.response as Record<string, unknown>;
      expect(response.status).toBe("ok");
      expect(response.verdict).toBe("valid");
      expect(response.verifier_receipt_sha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect((response.metadata as Record<string, unknown>).provider_backend).toEqual({
        kind: "skills",
        stages: ["proofverify.verify"],
      });
      expect(submittedPayments).toBe(1);
      const records = listProofVerificationRecords(db, 10);
      expect(records).toHaveLength(1);
      expect(records[0]?.verificationMode).toBe("fallback");
      expect(records[0]?.verdictReason).toBe("all_checks_passed");
      expect(records[0]?.boundSubjectHashes.subjectSha256).toBe(SUBJECT_SHA);
      const summary = buildProofVerificationSummary(db, 10);
      expect(summary.totalResults).toBe(1);
      expect(summary.fallbackVerifications).toBe(1);
    } finally {
      await server.close();
      db.close();
    }
  });

  it("can route proofverify.verify through a configured CLI worker", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-proof-verify-worker-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const config = makeConfig();
    config.agentDiscovery!.proofVerifyServer!.verifierWorker = makeRustWorkerConfig(
      "openfox-proof-verifier",
    );
    const { startAgentDiscoveryProofVerifyServer } = await import("../agent-discovery/proof-verify-server.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryProofVerifyServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      proofVerifyConfig: config.agentDiscovery!.proofVerifyServer!,
    });

    const requester = makeIdentity();
    const fixtureServer = http.createServer((req, res) => {
      if (req.url === "/subject.txt") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("proof verify subject payload");
        return;
      }
      if (req.url === "/bundle.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            article_sha256: SUBJECT_SHA,
            proof_bundle_sha256: `0x${"e".repeat(64)}`,
            verifier_backend: "bounded_http_capture_v0",
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
    const fixtureAddress = fixtureServer.address();
    const fixturePort =
      fixtureAddress && typeof fixtureAddress === "object" && "port" in fixtureAddress
        ? fixtureAddress.port
        : 0;

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
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const body = {
        capability: "proof.verify",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: { kind: "tos", value: requester.address.toLowerCase() },
        },
        request_nonce: "proofverifyworker1",
        request_expires_at: Math.floor(Date.now() / 1000) + 300,
        subject_url: `http://127.0.0.1:${fixturePort}/subject.txt`,
        subject_sha256: SUBJECT_SHA,
        proof_bundle_url: `http://127.0.0.1:${fixturePort}/bundle.json`,
        proof_bundle_sha256: `0x${"e".repeat(64)}`,
        reason: "paid proof verify",
      };

      const result = await postPaid(server.url, body, config.rpcUrl!);
      expect(result.success).toBe(true);
      const response = result.response as Record<string, unknown>;
      expect(response.status).toBe("ok");
      expect(response.verdict).toBe("valid");
      expect(response.verifier_receipt_sha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect((response.metadata as Record<string, unknown>).verifier_class).toBe(
        "bundle_integrity_verification",
      );
      const records = listProofVerificationRecords(db, 10);
      expect(records).toHaveLength(1);
      expect(records[0]?.verificationMode).toBe("worker_backed");
      expect(records[0]?.verifierClass).toBe("bundle_integrity_verification");
      expect(records[0]?.verifierMaterialReference?.kind).toBe("proof_bundle");
      expect(records[0]?.boundSubjectHashes.subjectSha256).toBe(SUBJECT_SHA);
    } finally {
      await new Promise<void>((resolve, reject) =>
        fixtureServer.close((error) => (error ? reject(error) : resolve())),
      );
      await server.close();
      db.close();
    }
  });

  it("records invalid and inconclusive proof verification paths", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-proof-verify-paths-"));
    process.env.HOME = tempHome;
    process.env.TOS_RPC_URL = "http://127.0.0.1:8545";
    fs.mkdirSync(path.join(tempHome, ".openfox"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".openfox", "wallet.json"),
      JSON.stringify({ privateKey: TEST_PRIVATE_KEY, createdAt: new Date().toISOString() }),
    );

    const config = makeConfig();
    config.agentDiscovery!.proofVerifyServer!.verifierWorker = makeRustWorkerConfig(
      "openfox-proof-verifier",
    );
    const { startAgentDiscoveryProofVerifyServer } = await import("../agent-discovery/proof-verify-server.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryProofVerifyServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      proofVerifyConfig: config.agentDiscovery!.proofVerifyServer!,
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
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    const invalidFixture = http.createServer((req, res) => {
      if (req.url === "/subject.txt") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("proof verify subject payload");
        return;
      }
      if (req.url === "/bundle.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ article_sha256: `0x${"f".repeat(64)}` }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => invalidFixture.listen(0, "127.0.0.1", resolve));
    const invalidAddress = invalidFixture.address();
    const invalidPort =
      invalidAddress && typeof invalidAddress === "object" && "port" in invalidAddress
        ? invalidAddress.port
        : 0;

    try {
      const invalid = await postPaid(
        server.url,
        {
          capability: "proof.verify",
          requester: {
            agent_id: requester.address.toLowerCase(),
            identity: { kind: "tos", value: requester.address.toLowerCase() },
          },
          request_nonce: "proofverifyinvalid1",
          request_expires_at: Math.floor(Date.now() / 1000) + 300,
          subject_url: `http://127.0.0.1:${invalidPort}/subject.txt`,
          subject_sha256: SUBJECT_SHA,
          proof_bundle_url: `http://127.0.0.1:${invalidPort}/bundle.json`,
          reason: "invalid proof path",
        },
        config.rpcUrl!,
      );
      expect(invalid.success).toBe(true);
      expect((invalid.response as Record<string, unknown>).verdict).toBe("invalid");

      const inconclusive = await postPaid(
        server.url,
        {
          capability: "proof.verify",
          requester: {
            agent_id: requester.address.toLowerCase(),
            identity: { kind: "tos", value: requester.address.toLowerCase() },
          },
          request_nonce: "proofverifyinconclusive1",
          request_expires_at: Math.floor(Date.now() / 1000) + 300,
          subject_sha256: SUBJECT_SHA,
          reason: "inconclusive proof path",
        },
        config.rpcUrl!,
      );
      expect(inconclusive.success).toBe(true);
      expect((inconclusive.response as Record<string, unknown>).verdict).toBe(
        "inconclusive",
      );

      const records = listProofVerificationRecords(db, 10);
      expect(records.map((item) => item.verdict)).toEqual([
        "inconclusive",
        "invalid",
      ]);
      expect(records[0]?.verdictReason).toBeTruthy();
      const summary = buildProofVerificationSummary(db, 10);
      expect(summary.verdicts.invalid).toBe(1);
      expect(summary.verdicts.inconclusive).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        invalidFixture.close((error) => (error ? reject(error) : resolve())),
      );
      await server.close();
      db.close();
    }
  });
});
