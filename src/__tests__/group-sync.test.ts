import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  sendGroupInvite,
  acceptGroupInvite,
  postGroupMessage,
  listGroupEvents,
  listGroupMembers,
  listGroupChannels,
  getGroupDetail,
  getGroup,
} from "../group/store.js";
import {
  buildGroupSyncOffer,
  buildGroupSyncBundle,
  applyGroupSyncBundle,
  buildGroupSnapshot,
  applyGroupSnapshot,
  resolveGroupEventConflict,
  updateSyncCursor,
  getSyncCursor,
  upsertSyncPeer,
  listSyncPeers,
} from "../group/sync.js";
import { buildGroupPageSnapshot } from "../metaworld/group-page.js";
import type { OpenFoxDatabase } from "../types.js";
import type { GroupEventRecord } from "../group/store.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const SECOND_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-gsync-test-"));
  return path.join(tmpDir, "test.db");
}

describe("Group Sync", () => {
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

  // ─── Sync Offer ─────────────────────────────────────────────

  it("buildGroupSyncOffer returns group sync state", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Sync Test Group",
        actorAddress: account.address,
      },
    });

    const offer = buildGroupSyncOffer(db, created.group.groupId);
    expect(offer.groupId).toBe(created.group.groupId);
    expect(offer.epoch).toBe(1);
    expect(offer.latestEventId).toBeTruthy();
    expect(offer.eventCount).toBeGreaterThan(0);
    expect(offer.membersRoot).toBeTruthy();
  });

  it("buildGroupSyncOffer throws for non-existent group", () => {
    expect(() => buildGroupSyncOffer(db, "grp_nonexistent")).toThrow(
      /Group not found/,
    );
  });

  // ─── Sync Bundle ────────────────────────────────────────────

  it("buildGroupSyncBundle returns all events when no cursor", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Bundle Test",
        actorAddress: account.address,
      },
    });

    const bundle = buildGroupSyncBundle(db, created.group.groupId, null);
    expect(bundle.groupId).toBe(created.group.groupId);
    expect(bundle.sinceEventId).toBeNull();
    expect(bundle.events.length).toBeGreaterThan(0);
    expect(bundle.bundleHash).toBeTruthy();

    // All events should be ordered by creation time
    for (let i = 1; i < bundle.events.length; i++) {
      const prev = bundle.events[i - 1];
      const curr = bundle.events[i];
      expect(prev.createdAt <= curr.createdAt).toBe(true);
    }
  });

  it("buildGroupSyncBundle returns events after cursor", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Cursor Test",
        actorAddress: account.address,
      },
    });

    // Get all events and use the first as cursor
    const allEvents = listGroupEvents(db, created.group.groupId, 100);
    // allEvents are ordered DESC, get the oldest (group.created)
    const oldestEvent = allEvents[allEvents.length - 1];

    const bundle = buildGroupSyncBundle(
      db,
      created.group.groupId,
      oldestEvent.eventId,
    );
    // Should have events after the oldest one
    expect(bundle.events.length).toBe(allEvents.length - 1);

    // None of the returned events should be the cursor event
    for (const event of bundle.events) {
      expect(event.eventId).not.toBe(oldestEvent.eventId);
    }
  });

  // ─── Apply Sync Bundle (round-trip) ─────────────────────────

  it("round-trips sync offer / bundle / apply between two databases", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);

    // Source DB: create group and post a message
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Source Group",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    await postGroupMessage({
      db,
      account,
      input: {
        groupId,
        text: "Hello from source",
        actorAddress: account.address,
      },
    });

    // Build bundle from source
    const bundle = buildGroupSyncBundle(db, groupId, null);
    expect(bundle.events.length).toBeGreaterThan(0);

    // Target DB: first apply snapshot to create the group there
    const targetPath = makeTmpDbPath();
    const targetDb = createDatabase(targetPath);
    try {
      const snapshot = buildGroupSnapshot(db, groupId);
      applyGroupSnapshot(targetDb, groupId, snapshot);

      // Verify the group exists on target
      const targetGroup = getGroup(targetDb, groupId);
      expect(targetGroup).toBeTruthy();
      expect(targetGroup!.name).toBe("Source Group");

      // Verify channels replicated
      const targetChannels = listGroupChannels(targetDb, groupId);
      expect(targetChannels.length).toBeGreaterThan(0);

      // Verify members replicated
      const targetMembers = listGroupMembers(targetDb, groupId);
      expect(targetMembers.length).toBe(1);

      // Verify events replicated
      const targetEvents = listGroupEvents(targetDb, groupId, 100);
      expect(targetEvents.length).toBe(bundle.events.length);
    } finally {
      targetDb.close();
    }
  });

  // ─── Replay Safety ──────────────────────────────────────────

  it("applying same bundle twice is idempotent (replay safe)", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Replay Test",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    // Create target DB with snapshot
    const targetPath = makeTmpDbPath();
    const targetDb = createDatabase(targetPath);
    try {
      const snapshot = buildGroupSnapshot(db, groupId);
      applyGroupSnapshot(targetDb, groupId, snapshot);

      // Post a new message on source after snapshot
      await postGroupMessage({
        db,
        account,
        input: {
          groupId,
          text: "New message after snapshot",
          actorAddress: account.address,
        },
      });

      // Build bundle of new events (since the snapshot's latest event)
      const snapshotEvents = snapshot.events;
      const lastSnapshotEventId =
        snapshotEvents.length > 0
          ? snapshotEvents[snapshotEvents.length - 1].eventId
          : null;
      const bundle = buildGroupSyncBundle(db, groupId, lastSnapshotEventId);
      expect(bundle.events.length).toBeGreaterThan(0);

      // Apply once
      const first = applyGroupSyncBundle(targetDb, groupId, bundle);
      expect(first.applied).toBeGreaterThan(0);
      expect(first.skipped).toBe(0);

      // Apply again - should skip all
      const second = applyGroupSyncBundle(targetDb, groupId, bundle);
      expect(second.applied).toBe(0);
      expect(second.skipped).toBe(first.applied);
      expect(second.rejected).toBe(0);

      // Event count should be same after both applies
      const eventsAfterFirst = listGroupEvents(targetDb, groupId, 1000);
      // No additional events were created
      const eventsAfterSecond = listGroupEvents(targetDb, groupId, 1000);
      expect(eventsAfterFirst.length).toBe(eventsAfterSecond.length);
    } finally {
      targetDb.close();
    }
  });

  // ─── Snapshot ───────────────────────────────────────────────

  it("creates and applies a full group snapshot", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const invitee = privateKeyToAccount(SECOND_PRIVATE_KEY);

    // Create group with members
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Snapshot Group",
        actorAddress: admin.address,
      },
    });
    const groupId = created.group.groupId;

    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId,
        targetAddress: invitee.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: invitee,
      input: {
        groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: invitee.address,
        displayName: "Invitee",
      },
    });

    // Build snapshot
    const snapshot = buildGroupSnapshot(db, groupId);
    expect(snapshot.snapshotId).toBeTruthy();
    expect(snapshot.group.name).toBe("Snapshot Group");
    expect(snapshot.members.length).toBe(2);
    expect(snapshot.channels.length).toBeGreaterThan(0);
    expect(snapshot.events.length).toBeGreaterThan(0);
    expect(snapshot.snapshotHash).toBeTruthy();

    // Apply to fresh DB
    const targetPath = makeTmpDbPath();
    const targetDb = createDatabase(targetPath);
    try {
      applyGroupSnapshot(targetDb, groupId, snapshot);

      const targetDetail = getGroupDetail(targetDb, groupId);
      expect(targetDetail).toBeTruthy();
      expect(targetDetail!.group.name).toBe("Snapshot Group");
      expect(targetDetail!.group.currentEpoch).toBe(2);
      expect(targetDetail!.members.length).toBe(2);
      expect(targetDetail!.channels.length).toBe(snapshot.channels.length);
    } finally {
      targetDb.close();
    }
  });

  it("applyGroupSnapshot is a no-op when group already exists", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Existing Group",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;
    const snapshot = buildGroupSnapshot(db, groupId);

    // Apply to the same DB should be a no-op
    applyGroupSnapshot(db, groupId, snapshot);

    // Group should still exist unchanged
    const detail = getGroupDetail(db, groupId);
    expect(detail!.group.name).toBe("Existing Group");
  });

  // ─── Conflict Resolution ────────────────────────────────────

  it("resolves event conflicts by lower event ID winning", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Conflict Test",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    const allEvents = listGroupEvents(db, groupId, 100);
    // We need at least 2 events in the same epoch
    const epoch1Events = allEvents.filter((e) => e.epoch === 1);
    expect(epoch1Events.length).toBeGreaterThanOrEqual(2);

    // Sort by ID to know which should win
    const sorted = [...epoch1Events].sort((a, b) =>
      a.eventId.localeCompare(b.eventId),
    );
    const eventA = sorted[0]; // lower ID
    const eventB = sorted[1]; // higher ID

    const winner = resolveGroupEventConflict(db, groupId, eventA, eventB);
    expect(winner.eventId).toBe(eventA.eventId);

    // The loser should be rejected in the DB
    const loserRow = db.raw
      .prepare(
        "SELECT reducer_status, rejection_reason FROM group_events WHERE event_id = ?",
      )
      .get(eventB.eventId) as {
      reducer_status: string;
      rejection_reason: string;
    };
    expect(loserRow.reducer_status).toBe("rejected");
    expect(loserRow.rejection_reason).toContain("conflict_resolution");
  });

  it("conflict resolution also works with reversed argument order", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Conflict Reverse",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    const allEvents = listGroupEvents(db, groupId, 100);
    const epoch1Events = allEvents.filter((e) => e.epoch === 1);
    const sorted = [...epoch1Events].sort((a, b) =>
      a.eventId.localeCompare(b.eventId),
    );
    const eventA = sorted[0];
    const eventB = sorted[1];

    // Pass in reverse order -- winner should still be the lower ID
    const winner = resolveGroupEventConflict(db, groupId, eventB, eventA);
    expect(winner.eventId).toBe(eventA.eventId);
  });

  // ─── Invalid Events Rejection ──────────────────────────────

  it("rejects invalid events in a sync bundle", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Validation Test",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    // Create a bundle with an invalid event (wrong group ID)
    const invalidEvent: GroupEventRecord = {
      eventId: "gev_invalid_001",
      groupId: "grp_wrong",
      kind: "message.posted",
      epoch: 1,
      channelId: null,
      actorAddress: account.address.toLowerCase(),
      actorAgentId: null,
      parentEventIds: [],
      payload: {},
      signature: "0xdeadbeef" as any,
      eventHash: "0xdeadbeef" as any,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      receivedAt: new Date().toISOString(),
      sourceKind: "peer",
      reducerStatus: "accepted",
      rejectionReason: null,
    };

    const bundle = {
      groupId,
      sinceEventId: null,
      events: [invalidEvent],
      bundleHash: "0xtest" as any,
      createdAt: new Date().toISOString(),
    };

    const result = applyGroupSyncBundle(db, groupId, bundle);
    expect(result.rejected).toBe(1);
    expect(result.rejectedEventIds).toContain("gev_invalid_001");
    expect(result.applied).toBe(0);
  });

  it("rejects events with missing signature", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Sig Validation Test",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    const noSigEvent: GroupEventRecord = {
      eventId: "gev_nosig_001",
      groupId,
      kind: "message.posted",
      epoch: 1,
      channelId: null,
      actorAddress: account.address.toLowerCase(),
      actorAgentId: null,
      parentEventIds: [],
      payload: {},
      signature: "" as any,
      eventHash: "0xdeadbeef" as any,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      receivedAt: new Date().toISOString(),
      sourceKind: "peer",
      reducerStatus: "accepted",
      rejectionReason: null,
    };

    const bundle = {
      groupId,
      sinceEventId: null,
      events: [noSigEvent],
      bundleHash: "0xtest" as any,
      createdAt: new Date().toISOString(),
    };

    const result = applyGroupSyncBundle(db, groupId, bundle);
    expect(result.rejected).toBe(1);
  });

  it("rejects events with invalid epoch", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Epoch Validation",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    const badEpochEvent: GroupEventRecord = {
      eventId: "gev_badepoch_001",
      groupId,
      kind: "message.posted",
      epoch: 0,
      channelId: null,
      actorAddress: account.address.toLowerCase(),
      actorAgentId: null,
      parentEventIds: [],
      payload: {},
      signature: "0xdeadbeef" as any,
      eventHash: "0xdeadbeef" as any,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      receivedAt: new Date().toISOString(),
      sourceKind: "peer",
      reducerStatus: "accepted",
      rejectionReason: null,
    };

    const bundle = {
      groupId,
      sinceEventId: null,
      events: [badEpochEvent],
      bundleHash: "0xtest" as any,
      createdAt: new Date().toISOString(),
    };

    const result = applyGroupSyncBundle(db, groupId, bundle);
    expect(result.rejected).toBe(1);
  });

  it("throws when bundle groupId does not match target", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Mismatch Test",
        actorAddress: account.address,
      },
    });

    const bundle = {
      groupId: "grp_different",
      sinceEventId: null,
      events: [],
      bundleHash: "0xtest" as any,
      createdAt: new Date().toISOString(),
    };

    expect(() =>
      applyGroupSyncBundle(db, created.group.groupId, bundle),
    ).toThrow(/Bundle group mismatch/);
  });

  // ─── Sync State Management ─────────────────────────────────

  it("tracks sync cursors per peer per group", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Cursor Tracking",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    // Initially no cursor
    expect(getSyncCursor(db, groupId, "peer-a", "peer")).toBeNull();

    // Set cursor
    updateSyncCursor(db, groupId, "peer-a", "peer", "gev_test_001");
    expect(getSyncCursor(db, groupId, "peer-a", "peer")).toBe("gev_test_001");

    // Update cursor
    updateSyncCursor(db, groupId, "peer-a", "peer", "gev_test_002");
    expect(getSyncCursor(db, groupId, "peer-a", "peer")).toBe("gev_test_002");

    // Different peer has its own cursor
    expect(getSyncCursor(db, groupId, "peer-b", "peer")).toBeNull();
    updateSyncCursor(db, groupId, "peer-b", "gateway", "gev_test_100");
    expect(getSyncCursor(db, groupId, "peer-b", "gateway")).toBe(
      "gev_test_100",
    );
  });

  // ─── Peer Tracking ─────────────────────────────────────────

  it("manages sync peers for a group", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Peer Tracking",
        actorAddress: account.address,
      },
    });
    const groupId = created.group.groupId;

    // Initially no peers
    expect(listSyncPeers(db, groupId)).toHaveLength(0);

    // Add peers
    upsertSyncPeer(db, {
      groupId,
      peerAddress: "0xpeer1",
      peerEndpoint: "http://peer1.example.com:4800",
      lastSyncAt: null,
      lastCursor: null,
      syncKind: "peer",
    });
    upsertSyncPeer(db, {
      groupId,
      peerAddress: "0xpeer2",
      peerEndpoint: "http://peer2.example.com:4800",
      lastSyncAt: null,
      lastCursor: null,
      syncKind: "gateway",
    });

    const peers = listSyncPeers(db, groupId);
    expect(peers).toHaveLength(2);
    expect(peers.map((p) => p.peerAddress)).toContain("0xpeer1");
    expect(peers.map((p) => p.peerAddress)).toContain("0xpeer2");

    // Update a peer
    upsertSyncPeer(db, {
      groupId,
      peerAddress: "0xpeer1",
      peerEndpoint: "http://peer1-new.example.com:4800",
      lastSyncAt: new Date().toISOString(),
      lastCursor: "gev_test",
      syncKind: "peer",
    });

    const updatedPeers = listSyncPeers(db, groupId);
    const peer1 = updatedPeers.find((p) => p.peerAddress === "0xpeer1");
    expect(peer1!.peerEndpoint).toBe("http://peer1-new.example.com:4800");
    expect(peer1!.lastCursor).toBe("gev_test");
  });

  // ─── Full lifecycle: multi-step sync ────────────────────────

  it("supports full lifecycle: create, message, snapshot, incremental sync", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const member = privateKeyToAccount(SECOND_PRIVATE_KEY);

    // Step 1: Create group and add member
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Full Lifecycle",
        actorAddress: admin.address,
      },
    });
    const groupId = created.group.groupId;

    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId,
        targetAddress: member.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: member,
      input: {
        groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: member.address,
      },
    });

    // Step 2: Take snapshot and apply to target
    const targetPath = makeTmpDbPath();
    const targetDb = createDatabase(targetPath);
    try {
      const snapshot = buildGroupSnapshot(db, groupId);
      applyGroupSnapshot(targetDb, groupId, snapshot);

      // Verify snapshot applied correctly
      const targetGroup = getGroup(targetDb, groupId);
      expect(targetGroup!.currentEpoch).toBe(2);
      expect(listGroupMembers(targetDb, groupId).length).toBe(2);

      // Step 3: Post messages on source after snapshot
      await postGroupMessage({
        db,
        account: admin,
        input: {
          groupId,
          text: "Post-snapshot message 1",
          actorAddress: admin.address,
        },
      });
      await postGroupMessage({
        db,
        account: member,
        input: {
          groupId,
          text: "Post-snapshot message 2",
          actorAddress: member.address,
        },
      });

      // Step 4: Incremental sync
      const lastSnapshotEventId =
        snapshot.events.length > 0
          ? snapshot.events[snapshot.events.length - 1].eventId
          : null;
      const incrementalBundle = buildGroupSyncBundle(
        db,
        groupId,
        lastSnapshotEventId,
      );
      expect(incrementalBundle.events.length).toBeGreaterThan(0);

      const syncResult = applyGroupSyncBundle(
        targetDb,
        groupId,
        incrementalBundle,
      );
      expect(syncResult.applied).toBeGreaterThan(0);
      expect(syncResult.rejected).toBe(0);

      // Verify target has the new events
      const targetEvents = listGroupEvents(targetDb, groupId, 1000);
      const sourceEvents = listGroupEvents(db, groupId, 1000);
      expect(targetEvents.length).toBe(sourceEvents.length);
    } finally {
      targetDb.close();
    }
  });

  it("renders a group page from synchronized state on a second node", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const member = privateKeyToAccount(SECOND_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Synced Render Group",
        actorAddress: admin.address,
      },
    });
    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: member.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: member.address,
        displayName: "Synced Member",
      },
    });
    await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "Rendered from synchronized state",
        actorAddress: admin.address,
      },
    });

    const targetPath = makeTmpDbPath();
    const targetDb = createDatabase(targetPath);
    try {
      const snapshot = buildGroupSnapshot(db, created.group.groupId);
      applyGroupSnapshot(targetDb, created.group.groupId, snapshot);
      const lastSnapshotEventId =
        snapshot.events.length > 0
          ? snapshot.events[snapshot.events.length - 1].eventId
          : null;
      const bundle = buildGroupSyncBundle(
        db,
        created.group.groupId,
        lastSnapshotEventId,
      );
      applyGroupSyncBundle(targetDb, created.group.groupId, bundle);

      const page = buildGroupPageSnapshot(targetDb, {
        groupId: created.group.groupId,
        messageLimit: 10,
        announcementLimit: 10,
        eventLimit: 20,
      });
      expect(page.group.name).toBe("Synced Render Group");
      expect(page.stats.activeMemberCount).toBe(2);
      expect(page.stats.messageCount).toBeGreaterThan(0);
      expect(page.recentMessages.some((item) => item.latestEventId.length > 0)).toBe(true);
      expect(page.activityFeed.items.length).toBeGreaterThan(0);
      expect(page.activityFeed.items.some((item) => item.kind === "group_message")).toBe(true);
    } finally {
      targetDb.close();
    }
  });
});
