import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
  requestToJoinGroup,
  approveGroupJoinRequest,
} from "../group/store.js";
import {
  followFox,
  unfollowFox,
  followGroup,
  unfollowGroup,
  listFollowedFoxes,
  listFollowedGroups,
  listFoxFollowers,
  getFollowCounts,
  isFollowing,
} from "../metaworld/follows.js";
import {
  subscribeToFeed,
  unsubscribe,
  listSubscriptions,
  getSubscriptionMatches,
} from "../metaworld/subscriptions.js";
import {
  searchWorld,
  buildSearchResultSnapshot,
} from "../metaworld/search.js";
import {
  buildPersonalizedFeedSnapshot,
  buildRecommendedFoxes,
  buildRecommendedGroups,
} from "../metaworld/ranking.js";
import type {
  BountyRecord,
  OpenFoxConfig,
  OpenFoxDatabase,
} from "../types.js";

const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const FOX_B_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;
const FOX_C_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-world-social-test-"),
  );
  return path.join(tmpDir, "test.db");
}

function makeConfig(walletAddress: string): OpenFoxConfig {
  return {
    name: "test-fox",
    genesisPrompt: "",
    creatorAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    registeredRemotely: false,
    sandboxId: "test",
    inferenceModel: "test",
    maxTokensPerTurn: 1000,
    heartbeatConfigPath: "",
    dbPath: "",
    logLevel: "error",
    walletAddress: walletAddress.toLowerCase() as `0x${string}`,
    version: "0.0.0",
    skillsDir: "",
    maxChildren: 0,
  };
}

describe("world social: follows", () => {
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

  it("follows and unfollows a fox", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);

    const record = followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });
    expect(record.followKind).toBe("fox");
    expect(record.targetAddress).toBe(foxB.address.toLowerCase());
    expect(record.followerAddress).toBe(admin.address.toLowerCase());

    expect(isFollowing(db, admin.address, foxB.address)).toBe(true);
    expect(isFollowing(db, foxB.address, admin.address)).toBe(false);

    const followers = listFoxFollowers(db, foxB.address);
    expect(followers.length).toBe(1);
    expect(followers[0].followerAddress).toBe(admin.address.toLowerCase());

    const removed = unfollowFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });
    expect(removed).toBe(true);
    expect(isFollowing(db, admin.address, foxB.address)).toBe(false);
  });

  it("follows and unfollows a group", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Follow Test Group",
        actorAddress: admin.address,
      },
    });

    const record = followGroup(db, {
      followerAddress: admin.address,
      groupId: created.group.groupId,
    });
    expect(record.followKind).toBe("group");
    expect(record.targetGroupId).toBe(created.group.groupId);

    const groups = listFollowedGroups(db, admin.address);
    expect(groups.length).toBe(1);

    const removed = unfollowGroup(db, {
      followerAddress: admin.address,
      groupId: created.group.groupId,
    });
    expect(removed).toBe(true);

    const groupsAfter = listFollowedGroups(db, admin.address);
    expect(groupsAfter.length).toBe(0);
  });

  it("returns correct follow counts", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);
    const foxC = privateKeyToAccount(FOX_C_PRIVATE_KEY);

    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });
    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxC.address,
    });
    followFox(db, {
      followerAddress: foxB.address,
      targetAddress: admin.address,
    });
    followGroup(db, {
      followerAddress: admin.address,
      groupId: "group-123",
    });

    const counts = getFollowCounts(db, admin.address);
    expect(counts.followingFoxes).toBe(2);
    expect(counts.followingGroups).toBe(1);
    expect(counts.followers).toBe(1);
  });

  it("prevents following yourself", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    expect(() =>
      followFox(db, {
        followerAddress: admin.address,
        targetAddress: admin.address,
      }),
    ).toThrow("cannot follow yourself");
  });

  it("is idempotent on duplicate follow", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);

    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });
    // Second follow should not throw
    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });

    const foxes = listFollowedFoxes(db, admin.address);
    expect(foxes.length).toBe(1);
  });
});

