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
  listGroupMembers,
} from "../group/store.js";
import {
  issueGroupWarning,
  listGroupWarnings,
  getGroupWarningCount,
  reportGroupMessage,
  reportGroupMember,
  listGroupReports,
  resolveGroupReport,
  appealGroupAction,
  listGroupAppeals,
  resolveGroupAppeal,
  checkGroupRateLimit,
  setGroupRateLimitConfig,
  isGroupContentFiltered,
} from "../group/moderation.js";
import type { OpenFoxDatabase } from "../types.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const SECOND_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-mod-test-"));
  return path.join(tmpDir, "test.db");
}

describe("Group Moderation", () => {
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

  async function createTestGroupWithMember() {
    const admin = privateKeyToAccount(TEST_PRIVATE_KEY);
    const member = privateKeyToAccount(SECOND_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Moderation Test Group",
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
      },
    });
    return { admin, member, groupId: created.group.groupId };
  }

  // ─── Warnings ────────────────────────────────────────────────

  it("issues a warning and lists it", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const result = await issueGroupWarning(db, {
      groupId,
      targetAddress: member.address,
      issuerAddress: admin.address,
      reason: "Off-topic posting",
      severity: "mild",
    });

    expect(result.warning.severity).toBe("mild");
    expect(result.warning.reason).toBe("Off-topic posting");
    expect(result.warning.groupId).toBe(groupId);
    expect(result.warning.targetAddress).toBe(member.address.toLowerCase());
    expect(result.escalationAction).toBeNull();

    const warnings = listGroupWarnings(db, groupId);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].warningId).toBe(result.warning.warningId);

    const count = getGroupWarningCount(db, groupId, member.address);
    expect(count).toBe(1);
  });

  it("lists warnings filtered by target address", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    await issueGroupWarning(db, {
      groupId,
      targetAddress: member.address,
      issuerAddress: admin.address,
      reason: "First warning",
    });
    await issueGroupWarning(db, {
      groupId,
      targetAddress: member.address,
      issuerAddress: admin.address,
      reason: "Second warning",
    });

    const filtered = listGroupWarnings(db, groupId, {
      targetAddress: member.address,
    });
    expect(filtered).toHaveLength(2);

    const byAdmin = listGroupWarnings(db, groupId, {
      targetAddress: admin.address,
    });
    expect(byAdmin).toHaveLength(0);
  });

  it("auto-escalates on 3 mild warnings to auto-mute", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const w1 = await issueGroupWarning(
      db,
      {
        groupId,
        targetAddress: member.address,
        issuerAddress: admin.address,
        reason: "Warning 1",
        severity: "mild",
      },
      admin,
    );
    expect(w1.escalationAction).toBeNull();

    const w2 = await issueGroupWarning(
      db,
      {
        groupId,
        targetAddress: member.address,
        issuerAddress: admin.address,
        reason: "Warning 2",
        severity: "mild",
      },
      admin,
    );
    expect(w2.escalationAction).toBeNull();

    const w3 = await issueGroupWarning(
      db,
      {
        groupId,
        targetAddress: member.address,
        issuerAddress: admin.address,
        reason: "Warning 3",
        severity: "mild",
      },
      admin,
    );
    expect(w3.escalationAction).toBe("auto_mute_1h");

    // Member should now be muted
    const members = listGroupMembers(db, groupId);
    const targetMember = members.find(
      (m) => m.memberAddress === member.address.toLowerCase(),
    );
    expect(targetMember?.muteUntil).not.toBeNull();
  });

  it("auto-escalates on 2 moderate warnings to auto-mute 24h", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const w1 = await issueGroupWarning(
      db,
      {
        groupId,
        targetAddress: member.address,
        issuerAddress: admin.address,
        reason: "Moderate warning 1",
        severity: "moderate",
      },
      admin,
    );
    expect(w1.escalationAction).toBeNull();

    const w2 = await issueGroupWarning(
      db,
      {
        groupId,
        targetAddress: member.address,
        issuerAddress: admin.address,
        reason: "Moderate warning 2",
        severity: "moderate",
      },
      admin,
    );
    expect(w2.escalationAction).toBe("auto_mute_24h");
  });

  it("auto-escalates on severe warning to auto-ban", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const w1 = await issueGroupWarning(
      db,
      {
        groupId,
        targetAddress: member.address,
        issuerAddress: admin.address,
        reason: "Severe violation",
        severity: "severe",
      },
      admin,
    );
    expect(w1.escalationAction).toBe("auto_ban");

    // Member should now be banned
    const members = listGroupMembers(db, groupId);
    const targetMember = members.find(
      (m) => m.memberAddress === member.address.toLowerCase(),
    );
    expect(targetMember?.membershipState).toBe("banned");
  });

  // ─── Reports ─────────────────────────────────────────────────

  it("reports a message and lists reports", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const msg = await postGroupMessage({
      db,
      account: member,
      input: {
        groupId,
        text: "This is spam!",
        actorAddress: member.address,
      },
    });

    const report = reportGroupMessage(db, {
      groupId,
      messageId: msg.message.messageId,
      reporterAddress: admin.address,
      reason: "Spammy content",
      category: "spam",
    });

    expect(report.status).toBe("open");
    expect(report.category).toBe("spam");
    expect(report.messageId).toBe(msg.message.messageId);
    expect(report.targetAddress).toBe(member.address.toLowerCase());

    const reports = listGroupReports(db, groupId);
    expect(reports).toHaveLength(1);
    expect(reports[0].reportId).toBe(report.reportId);

    const openReports = listGroupReports(db, groupId, { status: "open" });
    expect(openReports).toHaveLength(1);
  });

  it("reports a group member", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const report = reportGroupMember(db, {
      groupId,
      targetAddress: member.address,
      reporterAddress: admin.address,
      reason: "Harassing other members",
      category: "harassment",
    });

    expect(report.status).toBe("open");
    expect(report.category).toBe("harassment");
    expect(report.targetAddress).toBe(member.address.toLowerCase());
    expect(report.messageId).toBeNull();
  });

  it("resolves a report with dismiss", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const report = reportGroupMember(db, {
      groupId,
      targetAddress: member.address,
      reporterAddress: admin.address,
      reason: "Test report",
      category: "other",
    });

    const resolved = await resolveGroupReport(db, report.reportId, {
      resolverAddress: admin.address,
      resolution: "dismiss",
      note: "Not a real issue",
    });

    expect(resolved.status).toBe("dismissed");
    expect(resolved.resolution).toBe("dismiss");
    expect(resolved.resolutionNote).toBe("Not a real issue");
    expect(resolved.resolvedAt).not.toBeNull();

    const openReports = listGroupReports(db, groupId, { status: "open" });
    expect(openReports).toHaveLength(0);

    const dismissedReports = listGroupReports(db, groupId, {
      status: "dismissed",
    });
    expect(dismissedReports).toHaveLength(1);
  });

  it("resolves a report with ban action", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const report = reportGroupMember(db, {
      groupId,
      targetAddress: member.address,
      reporterAddress: admin.address,
      reason: "Illegal content",
      category: "illegal",
    });

    const resolved = await resolveGroupReport(
      db,
      report.reportId,
      {
        resolverAddress: admin.address,
        resolution: "ban",
        note: "Confirmed illegal content",
      },
      admin,
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toBe("ban");

    // Member should be banned
    const members = listGroupMembers(db, groupId);
    const targetMember = members.find(
      (m) => m.memberAddress === member.address.toLowerCase(),
    );
    expect(targetMember?.membershipState).toBe("banned");
  });

  it("rejects resolving an already resolved report", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const report = reportGroupMember(db, {
      groupId,
      targetAddress: member.address,
      reporterAddress: admin.address,
      reason: "Test",
      category: "other",
    });

    await resolveGroupReport(db, report.reportId, {
      resolverAddress: admin.address,
      resolution: "dismiss",
    });

    await expect(
      resolveGroupReport(db, report.reportId, {
        resolverAddress: admin.address,
        resolution: "dismiss",
      }),
    ).rejects.toThrow(/already/i);
  });

  // ─── Appeals ─────────────────────────────────────────────────

  it("creates an appeal and lists appeals", async () => {
    const { member, groupId } = await createTestGroupWithMember();

    const appeal = appealGroupAction(db, {
      groupId,
      appealerAddress: member.address,
      actionKind: "mute",
      reason: "I was unfairly muted",
    });

    expect(appeal.status).toBe("pending");
    expect(appeal.actionKind).toBe("mute");
    expect(appeal.reason).toBe("I was unfairly muted");

    const appeals = listGroupAppeals(db, groupId);
    expect(appeals).toHaveLength(1);
    expect(appeals[0].appealId).toBe(appeal.appealId);

    const pendingAppeals = listGroupAppeals(db, groupId, {
      status: "pending",
    });
    expect(pendingAppeals).toHaveLength(1);
  });

  it("approves an appeal for a mute and reverses the action", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    // First mute the member
    await import("../group/store.js").then((mod) =>
      mod.muteGroupMember({
        db,
        account: admin,
        input: {
          groupId,
          targetAddress: member.address,
          until: new Date(Date.now() + 60_000).toISOString(),
          reason: "cooldown",
          actorAddress: admin.address,
        },
      }),
    );

    // Member appeals
    const appeal = appealGroupAction(db, {
      groupId,
      appealerAddress: member.address,
      actionKind: "mute",
      reason: "It was a misunderstanding",
    });

    // Admin approves the appeal
    const resolved = await resolveGroupAppeal(
      db,
      appeal.appealId,
      {
        resolverAddress: admin.address,
        decision: "approved",
        note: "Agreed, it was a misunderstanding",
      },
      admin,
    );

    expect(resolved.status).toBe("approved");
    expect(resolved.decision).toBe("approved");
    expect(resolved.resolutionNote).toBe("Agreed, it was a misunderstanding");

    // Member should be unmuted
    const members = listGroupMembers(db, groupId);
    const targetMember = members.find(
      (m) => m.memberAddress === member.address.toLowerCase(),
    );
    expect(targetMember?.muteUntil).toBeNull();
  });

  it("rejects an appeal", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const appeal = appealGroupAction(db, {
      groupId,
      appealerAddress: member.address,
      actionKind: "ban",
      reason: "Please reconsider",
    });

    const resolved = await resolveGroupAppeal(db, appeal.appealId, {
      resolverAddress: admin.address,
      decision: "rejected",
      note: "Violation was clear",
    });

    expect(resolved.status).toBe("rejected");
    expect(resolved.decision).toBe("rejected");
  });

  it("rejects resolving an already resolved appeal", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    const appeal = appealGroupAction(db, {
      groupId,
      appealerAddress: member.address,
      actionKind: "warning",
      reason: "Unfair warning",
    });

    await resolveGroupAppeal(db, appeal.appealId, {
      resolverAddress: admin.address,
      decision: "rejected",
    });

    await expect(
      resolveGroupAppeal(db, appeal.appealId, {
        resolverAddress: admin.address,
        decision: "approved",
      }),
    ).rejects.toThrow(/already/i);
  });

  // ─── Rate Limiting ──────────────────────────────────────────

  it("checks rate limits with default config", async () => {
    const { member, groupId } = await createTestGroupWithMember();

    const result = checkGroupRateLimit(db, groupId, member.address);
    expect(result.limited).toBe(false);
    expect(result.messagesInLastMinute).toBe(0);
    expect(result.messagesInLastHour).toBe(0);
  });

  it("configures and applies custom rate limits", async () => {
    const { admin, member, groupId } = await createTestGroupWithMember();

    // Set very low limits for testing
    const config = setGroupRateLimitConfig(db, groupId, {
      maxPerMinute: 2,
      maxPerHour: 5,
    });
    expect(config.maxPerMinute).toBe(2);
    expect(config.maxPerHour).toBe(5);

    // Post some messages
    await postGroupMessage({
      db,
      account: member,
      input: { groupId, text: "Message 1", actorAddress: member.address },
    });
    await postGroupMessage({
      db,
      account: member,
      input: { groupId, text: "Message 2", actorAddress: member.address },
    });

    // Now check rate limit - should be limited
    const result = checkGroupRateLimit(db, groupId, member.address);
    expect(result.limited).toBe(true);
    expect(result.reason).toContain("minute");
    expect(result.messagesInLastMinute).toBe(2);
  });

  it("updates existing rate limit config", async () => {
    const { groupId } = await createTestGroupWithMember();

    setGroupRateLimitConfig(db, groupId, { maxPerMinute: 5 });
    const updated = setGroupRateLimitConfig(db, groupId, {
      maxPerMinute: 20,
      maxPerHour: 200,
    });
    expect(updated.maxPerMinute).toBe(20);
    expect(updated.maxPerHour).toBe(200);
  });

  // ─── Content Filtering ──────────────────────────────────────

  it("filters repeated characters", () => {
    expect(isGroupContentFiltered("aaaaaaaaaa")).toBe(true);
    expect(isGroupContentFiltered("hello world")).toBe(false);
  });

  it("filters excessive caps", () => {
    expect(isGroupContentFiltered("THIS IS ALL CAPS MESSAGE HERE")).toBe(true);
    expect(isGroupContentFiltered("This Is A Normal Message")).toBe(false);
    // Short messages should not be filtered for caps
    expect(isGroupContentFiltered("OK")).toBe(false);
  });

  it("filters link spam", () => {
    const linkSpam =
      "Check out https://a.com https://b.com https://c.com https://d.com https://e.com";
    expect(isGroupContentFiltered(linkSpam)).toBe(true);
    expect(isGroupContentFiltered("Check https://example.com")).toBe(false);
  });

  it("does not filter empty or normal content", () => {
    expect(isGroupContentFiltered("")).toBe(false);
    expect(isGroupContentFiltered("Hello, how is everyone?")).toBe(false);
    expect(isGroupContentFiltered("  ")).toBe(false);
  });
});
