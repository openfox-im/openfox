import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
  requestToJoinGroup,
} from "../group/store.js";
import { publishWorldPresence } from "../metaworld/presence.js";
import {
  buildMetaWorldShellHtml,
  buildMetaWorldShellSnapshot,
} from "../metaworld/shell.js";

const ADMIN_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;
const APPLICANT_PRIVATE_KEY =
  "0x8b3a350cf5c34c9194ca3a9d8b8e1b2a4f1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-shell-test-"));
  return path.join(tmpDir, "test.db");
}

function makeConfig(walletAddress: `0x${string}`): OpenFoxConfig {
  return {
    name: "Shell Fox",
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
    agentId: "shell-fox",
    agentDiscovery: {
      enabled: true,
      publishCard: false,
      cardTtlSeconds: 3600,
      displayName: "Shell Fox",
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
    },
  };
}

describe("metaWorld shell", () => {
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

  it("builds a world shell snapshot and html surface from local metaWorld state", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const applicant = privateKeyToAccount(APPLICANT_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Shell Group",
        description: "A world shell group.",
        actorAddress: admin.address,
        actorAgentId: "shell-fox",
        creatorDisplayName: "Shell Fox",
        visibility: "listed",
      },
    });

    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Shell Launch",
        bodyText: "The metaWorld shell should render this announcement.",
        actorAddress: admin.address,
      },
    });
    await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "Posting into the world shell.",
        actorAddress: admin.address,
        actorAgentId: "shell-fox",
      },
    });
    await requestToJoinGroup({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        actorAddress: applicant.address,
        actorAgentId: "applicant-fox",
        requestedRoles: ["member"],
        message: "Requesting entry into the Shell Group.",
      },
    });

    publishWorldPresence({
      db,
      actorAddress: admin.address,
      agentId: "shell-fox",
      displayName: "Shell Fox",
      status: "online",
      ttlSeconds: 300,
    });
    publishWorldPresence({
      db,
      actorAddress: applicant.address,
      agentId: "applicant-fox",
      displayName: "Applicant Fox",
      status: "recently_active",
      ttlSeconds: 300,
      sourceKind: "peer",
    });

    const snapshot = buildMetaWorldShellSnapshot({
      db,
      config,
      feedLimit: 12,
      notificationLimit: 10,
      boardLimit: 8,
      directoryLimit: 10,
      groupPageLimit: 4,
    });
    const html = buildMetaWorldShellHtml(snapshot);

    expect(snapshot.fox.displayName).toBe("Shell Fox");
    expect(snapshot.activeGroups).toHaveLength(1);
    expect(snapshot.activeGroups[0].group.name).toBe("Shell Group");
    expect(snapshot.notifications.unreadCount).toBe(1);
    expect(snapshot.notifications.items[0].kind).toBe("group_join_request_pending");
    expect(
      snapshot.directories.foxes.items.some(
        (item) => item.displayName === "Applicant Fox",
      ),
    ).toBe(true);
    expect(snapshot.directories.groups.items[0].name).toBe("Shell Group");
    expect(html).toContain("<title>OpenFox metaWorld</title>");
    expect(html).toContain("Shell Fox");
    expect(html).toContain("Shell Group");
    expect(html).toContain("Join request pending approval");
    expect(html).toContain("World Feed");
  });
});
