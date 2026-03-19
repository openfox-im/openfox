import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  requestToJoinGroup,
  approveGroupJoinRequest,
} from "../group/store.js";
import { publishWorldPresence } from "../metaworld/presence.js";
import {
  buildWorldFoxDirectorySnapshot,
  buildWorldGroupDirectorySnapshot,
} from "../metaworld/directory.js";

const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const MEMBER_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-directory-test-"));
  return path.join(tmpDir, "test.db");
}

function makeConfig(walletAddress: `0x${string}`): OpenFoxConfig {
  return {
    name: "Local OpenFox",
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
    agentId: "admin-fox",
    agentDiscovery: {
      enabled: true,
      publishCard: true,
      cardTtlSeconds: 3600,
      displayName: "Admin Fox",
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
    },
  };
}

describe("metaWorld directory", () => {
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

  it("lists foxes and groups with query, tag, and role filters", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(MEMBER_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Oracle Lab",
        description: "Shared oracle and settlement work",
        visibility: "public",
        actorAddress: admin.address,
        tags: ["oracle", "research"],
      },
    });

    const joinRequest = await requestToJoinGroup({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        actorAddress: member.address,
        actorAgentId: "member-fox",
        requestedRoles: ["member", "solver"],
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        requestId: joinRequest.request.requestId,
        actorAddress: admin.address,
        displayName: "Member Fox",
      },
    });

    publishWorldPresence({
      db,
      actorAddress: member.address,
      agentId: "member-fox",
      displayName: "Member Fox",
      status: "online",
      ttlSeconds: 300,
    });

    const foxes = buildWorldFoxDirectorySnapshot(db, config, {
      query: "Member",
      role: "solver",
      limit: 10,
    });
    expect(foxes.items).toHaveLength(1);
    expect(foxes.items[0].displayName).toBe("Member Fox");
    expect(foxes.items[0].roles).toContain("solver");

    const groups = buildWorldGroupDirectorySnapshot(db, {
      visibility: "public",
      tag: "oracle",
      role: "solver",
      limit: 10,
    });
    expect(groups.items).toHaveLength(1);
    expect(groups.items[0].name).toBe("Oracle Lab");
    expect(groups.items[0].activeMemberCount).toBe(2);
    expect(groups.items[0].roleSummary.solver).toBe(1);
  });
});