describe("world social: subscriptions", () => {
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

  it("creates and lists subscriptions", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    const sub = subscribeToFeed(db, {
      address: admin.address,
      feedKind: "group",
      targetId: "group-123",
      notifyOn: ["announcement", "message"],
    });
    expect(sub.subscriptionId).toBeTruthy();
    expect(sub.feedKind).toBe("group");
    expect(sub.notifyOn).toEqual(["announcement", "message"]);

    const subs = listSubscriptions(db, admin.address);
    expect(subs.length).toBe(1);
    expect(subs[0].subscriptionId).toBe(sub.subscriptionId);
  });

  it("filters subscriptions by feed kind", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    subscribeToFeed(db, {
      address: admin.address,
      feedKind: "group",
      targetId: "group-1",
      notifyOn: ["announcement"],
    });
    subscribeToFeed(db, {
      address: admin.address,
      feedKind: "fox",
      targetId: "0xaaaa",
      notifyOn: ["bounty"],
    });

    const groupSubs = listSubscriptions(db, admin.address, {
      feedKind: "group",
    });
    expect(groupSubs.length).toBe(1);
    expect(groupSubs[0].feedKind).toBe("group");

    const foxSubs = listSubscriptions(db, admin.address, {
      feedKind: "fox",
    });
    expect(foxSubs.length).toBe(1);
    expect(foxSubs[0].feedKind).toBe("fox");
  });

  it("matches subscriptions by event kind", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    subscribeToFeed(db, {
      address: admin.address,
      feedKind: "group",
      targetId: "group-1",
      notifyOn: ["announcement", "message"],
    });
    subscribeToFeed(db, {
      address: admin.address,
      feedKind: "fox",
      targetId: "0xaaaa",
      notifyOn: ["bounty"],
    });

    const announcementMatches = getSubscriptionMatches(
      db,
      admin.address,
      "announcement",
    );
    expect(announcementMatches.length).toBe(1);

    const bountyMatches = getSubscriptionMatches(
      db,
      admin.address,
      "bounty",
    );
    expect(bountyMatches.length).toBe(1);

    const settlementMatches = getSubscriptionMatches(
      db,
      admin.address,
      "settlement",
    );
    expect(settlementMatches.length).toBe(0);
  });

  it("unsubscribes by id", () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    const sub = subscribeToFeed(db, {
      address: admin.address,
      feedKind: "group",
      targetId: "group-1",
      notifyOn: ["announcement"],
    });

    const removed = unsubscribe(db, sub.subscriptionId);
    expect(removed).toBe(true);

    const subs = listSubscriptions(db, admin.address);
    expect(subs.length).toBe(0);
  });
});

describe("world social: search", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let config: OpenFoxConfig;

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    config = makeConfig(admin.address);

    // Create a group to be searchable
    await createGroup({
      db,
      account: admin,
      input: {
        name: "Quantum Research Lab",
        description: "Research group for quantum computing",
        actorAddress: admin.address,
        tags: ["quantum", "research", "computing"],
      },
    });

    // Create a bounty to be searchable
    db.insertBounty({
      bountyId: "bounty-search-1",
      hostAgentId: "host-1",
      hostAddress: admin.address.toLowerCase() as `0x${string}`,
      kind: "question",
      title: "Quantum entanglement proof",
      taskPrompt: "Prove quantum entanglement for state X",
      referenceOutput: "canonical",
      rewardWei: "1000",
      submissionDeadline: "2030-01-02T00:00:00.000Z",
      judgeMode: "local_model",
      status: "open",
      createdAt: "2030-01-01T00:00:01.000Z",
      updatedAt: "2030-01-01T00:00:01.000Z",
    } satisfies BountyRecord);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("searches groups by name", () => {
    const results = searchWorld(db, config, "quantum", {
      kinds: ["group"],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].kind).toBe("group");
    expect(results[0].title).toContain("Quantum");
  });

  it("searches board items by title", () => {
    const results = searchWorld(db, config, "entanglement", {
      kinds: ["board_item"],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].kind).toBe("board_item");
    expect(results[0].title).toContain("entanglement");
  });

  it("ranks exact matches higher than contains", () => {
    const results = searchWorld(db, config, "Quantum Research Lab");
    const groupResult = results.find((r) => r.kind === "group");
    expect(groupResult).toBeDefined();
    expect(groupResult!.relevanceScore).toBeGreaterThanOrEqual(80);
  });

  it("returns empty results for non-matching query", () => {
    const results = searchWorld(db, config, "xyznonexistent123");
    expect(results.length).toBe(0);
  });

  it("builds a search result snapshot", () => {
    const snapshot = buildSearchResultSnapshot(db, config, "quantum");
    expect(snapshot.query).toBe("quantum");
    expect(snapshot.results.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary).toContain("quantum");
  });
});

