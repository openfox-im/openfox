/**
 * Audit Journal
 *
 * GTOS 2046 Phase 6: Append-only audit journal backed by SQLite.
 * Entries are immutable once written — no updates or deletes.
 */

import type Database from "better-sqlite3";
import type { AuditEntry, AuditEntryKind, AuditQuery } from "./types.js";
import { ulid } from "ulid";

export class AuditJournal {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_journal (
        entry_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        intent_id TEXT,
        plan_id TEXT,
        approval_id TEXT,
        receipt_id TEXT,
        actor_address TEXT,
        actor_role TEXT,
        terminal_class TEXT,
        terminal_id TEXT,
        trust_tier INTEGER,
        policy_hash TEXT,
        policy_decision TEXT,
        tx_hash TEXT,
        sponsor_address TEXT,
        value TEXT,
        summary TEXT NOT NULL,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_journal_intent ON audit_journal(intent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_journal_kind ON audit_journal(kind);
      CREATE INDEX IF NOT EXISTS idx_audit_journal_timestamp ON audit_journal(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_journal_actor ON audit_journal(actor_address);
      CREATE INDEX IF NOT EXISTS idx_audit_journal_terminal ON audit_journal(terminal_class);
      CREATE INDEX IF NOT EXISTS idx_audit_journal_sponsor ON audit_journal(sponsor_address);

      -- Enforce immutability: prevent updates and deletes on audit entries
      CREATE TRIGGER IF NOT EXISTS audit_journal_no_update
        BEFORE UPDATE ON audit_journal
        BEGIN
          SELECT RAISE(ABORT, 'Audit journal entries are immutable and cannot be updated');
        END;
      CREATE TRIGGER IF NOT EXISTS audit_journal_no_delete
        BEFORE DELETE ON audit_journal
        BEGIN
          SELECT RAISE(ABORT, 'Audit journal entries are immutable and cannot be deleted');
        END;
    `);
  }

  /** Append a new entry (immutable — no updates). */
  append(entry: Omit<AuditEntry, "entryId">): AuditEntry {
    const entryId = ulid();
    const full: AuditEntry = { entryId, ...entry };
    this.db
      .prepare(
        `INSERT INTO audit_journal (
          entry_id, kind, timestamp,
          intent_id, plan_id, approval_id, receipt_id,
          actor_address, actor_role,
          terminal_class, terminal_id, trust_tier,
          policy_hash, policy_decision,
          tx_hash, sponsor_address, value,
          summary, details
        ) VALUES (
          @entryId, @kind, @timestamp,
          @intentId, @planId, @approvalId, @receiptId,
          @actorAddress, @actorRole,
          @terminalClass, @terminalId, @trustTier,
          @policyHash, @policyDecision,
          @txHash, @sponsorAddress, @value,
          @summary, @details
        )`,
      )
      .run({
        entryId: full.entryId,
        kind: full.kind,
        timestamp: full.timestamp,
        intentId: full.intentId ?? null,
        planId: full.planId ?? null,
        approvalId: full.approvalId ?? null,
        receiptId: full.receiptId ?? null,
        actorAddress: full.actorAddress ?? null,
        actorRole: full.actorRole ?? null,
        terminalClass: full.terminalClass ?? null,
        terminalId: full.terminalId ?? null,
        trustTier: full.trustTier ?? null,
        policyHash: full.policyHash ?? null,
        policyDecision: full.policyDecision ?? null,
        txHash: full.txHash ?? null,
        sponsorAddress: full.sponsorAddress ?? null,
        value: full.value ?? null,
        summary: full.summary,
        details: full.details ? JSON.stringify(full.details) : null,
      });
    return full;
  }

  /** Query entries with flexible filters. */
  query(q: AuditQuery): AuditEntry[] {
    const { sql, params } = this.buildQueryClause(q);
    const orderBy = "ORDER BY timestamp ASC, entry_id ASC";
    // Use parameterized LIMIT/OFFSET to prevent SQL injection
    let limitOffsetClause = "";
    if (q.limit != null) {
      const safeLimit = Math.max(0, Math.min(Math.floor(Number(q.limit)), 10_000));
      limitOffsetClause += ` LIMIT ${safeLimit}`;
    }
    if (q.offset != null) {
      const safeOffset = Math.max(0, Math.floor(Number(q.offset)));
      limitOffsetClause += ` OFFSET ${safeOffset}`;
    }
    const rows = this.db
      .prepare(`SELECT * FROM audit_journal ${sql} ${orderBy}${limitOffsetClause}`)
      .all(...params) as RawAuditRow[];
    return rows.map(rowToEntry);
  }

  /** Get the full timeline for a single intent. */
  getIntentTimeline(intentId: string): AuditEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM audit_journal WHERE intent_id = ? ORDER BY timestamp ASC, entry_id ASC",
      )
      .all(intentId) as RawAuditRow[];
    return rows.map(rowToEntry);
  }

  /** Get entries filtered by kind. */
  getByKind(kind: AuditEntryKind, limit?: number): AuditEntry[] {
    const safeLimit = limit != null ? Math.max(0, Math.min(Math.floor(Number(limit)), 10_000)) : undefined;
    const limitClause = safeLimit != null ? `LIMIT ${safeLimit}` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_journal WHERE kind = ? ORDER BY timestamp DESC, entry_id DESC ${limitClause}`,
      )
      .all(kind) as RawAuditRow[];
    return rows.map(rowToEntry);
  }

  /** Count entries matching an optional query. */
  count(q?: AuditQuery): number {
    if (!q) {
      const row = this.db
        .prepare("SELECT COUNT(*) as cnt FROM audit_journal")
        .get() as { cnt: number };
      return row.cnt;
    }
    const { sql, params } = this.buildQueryClause(q);
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM audit_journal ${sql}`)
      .get(...params) as { cnt: number };
    return row.cnt;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private buildQueryClause(q: AuditQuery): { sql: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.intentId) {
      conditions.push("intent_id = ?");
      params.push(q.intentId);
    }
    if (q.planId) {
      conditions.push("plan_id = ?");
      params.push(q.planId);
    }
    if (q.actorAddress) {
      conditions.push("actor_address = ?");
      params.push(q.actorAddress);
    }
    if (q.terminalClass) {
      conditions.push("terminal_class = ?");
      params.push(q.terminalClass);
    }
    if (q.sponsorAddress) {
      conditions.push("sponsor_address = ?");
      params.push(q.sponsorAddress);
    }
    if (q.kind) {
      if (Array.isArray(q.kind)) {
        const placeholders = q.kind.map(() => "?").join(", ");
        conditions.push(`kind IN (${placeholders})`);
        params.push(...q.kind);
      } else {
        conditions.push("kind = ?");
        params.push(q.kind);
      }
    }
    if (q.fromTimestamp != null) {
      conditions.push("timestamp >= ?");
      params.push(q.fromTimestamp);
    }
    if (q.toTimestamp != null) {
      conditions.push("timestamp <= ?");
      params.push(q.toTimestamp);
    }

    const sql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { sql, params };
  }
}

// ── Row mapping ──────────────────────────────────────────────────

interface RawAuditRow {
  entry_id: string;
  kind: string;
  timestamp: number;
  intent_id: string | null;
  plan_id: string | null;
  approval_id: string | null;
  receipt_id: string | null;
  actor_address: string | null;
  actor_role: string | null;
  terminal_class: string | null;
  terminal_id: string | null;
  trust_tier: number | null;
  policy_hash: string | null;
  policy_decision: string | null;
  tx_hash: string | null;
  sponsor_address: string | null;
  value: string | null;
  summary: string;
  details: string | null;
}

function rowToEntry(row: RawAuditRow): AuditEntry {
  const entry: AuditEntry = {
    entryId: row.entry_id,
    kind: row.kind as AuditEntryKind,
    timestamp: row.timestamp,
    summary: row.summary,
  };
  if (row.intent_id != null) entry.intentId = row.intent_id;
  if (row.plan_id != null) entry.planId = row.plan_id;
  if (row.approval_id != null) entry.approvalId = row.approval_id;
  if (row.receipt_id != null) entry.receiptId = row.receipt_id;
  if (row.actor_address != null) entry.actorAddress = row.actor_address;
  if (row.actor_role != null) entry.actorRole = row.actor_role;
  if (row.terminal_class != null) entry.terminalClass = row.terminal_class;
  if (row.terminal_id != null) entry.terminalId = row.terminal_id;
  if (row.trust_tier != null) entry.trustTier = row.trust_tier;
  if (row.policy_hash != null) entry.policyHash = row.policy_hash;
  if (row.policy_decision != null) entry.policyDecision = row.policy_decision;
  if (row.tx_hash != null) entry.txHash = row.tx_hash;
  if (row.sponsor_address != null) entry.sponsorAddress = row.sponsor_address;
  if (row.value != null) entry.value = row.value;
  if (row.details != null) {
    try {
      entry.details = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      // ignore malformed JSON in details
    }
  }
  return entry;
}
