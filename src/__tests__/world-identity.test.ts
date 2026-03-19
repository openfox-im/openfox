import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import { createGroup } from "../group/store.js";
import {
  buildFoxPublicProfile,
  publishFoxProfile,
  resolveFoxPublicProfile,
  updateFoxProfileFieldForAddress,
  buildFoxReputationSummary,
  buildGroupPublicProfile,
  publishGroupProfile,
  resolveGroupPublicProfile,
  buildGroupReputationSummary,
  getFoxProfileRow,
} from "../metaworld/identity.js";
import { buildFoxProfile } from "../metaworld/profile.js";
import {
  buildWorldFoxDirectorySnapshot,
} from "../metaworld/directory.js";

const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-world-identity-test-"),
  );
  return path.join(tmpDir, "test.db");
}

function makeConfig(walletAddress: `0x${string}`): OpenFoxConfig {
  return {
    name: "Test Fox",
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
    logLevel: "error",
    walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentId: "test-fox-agent",
    agentDiscovery: {
      enabled: true,
      publishCard: true,
      cardTtlSeconds: 3600,
      displayName: "Test Fox Display",
      endpoints: [],
      capabilities: [
        {
          name: "storage.put",
          mode: "paid",
          maxAmount: "1000000",
          rateLimit: "10/hour",
        },
      ],
      directoryNodeRecords: [],
    },
  };
}

