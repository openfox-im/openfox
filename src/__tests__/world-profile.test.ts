import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createDatabase } from "../state/database.js";
import {
  buildSignedAgentDiscoveryCard,
} from "../agent-discovery/card.js";
import {
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
} from "../group/store.js";
import { buildFoxProfile } from "../metaworld/profile.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-profile-test-"));
  return path.join(tmpDir, "test.db");
}

function makeConfig(walletAddress: `0x${string}`): OpenFoxConfig {
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
    walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentId: "fox-local",
    agentDiscovery: {
      enabled: true,
      publishCard: true,
      cardTtlSeconds: 3600,
      displayName: "Fox Local",
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

describe("metaWorld fox profile", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("builds a local fox profile from config, discovery card, groups, and recent activity", async () => {
    const identity = makeIdentity();
    const config = makeConfig(identity.address);
    const card = await buildSignedAgentDiscoveryCard({
      identity,
      config,
      agentDiscovery: config.agentDiscovery!,
      address: config.walletAddress,
      discoveryNodeId: "node-fox-1",
      issuedAt: Math.floor(Date.now() / 1000),
      cardSequence: 11,
    });
    db.setKV("agent_discovery:last_published_card", JSON.stringify(card));
    db.setKV("agent_discovery:last_published_at", "2030-01-01T00:00:00.000Z");

    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Profile Group",
        actorAddress: account.address,
        actorAgentId: "fox-local",
        creatorDisplayName: "Fox Local",
      },
    });
    await postGroupAnnouncement({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        title: "Profile Launch",
        bodyText: "This fox profile is active.",
        actorAddress: account.address,
      },
    });
    await postGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        text: "Posting into the world.",
        actorAddress: account.address,
      },
    });

    const profile = buildFoxProfile({
      db,
      config,
      address: account.address,
      activityLimit: 10,
    });

    expect(profile.address).toBe(account.address.toLowerCase());
    expect(profile.agentId).toBe("fox-local");
    expect(profile.displayName).toBe("Fox Local");
    expect(profile.discovery.published).toBe(true);
    expect(profile.discovery.discoveryNodeId).toBe("node-fox-1");
    expect(profile.discovery.capabilityNames).toContain("sponsor.topup.testnet");
    expect(profile.groups).toHaveLength(1);
    expect(profile.groups[0].name).toBe("Profile Group");
    expect(profile.stats.groupCount).toBe(1);
    expect(profile.stats.activeGroupCount).toBe(1);
    expect(profile.recentActivity.length).toBeGreaterThanOrEqual(2);
  });
});
