import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";

const getBalanceMock = vi.fn(async () => 10_000_000_000_000_000_000n);
const sendTransferMock = vi.fn(async () => ({
  signed: {
    nonce: 1n,
    gas: 21_000n,
    rawTransaction: "0xraw",
  },
  txHash: "0xtxhash",
}));

vi.mock("../chain/client.js", () => ({
  ChainRpcClient: class {
    async getBalance() {
      return getBalanceMock();
    }
  },
  sendNativeTransfer: (...args: unknown[]) => sendTransferMock(...args),
}));

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
    walletAddress: "0x00000000000000000000000000000000000000000000000000000000000000aa",
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

describe("agent discovery faucet server", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("serves healthz and approves a sponsored top-up", async () => {
    const { startAgentDiscoveryFaucetServer } = await import("../agent-discovery/faucet-server.js");
    const server = await startAgentDiscoveryFaucetServer({
      identity: makeIdentity(),
      config: makeConfig(),
      address: "0x00000000000000000000000000000000000000000000000000000000000000aa",
      privateKey: TEST_PRIVATE_KEY,
      db: makeDb(),
      faucetConfig: makeConfig().agentDiscovery!.faucetServer!,
    });

    try {
      const healthz = await fetch(`${server.url}/healthz`);
      expect(healthz.status).toBe(200);

      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "sponsor.topup.testnet",
          requester: {
            agent_id: "requester",
            identity: {
              kind: "tos",
              value: "0x0000000000000000000000000000000000000000000000000000000000000042",
            },
          },
          request_nonce: "nonce-0001",
          request_expires_at: Math.floor(Date.now() / 1000) + 120,
          requested_amount: "9000000000000000",
          reason: "bootstrap",
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { status: string; tx_hash: string; amount: string };
      expect(body.status).toBe("approved");
      expect(body.tx_hash).toBe("0xtxhash");
      expect(body.amount).toBe("9000000000000000");
      expect(sendTransferMock).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it("enforces cooldown for repeated requester identities", async () => {
    const { startAgentDiscoveryFaucetServer } = await import("../agent-discovery/faucet-server.js");
    const config = makeConfig();
    const server = await startAgentDiscoveryFaucetServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      privateKey: TEST_PRIVATE_KEY,
      db: makeDb(),
      faucetConfig: config.agentDiscovery!.faucetServer!,
    });

    try {
      const payload = {
        capability: "sponsor.topup.testnet",
        requester: {
          agent_id: "requester",
          identity: {
            kind: "tos",
            value: "0x0000000000000000000000000000000000000000000000000000000000000042",
          },
        },
        request_nonce: "nonce-0001",
        request_expires_at: Math.floor(Date.now() / 1000) + 120,
        requested_amount: "1000000000000000",
        reason: "bootstrap",
      };

      const first = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);

      const second = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, request_nonce: "nonce-0002" }),
      });
      expect(second.status).toBe(429);
      const body = await second.json() as { status: string; reason: string };
      expect(body.status).toBe("rejected");
      expect(body.reason).toContain("cooldown");
    } finally {
      await server.close();
    }
  });

  it("rejects duplicate nonces before another payout", async () => {
    const { startAgentDiscoveryFaucetServer } = await import("../agent-discovery/faucet-server.js");
    const config = makeConfig();
    const server = await startAgentDiscoveryFaucetServer({
      identity: makeIdentity(),
      config,
      address: config.walletAddress!,
      privateKey: TEST_PRIVATE_KEY,
      db: makeDb(),
      faucetConfig: config.agentDiscovery!.faucetServer!,
    });

    try {
      const payload = {
        capability: "sponsor.topup.testnet",
        requester: {
          agent_id: "requester",
          identity: {
            kind: "tos",
            value: "0x0000000000000000000000000000000000000000000000000000000000000043",
          },
        },
        request_nonce: "nonce-replay-1",
        request_expires_at: Math.floor(Date.now() / 1000) + 120,
        requested_amount: "1000000000000000",
        reason: "bootstrap",
      };

      const first = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);

      const second = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(second.status).toBe(400);
      const body = await second.json() as { reason: string };
      expect(body.reason).toContain("duplicate request nonce");
      expect(sendTransferMock).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
});
