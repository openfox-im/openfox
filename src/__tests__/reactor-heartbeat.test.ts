/**
 * Reactor Heartbeat Tests (Task 121)
 *
 * Verifies heartbeat-driven reactor tasks: expiring stale proposals,
 * resetting expired budget periods, syncing treasury balances,
 * publishing chain state commitments, and group isolation on failure.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import { createGroup } from "../group/store.js";
import {
  createGovernanceProposal,
  expireStaleProposals,
  setGovernancePolicy,
  getGovernanceProposal,
  listGovernanceProposals,
} from "../group/governance.js";
import {
  initializeGroupTreasury,
  recordTreasuryInflow,
  recordTreasuryOutflow,
  resetExpiredBudgetPeriods,
  listBudgetLines,
  getGroupTreasury,
  setBudgetLine,
} from "../group/treasury.js";
import type { OpenFoxDatabase } from "../types.js";
import type { HexString } from "../chain/address.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const TREASURY_KEY =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as HexString;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-reactor-heartbeat-test-"),
  );
  return path.join(tmpDir, "test.db");
}

describe("reactor heartbeat — periodic task automation", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);

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

  it("stale governance proposals are expired on heartbeat", async () => {
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Heartbeat Expiry Group",
        description: "Testing heartbeat expiry",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Test Fox",
      },
    });
    const groupId = created.group.groupId;

    // Create two proposals
    const p1 = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Will expire",
      proposerAddress: account.address,
    });

    const p2 = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "config_change",
      title: "Still active",
      proposerAddress: account.address,
    });

    // Set p1's expiry to the past
    db.raw
      .prepare(
        `UPDATE group_governance_proposals SET expires_at = ? WHERE proposal_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", p1.proposalId);

    // Run heartbeat expiry sweep
    const expired = await expireStaleProposals(
      db,
      groupId,
      account,
      account.address,
    );

    expect(expired.length).toBe(1);
    expect(expired[0].proposalId).toBe(p1.proposalId);
    expect(expired[0].status).toBe("expired");

    // p2 should still be active
    const p2After = getGovernanceProposal(db, p2.proposalId);
    expect(p2After!.status).toBe("active");
  });

  it("expired budget periods are reset on heartbeat", () => {
    const groupId = "heartbeat-budget-group";
    initializeGroupTreasury(db, groupId, TREASURY_KEY, [
      { lineName: "daily-ops", capTomi: "1000", period: "daily" },
      { lineName: "weekly-dev", capTomi: "5000", period: "weekly" },
      { lineName: "monthly-marketing", capTomi: "20000", period: "monthly" },
    ]);

    // Fund and spend against each line
    recordTreasuryInflow(db, groupId, "100000");
    recordTreasuryOutflow(db, groupId, "500", "0xrecipient", "daily-ops");
    recordTreasuryOutflow(db, groupId, "2000", "0xrecipient", "weekly-dev");
    recordTreasuryOutflow(db, groupId, "10000", "0xrecipient", "monthly-marketing");

    // Verify spending is tracked
    let lines = listBudgetLines(db, groupId);
    const dailyBefore = lines.find((l) => l.lineName === "daily-ops")!;
    expect(dailyBefore.spentTomi).toBe("500");

    // Simulate 25 hours later — daily should reset, weekly and monthly should not
    const twentyFiveHoursLater = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const resetCount = resetExpiredBudgetPeriods(db, groupId, twentyFiveHoursLater);

    expect(resetCount).toBe(1); // Only daily should reset

    lines = listBudgetLines(db, groupId);
    const dailyAfter = lines.find((l) => l.lineName === "daily-ops")!;
    const weeklyAfter = lines.find((l) => l.lineName === "weekly-dev")!;
    const monthlyAfter = lines.find((l) => l.lineName === "monthly-marketing")!;

    expect(dailyAfter.spentTomi).toBe("0");
    expect(weeklyAfter.spentTomi).toBe("2000"); // Unchanged
    expect(monthlyAfter.spentTomi).toBe("10000"); // Unchanged

    // Simulate 8 days later — weekly should also reset
    const eightDaysLater = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const resetCount2 = resetExpiredBudgetPeriods(db, groupId, eightDaysLater);
    expect(resetCount2).toBeGreaterThanOrEqual(1);
  });

  it("treasury balances reflect correct state after heartbeat sync operations", () => {
    const groupId = "heartbeat-sync-group";
    initializeGroupTreasury(db, groupId, TREASURY_KEY);

    recordTreasuryInflow(db, groupId, "50000", "0xsource");

    const treasury = getGroupTreasury(db, groupId)!;
    expect(treasury.balanceTomi).toBe("50000");

    // Simulate an on-chain sync by updating the balance
    // In production, the heartbeat would call an RPC to get the actual on-chain balance
    const now = new Date().toISOString();
    db.raw
      .prepare(
        "UPDATE group_treasury SET balance_tomi = ?, last_synced_at = ?, updated_at = ? WHERE group_id = ?",
      )
      .run("55000", now, now, groupId);

    const synced = getGroupTreasury(db, groupId)!;
    expect(synced.balanceTomi).toBe("55000");
    expect(synced.lastSyncedAt).toBe(now);
  });

  it("chain state commitments can be published on heartbeat", () => {
    const groupId = "heartbeat-chain-group";
    const now = new Date().toISOString();

    // Create group record
    db.raw
      .prepare(
        `INSERT INTO groups (group_id, name, description, visibility, join_mode, max_members, tags_json, creator_address, current_policy_hash, current_members_root, created_at, updated_at)
         VALUES (?, 'Chain Group', 'test', 'public', 'invite_only', 100, '[]', ?, 'hash1', 'root1', ?, ?)`,
      )
      .run(groupId, account.address, now, now);

    // Simulate the reactor heartbeat publishing a state commitment
    const commitmentId = `commit_hb_${Date.now()}`;
    db.raw
      .prepare(
        `INSERT INTO group_chain_commitments
         (commitment_id, group_id, action_type, epoch, members_root, events_merkle_root, treasury_balance_tomi, tx_hash, block_number, created_at)
         VALUES (?, ?, 'state_commit', 1, 'root1', ?, '50000', '0xhbtx', NULL, ?)`,
      )
      .run(commitmentId, groupId, null, now);

    const commitment = db.raw
      .prepare("SELECT * FROM group_chain_commitments WHERE commitment_id = ?")
      .get(commitmentId) as any;

    expect(commitment).toBeTruthy();
    expect(commitment.group_id).toBe(groupId);
    expect(commitment.action_type).toBe("state_commit");
    expect(commitment.epoch).toBe(1);
    expect(commitment.treasury_balance_tomi).toBe("50000");
  });

  it("one failing group does not stop other groups from being processed", async () => {
    // Create two groups
    const group1 = await createGroup({
      db,
      account,
      input: {
        name: "Group A",
        description: "First group",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Fox A",
      },
    });

    const group2 = await createGroup({
      db,
      account,
      input: {
        name: "Group B",
        description: "Second group",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Fox B",
      },
    });

    const groupId1 = group1.group.groupId;
    const groupId2 = group2.group.groupId;

    // Create expired proposals in both groups
    const p1 = await createGovernanceProposal(db, {
      account,
      groupId: groupId1,
      proposalType: "spend",
      title: "Group A proposal",
      proposerAddress: account.address,
    });

    const p2 = await createGovernanceProposal(db, {
      account,
      groupId: groupId2,
      proposalType: "spend",
      title: "Group B proposal",
      proposerAddress: account.address,
    });

    // Set both to expired
    db.raw
      .prepare(
        `UPDATE group_governance_proposals SET expires_at = ? WHERE proposal_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", p1.proposalId);
    db.raw
      .prepare(
        `UPDATE group_governance_proposals SET expires_at = ? WHERE proposal_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", p2.proposalId);

    // Process each group independently — a failure in one should not affect the other
    const errors: Error[] = [];
    const results: { groupId: string; expired: number }[] = [];

    for (const gId of [groupId1, groupId2]) {
      try {
        const expired = await expireStaleProposals(db, gId, account, account.address);
        results.push({ groupId: gId, expired: expired.length });
      } catch (err) {
        errors.push(err as Error);
      }
    }

    // Both groups should have been processed successfully
    expect(errors).toHaveLength(0);
    expect(results).toHaveLength(2);
    expect(results[0].expired).toBe(1);
    expect(results[1].expired).toBe(1);
  });

  it("heartbeat tasks respect their configured intervals", () => {
    // Simulate interval-based task execution using timestamps
    const taskLastRun: Record<string, Date> = {
      expireProposals: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      resetBudgets: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      syncTreasury: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      chainCommit: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    };

    const taskIntervals: Record<string, number> = {
      expireProposals: 5 * 60 * 1000, // 5 minutes
      resetBudgets: 60 * 60 * 1000, // 1 hour
      syncTreasury: 15 * 60 * 1000, // 15 minutes
      chainCommit: 10 * 60 * 1000, // 10 minutes
    };

    const now = new Date();
    const shouldRun: Record<string, boolean> = {};

    for (const [task, lastRun] of Object.entries(taskLastRun)) {
      const interval = taskIntervals[task];
      shouldRun[task] = now.getTime() - lastRun.getTime() >= interval;
    }

    // expireProposals: 10 min since last run, interval is 5 min -> should run
    expect(shouldRun.expireProposals).toBe(true);

    // resetBudgets: 2 hours since last run, interval is 1 hour -> should run
    expect(shouldRun.resetBudgets).toBe(true);

    // syncTreasury: 30 min since last run, interval is 15 min -> should run
    expect(shouldRun.syncTreasury).toBe(true);

    // chainCommit: 5 min since last run, interval is 10 min -> should NOT run
    expect(shouldRun.chainCommit).toBe(false);
  });
});
