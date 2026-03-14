import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import { createGroup, listGroupMembers } from "../group/store.js";
import {
  createGovernanceProposal,
  voteOnProposal,
  resolveProposalIfReady,
  executeApprovedProposal,
  buildGovernanceV2Snapshot,
  expireStaleProposals,
  getGovernancePolicy,
  setGovernancePolicy,
  listGovernanceProposals,
  getGovernanceProposal,
  getGovernanceProposalWithVotes,
} from "../group/governance.js";
import type { OpenFoxDatabase } from "../types.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const SECOND_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;
const THIRD_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-gov-test-"));
  return path.join(tmpDir, "test.db");
}

describe("Group Governance v2", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let groupId: string;
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const account2 = privateKeyToAccount(SECOND_PRIVATE_KEY);
  const account3 = privateKeyToAccount(THIRD_PRIVATE_KEY);

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);

    // Create a group with the test account as owner
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Governance Test Group",
        description: "Testing governance proposals",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Test Fox",
      },
    });
    groupId = created.group.groupId;
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("creates a proposal with valid role", async () => {
    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "policy_change",
      title: "Change visibility to public",
      description: "We should be public",
      params: { updates: { visibility: "public" } },
      proposerAddress: account.address,
      proposerAgentId: "fox-test",
    });

    expect(proposal.proposalId).toMatch(/^gprop_/);
    expect(proposal.groupId).toBe(groupId);
    expect(proposal.proposalType).toBe("policy_change");
    expect(proposal.title).toBe("Change visibility to public");
    expect(proposal.status).toBe("active");
    expect(proposal.votesApprove).toBe(0);
    expect(proposal.votesReject).toBe(0);
    expect(proposal.votesTotal).toBe(0);
  });

  it("throws when proposer lacks required role", async () => {
    // account2 is not a member of the group
    await expect(
      createGovernanceProposal(db, {
        account: account2,
        groupId,
        proposalType: "policy_change",
        title: "Unauthorized proposal",
        proposerAddress: account2.address,
      }),
    ).rejects.toThrow(/does not have a required role/);
  });

  it("vote approve increments count", async () => {
    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Fund project",
      proposerAddress: account.address,
    });

    // Set quorum high so it doesn't auto-resolve
    setGovernancePolicy(db, groupId, "spend", { quorum: 5 });

    const result = await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
      reason: "Looks good",
    });

    expect(result.vote.vote).toBe("approve");
    expect(result.proposal.votesApprove).toBe(1);
    expect(result.proposal.votesTotal).toBe(1);
  });

  it("throws on duplicate vote", async () => {
    setGovernancePolicy(db, groupId, "spend", { quorum: 5 });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Duplicate vote test",
      proposerAddress: account.address,
    });

    await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
    });

    await expect(
      voteOnProposal(db, {
        account,
        proposalId: proposal.proposalId,
        voterAddress: account.address,
        vote: "reject",
      }),
    ).rejects.toThrow(/already voted/);
  });

  it("auto-resolves to approved when quorum + threshold met", async () => {
    // Set policy: quorum=1, threshold 1/2 (50%)
    setGovernancePolicy(db, groupId, "config_change", {
      quorum: 1,
      thresholdNumerator: 1,
      thresholdDenominator: 2,
    });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "config_change",
      title: "Auto approve test",
      proposerAddress: account.address,
    });

    const result = await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
    });

    expect(result.proposal.status).toBe("approved");
    expect(result.proposal.votesApprove).toBe(1);
    expect(result.proposal.resolvedEventId).toBeTruthy();
  });

  it("auto-resolves to rejected when threshold impossible", async () => {
    // There is only 1 eligible voter (the owner), quorum=1, threshold 2/3
    // If the only voter rejects, approval is impossible
    setGovernancePolicy(db, groupId, "spend", {
      quorum: 1,
      thresholdNumerator: 2,
      thresholdDenominator: 3,
    });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Rejection test",
      proposerAddress: account.address,
    });

    const result = await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "reject",
    });

    expect(result.proposal.status).toBe("rejected");
  });

  it("resolves to expired when past expiry", async () => {
    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Expiry test",
      proposerAddress: account.address,
      durationHours: 0, // Falls back to policy default, but let's force expiry
    });

    // Manually set expiry to the past
    db.raw
      .prepare(
        `UPDATE group_governance_proposals SET expires_at = ? WHERE proposal_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", proposal.proposalId);

    const result = await resolveProposalIfReady(db, {
      account,
      proposalId: proposal.proposalId,
      actorAddress: account.address,
    });

    expect(result.status).toBe("expired");
  });

  it("executes approved member_action proposal", async () => {
    setGovernancePolicy(db, groupId, "member_action", {
      quorum: 1,
      thresholdNumerator: 1,
      thresholdDenominator: 2,
    });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "member_action",
      title: "Mute spammer",
      params: { action: "mute", targetAddress: "0xspammer" },
      proposerAddress: account.address,
    });

    await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
    });

    const executed = await executeApprovedProposal(db, {
      account,
      proposalId: proposal.proposalId,
      actorAddress: account.address,
    });

    expect(executed.status).toBe("executed");
    expect(executed.executionResult).toBeTruthy();
    expect(executed.executionResult!.action).toBe("mute");
    expect(executed.executedEventId).toBeTruthy();
  });

  it("throws when executing non-approved proposal", async () => {
    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Not approved yet",
      proposerAddress: account.address,
    });

    await expect(
      executeApprovedProposal(db, {
        account,
        proposalId: proposal.proposalId,
        actorAddress: account.address,
      }),
    ).rejects.toThrow(/not approved/);
  });

  it("governance snapshot includes active and recent proposals", async () => {
    setGovernancePolicy(db, groupId, "spend", {
      quorum: 1,
      thresholdNumerator: 1,
      thresholdDenominator: 2,
    });

    // Create an active proposal
    await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Active proposal",
      proposerAddress: account.address,
    });

    // Create and approve another proposal
    const p2 = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "config_change",
      title: "Approved proposal",
      proposerAddress: account.address,
    });

    setGovernancePolicy(db, groupId, "config_change", {
      quorum: 1,
      thresholdNumerator: 1,
      thresholdDenominator: 2,
    });

    await voteOnProposal(db, {
      account,
      proposalId: p2.proposalId,
      voterAddress: account.address,
      vote: "approve",
    });

    const snapshot = buildGovernanceV2Snapshot(db, groupId);

    expect(snapshot.groupId).toBe(groupId);
    expect(snapshot.activeProposals.length).toBe(1);
    expect(snapshot.activeProposals[0].title).toBe("Active proposal");
    expect(snapshot.recentOutcomes.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.totalProposals).toBeGreaterThanOrEqual(2);
    expect(snapshot.totalApproved).toBeGreaterThanOrEqual(1);
  });

  it("getGovernanceProposalWithVotes returns proposal and votes", async () => {
    setGovernancePolicy(db, groupId, "spend", { quorum: 5 });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Detailed proposal",
      proposerAddress: account.address,
    });

    await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
      reason: "I agree",
    });

    const detail = getGovernanceProposalWithVotes(db, proposal.proposalId);
    expect(detail).toBeTruthy();
    expect(detail!.proposal.proposalId).toBe(proposal.proposalId);
    expect(detail!.votes).toHaveLength(1);
    expect(detail!.votes[0].vote).toBe("approve");
    expect(detail!.votes[0].reason).toBe("I agree");
  });

  it("listGovernanceProposals filters by status", async () => {
    setGovernancePolicy(db, groupId, "spend", { quorum: 5 });

    await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Proposal A",
      proposerAddress: account.address,
    });

    const all = listGovernanceProposals(db, groupId);
    expect(all.length).toBeGreaterThanOrEqual(1);

    const active = listGovernanceProposals(db, groupId, "active");
    expect(active.length).toBeGreaterThanOrEqual(1);

    const approved = listGovernanceProposals(db, groupId, "approved");
    expect(approved.length).toBe(0);
  });

  it("getGovernancePolicy returns defaults when no policy set", () => {
    const policy = getGovernancePolicy(db, groupId, "spend");
    expect(policy.quorum).toBe(1);
    expect(policy.thresholdNumerator).toBe(2);
    expect(policy.thresholdDenominator).toBe(3);
    expect(policy.allowedProposerRoles).toEqual(["owner", "admin"]);
    expect(policy.allowedVoterRoles).toEqual(["owner", "admin"]);
    expect(policy.defaultDurationHours).toBe(168);
  });

  it("setGovernancePolicy persists and returns updated policy", () => {
    const updated = setGovernancePolicy(db, groupId, "spend", {
      quorum: 3,
      thresholdNumerator: 3,
      thresholdDenominator: 4,
      allowedProposerRoles: ["owner"],
      defaultDurationHours: 24,
    });

    expect(updated.quorum).toBe(3);
    expect(updated.thresholdNumerator).toBe(3);
    expect(updated.thresholdDenominator).toBe(4);
    expect(updated.allowedProposerRoles).toEqual(["owner"]);
    expect(updated.defaultDurationHours).toBe(24);

    // Verify persistence
    const read = getGovernancePolicy(db, groupId, "spend");
    expect(read.quorum).toBe(3);
  });

  it("expireStaleProposals sweeps expired proposals", async () => {
    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Will expire",
      proposerAddress: account.address,
    });

    // Set expiry to the past
    db.raw
      .prepare(
        `UPDATE group_governance_proposals SET expires_at = ? WHERE proposal_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", proposal.proposalId);

    const expired = await expireStaleProposals(
      db,
      groupId,
      account,
      account.address,
    );

    expect(expired.length).toBe(1);
    expect(expired[0].status).toBe("expired");
    expect(expired[0].proposalId).toBe(proposal.proposalId);
  });
});
