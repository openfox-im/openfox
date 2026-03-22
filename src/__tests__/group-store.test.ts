import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  acceptGroupInvite,
  approveGroupJoinRequest,
  createGroup,
  createGroupChannel,
  banGroupMember,
  editGroupMessage,
  getGroupDetail,
  leaveGroup,
  listGroupAnnouncements,
  listGroupChannels,
  listGroupEvents,
  listGroupJoinRequests,
  listGroupMessages,
  listGroupMembers,
  listGroups,
  listGroupProposals,
  muteGroupMember,
  postGroupAnnouncement,
  postGroupMessage,
  reactGroupMessage,
  redactGroupMessage,
  removeGroupMember,
  requestToJoinGroup,
  sendGroupInvite,
  unbanGroupMember,
  unmuteGroupMember,
  withdrawGroupJoinRequest,
} from "../group/store.js";
import type { OpenFoxDatabase } from "../types.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const SECOND_PRIVATE_KEY =
  "0xdf96edbc954f43d46dc80e0180291bb781ac0a8a3a69c785631d4193e9a9d5e723456789abcdef0123456789" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-group-test-"));
  return path.join(tmpDir, "test.db");
}

describe("Group Store", () => {
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

  it("creates group tables in the schema", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    expect(names).toContain("groups");
    expect(names).toContain("group_events");
    expect(names).toContain("group_members");
    expect(names).toContain("group_channels");
    expect(names).toContain("group_announcements");
  });

  it("creates a group with default channels, creator membership, and events", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Alpha Hunters",
        description: "Find high-signal opportunities",
        actorAddress: account.address,
        actorAgentId: "fox-alpha",
        creatorDisplayName: "Alpha",
      },
    });

    expect(created.group.name).toBe("Alpha Hunters");
    expect(created.group.visibility).toBe("listed");
    expect(created.group.joinMode).toBe("request_approval");
    expect(created.channels.map((channel) => channel.name)).toEqual([
      "announcements",
      "general",
    ]);

    const members = listGroupMembers(db, created.group.groupId);
    expect(members).toHaveLength(1);
    expect(members[0].memberAddress).toBe(account.address.toLowerCase());
    expect(members[0].roles).toEqual(["admin", "member", "owner"]);

    const events = listGroupEvents(db, created.group.groupId, 10);
    expect(events.map((event) => event.kind)).toEqual([
      "channel.created",
      "channel.created",
      "group.created",
    ]);

    const detail = getGroupDetail(db, created.group.groupId);
    expect(detail?.group.groupId).toBe(created.group.groupId);
    expect(detail?.channels).toHaveLength(2);
  });

  it("creates additional channels and appends channel.created events", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Fox Research",
        actorAddress: account.address,
      },
    });

    const result = await createGroupChannel({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        name: "research-lab",
        description: "Deep research threads",
        actorAddress: account.address,
      },
    });

    expect(result.channel.name).toBe("research-lab");

    const channels = listGroupChannels(db, created.group.groupId);
    expect(channels.map((channel) => channel.name)).toContain("research-lab");

    const latestEvent = listGroupEvents(db, created.group.groupId, 1)[0];
    expect(latestEvent.kind).toBe("channel.created");
    expect(latestEvent.channelId).toBe(result.channel.channelId);
  });

  it("posts and pins announcements", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Fox Community",
        actorAddress: account.address,
      },
    });

    const posted = await postGroupAnnouncement({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        title: "Week 1 Focus",
        bodyText: "Prioritize oracle work and sponsored execution.",
        pin: true,
        actorAddress: account.address,
      },
    });

    expect(posted.announcement.pinned).toBe(true);
    expect(posted.events.map((event) => event.kind)).toEqual([
      "announcement.posted",
      "announcement.pinned",
    ]);

    const announcements = listGroupAnnouncements(db, created.group.groupId, 10);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].title).toBe("Week 1 Focus");
    expect(announcements[0].pinned).toBe(true);

    const groupRow = listGroups(db, 1)[0];
    expect(groupRow.pinnedAnnouncementId).toBe(posted.announcement.announcementId);
  });

  it("sends and accepts an invite, then commits membership", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const invitee = privateKeyToAccount(SECOND_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Network",
        actorAddress: admin.address,
      },
    });

    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: invitee.address,
        targetAgentId: "fox-beta",
        targetRoles: ["member", "scout"],
        reason: "Join the scouting rotation",
        actorAddress: admin.address,
      },
    });

    expect(invite.proposal.status).toBe("open");
    expect(listGroupProposals(db, created.group.groupId, { proposalKind: "invite" })).toHaveLength(1);

    const accepted = await acceptGroupInvite({
      db,
      account: invitee,
      input: {
        groupId: created.group.groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: invitee.address,
        actorAgentId: "fox-beta",
        displayName: "Beta",
      },
    });

    expect(accepted.proposal.status).toBe("committed");
    expect(accepted.member.memberAddress).toBe(invitee.address.toLowerCase());
    expect(accepted.member.roles).toEqual(["member", "scout"]);

    const group = getGroupDetail(db, created.group.groupId)?.group;
    expect(group?.currentEpoch).toBe(2);
    expect(listGroupMembers(db, created.group.groupId)).toHaveLength(2);
  });

  it("supports member leave and admin removal flows", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const invitee = privateKeyToAccount(SECOND_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Ops",
        actorAddress: admin.address,
      },
    });

    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: invitee.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: invitee,
      input: {
        groupId: created.group.groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: invitee.address,
      },
    });

    const left = await leaveGroup({
      db,
      account: invitee,
      input: {
        groupId: created.group.groupId,
        actorAddress: invitee.address,
      },
    });
    expect(left.member.membershipState).toBe("left");

    const reinvite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: invitee.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: invitee,
      input: {
        groupId: created.group.groupId,
        proposalId: reinvite.proposal.proposalId,
        actorAddress: invitee.address,
      },
    });

    const removed = await removeGroupMember({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: invitee.address,
        reason: "No longer active",
        actorAddress: admin.address,
      },
    });
    expect(removed.member.membershipState).toBe("removed");
  });

  it("supports group message post, reply, edit, react, and redact", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Fox Chat",
        actorAddress: account.address,
      },
    });

    const first = await postGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        text: "I found three oracle jobs.",
        actorAddress: account.address,
      },
    });
    const reply = await postGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        channelName: "general",
        replyToMessageId: first.message.messageId,
        text: "Share the top one first.",
        actorAddress: account.address,
      },
    });
    const edited = await editGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        messageId: first.message.messageId,
        text: "I found two oracle jobs.",
        actorAddress: account.address,
      },
    });
    const reacted = await reactGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        messageId: first.message.messageId,
        reactionCode: "thumbs_up",
        actorAddress: account.address,
      },
    });
    const redacted = await redactGroupMessage({
      db,
      account,
      input: {
        groupId: created.group.groupId,
        messageId: reply.message.messageId,
        actorAddress: account.address,
      },
    });

    expect(first.event.kind).toBe("message.posted");
    expect(reply.event.kind).toBe("message.reply.posted");
    expect(edited.message.previewText).toBe("I found two oracle jobs.");
    expect(reacted.message.reactionSummary.thumbs_up).toBe(1);
    expect(redacted.message.redacted).toBe(true);

    const messages = listGroupMessages(db, created.group.groupId, { channelName: "general" });
    expect(messages).toHaveLength(2);
    expect(messages[0].messageId).toBe(first.message.messageId);
    expect(messages[1].replyToMessageId).toBe(first.message.messageId);
  });

  it("blocks muted members from posting until unmuted", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const memberAccount = privateKeyToAccount(SECOND_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Moderation",
        actorAddress: admin.address,
      },
    });

    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: memberAccount.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: memberAccount,
      input: {
        groupId: created.group.groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: memberAccount.address,
      },
    });

    const muted = await muteGroupMember({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: memberAccount.address,
        until: new Date(Date.now() + 60_000).toISOString(),
        reason: "cooldown",
        actorAddress: admin.address,
      },
    });
    expect(muted.member.muteUntil).not.toBeNull();

    await expect(
      postGroupMessage({
        db,
        account: memberAccount,
        input: {
          groupId: created.group.groupId,
          text: "Can anyone see this?",
          actorAddress: memberAccount.address,
        },
      }),
    ).rejects.toThrow(/muted/i);

    const unmuted = await unmuteGroupMember({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: memberAccount.address,
        actorAddress: admin.address,
      },
    });
    expect(unmuted.member.muteUntil).toBeNull();

    const posted = await postGroupMessage({
      db,
      account: memberAccount,
      input: {
        groupId: created.group.groupId,
        text: "I am back.",
        actorAddress: memberAccount.address,
      },
    });
    expect(posted.message.senderAddress).toBe(memberAccount.address.toLowerCase());
  });

  it("supports join request withdraw and admin approval flows", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const applicant = privateKeyToAccount(SECOND_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Join Board",
        actorAddress: admin.address,
      },
    });

    const requested = await requestToJoinGroup({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        requestedRoles: ["member", "observer"],
        message: "I want to help with oracle verification.",
        actorAddress: applicant.address,
      },
    });
    expect(requested.request.status).toBe("open");
    expect(listGroupJoinRequests(db, created.group.groupId)).toHaveLength(1);

    const withdrawn = await withdrawGroupJoinRequest({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        requestId: requested.request.requestId,
        actorAddress: applicant.address,
      },
    });
    expect(withdrawn.request.status).toBe("withdrawn");

    const secondRequest = await requestToJoinGroup({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        requestedRoles: ["member"],
        message: "Second attempt",
        actorAddress: applicant.address,
      },
    });
    const approved = await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        requestId: secondRequest.request.requestId,
        actorAddress: admin.address,
        displayName: "Applicant",
      },
    });

    expect(approved.request.status).toBe("committed");
    expect(approved.member.membershipState).toBe("active");
    expect(approved.member.roles).toEqual(["member"]);
    expect(getGroupDetail(db, created.group.groupId)?.group.currentEpoch).toBe(2);
  });

  it("supports ban and unban, and blocks banned members from rejoining", async () => {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const memberAccount = privateKeyToAccount(SECOND_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Fox Enforcement",
        actorAddress: admin.address,
      },
    });

    const invite = await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: memberAccount.address,
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: memberAccount,
      input: {
        groupId: created.group.groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: memberAccount.address,
      },
    });

    const banned = await banGroupMember({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: memberAccount.address,
        reason: "malicious behavior",
        actorAddress: admin.address,
      },
    });
    expect(banned.member.membershipState).toBe("banned");
    expect(getGroupDetail(db, created.group.groupId)?.group.currentEpoch).toBe(3);

    await expect(
      requestToJoinGroup({
        db,
        account: memberAccount,
        input: {
          groupId: created.group.groupId,
          requestedRoles: ["member"],
          actorAddress: memberAccount.address,
        },
      }),
    ).rejects.toThrow(/banned/i);

    await expect(
      sendGroupInvite({
        db,
        account: admin,
        input: {
          groupId: created.group.groupId,
          targetAddress: memberAccount.address,
          targetRoles: ["member"],
          actorAddress: admin.address,
        },
      }),
    ).rejects.toThrow(/banned/i);

    const unbanned = await unbanGroupMember({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: memberAccount.address,
        actorAddress: admin.address,
      },
    });
    expect(unbanned.member.membershipState).toBe("removed");

    const requestAfterUnban = await requestToJoinGroup({
      db,
      account: memberAccount,
      input: {
        groupId: created.group.groupId,
        requestedRoles: ["member"],
        actorAddress: memberAccount.address,
      },
    });
    expect(requestAfterUnban.request.status).toBe("open");
  });
});
