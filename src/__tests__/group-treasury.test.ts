/**
 * Group Treasury & Budget System Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./mocks.js";
import type { OpenFoxDatabase } from "../types.js";
import type { HexString } from "../chain/address.js";
import {
  deriveTreasuryPrivateKey,
  deriveTreasuryAddress,
  initializeGroupTreasury,
  getGroupTreasury,
  listBudgetLines,
  setBudgetLine,
  getTreasuryLog,
  recordTreasuryInflow,
  recordTreasuryOutflow,
  validateSpendBudget,
  resetExpiredBudgetPeriods,
  freezeGroupTreasury,
  unfreezeGroupTreasury,
  buildTreasurySnapshot,
} from "../group/treasury.js";

const TEST_PRIVATE_KEY =
  "0x97b1c813eae702332ba3eaa1625f942c5472626d90abcdef1234567890abcdef" as HexString;
const TEST_GROUP_ID = "test-group-001";

describe("group treasury", () => {
  let db: OpenFoxDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  it("treasury init creates address and default budget lines", () => {
    const treasury = initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "operations", capTomi: "1000000000000000000", period: "monthly" },
      { lineName: "bounties", capTomi: "5000000000000000000", period: "weekly" },
    ]);

    expect(treasury.groupId).toBe(TEST_GROUP_ID);
    expect(treasury.treasuryAddress).toBeTruthy();
    expect(treasury.treasuryAddress.startsWith("0x")).toBe(true);
    expect(treasury.balanceTomi).toBe("0");
    expect(treasury.status).toBe("active");

    const lines = listBudgetLines(db, TEST_GROUP_ID);
    expect(lines).toHaveLength(2);
    expect(lines[0].lineName).toBe("bounties");
    expect(lines[1].lineName).toBe("operations");
  });

  it("treasury address is deterministic (same inputs produce same address)", () => {
    const addr1 = deriveTreasuryAddress(TEST_PRIVATE_KEY, TEST_GROUP_ID);
    const addr2 = deriveTreasuryAddress(TEST_PRIVATE_KEY, TEST_GROUP_ID);
    expect(addr1).toBe(addr2);
  });

  it("deriveTreasuryAddress produces valid ChainAddress", () => {
    const addr = deriveTreasuryAddress(TEST_PRIVATE_KEY, TEST_GROUP_ID);
    expect(addr).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("deriveTreasuryPrivateKey is deterministic", () => {
    const key1 = deriveTreasuryPrivateKey(TEST_PRIVATE_KEY, TEST_GROUP_ID);
    const key2 = deriveTreasuryPrivateKey(TEST_PRIVATE_KEY, TEST_GROUP_ID);
    expect(key1).toBe(key2);
  });

  it("different group IDs produce different addresses", () => {
    const addr1 = deriveTreasuryAddress(TEST_PRIVATE_KEY, "group-a");
    const addr2 = deriveTreasuryAddress(TEST_PRIVATE_KEY, "group-b");
    expect(addr1).not.toBe(addr2);
  });

  it("setBudgetLine creates and updates budget lines", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY);

    const line = setBudgetLine(db, TEST_GROUP_ID, "rewards", "2000000000000000000", "weekly");
    expect(line.lineName).toBe("rewards");
    expect(line.capTomi).toBe("2000000000000000000");
    expect(line.period).toBe("weekly");
    expect(line.spentTomi).toBe("0");
    expect(line.requiresSupermajority).toBe(false);

    // Update existing line
    const updated = setBudgetLine(db, TEST_GROUP_ID, "rewards", "5000000000000000000", "monthly", true);
    expect(updated.capTomi).toBe("5000000000000000000");
    expect(updated.period).toBe("monthly");
    expect(updated.requiresSupermajority).toBe(true);
  });

  it("recordTreasuryOutflow validates budget line cap", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "operations", capTomi: "1000" },
    ]);

    // Fund treasury first
    recordTreasuryInflow(db, TEST_GROUP_ID, "2000", "0xfunder");

    // Spend within budget
    const log = recordTreasuryOutflow(db, TEST_GROUP_ID, "500", "0xrecipient", "operations");
    expect(log.direction).toBe("outflow");
    expect(log.amountTomi).toBe("500");

    const treasury = getGroupTreasury(db, TEST_GROUP_ID)!;
    expect(treasury.balanceTomi).toBe("1500");

    const lines = listBudgetLines(db, TEST_GROUP_ID);
    const opsLine = lines.find((l) => l.lineName === "operations")!;
    expect(opsLine.spentTomi).toBe("500");
  });

  it("recordTreasuryOutflow rejects if over budget", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "operations", capTomi: "1000" },
    ]);

    recordTreasuryInflow(db, TEST_GROUP_ID, "5000");

    // Spend up to cap
    recordTreasuryOutflow(db, TEST_GROUP_ID, "800", "0xrecipient", "operations");

    // This should fail because 800 + 300 > 1000
    expect(() =>
      recordTreasuryOutflow(db, TEST_GROUP_ID, "300", "0xrecipient", "operations"),
    ).toThrow(/exceed cap/);
  });

  it("recordTreasuryOutflow rejects if treasury frozen", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "operations", capTomi: "1000" },
    ]);

    recordTreasuryInflow(db, TEST_GROUP_ID, "5000");
    freezeGroupTreasury(db, TEST_GROUP_ID);

    expect(() =>
      recordTreasuryOutflow(db, TEST_GROUP_ID, "100", "0xrecipient", "operations"),
    ).toThrow(/frozen/);
  });

  it("resetExpiredBudgetPeriods resets spent counter", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "daily-ops", capTomi: "1000", period: "daily" },
    ]);

    recordTreasuryInflow(db, TEST_GROUP_ID, "5000");
    recordTreasuryOutflow(db, TEST_GROUP_ID, "500", "0xrecipient", "daily-ops");

    let lines = listBudgetLines(db, TEST_GROUP_ID);
    expect(lines[0].spentTomi).toBe("500");

    // Simulate time passing (25 hours later)
    const future = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const resetCount = resetExpiredBudgetPeriods(db, TEST_GROUP_ID, future);
    expect(resetCount).toBe(1);

    lines = listBudgetLines(db, TEST_GROUP_ID);
    expect(lines[0].spentTomi).toBe("0");
  });

  it("recordTreasuryInflow updates balance", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY);

    recordTreasuryInflow(db, TEST_GROUP_ID, "1000000", "0xfunder", "0xtxhash1", "initial deposit");
    let treasury = getGroupTreasury(db, TEST_GROUP_ID)!;
    expect(treasury.balanceTomi).toBe("1000000");

    recordTreasuryInflow(db, TEST_GROUP_ID, "500000", "0xfunder2");
    treasury = getGroupTreasury(db, TEST_GROUP_ID)!;
    expect(treasury.balanceTomi).toBe("1500000");

    const log = getTreasuryLog(db, TEST_GROUP_ID);
    expect(log).toHaveLength(2);
    expect(log[0].direction).toBe("inflow");
    expect(log[1].direction).toBe("inflow");
  });

  it("buildTreasurySnapshot returns complete snapshot", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "operations", capTomi: "1000" },
    ]);

    recordTreasuryInflow(db, TEST_GROUP_ID, "5000", "0xfunder");
    recordTreasuryOutflow(db, TEST_GROUP_ID, "200", "0xrecipient", "operations", undefined, undefined, "test spend");

    const snapshot = buildTreasurySnapshot(db, TEST_GROUP_ID);
    expect(snapshot.groupId).toBe(TEST_GROUP_ID);
    expect(snapshot.balanceTomi).toBe("4800");
    expect(snapshot.status).toBe("active");
    expect(snapshot.budgetLines).toHaveLength(1);
    expect(snapshot.recentLog).toHaveLength(2);
    expect(snapshot.generatedAt).toBeTruthy();
    expect(snapshot.treasuryAddress).toBeTruthy();
  });

  it("freeze and unfreeze works correctly", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY);

    let treasury = freezeGroupTreasury(db, TEST_GROUP_ID);
    expect(treasury.status).toBe("frozen");

    treasury = unfreezeGroupTreasury(db, TEST_GROUP_ID);
    expect(treasury.status).toBe("active");
  });

  it("validateSpendBudget rejects insufficient balance", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "operations", capTomi: "10000" },
    ]);

    // Treasury has 0 balance
    const result = validateSpendBudget(db, TEST_GROUP_ID, "operations", "100");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Insufficient treasury balance/);
  });

  it("validateSpendBudget rejects nonexistent budget line", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY);
    recordTreasuryInflow(db, TEST_GROUP_ID, "5000");

    const result = validateSpendBudget(db, TEST_GROUP_ID, "nonexistent", "100");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Budget line not found/);
  });

  it("initializeGroupTreasury rejects duplicate initialization", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY);

    expect(() =>
      initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY),
    ).toThrow(/already exists/);
  });

  it("epoch budget periods do not auto-expire", () => {
    initializeGroupTreasury(db, TEST_GROUP_ID, TEST_PRIVATE_KEY, [
      { lineName: "epoch-fund", capTomi: "1000", period: "epoch" },
    ]);

    recordTreasuryInflow(db, TEST_GROUP_ID, "5000");
    recordTreasuryOutflow(db, TEST_GROUP_ID, "500", "0xrecipient", "epoch-fund");

    // Even far in the future, epoch periods should not reset
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const resetCount = resetExpiredBudgetPeriods(db, TEST_GROUP_ID, farFuture);
    expect(resetCount).toBe(0);

    const lines = listBudgetLines(db, TEST_GROUP_ID);
    expect(lines[0].spentTomi).toBe("500");
  });
});
