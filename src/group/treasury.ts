/**
 * Group Treasury & Budget System
 *
 * Operational treasury engine for group financial management.
 * Handles treasury initialization, budget lines, spend validation,
 * inflow/outflow recording, and period-based budget resets.
 */

import { keccak256, toHex } from "tosdk";
import { createLogger } from "../observability/logger.js";
import { deriveAddressFromPrivateKey, type ChainAddress, type HexString } from "../chain/address.js";
import { ulid } from "ulid";
import type { OpenFoxDatabase } from "../types.js";
import { worldEventBus } from "../metaworld/event-bus.js";

const logger = createLogger("group-treasury");

// ─── Stable JSON Serialization ──────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

// ─── Types ──────────────────────────────────────────────────────

export interface TreasuryRecord {
  groupId: string;
  treasuryAddress: string;
  balanceWei: string;
  lastSyncedAt: string | null;
  spendPolicy: Record<string, unknown>;
  status: "active" | "frozen" | "closed";
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLineRecord {
  groupId: string;
  lineName: string;
  capWei: string;
  period: "daily" | "weekly" | "monthly" | "epoch";
  spentWei: string;
  periodStart: string;
  requiresSupermajority: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TreasuryLogRecord {
  logId: string;
  groupId: string;
  direction: "inflow" | "outflow";
  amountWei: string;
  counterparty: string | null;
  budgetLine: string | null;
  proposalId: string | null;
  txHash: string | null;
  memo: string | null;
  createdAt: string;
}

export interface BudgetLineInput {
  lineName: string;
  capWei: string;
  period?: "daily" | "weekly" | "monthly" | "epoch";
  requiresSupermajority?: boolean;
}

export interface TreasurySnapshot {
  groupId: string;
  treasuryAddress: string;
  balanceWei: string;
  status: "active" | "frozen" | "closed";
  budgetLines: BudgetLineRecord[];
  recentLog: TreasuryLogRecord[];
  generatedAt: string;
}

// ─── Period Calculations ────────────────────────────────────────

const PERIOD_DURATIONS_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

function isPeriodExpired(
  periodStart: string,
  period: string,
  now: Date,
): boolean {
  const durationMs = PERIOD_DURATIONS_MS[period];
  if (!durationMs) {
    // epoch periods never auto-expire
    return false;
  }
  const startMs = new Date(periodStart).getTime();
  return now.getTime() >= startMs + durationMs;
}

function nextPeriodStart(period: string, now: Date): string {
  return now.toISOString();
}

// ─── Key Derivation ─────────────────────────────────────────────

export function deriveTreasuryPrivateKey(
  creatorPrivateKey: HexString,
  groupId: string,
): HexString {
  const input = stableStringify({
    parent_key: creatorPrivateKey,
    purpose: "openfox:treasury:v1",
    group_id: groupId,
  });
  const hash = keccak256(toHex(new TextEncoder().encode(input)));
  return hash as HexString;
}

export function deriveTreasuryAddress(
  creatorPrivateKey: HexString,
  groupId: string,
): ChainAddress {
  const treasuryKey = deriveTreasuryPrivateKey(creatorPrivateKey, groupId);
  return deriveAddressFromPrivateKey(treasuryKey);
}

// ─── Row Mappers ────────────────────────────────────────────────

interface TreasuryRow {
  group_id: string;
  treasury_address: string;
  balance_wei: string;
  last_synced_at: string | null;
  spend_policy_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface BudgetLineRow {
  group_id: string;
  line_name: string;
  cap_wei: string;
  period: string;
  spent_wei: string;
  period_start: string;
  requires_supermajority: number;
  created_at: string;
  updated_at: string;
}

interface TreasuryLogRow {
  log_id: string;
  group_id: string;
  direction: string;
  amount_wei: string;
  counterparty: string | null;
  budget_line: string | null;
  proposal_id: string | null;
  tx_hash: string | null;
  memo: string | null;
  created_at: string;
}

function mapTreasuryRow(row: TreasuryRow): TreasuryRecord {
  return {
    groupId: row.group_id,
    treasuryAddress: row.treasury_address,
    balanceWei: row.balance_wei,
    lastSyncedAt: row.last_synced_at,
    spendPolicy: JSON.parse(row.spend_policy_json),
    status: row.status as TreasuryRecord["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBudgetLineRow(row: BudgetLineRow): BudgetLineRecord {
  return {
    groupId: row.group_id,
    lineName: row.line_name,
    capWei: row.cap_wei,
    period: row.period as BudgetLineRecord["period"],
    spentWei: row.spent_wei,
    periodStart: row.period_start,
    requiresSupermajority: row.requires_supermajority === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTreasuryLogRow(row: TreasuryLogRow): TreasuryLogRecord {
  return {
    logId: row.log_id,
    groupId: row.group_id,
    direction: row.direction as TreasuryLogRecord["direction"],
    amountWei: row.amount_wei,
    counterparty: row.counterparty,
    budgetLine: row.budget_line,
    proposalId: row.proposal_id,
    txHash: row.tx_hash,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

// ─── Core Functions ─────────────────────────────────────────────

export function initializeGroupTreasury(
  db: OpenFoxDatabase,
  groupId: string,
  creatorPrivateKey: HexString,
  budgetLines?: BudgetLineInput[],
): TreasuryRecord {
  const treasuryAddress = deriveTreasuryAddress(creatorPrivateKey, groupId);
  const now = new Date().toISOString();

  // Check if treasury already exists
  const existing = getGroupTreasury(db, groupId);
  if (existing) {
    throw new Error(`Treasury already exists for group: ${groupId}`);
  }

  db.raw
    .prepare(
      `INSERT INTO group_treasury (group_id, treasury_address, balance_wei, spend_policy_json, status, created_at, updated_at)
       VALUES (?, ?, '0', '{}', 'active', ?, ?)`,
    )
    .run(groupId, treasuryAddress, now, now);

  // Create default budget lines if provided
  if (budgetLines && budgetLines.length > 0) {
    for (const line of budgetLines) {
      setBudgetLine(
        db,
        groupId,
        line.lineName,
        line.capWei,
        line.period ?? "monthly",
        line.requiresSupermajority ?? false,
      );
    }
  }

  logger.info("Treasury initialized", { groupId, treasuryAddress });

  return getGroupTreasury(db, groupId)!;
}

export function getGroupTreasury(
  db: OpenFoxDatabase,
  groupId: string,
): TreasuryRecord | null {
  const row = db.raw
    .prepare("SELECT * FROM group_treasury WHERE group_id = ?")
    .get(groupId) as TreasuryRow | undefined;
  return row ? mapTreasuryRow(row) : null;
}

export function listBudgetLines(
  db: OpenFoxDatabase,
  groupId: string,
): BudgetLineRecord[] {
  const rows = db.raw
    .prepare(
      "SELECT * FROM group_budget_lines WHERE group_id = ? ORDER BY line_name",
    )
    .all(groupId) as BudgetLineRow[];
  return rows.map(mapBudgetLineRow);
}

export function setBudgetLine(
  db: OpenFoxDatabase,
  groupId: string,
  lineName: string,
  capWei: string,
  period: "daily" | "weekly" | "monthly" | "epoch" = "monthly",
  requiresSupermajority: boolean = false,
): BudgetLineRecord {
  const now = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO group_budget_lines (group_id, line_name, cap_wei, period, spent_wei, period_start, requires_supermajority, created_at, updated_at)
       VALUES (?, ?, ?, ?, '0', ?, ?, ?, ?)
       ON CONFLICT(group_id, line_name) DO UPDATE SET
         cap_wei = excluded.cap_wei,
         period = excluded.period,
         requires_supermajority = excluded.requires_supermajority,
         updated_at = excluded.updated_at`,
    )
    .run(
      groupId,
      lineName,
      capWei,
      period,
      now,
      requiresSupermajority ? 1 : 0,
      now,
      now,
    );

  const row = db.raw
    .prepare(
      "SELECT * FROM group_budget_lines WHERE group_id = ? AND line_name = ?",
    )
    .get(groupId, lineName) as BudgetLineRow;
  return mapBudgetLineRow(row);
}

export function getTreasuryLog(
  db: OpenFoxDatabase,
  groupId: string,
  limit: number = 50,
): TreasuryLogRecord[] {
  const rows = db.raw
    .prepare(
      "SELECT * FROM group_treasury_log WHERE group_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(groupId, limit) as TreasuryLogRow[];
  return rows.map(mapTreasuryLogRow);
}

export function recordTreasuryInflow(
  db: OpenFoxDatabase,
  groupId: string,
  amountWei: string,
  fromAddress?: string,
  txHash?: string,
  memo?: string,
): TreasuryLogRecord {
  const treasury = getGroupTreasury(db, groupId);
  if (!treasury) {
    throw new Error(`Treasury not found for group: ${groupId}`);
  }

  const newBalance = (BigInt(treasury.balanceWei) + BigInt(amountWei)).toString();
  const now = new Date().toISOString();
  const logId = ulid();

  db.raw
    .prepare(
      "UPDATE group_treasury SET balance_wei = ?, updated_at = ? WHERE group_id = ?",
    )
    .run(newBalance, now, groupId);

  db.raw
    .prepare(
      `INSERT INTO group_treasury_log (log_id, group_id, direction, amount_wei, counterparty, budget_line, proposal_id, tx_hash, memo, created_at)
       VALUES (?, ?, 'inflow', ?, ?, NULL, NULL, ?, ?, ?)`,
    )
    .run(logId, groupId, amountWei, fromAddress ?? null, txHash ?? null, memo ?? null, now);

  logger.info("Treasury inflow recorded", { groupId, amountWei, logId });

  worldEventBus.publish({
    kind: "treasury.update",
    payload: { groupId, action: "inflow", amountWei, fromAddress, newBalance: newBalance },
    timestamp: now,
  });

  return {
    logId,
    groupId,
    direction: "inflow",
    amountWei,
    counterparty: fromAddress ?? null,
    budgetLine: null,
    proposalId: null,
    txHash: txHash ?? null,
    memo: memo ?? null,
    createdAt: now,
  };
}

export interface SpendValidation {
  valid: boolean;
  reason?: string;
}

export function validateSpendBudget(
  db: OpenFoxDatabase,
  groupId: string,
  budgetLine: string,
  amountWei: string,
): SpendValidation {
  const treasury = getGroupTreasury(db, groupId);
  if (!treasury) {
    return { valid: false, reason: "Treasury not found" };
  }

  if (treasury.status !== "active") {
    return { valid: false, reason: `Treasury is ${treasury.status}` };
  }

  const line = db.raw
    .prepare(
      "SELECT * FROM group_budget_lines WHERE group_id = ? AND line_name = ?",
    )
    .get(groupId, budgetLine) as BudgetLineRow | undefined;

  if (!line) {
    return { valid: false, reason: `Budget line not found: ${budgetLine}` };
  }

  const amount = BigInt(amountWei);
  const spent = BigInt(line.spent_wei);
  const cap = BigInt(line.cap_wei);

  if (spent + amount > cap) {
    return {
      valid: false,
      reason: `Budget line "${budgetLine}" would exceed cap: ${(spent + amount).toString()} > ${cap.toString()}`,
    };
  }

  const balance = BigInt(treasury.balanceWei);
  if (balance < amount) {
    return {
      valid: false,
      reason: `Insufficient treasury balance: ${balance.toString()} < ${amount.toString()}`,
    };
  }

  return { valid: true };
}

export function recordTreasuryOutflow(
  db: OpenFoxDatabase,
  groupId: string,
  amountWei: string,
  recipient: string,
  budgetLine: string,
  proposalId?: string,
  txHash?: string,
  memo?: string,
): TreasuryLogRecord {
  const validation = validateSpendBudget(db, groupId, budgetLine, amountWei);
  if (!validation.valid) {
    throw new Error(`Outflow rejected: ${validation.reason}`);
  }

  const treasury = getGroupTreasury(db, groupId)!;
  const amount = BigInt(amountWei);
  const newBalance = (BigInt(treasury.balanceWei) - amount).toString();
  const now = new Date().toISOString();
  const logId = ulid();

  // Update treasury balance
  db.raw
    .prepare(
      "UPDATE group_treasury SET balance_wei = ?, updated_at = ? WHERE group_id = ?",
    )
    .run(newBalance, now, groupId);

  // Update budget line spent amount
  const line = db.raw
    .prepare(
      "SELECT * FROM group_budget_lines WHERE group_id = ? AND line_name = ?",
    )
    .get(groupId, budgetLine) as BudgetLineRow;
  const newSpent = (BigInt(line.spent_wei) + amount).toString();

  db.raw
    .prepare(
      "UPDATE group_budget_lines SET spent_wei = ?, updated_at = ? WHERE group_id = ? AND line_name = ?",
    )
    .run(newSpent, now, groupId, budgetLine);

  // Record log entry
  db.raw
    .prepare(
      `INSERT INTO group_treasury_log (log_id, group_id, direction, amount_wei, counterparty, budget_line, proposal_id, tx_hash, memo, created_at)
       VALUES (?, ?, 'outflow', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      logId,
      groupId,
      amountWei,
      recipient,
      budgetLine,
      proposalId ?? null,
      txHash ?? null,
      memo ?? null,
      now,
    );

  logger.info("Treasury outflow recorded", { groupId, amountWei, budgetLine, logId });

  worldEventBus.publish({
    kind: "treasury.update",
    payload: { groupId, action: "outflow", amountWei, recipient, budgetLine, newBalance: newBalance },
    timestamp: now,
  });

  return {
    logId,
    groupId,
    direction: "outflow",
    amountWei,
    counterparty: recipient,
    budgetLine,
    proposalId: proposalId ?? null,
    txHash: txHash ?? null,
    memo: memo ?? null,
    createdAt: now,
  };
}

export function resetExpiredBudgetPeriods(
  db: OpenFoxDatabase,
  groupId: string,
  now?: Date,
): number {
  const currentTime = now ?? new Date();
  const lines = listBudgetLines(db, groupId);
  let resetCount = 0;

  for (const line of lines) {
    if (isPeriodExpired(line.periodStart, line.period, currentTime)) {
      const newPeriodStart = nextPeriodStart(line.period, currentTime);
      db.raw
        .prepare(
          "UPDATE group_budget_lines SET spent_wei = '0', period_start = ?, updated_at = ? WHERE group_id = ? AND line_name = ?",
        )
        .run(newPeriodStart, currentTime.toISOString(), groupId, line.lineName);
      resetCount++;
      logger.info("Budget period reset", {
        groupId,
        lineName: line.lineName,
        period: line.period,
      });
    }
  }

  return resetCount;
}

export function freezeGroupTreasury(
  db: OpenFoxDatabase,
  groupId: string,
): TreasuryRecord {
  const treasury = getGroupTreasury(db, groupId);
  if (!treasury) {
    throw new Error(`Treasury not found for group: ${groupId}`);
  }

  const now = new Date().toISOString();
  db.raw
    .prepare(
      "UPDATE group_treasury SET status = 'frozen', updated_at = ? WHERE group_id = ?",
    )
    .run(now, groupId);

  logger.info("Treasury frozen", { groupId });
  worldEventBus.publish({
    kind: "treasury.update",
    payload: { groupId, action: "frozen" },
    timestamp: now,
  });
  return getGroupTreasury(db, groupId)!;
}

export function unfreezeGroupTreasury(
  db: OpenFoxDatabase,
  groupId: string,
): TreasuryRecord {
  const treasury = getGroupTreasury(db, groupId);
  if (!treasury) {
    throw new Error(`Treasury not found for group: ${groupId}`);
  }

  const now = new Date().toISOString();
  db.raw
    .prepare(
      "UPDATE group_treasury SET status = 'active', updated_at = ? WHERE group_id = ?",
    )
    .run(now, groupId);

  logger.info("Treasury unfrozen", { groupId });
  worldEventBus.publish({
    kind: "treasury.update",
    payload: { groupId, action: "unfrozen" },
    timestamp: now,
  });
  return getGroupTreasury(db, groupId)!;
}

export function buildTreasurySnapshot(
  db: OpenFoxDatabase,
  groupId: string,
): TreasurySnapshot {
  const treasury = getGroupTreasury(db, groupId);
  if (!treasury) {
    throw new Error(`Treasury not found for group: ${groupId}`);
  }

  const budgetLines = listBudgetLines(db, groupId);
  const recentLog = getTreasuryLog(db, groupId, 20);

  return {
    groupId,
    treasuryAddress: treasury.treasuryAddress,
    balanceWei: treasury.balanceWei,
    status: treasury.status,
    budgetLines,
    recentLog,
    generatedAt: new Date().toISOString(),
  };
}
