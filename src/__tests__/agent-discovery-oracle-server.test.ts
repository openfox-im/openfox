import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type {
  InferenceClient,
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { createDatabase } from "../state/database.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeConfig(): OpenFoxConfig {
  return {
    name: "OracleFox",
    genesisPrompt: "test",
    creatorAddress: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
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
      oracleServer: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        path: "/agent-discovery/oracle-resolve",
        capability: "oracle.resolve",
        priceTomi: "2000000000000000",
        maxQuestionChars: 1024,
        maxContextChars: 8192,
        maxOptions: 16,
      },
    },
  };
}

function makeIdentity(): OpenFoxIdentity {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  return {
    name: "OracleFox",
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

function makeInference(): InferenceClient {
  return {
    async chat() {
      return {
        message: {
          role: "assistant",
          content: JSON.stringify({
            canonical_result: "yes",
            confidence: 0.91,
            summary: "The bounded query resolves to yes.",
          }),
        },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "mock",
      };
    },
    setLowComputeMode() {},
    getDefaultModel() {
      return "mock";
    },
  };
}

describe("agent discovery oracle server", () => {
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

  it("serves a paid oracle resolution, persists a result, and replays duplicate nonces idempotently", async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-oracle-"));
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
    const { startAgentDiscoveryOracleServer } = await import("../agent-discovery/oracle-server.js");
    const { x402Fetch } = await import("../runtime/x402.js");
    const db = makeDb(tempHome);
    const server = await startAgentDiscoveryOracleServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      db,
      inference: makeInference(),
      oracleConfig: config.agentDiscovery!.oracleServer!,
      marketBindingPublisher: {
        publish(input) {
          return {
            bindingId: `oracle:${input.subjectId}`,
            kind: "oracle",
            subjectId: input.subjectId,
            receipt: {
              version: 1,
              bindingId: `oracle:${input.subjectId}`,
              kind: "oracle",
              subjectId: input.subjectId,
              publisherAddress: config.walletAddress!,
              capability: input.capability,
              artifactUrl: `/oracle/result/${input.subjectId}`,
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
              packageName: "OracleMarket",
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
            receiptId: `oracle:${input.subjectId}`,
            kind: "oracle",
            subjectId: input.subjectId,
            receipt: {
              version: 1,
              receiptId: `oracle:${input.subjectId}`,
              kind: "oracle",
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
              JSON.stringify({ jsonrpc: "2.0", id: body.id, result: `0xoraclepay${submittedPayments}` }),
              { status: 200 },
            );
          default:
            throw new Error(`unexpected RPC method ${body.method}`);
        }
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const canonical = new URL(server.url);
      const resolveUrl = `${canonical.protocol}//${canonical.host}/oracle/resolve`;
      const quoteUrl = `${canonical.protocol}//${canonical.host}/oracle/quote`;
      const body = {
        capability: "oracle.resolve",
        requester: {
          agent_id: requester.address.toLowerCase(),
          identity: {
            kind: "tos",
            value: config.walletAddress!,
          },
        },
        request_nonce: "nonce-oracle-1",
        request_expires_at: Math.floor(Date.now() / 1000) + 120,
        query: "Will the answer be yes or no?",
        query_kind: "binary",
        reason: "test oracle",
      };

      const quote = await fetch(quoteUrl, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      expect(quote.status).toBe(200);
      const quoteBody = (await quote.json()) as { capability: string; price_tomi: string };
      expect(quoteBody.capability).toBe("oracle.resolve");
      expect(quoteBody.price_tomi).toBe("2000000000000000");

      const first = await x402Fetch(
        resolveUrl,
        requester.account,
        "POST",
        JSON.stringify(body),
        { Accept: "application/json" },
      );
      expect(first.success).toBe(true);
      const firstBody = first.response as {
        status: string;
        result_id: string;
        result_url: string;
        canonical_result: string;
        binding_id: string;
        binding_hash: string;
        market_callback_tx_hash: string;
        receipt_id: string;
        receipt_hash: string;
        settlement_tx_hash: string;
      };
      expect(firstBody.status).toBe("ok");
      expect(firstBody.result_id).toMatch(/^[0-9a-f]{64}$/);
      expect(firstBody.result_url).toBe(`/oracle/result/${firstBody.result_id}`);
      expect(firstBody.canonical_result).toBe("yes");
      expect(firstBody.binding_id).toBe(`oracle:${firstBody.result_id}`);
      expect(firstBody.binding_hash).toBe(
        "0x1212121212121212121212121212121212121212121212121212121212121212",
      );
      expect(firstBody.market_callback_tx_hash).toBe(
        "0x3434343434343434343434343434343434343434343434343434343434343434",
      );
      expect(firstBody.receipt_id).toBe(`oracle:${firstBody.result_id}`);
      expect(firstBody.receipt_hash).toBe(
        "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
      );
      expect(firstBody.settlement_tx_hash).toBe(
        "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
      );
      expect(submittedPayments).toBe(1);

      const stored = await fetch(`http://127.0.0.1:${canonical.port}${firstBody.result_url}`);
      expect(stored.status).toBe(200);
      const storedBody = (await stored.json()) as { result_id: string; status: string };
      expect(storedBody.result_id).toBe(firstBody.result_id);
      expect(storedBody.status).toBe("ok");

      const second = await x402Fetch(
        resolveUrl,
        requester.account,
        "POST",
        JSON.stringify(body),
        { Accept: "application/json" },
      );
      expect(second.success).toBe(true);
      const secondBody = second.response as { result_id: string; idempotent?: boolean };
      expect(secondBody.result_id).toBe(firstBody.result_id);
      expect(secondBody.idempotent).toBe(true);
      expect(submittedPayments).toBe(1);
    } finally {
      await server.close();
      db.close();
    }
  });
});
