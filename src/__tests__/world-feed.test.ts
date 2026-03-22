import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
} from "../group/store.js";
import { buildWorldFeedSnapshot, listWorldFeedItems } from "../metaworld/feed.js";
import { subscribeToFeed } from "../metaworld/subscriptions.js";
import type {
  ArtifactRecord,
  BountyRecord,
  OpenFoxDatabase,
  SettlementRecord,
} from "../types.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-feed-test-"));
  return path.join(tmpDir, "test.db");
}

describe("metaWorld feed", () => {
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

  it("builds a normalized local world feed from community and market activity", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Fox World",
        actorAddress: account.address,
      },
    });

    await postGroupAnnouncement({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        title: "Launch",
        bodyText: "Fox World is live.",
        actorAddress: account.address,
      },
    });
    await postGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        text: "First world message.",
        actorAddress: account.address,
      },
    });

    db.insertBounty({
      bountyId: "bounty-feed-1",
      hostAgentId: "host-1",
      hostAddress: account.address.toLowerCase() as `0x${string}`,
      kind: "question",
      title: "Answer a hard question",
      taskPrompt: "What is the best path?",
      referenceOutput: "canonical",
      rewardTomi: "1000",
      submissionDeadline: "2030-01-02T00:00:00.000Z",
      judgeMode: "local_model",
      status: "open",
      createdAt: "2030-01-01T00:00:01.000Z",
      updatedAt: "2030-01-01T00:00:01.000Z",
    } satisfies BountyRecord);

    db.upsertArtifact({
      artifactId: "artifact-feed-1",
      kind: "public_news.capture",
      title: "Proof bundle",
      leaseId: "lease-feed-1",
      cid: "bafyfeedartifact",
      bundleHash:
        "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d111111111111111111111111",
      providerBaseUrl: "https://artifacts.example.com",
      providerAddress:
        "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626daaaaaaaaaaaaaaaaaaaaaaaa",
      requesterAddress: account.address.toLowerCase() as `0x${string}`,
      status: "stored",
      createdAt: "2030-01-01T00:00:02.000Z",
      updatedAt: "2030-01-01T00:00:02.000Z",
    } satisfies ArtifactRecord);

    db.upsertSettlementReceipt({
      receiptId: "receipt-feed-1",
      kind: "bounty",
      subjectId: "bounty-feed-1",
      receipt: {} as any,
      receiptHash:
        "0x473302ca547d5f9877e272cffe58d4def43198b66ba35cff4b2e584be19efa05222222222222222222222222",
      createdAt: "2030-01-01T00:00:03.000Z",
      updatedAt: "2030-01-01T00:00:03.000Z",
    } satisfies SettlementRecord);

    const items = listWorldFeedItems(db, { limit: 20 });
    expect(items.map((item) => item.kind)).toContain("group_announcement");
    expect(items.map((item) => item.kind)).toContain("group_message");
    expect(items.map((item) => item.kind)).toContain("bounty_opened");
    expect(items.map((item) => item.kind)).toContain("artifact_published");
    expect(items.map((item) => item.kind)).toContain("settlement_completed");
    expect(items[0].kind).toBe("settlement_completed");

    const snapshot = buildWorldFeedSnapshot(db, { limit: 20 });
    expect(snapshot.summary).toContain("World feed");
    expect(snapshot.items.length).toBeGreaterThanOrEqual(5);
  });

  it("supports group-scoped feed views", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Scoped Group",
        actorAddress: account.address,
      },
    });
    await postGroupAnnouncement({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        title: "Scoped",
        bodyText: "Group-only feed item.",
        actorAddress: account.address,
      },
    });

    db.insertBounty({
      bountyId: "bounty-outside-scope",
      hostAgentId: "host-1",
      hostAddress: account.address.toLowerCase() as `0x${string}`,
      kind: "question",
      title: "Outside scope",
      taskPrompt: "ignored",
      referenceOutput: "ignored",
      rewardTomi: "1000",
      submissionDeadline: "2030-01-02T00:00:00.000Z",
      judgeMode: "local_model",
      status: "open",
      createdAt: "2030-01-01T00:00:01.000Z",
      updatedAt: "2030-01-01T00:00:01.000Z",
    } satisfies BountyRecord);

    const items = listWorldFeedItems(db, {
      groupId: created.group.groupId,
      limit: 20,
    });
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((item) => item.groupId === created.group.groupId)).toBe(true);
    expect(items.some((item) => item.kind === "bounty_opened")).toBe(false);
  });

  it("filters feed items by subscriptions when requested", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Subscribed Group",
        actorAddress: account.address,
      },
    });

    await postGroupAnnouncement({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        title: "Subscribed launch",
        bodyText: "This should stay visible.",
        actorAddress: account.address,
      },
    });
    await postGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        text: "Subscribed message.",
        actorAddress: account.address,
      },
    });

    db.insertBounty({
      bountyId: "bounty-feed-subscription",
      hostAgentId: "host-subscription",
      hostAddress: account.address.toLowerCase() as `0x${string}`,
      kind: "question",
      title: "Bounty that should be filtered",
      taskPrompt: "ignore me",
      referenceOutput: "canonical",
      rewardTomi: "1000",
      submissionDeadline: "2030-01-02T00:00:00.000Z",
      judgeMode: "local_model",
      status: "open",
      createdAt: "2030-01-01T00:00:04.000Z",
      updatedAt: "2030-01-01T00:00:04.000Z",
    } satisfies BountyRecord);

    subscribeToFeed(db, {
      address: account.address,
      feedKind: "group",
      targetId: created.group.groupId,
      notifyOn: ["announcement", "message"],
    });

    const snapshot = buildWorldFeedSnapshot(db, {
      limit: 20,
      subscriberAddress: account.address,
      subscribedOnly: true,
    });
    expect(snapshot.summary).toContain("matching subscriptions");
    expect(snapshot.items.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.items.every((item) => item.groupId === created.group.groupId)).toBe(true);
    expect(snapshot.items.some((item) => item.kind === "bounty_opened")).toBe(false);
  });
});
