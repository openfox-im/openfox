import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
} from "../group/store.js";
import { publishWorldPresence } from "../metaworld/presence.js";
import {
  buildFoxPageHtml,
  buildFoxPageSnapshot,
} from "../metaworld/fox-page.js";

const ADMIN_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-fox-page-test-"));
  return path.join(tmpDir, "test.db");
}

function makeConfig(walletAddress: `0x${string}`): OpenFoxConfig {
  return {
    name: "Fox Local",
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
    walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentId: "fox-local",
    agentDiscovery: {
      enabled: true,
      publishCard: false,
      cardTtlSeconds: 3600,
      displayName: "Fox Local",
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
    },
  };
}

describe("metaWorld fox page", () => {
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

  it("builds a fox page snapshot with profile, presence, activity, announcements, and messages", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Page Group",
        description: "A group for the fox page test.",
        visibility: "public",
        actorAddress: admin.address,
        actorAgentId: "fox-local",
        creatorDisplayName: "Fox Local",
        tags: ["testing", "world"],
      },
    });

    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Fox Page Launch",
        bodyText: "This announcement should appear on the fox page.",
        actorAddress: admin.address,
      },
    });
    await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "This message should appear on the fox page.",
        actorAddress: admin.address,
        actorAgentId: "fox-local",
      },
    });

    publishWorldPresence({
      db,
      actorAddress: admin.address,
      agentId: "fox-local",
      displayName: "Fox Local",
      status: "online",
      ttlSeconds: 300,
    });
    publishWorldPresence({
      db,
      actorAddress: admin.address,
      groupId: created.group.groupId,
      agentId: "fox-local",
      displayName: "Fox Local",
      status: "busy",
      ttlSeconds: 300,
    });

    const page = buildFoxPageSnapshot({
      db,
      config,
      address: admin.address,
      activityLimit: 10,
      announcementLimit: 10,
      messageLimit: 10,
      presenceLimit: 10,
    });
    const html = buildFoxPageHtml(page);

    expect(page.fox.displayName).toBe("Fox Local");
    expect(page.directoryEntry.displayName).toBe("Fox Local");
    expect(page.stats.groupCount).toBe(1);
    expect(page.stats.activeGroupCount).toBe(1);
    expect(page.presence).toHaveLength(2);
    expect(page.recentAnnouncements).toHaveLength(1);
    expect(page.recentAnnouncements[0].groupName).toBe("Fox Page Group");
    expect(page.recentMessages).toHaveLength(1);
    expect(page.recentMessages[0].channelName).toBe("general");
    expect(page.recentActivity.map((item) => item.kind)).toContain("group_message");
    expect(page.roleSummary.owner).toBe(1);
    expect(html).toContain("<title>Fox Local · OpenFox metaWorld</title>");
    expect(html).toContain("Identity, presence, memberships, activity");
    expect(html).toContain("Fox Page Launch");
  });
});
