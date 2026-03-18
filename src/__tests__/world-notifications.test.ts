import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  acceptGroupInvite,
  approveGroupJoinRequest,
  createGroup,
  muteGroupMember,
  postGroupAnnouncement,
  postGroupMessage,
  requestToJoinGroup,
  sendGroupInvite,
} from "../group/store.js";
import {
  buildWorldNotificationsSnapshot,
  dismissWorldNotification,
  listWorldNotifications,
  markWorldNotificationRead,
} from "../metaworld/notifications.js";
import { subscribeToFeed } from "../metaworld/subscriptions.js";
import type { OpenFoxDatabase } from "../types.js";

const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const MEMBER_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;
const APPLICANT_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-notifications-test-"));
  return path.join(tmpDir, "test.db");
}

describe("metaWorld notifications", () => {
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

  it("tracks read and dismissed state for targeted group invites", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const invitee = privateKeyToAccount(MEMBER_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Signals",
        actorAddress: admin.address,
      },
    });

    await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: invitee.address,
        targetRoles: ["member", "scout"],
        reason: "Join the alpha rotation",
        actorAddress: admin.address,
      },
    });

    const initial = listWorldNotifications(db, {
      actorAddress: invitee.address,
      limit: 20,
    });
    expect(initial).toHaveLength(1);
    expect(initial[0].kind).toBe("group_invite_received");
    expect(initial[0].readAt).toBeNull();

    const readState = markWorldNotificationRead(db, initial[0].notificationId);
    expect(readState.readAt).not.toBeNull();

    const afterRead = buildWorldNotificationsSnapshot(db, {
      actorAddress: invitee.address,
      limit: 20,
    });
    expect(afterRead.unreadCount).toBe(0);
    expect(afterRead.items[0].readAt).not.toBeNull();

    const dismissed = dismissWorldNotification(db, initial[0].notificationId);
    expect(dismissed.dismissedAt).not.toBeNull();

    const hidden = listWorldNotifications(db, {
      actorAddress: invitee.address,
      limit: 20,
    });
    expect(hidden).toHaveLength(0);

    const restored = listWorldNotifications(db, {
      actorAddress: invitee.address,
      limit: 20,
      includeDismissed: true,
    });
    expect(restored).toHaveLength(1);
    expect(restored[0].dismissedAt).not.toBeNull();
  });

  it("builds notifications for approvals, replies, announcements, and moderation", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(MEMBER_PRIVATE_KEY);
    const applicant = privateKeyToAccount(APPLICANT_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Community",
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
        actorAgentId: "member-fox",
        displayName: "Member Fox",
      },
    });

    const joinRequest = await requestToJoinGroup({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        actorAddress: applicant.address,
        actorAgentId: "applicant-fox",
        message: "I can help with settlement review.",
        requestedRoles: ["member", "watcher"],
      },
    });

    const seedMessage = await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "Post your best observations here.",
        actorAddress: admin.address,
      },
    });

    await postGroupMessage({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        text: "Replying with a fresh lead for @admin.",
        replyToMessageId: seedMessage.message.messageId,
        mentions: [admin.address],
        actorAddress: member.address,
      },
    });

    const adminNotifications = listWorldNotifications(db, {
      actorAddress: admin.address,
      limit: 20,
    });
    expect(adminNotifications.map((item) => item.kind)).toContain(
      "group_join_request_pending",
    );
    expect(adminNotifications.map((item) => item.kind)).toContain(
      "group_message_reply",
    );

    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        requestId: joinRequest.request.requestId,
        actorAddress: admin.address,
        displayName: "Applicant Fox",
      },
    });

    const applicantNotifications = listWorldNotifications(db, {
      actorAddress: applicant.address,
      limit: 20,
    });
    expect(applicantNotifications.map((item) => item.kind)).toContain(
      "group_join_request_approved",
    );

    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Community Focus",
        bodyText: "Prioritize artifacts and settlement reviews today.",
        actorAddress: admin.address,
      },
    });

    await muteGroupMember({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: member.address,
        until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        reason: "Cooldown after spam burst",
        actorAddress: admin.address,
      },
    });

    const memberSnapshot = buildWorldNotificationsSnapshot(db, {
      actorAddress: member.address,
      limit: 20,
    });
    expect(memberSnapshot.items.map((item) => item.kind)).toContain(
      "group_announcement_posted",
    );
    expect(memberSnapshot.items.map((item) => item.kind)).toContain(
      "group_moderation_notice",
    );
  });

  it("filters notifications by subscriptions while keeping direct action items", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(MEMBER_PRIVATE_KEY);
    const applicant = privateKeyToAccount(APPLICANT_PRIVATE_KEY);
    const outsider = privateKeyToAccount(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Subscribed Notifications",
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
        displayName: "Subscribed Member",
      },
    });

    const coAdminInvite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: applicant.address,
        targetRoles: ["admin"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        proposalId: coAdminInvite.proposal.proposalId,
        actorAddress: applicant.address,
        displayName: "Co Admin",
      },
    });

    await requestToJoinGroup({
      db,
      account: outsider,
      input: {
        groupId: created.group.groupId,
        actorAddress: outsider.address,
        message: "Let me in.",
      },
    });

    const seedMessage = await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "Seed message",
        actorAddress: admin.address,
      },
    });
    await postGroupMessage({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        text: "Reply that should be filtered out",
        replyToMessageId: seedMessage.message.messageId,
        actorAddress: member.address,
      },
    });
    await postGroupAnnouncement({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        title: "Subscribed announcement",
        bodyText: "This should remain after filtering.",
        actorAddress: applicant.address,
      },
    });

    subscribeToFeed(db, {
      address: admin.address,
      feedKind: "group",
      targetId: created.group.groupId,
      notifyOn: ["announcement"],
    });

    const snapshot = buildWorldNotificationsSnapshot(db, {
      actorAddress: admin.address,
      limit: 20,
      subscribedOnly: true,
    });
    expect(snapshot.summary).toContain("matching subscriptions");
    expect(snapshot.items.map((item) => item.kind)).toContain(
      "group_join_request_pending",
    );
    expect(snapshot.items.map((item) => item.kind)).toContain(
      "group_announcement_posted",
    );
    expect(snapshot.items.map((item) => item.kind)).not.toContain(
      "group_message_reply",
    );
  });
});