describe("world social: personalized feed ranking", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let config: OpenFoxConfig;

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);
    config = makeConfig(admin.address);

    // Create a group
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Ranking Group",
        actorAddress: admin.address,
      },
    });

    // Join foxB to the group
    const joinReq = await requestToJoinGroup({
      db,
      account: foxB,
      input: {
        groupId: created.group.groupId,
        actorAddress: foxB.address,
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        requestId: joinReq.request.requestId,
        actorAddress: admin.address,
      },
    });

    // Post a message from foxB
    await postGroupMessage({
      db,
      account: foxB,
      input: {
        groupId: created.group.groupId,
        text: "Message from foxB in ranking group",
        actorAddress: foxB.address,
      },
    });

    // Post an announcement
    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Ranking announcement",
        bodyText: "Important ranking test announcement",
        actorAddress: admin.address,
      },
    });

    // Follow foxB
    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("builds a personalized feed with boost scores", () => {
    const snapshot = buildPersonalizedFeedSnapshot(db, config, { limit: 20 });
    expect(snapshot.items.length).toBeGreaterThanOrEqual(1);
    // Items should have boost scores
    for (const item of snapshot.items) {
      expect(item.boostScore).toBeGreaterThan(0);
    }
  });

  it("ranks followed fox items higher", () => {
    const snapshot = buildPersonalizedFeedSnapshot(db, config, { limit: 20 });
    const followedItems = snapshot.items.filter((item) =>
      item.boostReasons.includes("followed_fox"),
    );
    const unfollowedItems = snapshot.items.filter(
      (item) => !item.boostReasons.includes("followed_fox") && !item.boostReasons.includes("joined_group"),
    );

    if (followedItems.length > 0 && unfollowedItems.length > 0) {
      // On average, followed items should have higher boost
      const avgFollowed =
        followedItems.reduce((sum, item) => sum + item.boostScore, 0) /
        followedItems.length;
      const avgUnfollowed =
        unfollowedItems.reduce((sum, item) => sum + item.boostScore, 0) /
        unfollowedItems.length;
      expect(avgFollowed).toBeGreaterThan(avgUnfollowed);
    }
  });

  it("includes joined_group boost reason for items from joined groups", () => {
    const snapshot = buildPersonalizedFeedSnapshot(db, config, { limit: 20 });
    const joinedGroupItems = snapshot.items.filter((item) =>
      item.boostReasons.includes("joined_group"),
    );
    expect(joinedGroupItems.length).toBeGreaterThanOrEqual(1);
  });
});

describe("world social: recommendations", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let config: OpenFoxConfig;

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);
    const foxC = privateKeyToAccount(FOX_C_PRIVATE_KEY);
    config = makeConfig(admin.address);

    // Create two groups
    const group1 = await createGroup({
      db,
      account: admin,
      input: {
        name: "Shared Group",
        actorAddress: admin.address,
        tags: ["ai", "research"],
      },
    });
    const group2 = await createGroup({
      db,
      account: admin,
      input: {
        name: "Recommendation Group",
        actorAddress: admin.address,
        tags: ["ai", "ml"],
      },
    });

    // FoxB joins group1
    const joinReqB = await requestToJoinGroup({
      db,
      account: foxB,
      input: {
        groupId: group1.group.groupId,
        actorAddress: foxB.address,
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: group1.group.groupId,
        requestId: joinReqB.request.requestId,
        actorAddress: admin.address,
      },
    });

    // FoxC joins both groups
    const joinReqC1 = await requestToJoinGroup({
      db,
      account: foxC,
      input: {
        groupId: group1.group.groupId,
        actorAddress: foxC.address,
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: group1.group.groupId,
        requestId: joinReqC1.request.requestId,
        actorAddress: admin.address,
      },
    });

    const joinReqC2 = await requestToJoinGroup({
      db,
      account: foxC,
      input: {
        groupId: group2.group.groupId,
        actorAddress: foxC.address,
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: group2.group.groupId,
        requestId: joinReqC2.request.requestId,
        actorAddress: admin.address,
      },
    });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("recommends foxes based on shared groups", () => {
    const snapshot = buildRecommendedFoxes(db, config, { limit: 10 });
    expect(snapshot.items.length).toBeGreaterThanOrEqual(1);
    // FoxB and FoxC share groups with admin
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);
    const addresses = snapshot.items.map((f) => f.address);
    expect(addresses).toContain(foxB.address.toLowerCase());
  });

  it("does not recommend already-followed foxes", () => {
    const foxB = privateKeyToAccount(FOX_B_PRIVATE_KEY);
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxB.address,
    });

    const snapshot = buildRecommendedFoxes(db, config, { limit: 10 });
    const addresses = snapshot.items.map((f) => f.address);
    expect(addresses).not.toContain(foxB.address.toLowerCase());
  });

  it("recommends groups based on tag overlap", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);

    // Create a third group that shares tags but admin has not joined
    const group3 = await createGroup({
      db,
      account: admin,
      input: {
        name: "AI Ethics Group",
        actorAddress: admin.address,
        tags: ["ai", "ethics"],
      },
    });

    // Admin needs to NOT be in group3 for it to be recommended.
    // But createGroup auto-adds the creator. So let's create a new group
    // with foxC as creator that shares tags.
    const foxC = privateKeyToAccount(FOX_C_PRIVATE_KEY);
    const group4 = await createGroup({
      db,
      account: foxC,
      input: {
        name: "Deep Learning Hub",
        actorAddress: foxC.address,
        tags: ["ai", "deep-learning"],
      },
    });

    // Follow foxC so the group gets recommended via followed members
    followFox(db, {
      followerAddress: admin.address,
      targetAddress: foxC.address,
    });

    const snapshot = buildRecommendedGroups(db, config, { limit: 10 });
    // group4 should be recommended (tag overlap + followed member)
    const groupIds = snapshot.items.map((g) => g.groupId);
    expect(groupIds).toContain(group4.group.groupId);
  });
});
