/**
 * SQLite-backed persistent session storage for TerminalRegistry.
 *
 * Provides durable storage of TerminalSession records so they survive
 * process restarts, while keeping the same interface shape the registry
 * already uses (save / get / list / revoke / clean / deleteAll).
 */

import type Database from "better-sqlite3";
import type { TerminalSession, TerminalClass, TrustTier } from "./types.js";

export class SessionStore {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_sessions (
        session_id TEXT PRIMARY KEY,
        terminal_class TEXT NOT NULL,
        trust_tier INTEGER NOT NULL,
        terminal_id TEXT NOT NULL,
        connected_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_terminal ON terminal_sessions(terminal_id);
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_expires ON terminal_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_revoked ON terminal_sessions(revoked);
    `);
  }

  /** Persist a session (insert or replace). */
  save(session: TerminalSession): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO terminal_sessions
        (session_id, terminal_class, trust_tier, terminal_id, connected_at, last_active_at, expires_at, metadata, revoked)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.sessionId,
      session.terminalClass,
      session.trustTier,
      session.terminalId,
      session.connectedAt,
      session.lastActiveAt,
      session.expiresAt,
      JSON.stringify(session.metadata),
      session.revoked ? 1 : 0,
    );
  }

  /** Retrieve a session by ID, or null if not found. */
  get(sessionId: string): TerminalSession | null {
    const stmt = this.db.prepare(
      "SELECT * FROM terminal_sessions WHERE session_id = ?",
    );
    const row = stmt.get(sessionId) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  /** Return all non-revoked, non-expired sessions. */
  listActive(): TerminalSession[] {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(
      "SELECT * FROM terminal_sessions WHERE revoked = 0 AND expires_at > ?",
    );
    const rows = stmt.all(now) as SessionRow[];
    return rows.map(rowToSession);
  }

  /** Mark a session as revoked. Returns true if the session existed. */
  revoke(sessionId: string): boolean {
    const stmt = this.db.prepare(
      "UPDATE terminal_sessions SET revoked = 1 WHERE session_id = ?",
    );
    const result = stmt.run(sessionId);
    return result.changes > 0;
  }

  /** Delete expired and revoked sessions. Returns number removed. */
  cleanExpired(): number {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(
      "DELETE FROM terminal_sessions WHERE expires_at <= ? OR revoked = 1",
    );
    const result = stmt.run(now);
    return result.changes;
  }

  /** Remove all sessions. */
  deleteAll(): void {
    this.db.exec("DELETE FROM terminal_sessions");
  }
}

interface SessionRow {
  session_id: string;
  terminal_class: string;
  trust_tier: number;
  terminal_id: string;
  connected_at: number;
  last_active_at: number;
  expires_at: number;
  metadata: string;
  revoked: number;
}

function rowToSession(row: SessionRow): TerminalSession {
  return {
    sessionId: row.session_id,
    terminalClass: row.terminal_class as TerminalClass,
    trustTier: row.trust_tier as TrustTier,
    terminalId: row.terminal_id,
    connectedAt: row.connected_at,
    lastActiveAt: row.last_active_at,
    expiresAt: row.expires_at,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    revoked: row.revoked === 1,
  };
}
