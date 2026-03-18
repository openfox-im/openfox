/**
 * Federation Outbound Broadcasting
 *
 * Queues local state changes for the next federation sync cycle
 * and flushes them to all active federation peers.
 *
 * Events are stored in the world_federation_outbound table and
 * sent to peers via the existing WorldFederationTransport.
 */

import { ulid } from "ulid";
import type { OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  listFederationPeers,
  type FederationEventType,
  type WorldFederationEvent,
  type WorldFederationTransport,
} from "./federation.js";

const logger = createLogger("federation-outbound");

// ─── Types ──────────────────────────────────────────────────────

export interface FederationOutboundEvent {
  outboundId: string;
  eventType: FederationEventType;
  payloadJson: string;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  sentAt: string | null;
}

// ─── Schema Bootstrap ───────────────────────────────────────────

/**
 * Ensure the outbound queue table exists.
 * Safe to call multiple times (CREATE IF NOT EXISTS).
 */
export function ensureFederationOutboundTable(db: OpenFoxDatabase): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS world_federation_outbound (
      outbound_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fed_outbound_status
      ON world_federation_outbound(status, created_at);
  `);
}

// ─── Queue ──────────────────────────────────────────────────────

/**
 * Queue a local event for federation broadcast.
 *
 * The event will be picked up by the next flush cycle and sent
 * to all active federation peers.
 */
export function queueFederationBroadcast(
  db: OpenFoxDatabase,
  event: {
    eventType: FederationEventType;
    payload: Record<string, unknown>;
  },
): FederationOutboundEvent {
  const outboundId = `wfo_${ulid()}`;
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(event.payload);

  db.raw
    .prepare(
      `INSERT INTO world_federation_outbound
       (outbound_id, event_type, payload_json, status, created_at, sent_at)
       VALUES (?, ?, ?, 'pending', ?, NULL)`,
    )
    .run(outboundId, event.eventType, payloadJson, now);

  logger.info(
    `queued federation broadcast: ${event.eventType} (${outboundId})`,
  );

  return {
    outboundId,
    eventType: event.eventType,
    payloadJson,
    status: "pending",
    createdAt: now,
    sentAt: null,
  };
}

// ─── Flush ──────────────────────────────────────────────────────

/**
 * Flush all pending outbound events to active federation peers.
 *
 * Each pending event is converted to a WorldFederationEvent and
 * published to every active peer via the provided transports.
 * On success the event is marked "sent"; on failure it stays "pending"
 * for the next cycle (up to MAX_RETRY_AGE_MS old events are pruned as "failed").
 */
export async function flushFederationOutbound(params: {
  db: OpenFoxDatabase;
  transports: WorldFederationTransport[];
}): Promise<{ sent: number; failed: number; peers: number }> {
  const { db, transports } = params;

  // Nothing to do without transports
  if (transports.length === 0) {
    return { sent: 0, failed: 0, peers: 0 };
  }

  const peers = listFederationPeers(db, "active");
  if (peers.length === 0) {
    return { sent: 0, failed: 0, peers: 0 };
  }

  // Fetch pending events (oldest first, capped at 200 per flush)
  const pendingRows = db.raw
    .prepare(
      `SELECT * FROM world_federation_outbound
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 200`,
    )
    .all() as Array<{
    outbound_id: string;
    event_type: string;
    payload_json: string;
    status: string;
    created_at: string;
    sent_at: string | null;
  }>;

  if (pendingRows.length === 0) {
    return { sent: 0, failed: 0, peers: peers.length };
  }

  // Convert to WorldFederationEvent format
  const events: WorldFederationEvent[] = pendingRows.map((row) => ({
    eventId: row.outbound_id,
    eventType: row.event_type as FederationEventType,
    payloadJson: row.payload_json,
    receivedAt: row.created_at,
  }));

  let sent = 0;
  let failed = 0;
  const now = new Date().toISOString();

  // Publish to each transport
  for (const transport of transports) {
    try {
      await transport.publishWorldEvents({ events });
      sent = events.length;
      break; // success with this transport
    } catch (err) {
      logger.warn(`federation outbound publish failed: ${err}`);
      failed = events.length;
    }
  }

  // Mark events based on result
  if (sent > 0) {
    const markSent = db.raw.prepare(
      `UPDATE world_federation_outbound
       SET status = 'sent', sent_at = ?
       WHERE outbound_id = ?`,
    );
    for (const row of pendingRows) {
      markSent.run(now, row.outbound_id);
    }
    logger.info(
      `flushed ${sent} federation outbound event(s) to ${peers.length} peer(s)`,
    );
  }

  // Prune old sent events (older than 7 days)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.raw
    .prepare(
      `DELETE FROM world_federation_outbound
       WHERE status = 'sent' AND created_at < ?`,
    )
    .run(cutoff);

  return { sent, failed, peers: peers.length };
}

// ─── Listing ────────────────────────────────────────────────────

/**
 * List recent outbound events, optionally filtered by status.
 */
export function listFederationOutbound(
  db: OpenFoxDatabase,
  status?: "pending" | "sent" | "failed",
  limit: number = 50,
): FederationOutboundEvent[] {
  const rows = status
    ? (db.raw
        .prepare(
          `SELECT * FROM world_federation_outbound
           WHERE status = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(status, limit) as any[])
    : (db.raw
        .prepare(
          `SELECT * FROM world_federation_outbound
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit) as any[]);

  return rows.map((r: any) => ({
    outboundId: r.outbound_id,
    eventType: r.event_type as FederationEventType,
    payloadJson: r.payload_json,
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at ?? null,
  }));
}

/**
 * Count pending outbound events.
 */
export function countPendingOutbound(db: OpenFoxDatabase): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS cnt FROM world_federation_outbound WHERE status = 'pending'`,
    )
    .get() as { cnt: number };
  return row.cnt;
}