describe("world identity", () => {
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

  // ─── Fox Public Profile ──────────────────────────────────────

  it("builds a fox public profile from config and stored data", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    const profile = buildFoxPublicProfile(db, config);

    expect(profile.address).toBe(admin.address.toLowerCase());
    expect(profile.displayName).toBe("Test Fox Display");
    expect(profile.bio).toBeNull();
    expect(profile.avatarUrl).toBeNull();
    expect(profile.tags).toEqual([]);
    expect(profile.socialLinks).toEqual([]);
    expect(profile.groupCount).toBe(0);
    expect(profile.publishedAt).toBeNull();
    expect(profile.reputationSummary).not.toBeNull();
  });

  it("updates individual fox profile fields that persist", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);
    const address = admin.address;

    updateFoxProfileFieldForAddress(db, address, "bio", "I am a test fox.");
    updateFoxProfileFieldForAddress(
      db,
      address,
      "avatar_url",
      "https://example.com/avatar.png",
    );
    updateFoxProfileFieldForAddress(
      db,
      address,
      "website_url",
      "https://example.com",
    );
    updateFoxProfileFieldForAddress(
      db,
      address,
      "tags",
      JSON.stringify(["oracle", "storage"]),
    );
    updateFoxProfileFieldForAddress(
      db,
      address,
      "social_links",
      JSON.stringify([{ platform: "twitter", url: "@testfox" }]),
    );

    const profile = buildFoxPublicProfile(db, config);
    expect(profile.bio).toBe("I am a test fox.");
    expect(profile.avatarUrl).toBe("https://example.com/avatar.png");
    expect(profile.websiteUrl).toBe("https://example.com");
    expect(profile.tags).toEqual(["oracle", "storage"]);
    expect(profile.socialLinks).toEqual([
      { platform: "twitter", url: "@testfox" },
    ]);
  });

  it("rejects unknown profile fields", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    expect(() =>
      updateFoxProfileFieldForAddress(db, admin.address, "hacker_field", "bad"),
    ).toThrow("Unknown profile field");
  });

  it("publishes and resolves a fox profile", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    updateFoxProfileFieldForAddress(db, admin.address, "bio", "A test bio.");

    const result = publishFoxProfile(db, config);
    expect(result.cid).toBeTruthy();
    expect(result.profile.bio).toBe("A test bio.");
    expect(result.profile.publishedAt).toBeTruthy();

    // Resolve the published profile
    const resolved = resolveFoxPublicProfile(admin.address, { db });
    expect(resolved).not.toBeNull();
    expect(resolved!.bio).toBe("A test bio.");
    expect(resolved!.address).toBe(admin.address.toLowerCase());
  });

  it("returns null for unresolvable fox profile", () => {
    const result = resolveFoxPublicProfile(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      { db },
    );
    expect(result).toBeNull();
  });

  // ─── Fox Profile integration with buildFoxProfile ────────────

  it("includes publishedProfile in buildFoxProfile when profile data exists", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    updateFoxProfileFieldForAddress(db, admin.address, "bio", "My bio text.");
    updateFoxProfileFieldForAddress(
      db,
      admin.address,
      "tags",
      JSON.stringify(["ai", "agent"]),
    );

    const foxProfile = buildFoxProfile({ db, config });
    expect(foxProfile.publishedProfile).not.toBeNull();
    expect(foxProfile.publishedProfile!.bio).toBe("My bio text.");
    expect(foxProfile.publishedProfile!.tags).toEqual(["ai", "agent"]);
  });

  // ─── Fox Reputation Summary ──────────────────────────────────

  it("builds a fox reputation summary with default values", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const summary = buildFoxReputationSummary(db, admin.address);

    expect(summary.jobsCompleted).toBe(0);
    expect(summary.bountiesWon).toBe(0);
    expect(summary.reportsFiled).toBe(0);
    expect(summary.warningsReceived).toBe(0);
    expect(summary.uptimePercentage).toBe(0);
    expect(summary.paymentReliabilityScore).toBe(100); // no settlements = 100% reliable
  });

  // ─── Group Public Profile ────────────────────────────────────

  it("builds a group public profile", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Identity Test Group",
        description: "A group for testing identity profiles.",
        visibility: "public",
        actorAddress: admin.address,
        tags: ["test", "identity"],
      },
    });

    const profile = buildGroupPublicProfile(db, created.group.groupId);
    expect(profile.groupId).toBe(created.group.groupId);
    expect(profile.name).toBe("Identity Test Group");
    expect(profile.description).toBe(
      "A group for testing identity profiles.",
    );
    expect(profile.visibility).toBe("public");
    expect(profile.tags).toEqual(["test", "identity"]);
    expect(profile.memberCount).toBeGreaterThanOrEqual(1);
    expect(profile.reputationSummary).not.toBeNull();
    expect(profile.publishedAt).toBeNull();
  });

  it("publishes and resolves a group profile", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Publish Test Group",
        description: "Group publish test.",
        visibility: "listed",
        actorAddress: admin.address,
        tags: ["publish"],
      },
    });

    const result = publishGroupProfile(db, created.group.groupId);
    expect(result.cid).toBeTruthy();
    expect(result.profile.name).toBe("Publish Test Group");
    expect(result.profile.publishedAt).toBeTruthy();

    const resolved = resolveGroupPublicProfile(created.group.groupId, { db });
    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe("Publish Test Group");
    expect(resolved!.groupId).toBe(created.group.groupId);
  });

  it("throws when building group profile for non-existent group", () => {
    expect(() => buildGroupPublicProfile(db, "nonexistent-group")).toThrow(
      "group not found",
    );
  });

  // ─── Group Reputation Summary ────────────────────────────────

  it("builds a group reputation summary", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Rep Test Group",
        description: "Reputation test.",
        visibility: "public",
        actorAddress: admin.address,
        tags: [],
      },
    });

    const summary = buildGroupReputationSummary(db, created.group.groupId);
    expect(summary.memberCount).toBeGreaterThanOrEqual(1);
    expect(summary.activeMemberCount).toBeGreaterThanOrEqual(1);
    expect(summary.messageVolume).toBe(0);
    expect(summary.artifactsPublished).toBe(0);
    expect(summary.settlementsCompleted).toBe(0);
  });

  // ─── Profile field persistence ───────────────────────────────

  it("profile field updates persist across reads", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    updateFoxProfileFieldForAddress(db, admin.address, "bio", "First bio.");
    let row = getFoxProfileRow(db, admin.address);
    expect(row?.bio).toBe("First bio.");

    updateFoxProfileFieldForAddress(db, admin.address, "bio", "Updated bio.");
    row = getFoxProfileRow(db, admin.address);
    expect(row?.bio).toBe("Updated bio.");
  });

  // ─── Directory integration ───────────────────────────────────

  it("directory snapshot shows published profile metadata", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address);

    // Create a group so the admin appears in the directory
    await createGroup({
      db,
      account: admin,
      input: {
        name: "Dir Test Group",
        description: "Directory integration test.",
        visibility: "public",
        actorAddress: admin.address,
        tags: [],
      },
    });

    // Set profile fields
    updateFoxProfileFieldForAddress(
      db,
      admin.address,
      "bio",
      "Directory test bio.",
    );
    updateFoxProfileFieldForAddress(
      db,
      admin.address,
      "avatar_url",
      "https://example.com/avatar.png",
    );
    updateFoxProfileFieldForAddress(
      db,
      admin.address,
      "tags",
      JSON.stringify(["directory-test"]),
    );

    const snapshot = buildWorldFoxDirectorySnapshot(db, config);
    expect(snapshot.items.length).toBeGreaterThan(0);

    const entry = snapshot.items.find(
      (item) => item.address === admin.address.toLowerCase(),
    );
    expect(entry).toBeDefined();
    expect(entry!.bio).toBe("Directory test bio.");
    expect(entry!.avatarUrl).toBe("https://example.com/avatar.png");
    expect(entry!.tags).toEqual(["directory-test"]);
  });
});
