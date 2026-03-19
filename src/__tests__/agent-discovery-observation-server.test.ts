import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "tosdk/accounts";
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
      observationServer: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        path: "/agent-discovery/observe-once",
        capability: "observation.once",
        priceTomi: "1000000000000000",
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

function makeDb(root: string): OpenFoxDatabase {
  return createDatabase(path.join(root, ".openfox", "state.db"));
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

  it("serves a paid observation, persists a job result, and replays duplicate nonces idempotently", async () => {
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
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryObservationServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      observationConfig: config.agentDiscovery!.observationServer!,
      marketBindingPublisher: {
        publish(input) {
          return {
            bindingId: `observation:${input.subjectId}`,
            kind: "observation",
            subjectId: input.subjectId,
            receipt: {
              version: 1,
              bindingId: `observation:${input.subjectId}`,
              kind: "observation",
              subjectId: input.subjectId,
              publisherAddress: config.walletAddress!,
              capability: input.capability,
              artifactUrl: `/jobs/${input.subjectId}`,
              createdAt: "2026-03-09T00:00:00.000Z",
            },
            receiptHash:
              "0x1212121212121212121212121212121212121212121212121212121212121212",
            callbackTarget:
              "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
            callbackTxHash:
              "0x3434343434343434343434343434343434343434343434343434343434343434",
            callbackReceipt: { status: "0x1" },
            createdAt: "2026-03-09T00:00:00.000Z",
            updatedAt: "2026-03-09T00:00:00.000Z",
          };
        },
      },
      marketContracts: {
        async dispatch(record) {
          return {
            action: "confirmed",
            callback: {
              callbackId: `${record.bindingId}:0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2`,
              bindingId: record.bindingId,
              kind: record.kind,
              subjectId: record.subjectId,
              contractAddress:
                "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
              packageName: "ObservationMarket",
              functionSignature: "bind(bytes)",
              payloadMode: "canonical_binding",
              payloadHex: "0x1234",
              payloadHash:
                "0x5656565656565656565656565656565656565656565656565656565656565656",
              status: "confirmed",
              attemptCount: 1,
              maxAttempts: 3,
              callbackTxHash:
                "0x3434343434343434343434343434343434343434343434343434343434343434",
              callbackReceipt: { status: "0x1" },
              createdAt: "2026-03-09T00:00:00.000Z",
              updatedAt: "2026-03-09T00:00:00.000Z",
            },
          };
        },
        async retryPending() {
          return { processed: 0, confirmed: 0, pending: 0, failed: 0 };
        },
      },
      settlementPublisher: {
        async publish(input) {
          return {
            receiptId: `observation:${input.subjectId}`,
            kind: "observation",
            subjectId: input.subjectId,
            receipt: {
              version: 1,
              receiptId: `observation:${input.subjectId}`,
              kind: "observation",
              subjectId: input.subjectId,
              publisherAddress: config.walletAddress!,
              resultHash:
                "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
              createdAt: "2026-03-09T00:00:00.000Z",
            },
            receiptHash:
              "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
            settlementTxHash:
              "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
            createdAt: "2026-03-09T00:00:00.000Z",
            updatedAt: "2026-03-09T00:00:00.000Z",
          };
        },
      },
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
          case "tos_getTransactionReceipt":
          case "tos_getTransactionByHash":
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), {
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
      const canonical = new URL(server.url);
      const observeUrl = `${canonical.protocol}//${canonical.host}/observe`;
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
        observeUrl,
        requester.account,
        "POST",
        JSON.stringify(body),
        { Accept: "application/json" },
      );
      expect(first.success).toBe(true);
      const firstBody = first.response as {
        status: string;
        job_id: string;
        result_url: string;
        binding_id: string;
        binding_hash: string;
        market_callback_tx_hash: string;
        receipt_id: string;
        receipt_hash: string;
        settlement_tx_hash: string;
      };
      expect(firstBody.status).toBe("ok");
      expect(firstBody.job_id).toMatch(/^[0-9a-f]{64}$/);
      expect(firstBody.result_url).toBe(`/jobs/${firstBody.job_id}`);
      expect(firstBody.binding_id).toBe(`observation:${firstBody.job_id}`);
      expect(firstBody.binding_hash).toBe(
        "0x1212121212121212121212121212121212121212121212121212121212121212",
      );
      expect(firstBody.market_callback_tx_hash).toBe(
        "0x3434343434343434343434343434343434343434343434343434343434343434",
      );
      expect(firstBody.receipt_id).toBe(`observation:${firstBody.job_id}`);
      expect(firstBody.receipt_hash).toBe(
        "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
      );
      expect(firstBody.settlement_tx_hash).toBe(
        "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
      );
      expect(submittedPayments).toBe(1);

      const stored = await fetch(`http://127.0.0.1:${new URL(server.url).port}${firstBody.result_url}`);
      expect(stored.status).toBe(200);
      const storedBody = (await stored.json()) as { job_id: string; status: string };
      expect(storedBody.job_id).toBe(firstBody.job_id);
      expect(storedBody.status).toBe("ok");

      const second = await x402Fetch(
        observeUrl,
        requester.account,
        "POST",
        JSON.stringify(body),
        { Accept: "application/json" },
      );
      expect(second.success).toBe(true);
      const secondBody = second.response as { job_id: string; idempotent?: boolean };
      expect(secondBody.job_id).toBe(firstBody.job_id);
      expect(secondBody.idempotent).toBe(true);
      expect(submittedPayments).toBe(1);
    } finally {
      await server.close();
      db.close();
    }
  });
});
