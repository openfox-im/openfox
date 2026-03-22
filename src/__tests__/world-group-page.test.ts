import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  requestToJoinGroup,
  approveGroupJoinRequest,
  postGroupAnnouncement,
  postGroupMessage,
  sendGroupInvite,
} from "../group/store.js";
import { publishWorldPresence } from "../metaworld/presence.js";
import {
  buildGroupPageHtml,
  buildGroupPageSnapshot,
} from "../metaworld/group-page.js";
import type { OpenFoxDatabase } from "../types.js";

const TOS = 10n ** 18n;
const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const MEMBER_PRIVATE_KEY =
  "0x80291bb781ac0a8a3a69c785631d4193e9a9d5e723456789abcdef0123456789" as const;
const APPLICANT_PRIVATE_KEY =
  "0x97b1c813eae702332ba3eaa1625f942c5472626d111111111111111111111111" as const;
const OUTSIDER_PRIVATE_KEY =
  "0x80291bb781ac0a8a3a69c785631d4193e9a9d5e7333333333333333333333333" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-group-page-test-"));
  return path.join(tmpDir, "test.db");
}

function makeHexPair(seed: string): { hash: `0x${string}`; txHash: `0x${string}` } {
  return {
    hash: (`0x${seed.repeat(64)}`.slice(0, 66)) as `0x${string}`,
    txHash: (`0x${(seed + seed.toUpperCase()).repeat(32)}`.slice(0, 66)) as `0x${string}`,
  };
}

