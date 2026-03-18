/**
 * World Federation — cross-node sync, Fox directory exchange,
 * and reputation attestation import.
 *
 * Follows the Group sync transport pattern: each peer is fetched
 * incrementally via cursor-based pagination.
 */

import { ulid } from "ulid";
import type { OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import { verifyReputationAttestation, importReputationAttestation } from "./reputation.js";

const logger = createLogger("federation");

// ─── Types ──────────────────────────────────────────────────────

export type FederationEventType =
  | "group_registered"
  | "fox_profile_updated"
  | "intent_published"
  | "settlement_completed"
  | "reputation_attestation";

export interface WorldFederationEvent {
  eventId: string;
  eventType: FederationEventType;
  payloadJson: string;
  receivedAt: string;
}

export interface FederationPeerRecord {
  peerId: string;
  peerUrl: string;
  peerAddress: string | null;
  status: "active" | "unreachable" | "banned";
  lastSyncAt: string | null;
  lastCursor: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FoxDirectoryExport {
  address: string;
  displayName: string | null;
  bio: string | null;
  tnsName: string | null;
  updatedAt: string;
}

export interface WorldFederationTransport {
  fetchWorldEvents(params: {
    peerUrl: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ events: WorldFederationEvent[]; nextCursor: string }>;

  publishWorldEvents(params: {
    events: WorldFederationEvent[];
  }): Promise<void>;
}

// ─── Peer Management ────────────────────────────────────────────

function mapPeerRow(row: any): FederationPeerRecord {
  return {
    peerId: row.peer_id,
    peerUrl: row.peer_url,
    peerAddress: row.peer_address ?? null,
    status: row.status,
    lastSyncAt: row.last_sync_at ?? null,
    lastCursor: row.last_cursor ?? null,
    failureCount: row.failure_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addFederationPeer(
  db: OpenFoxDatabase,
  peerUrl: string,
  peerAddress?: string,
): FederationPeerRecord {
  const peerId = `wfp_${ulid()}`;
  const now = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO world_federation_peers
       (peer_id, peer_url, peer_address, status, last_sync_at, last_cursor, failure_count, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, NULL, 0, ?, ?)`,
    )
    .run(peerId, peerUrl, peerAddress ?? null, now, now);

  logger.info(`added federation peer ${peerId} at ${peerUrl}`);

  return {
    peerId,
    peerUrl,
    peerAddress: peerAddress ?? null,
    status: "active",
    lastSyncAt: null,
    lastCursor: null,
    failureCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function listFederationPeers(
  db: OpenFoxDatabase,
  statusFilter?: "active" | "unreachable" | "banned",
): FederationPeerRecord[] {
  if (statusFilter) {
    return (
      db.raw
        .prepare(
          `SELECT * FROM world_federation_peers WHERE status = ? ORDER BY created_at ASC`,
        )
        .all(statusFilter) as any[]
    ).map(mapPeerRow);
  }
  return (
    db.raw
      .prepare(
        `SELECT * FROM world_federation_peers ORDER BY created_at ASC`,
      )
      .all() as any[]
  ).map(mapPeerRow);
}

export function removeFederationPeer(
  db: OpenFoxDatabase,
  peerId: string,
): boolean {
  db.raw
    .prepare(`DELETE FROM world_federation_events WHERE peer_id = ?`)
    .run(peerId);
  const result = db.raw
    .prepare(`DELETE FROM world_federation_peers WHERE peer_id = ?`)
    .run(peerId);
  if (result.changes > 0) {
    logger.info(`removed federation peer ${peerId}`);
    return true;
  }
  return false;
}

// ─── Event Ingestion ────────────────────────────────────────────

export function importFederationEvents(
  db: OpenFoxDatabase,
  peerId: string,
  events: WorldFederationEvent[],
): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;

  const insertStmt = db.raw.prepare(
    `INSERT OR IGNORE INTO world_federation_events
     (event_id, peer_id, event_type, payload_json, received_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const event of events) {
    const result = insertStmt.run(
      event.eventId,
      peerId,
      event.eventType,
      event.payloadJson,
      event.receivedAt,
    );
    if (result.changes > 0) {
      imported++;
      applyFederationEvent(db, event);
    } else {
      skipped++;
    }
  }

  return { imported, skipped };
}

function applyFederationEvent(
  db: OpenFoxDatabase,
  event: WorldFederationEvent,
): void {
  try {
    const payload = JSON.parse(event.payloadJson);

    switch (event.eventType) {
      case "fox_profile_updated":
        applyFoxProfileUpdate(db, payload);
        break;
      case "reputation_attestation":
        applyReputationAttestation(db, payload);
        break;
      // group_registered, intent_published, settlement_completed
      // are informational — stored in federation_events for display
      default:
        break;
    }
  } catch (err) {
    logger.warn(
      `failed to apply federation event ${event.eventId}: ${err}`,
    );
  }
}

function applyFoxProfileUpdate(
  db: OpenFoxDatabase,
  payload: {
    address: string;
    display_name?: string;
    bio?: string;
    tns_name?: string;
    updated_at: string;
  },
): void {
  // Update world_search_index with federated Fox data (latest timestamp wins)
  const existing = db.raw
    .prepare(
      `SELECT updated_at FROM world_search_index
       WHERE entry_id = ? AND entry_kind = 'fox'`,
    )
    .get(`fox:${payload.address}`) as { updated_at: string } | undefined;

  if (existing && existing.updated_at >= payload.updated_at) {
    return; // local or newer remote data exists
  }

  const searchableText = [
    payload.display_name,
    payload.bio,
    payload.tns_name,
    payload.address,
  ]
    .filter(Boolean)
    .join(" ");

  db.raw
    .prepare(
      `INSERT INTO world_search_index (entry_id, entry_kind, searchable_text, source_id, updated_at)
       VALUES (?, 'fox', ?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET
         searchable_text = excluded.searchable_text,
         updated_at = excluded.updated_at`,
    )
    .run(
      `fox:${payload.address}`,
      searchableText,
      payload.address,
      payload.updated_at,
    );
}

function applyReputationAttestation(
  db: OpenFoxDatabase,
  payload: {
    targetAddress: string;
    dimension: string;
    score: number;
    eventCount: number;
    issuerGroupId: string;
    issuerAddress: string;
    timestamp: string;
    signature: string;
  },
): void {
  const attestation = {
    targetAddress: payload.targetAddress,
    dimension: payload.dimension as any,
    score: payload.score,
    eventCount: payload.eventCount,
    issuerGroupId: payload.issuerGroupId,
    issuerAddress: payload.issuerAddress,
    timestamp: payload.timestamp,
    signature: payload.signature,
  };

  const valid = verifyReputationAttestation(attestation);

  if (!valid) {
    logger.warn(
      `rejected invalid reputation attestation for ${payload.targetAddress}`,
    );
    return;
  }

  try {
    importReputationAttestation(db, attestation);
  } catch (err) {
    logger.warn(`failed to import reputation attestation: ${err}`);
  }
}

// ─── Event Listing ──────────────────────────────────────────────

export interface FederationEventRecord {
  eventId: string;
  peerId: string;
  eventType: FederationEventType;
  payloadJson: string;
  receivedAt: string;
}

export function listFederationEvents(
  db: OpenFoxDatabase,
  eventType?: FederationEventType,
  limit: number = 50,
): FederationEventRecord[] {
  if (eventType) {
    return (
      db.raw
        .prepare(
          `SELECT * FROM world_federation_events
           WHERE event_type = ?
           ORDER BY received_at DESC LIMIT ?`,
        )
        .all(eventType, limit) as any[]
    ).map((r: any) => ({
      eventId: r.event_id,
      peerId: r.peer_id,
      eventType: r.event_type,
      payloadJson: r.payload_json,
      receivedAt: r.received_at,
    }));
  }
  return (
    db.raw
      .prepare(
        `SELECT * FROM world_federation_events
         ORDER BY received_at DESC LIMIT ?`,
      )
      .all(limit) as any[]
  ).map((r: any) => ({
    eventId: r.event_id,
    peerId: r.peer_id,
    eventType: r.event_type,
    payloadJson: r.payload_json,
    receivedAt: r.received_at,
  }));
}

// ─── Federation Snapshot ────────────────────────────────────────

export interface FederationSnapshot {
  peerCount: number;
  activePeers: number;
  unreachablePeers: number;
  bannedPeers: number;
  peers: FederationPeerRecord[];
  recentEvents: FederationEventRecord[];
  summary: string;
  generatedAt: string;
}

export function buildFederationSnapshot(
  db: OpenFoxDatabase,
): FederationSnapshot {
  const peers = listFederationPeers(db);
  const recentEvents = listFederationEvents(db, undefined, 20);

  const activePeers = peers.filter((p) => p.status === "active").length;
  const unreachablePeers = peers.filter((p) => p.status === "unreachable").length;
  const bannedPeers = peers.filter((p) => p.status === "banned").length;

  return {
    peerCount: peers.length,
    activePeers,
    unreachablePeers,
    bannedPeers,
    peers,
    recentEvents,
    summary: `${peers.length} peer(s): ${activePeers} active, ${unreachablePeers} unreachable, ${bannedPeers} banned`,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Fox Directory Export/Import ────────────────────────────────

export function exportLocalFoxDirectory(
  db: OpenFoxDatabase,
): FoxDirectoryExport[] {
  const rows = db.raw
    .prepare(
      `SELECT address, display_name, bio, tns_name, updated_at
       FROM fox_profiles
       ORDER BY updated_at DESC`,
    )
    .all() as any[];

  return rows.map((r: any) => ({
    address: r.address,
    displayName: r.display_name ?? null,
    bio: r.bio ?? null,
    tnsName: r.tns_name ?? null,
    updatedAt: r.updated_at,
  }));
}

export function importFoxDirectory(params: {
  db: OpenFoxDatabase;
  entries: FoxDirectoryExport[];
  peerId: string;
}): { imported: number; updated: number; conflicts: number } {
  const { db, entries, peerId } = params;
  let imported = 0;
  let updated = 0;
  let conflicts = 0;

  for (const entry of entries) {
    const existing = db.raw
      .prepare(
        `SELECT updated_at FROM world_search_index
         WHERE entry_id = ? AND entry_kind = 'fox'`,
      )
      .get(`fox:${entry.address}`) as { updated_at: string } | undefined;

    const searchableText = [
      entry.displayName,
      entry.bio,
      entry.tnsName,
      entry.address,
    ]
      .filter(Boolean)
      .join(" ");

    if (!existing) {
      db.raw
        .prepare(
          `INSERT INTO world_search_index (entry_id, entry_kind, searchable_text, source_id, updated_at)
           VALUES (?, 'fox', ?, ?, ?)`,
        )
        .run(`fox:${entry.address}`, searchableText, entry.address, entry.updatedAt);
      imported++;
    } else if (entry.updatedAt > existing.updated_at) {
      db.raw
        .prepare(
          `UPDATE world_search_index
           SET searchable_text = ?, updated_at = ?
           WHERE entry_id = ?`,
        )
        .run(searchableText, entry.updatedAt, `fox:${entry.address}`);
      updated++;
    } else {
      conflicts++;
    }
  }

  logger.info(
    `imported Fox directory from peer ${peerId}: ${imported} new, ${updated} updated, ${conflicts} skipped`,
  );

  return { imported, updated, conflicts };
}

// ─── Sync Orchestrator ──────────────────────────────────────────

const MAX_FAILURES = 3;

export async function runWorldFederationSync(params: {
  db: OpenFoxDatabase;
  transports: WorldFederationTransport[];
}): Promise<{ synced: number; errors: number }> {
  const { db, transports } = params;
  const peers = listFederationPeers(db, "active");
  let synced = 0;
  let errors = 0;

  for (const peer of peers) {
    for (const transport of transports) {
      try {
        const { events, nextCursor } = await transport.fetchWorldEvents({
          peerUrl: peer.peerUrl,
          cursor: peer.lastCursor ?? undefined,
          limit: 100,
        });

        const result = importFederationEvents(db, peer.peerId, events);
        synced += result.imported;

        const now = new Date().toISOString();
        db.raw
          .prepare(
            `UPDATE world_federation_peers
             SET last_sync_at = ?, last_cursor = ?, failure_count = 0, updated_at = ?
             WHERE peer_id = ?`,
          )
          .run(now, nextCursor, now, peer.peerId);

        logger.info(
          `synced ${result.imported} events from peer ${peer.peerId} (${peer.peerUrl})`,
        );
        break; // success with this transport
      } catch (err) {
        errors++;
        const newFailures = peer.failureCount + 1;
        const newStatus =
          newFailures >= MAX_FAILURES ? "unreachable" : "active";
        const now = new Date().toISOString();

        db.raw
          .prepare(
            `UPDATE world_federation_peers
             SET failure_count = ?, status = ?, updated_at = ?
             WHERE peer_id = ?`,
          )
          .run(newFailures, newStatus, now, peer.peerId);

        if (newStatus === "unreachable") {
          logger.warn(
            `peer ${peer.peerId} (${peer.peerUrl}) marked as unreachable after ${newFailures} failures`,
          );
        } else {
          logger.warn(
            `sync failed for peer ${peer.peerId} (${peer.peerUrl}): ${err}`,
          );
        }
      }
    }
  }

  return { synced, errors };
}

// ─── PeerWorldFederationTransport ───────────────────────────────

export class PeerWorldFederationTransport implements WorldFederationTransport {
  async fetchWorldEvents(params: {
    peerUrl: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ events: WorldFederationEvent[]; nextCursor: string }> {
    const url = new URL("/api/v1/federation/events", params.peerUrl);
    if (params.cursor) url.searchParams.set("cursor", params.cursor);
    if (params.limit) url.searchParams.set("limit", String(params.limit));

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `federation fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as {
      events: Array<{
        event_id: string;
        event_type: FederationEventType;
        payload_json: string;
        received_at: string;
      }>;
      next_cursor: string;
    };

    return {
      events: body.events.map((e) => ({
        eventId: e.event_id,
        eventType: e.event_type,
        payloadJson: e.payload_json,
        receivedAt: e.received_at,
      })),
      nextCursor: body.next_cursor,
    };
  }

  async publishWorldEvents(params: {
    events: WorldFederationEvent[];
  }): Promise<void> {
    void params;
  }
}