function seedGroupEconomics(params: {
  db: OpenFoxDatabase;
  groupId: string;
  adminAddress: string;
  memberAddress: string;
  outsiderAddress: string;
}): void {
  const now = "2026-03-14T12:00:00.000Z";
  const later = "2026-03-14T12:10:00.000Z";
  const latest = "2026-03-14T12:20:00.000Z";
  const paidHashes = makeHexPair("a");
  const solverHashes = makeHexPair("b");

  params.db.insertCampaign({
    campaignId: "camp_group_budget",
    hostAgentId: "admin-fox",
    hostAddress: params.adminAddress,
    title: "Ops Budget",
    description: "Budget for group operations.",
    budgetTomi: (10n * TOS).toString(),
    maxOpenBounties: 8,
    allowedKinds: ["question"],
    metadata: {},
    status: "open",
    createdAt: now,
    updatedAt: latest,
  });

  params.db.insertBounty({
    bountyId: "bnt_group_open",
    campaignId: "camp_group_budget",
    hostAgentId: "admin-fox",
    hostAddress: params.adminAddress,
    kind: "question",
    title: "Open Research Task",
    taskPrompt: "Investigate one target.",
    referenceOutput: "Expected answer",
    rewardTomi: (1n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  params.db.insertBounty({
    bountyId: "bnt_group_approved",
    campaignId: "camp_group_budget",
    hostAgentId: "admin-fox",
    hostAddress: params.adminAddress,
    kind: "question",
    title: "Approved Translation Task",
    taskPrompt: "Translate one note.",
    referenceOutput: "Translated note",
    rewardTomi: (2n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "approved",
    createdAt: now,
    updatedAt: later,
  });
  params.db.insertBounty({
    bountyId: "bnt_group_paid",
    campaignId: "camp_group_budget",
    hostAgentId: "admin-fox",
    hostAddress: params.adminAddress,
    kind: "question",
    title: "Paid Labeling Task",
    taskPrompt: "Label one batch.",
    referenceOutput: "Labels",
    rewardTomi: (3n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "paid",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBountySubmission({
    submissionId: "sub_group_paid",
    bountyId: "bnt_group_paid",
    solverAgentId: "outsider-solver",
    solverAddress: params.outsiderAddress,
    submissionText: "Done",
    status: "accepted",
    submittedAt: later,
    updatedAt: latest,
  });
  params.db.upsertBountyResult({
    bountyId: "bnt_group_paid",
    winningSubmissionId: "sub_group_paid",
    decision: "accepted",
    confidence: 0.98,
    judgeReason: "Correct",
    payoutTxHash: paidHashes.txHash,
    createdAt: later,
    updatedAt: latest,
  });
  params.db.upsertSettlementReceipt({
    receiptId: "rcpt_group_paid",
    kind: "bounty",
    subjectId: "bnt_group_paid",
    receipt: {} as any,
    receiptHash: paidHashes.hash,
    payoutTxHash: paidHashes.txHash,
    createdAt: latest,
    updatedAt: latest,
  });

  params.db.insertBounty({
    bountyId: "bnt_solver_paid",
    hostAgentId: "outsider-host",
    hostAddress: params.outsiderAddress,
    kind: "question",
    title: "External Paid Solver Task",
    taskPrompt: "Solve an external problem.",
    referenceOutput: "Answer",
    rewardTomi: (4n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "paid",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBountySubmission({
    submissionId: "sub_solver_paid",
    bountyId: "bnt_solver_paid",
    solverAgentId: "member-fox",
    solverAddress: params.memberAddress,
    submissionText: "Solved",
    status: "accepted",
    submittedAt: later,
    updatedAt: latest,
  });
  params.db.upsertBountyResult({
    bountyId: "bnt_solver_paid",
    winningSubmissionId: "sub_solver_paid",
    decision: "accepted",
    confidence: 0.99,
    judgeReason: "Accepted",
    payoutTxHash: solverHashes.txHash,
    createdAt: later,
    updatedAt: latest,
  });
  params.db.upsertSettlementReceipt({
    receiptId: "rcpt_solver_paid",
    kind: "bounty",
    subjectId: "bnt_solver_paid",
    receipt: {} as any,
    receiptHash: solverHashes.hash,
    payoutTxHash: solverHashes.txHash,
    createdAt: latest,
    updatedAt: latest,
  });

  params.db.insertBounty({
    bountyId: "bnt_solver_pending",
    hostAgentId: "outsider-host",
    hostAddress: params.outsiderAddress,
    kind: "question",
    title: "External Pending Solver Task",
    taskPrompt: "Pending payout task.",
    referenceOutput: "Pending answer",
    rewardTomi: (5n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "approved",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBountySubmission({
    submissionId: "sub_solver_pending",
    bountyId: "bnt_solver_pending",
    solverAgentId: "member-fox",
    solverAddress: params.memberAddress,
    submissionText: "Pending reward",
    status: "accepted",
    submittedAt: later,
    updatedAt: latest,
  });
  params.db.upsertBountyResult({
    bountyId: "bnt_solver_pending",
    winningSubmissionId: "sub_solver_pending",
    decision: "accepted",
    confidence: 0.93,
    judgeReason: "Accepted but unpaid",
    payoutTxHash: null,
    createdAt: later,
    updatedAt: latest,
  });
}

describe("metaWorld group page", () => {
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

  it("builds a group page snapshot with members, messages, announcements, presence, and feed", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(MEMBER_PRIVATE_KEY);
    const applicant = privateKeyToAccount(APPLICANT_PRIVATE_KEY);
    const outsider = privateKeyToAccount(OUTSIDER_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Page Group",
        actorAddress: admin.address,
      },
    });

    const joinRequest = await requestToJoinGroup({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        actorAddress: member.address,
        actorAgentId: "member-fox",
        requestedRoles: ["member", "watcher"],
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
    await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: applicant.address,
        targetAgentId: "applicant-fox",
        targetRoles: ["member"],
        actorAddress: admin.address,
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
        message: "Requesting access to the governance test group.",
      },
    });
    seedGroupEconomics({
      db,
      groupId: created.group.groupId,
      adminAddress: admin.address,
      memberAddress: member.address,
      outsiderAddress: outsider.address,
    });

    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Page Launch",
        bodyText: "The group page should show this announcement.",
        actorAddress: admin.address,
      },
    });
    await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "First page message.",
        actorAddress: admin.address,
      },
    });
    publishWorldPresence({
      db,
      actorAddress: member.address,
      groupId: created.group.groupId,
      agentId: "member-fox",
      displayName: "Member Fox",
      status: "busy",
      ttlSeconds: 300,
    });

    const page = buildGroupPageSnapshot(db, {
      groupId: created.group.groupId,
      messageLimit: 10,
      announcementLimit: 10,
      eventLimit: 10,
      presenceLimit: 10,
      activityLimit: 10,
    });
    const html = buildGroupPageHtml(page);

    expect(page.group.name).toBe("Page Group");
    expect(page.stats.activeMemberCount).toBe(2);
    expect(page.channels.length).toBeGreaterThanOrEqual(2);
    expect(page.announcements).toHaveLength(1);
    expect(page.recentMessages).toHaveLength(1);
    expect(page.presence).toHaveLength(1);
    expect(page.presence[0].displayName).toBe("Member Fox");
    expect(page.roleSummary.owner).toBe(1);
    expect(page.roleSummary.watcher).toBe(1);
    expect(page.governance.counts.openProposalCount).toBe(1);
    expect(page.governance.counts.openJoinRequestCount).toBe(1);
    expect(page.treasury.counts.campaignCount).toBe(1);
    expect(page.treasury.counts.settlementCount).toBe(2);
    expect(page.treasury.totals.totalBudgetTomi).toBe((10n * TOS).toString());
    expect(page.treasury.totals.pendingPayablesTomi).toBe((2n * TOS).toString());
    expect(page.treasury.totals.pendingReceivablesTomi).toBe((5n * TOS).toString());
    expect(page.activityFeed.items.map((item) => item.kind)).toContain(
      "group_announcement",
    );
    expect(html).toContain("<title>Page Group · OpenFox metaWorld</title>");
    expect(html).toContain("Community snapshot for Page Group");
    expect(html).toContain("Page Launch");
    expect(html).toContain("Governance");
    expect(html).toContain("Open Join Requests");
    expect(html).toContain("Treasury &amp; Budget");
    expect(html).toContain("Settlement Trails");
  });
});
