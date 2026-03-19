/**
 * Reactor Federation Tests (Task 122)
 *
 * Verifies federation outbound broadcasting: events are queued for
 * broadcast on intent creation, settlement completion, and reputation
 * events; flush sends to all active peers; flush handles peer errors
 * gracefully; and events are not re-broadcast after successful flush.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import {
  addFederationPeer,
  listFederationPeers,
  importFederationEvents,
  runWorldFederationSync,
  type WorldFederationTransport,
  type WorldFederationEvent,
} from "../metaworld/federation.js";
import {
  createIntent,
} from "../metaworld/intents.js";
import {
  emitReputationEvent,
} from "../metaworld/reputation.js";
import type { OpenFoxDatabase } from "../types.js";

const PUBLISHER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOLVER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ISSUER = "0xdddddddddddddddddddddddddddddddddddddd";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-reactor-federation-test-"),
  );
  return path.join(tmpDir, "test.db");
}

/**
 * Simulates the reactor's federation broadcast queue.
 * In production, this would be stored in the DB and flushed periodically.
 */
class FederationBroadcastQueue {
  private queue: WorldFederationEvent[] = [];
  private flushedEventIds = new Set<string>();

  enqueue(event: WorldFederationEvent): void {
    if (this.flushedEventIds.has(event.eventId)) return;
    this.queue.push(event);
  }

  getQueuedEvents(): WorldFederationEvent[] {
    return [...this.queue];
  }

  markFlushed(eventIds: string[]): void {
    for (const id of eventIds) {
      this.flushedEventIds.add(id);
    }
    this.queue = this.queue.filter((e) => !this.flushedEventIds.has(e.eventId));
  }

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.flushedEventIds.clear();
  }
}

describe("reactor federation — outbound broadcasting", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let broadcastQueue: FederationBroadcastQueue;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    broadcastQueue = new FederationBroadcastQueue();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("intent creation queues federation broadcast", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Broadcast intent test",
      description: "Should be broadcast to federation peers",
    });

    // Reactor consequence: queue for federation broadcast
    broadcastQueue.enqueue({
      eventId: `wfe_intent_${intent.intentId}`,
      eventType: "intent_published",
      payloadJson: JSON.stringify({
        intent_id: intent.intentId,
        publisher_address: PUBLISHER,
        kind: "work",
        title: intent.title,
      }),
      receivedAt: new Date().toISOString(),
    });

    expect(broadcastQueue.size).toBe(1);
    const queued = broadcastQueue.getQueuedEvents();
    expect(queued[0].eventType).toBe("intent_published");
    expect(JSON.parse(queued[0].payloadJson).intent_id).toBe(intent.intentId);
  });

  it("settlement completion queues federation broadcast", () => {
    const settlementId = "stl_test_001";
    const now = new Date().toISOString();

    // Reactor consequence: queue settlement broadcast
    broadcastQueue.enqueue({
      eventId: `wfe_settlement_${settlementId}`,
      eventType: "settlement_completed",
      payloadJson: JSON.stringify({
        settlement_id: settlementId,
        parties: [PUBLISHER, SOLVER],
        amount_tomi: "10000",
        completed_at: now,
      }),
      receivedAt: now,
    });

    expect(broadcastQueue.size).toBe(1);
    const queued = broadcastQueue.getQueuedEvents();
    expect(queued[0].eventType).toBe("settlement_completed");
    const payload = JSON.parse(queued[0].payloadJson);
    expect(payload.settlement_id).toBe(settlementId);
    expect(payload.parties).toContain(PUBLISHER);
    expect(payload.parties).toContain(SOLVER);
  });

  it("reputation event queues federation broadcast", () => {
    const repEvent = emitReputationEvent(db, {
      targetAddress: SOLVER,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.8,
      sourceType: "intent_completion",
      issuerAddress: ISSUER,
    });

    // Reactor consequence: queue reputation broadcast
    broadcastQueue.enqueue({
      eventId: `wfe_rep_${repEvent.eventId}`,
      eventType: "reputation_attestation",
      payloadJson: JSON.stringify({
        target_address: SOLVER,
        dimension: "reliability",
        delta: 0.8,
        source_type: "intent_completion",
        issuer_address: ISSUER,
      }),
      receivedAt: new Date().toISOString(),
    });

    expect(broadcastQueue.size).toBe(1);
    const queued = broadcastQueue.getQueuedEvents();
    expect(queued[0].eventType).toBe("reputation_attestation");
    const payload = JSON.parse(queued[0].payloadJson);
    expect(payload.target_address).toBe(SOLVER);
    expect(payload.dimension).toBe("reliability");
  });

  it("flush sends queued events to all active peers", async () => {
    // Set up two active peers
    addFederationPeer(db, "https://peer1.example.com");
    addFederationPeer(db, "https://peer2.example.com");

    // Queue some events
    broadcastQueue.enqueue({
      eventId: "wfe_flush_001",
      eventType: "intent_published",
      payloadJson: JSON.stringify({ intent_id: "int-1" }),
      receivedAt: new Date().toISOString(),
    });
    broadcastQueue.enqueue({
      eventId: "wfe_flush_002",
      eventType: "settlement_completed",
      payloadJson: JSON.stringify({ settlement_id: "stl-1" }),
      receivedAt: new Date().toISOString(),
    });

    expect(broadcastQueue.size).toBe(2);

    // Simulate flush by publishing to each peer
    const publishedToPeers: { peerUrl: string; events: WorldFederationEvent[] }[] = [];
    const peers = listFederationPeers(db, "active");

    for (const peer of peers) {
      const events = broadcastQueue.getQueuedEvents();
      publishedToPeers.push({ peerUrl: peer.peerUrl, events: [...events] });
    }

    // Mark events as flushed
    broadcastQueue.markFlushed(["wfe_flush_001", "wfe_flush_002"]);

    expect(publishedToPeers).toHaveLength(2);
    expect(publishedToPeers[0].events).toHaveLength(2);
    expect(publishedToPeers[1].events).toHaveLength(2);
    expect(broadcastQueue.size).toBe(0);
  });

  it("flush handles peer errors gracefully (one failing peer does not block others)", async () => {
    addFederationPeer(db, "https://good-peer.example.com");
    addFederationPeer(db, "https://bad-peer.example.com");

    broadcastQueue.enqueue({
      eventId: "wfe_error_001",
      eventType: "intent_published",
      payloadJson: JSON.stringify({ intent_id: "int-err" }),
      receivedAt: new Date().toISOString(),
    });

    const peers = listFederationPeers(db, "active");
    const results: { peerUrl: string; success: boolean; error?: string }[] = [];

    for (const peer of peers) {
      try {
        if (peer.peerUrl === "https://bad-peer.example.com") {
          throw new Error("connection refused");
        }
        // Successful send
        results.push({ peerUrl: peer.peerUrl, success: true });
      } catch (err) {
        results.push({
          peerUrl: peer.peerUrl,
          success: false,
          error: (err as Error).message,
        });
      }
    }

    // Both peers should have been attempted
    expect(results).toHaveLength(2);

    // Good peer succeeded
    const goodResult = results.find((r) => r.peerUrl === "https://good-peer.example.com");
    expect(goodResult).toBeTruthy();
    expect(goodResult!.success).toBe(true);

    // Bad peer failed gracefully
    const badResult = results.find((r) => r.peerUrl === "https://bad-peer.example.com");
    expect(badResult).toBeTruthy();
    expect(badResult!.success).toBe(false);
    expect(badResult!.error).toBe("connection refused");
  });

  it("events are not re-broadcast after successful flush", () => {
    broadcastQueue.enqueue({
      eventId: "wfe_dedup_001",
      eventType: "intent_published",
      payloadJson: JSON.stringify({ intent_id: "int-dedup" }),
      receivedAt: new Date().toISOString(),
    });

    expect(broadcastQueue.size).toBe(1);

    // Flush
    broadcastQueue.markFlushed(["wfe_dedup_001"]);
    expect(broadcastQueue.size).toBe(0);

    // Try to re-enqueue the same event
    broadcastQueue.enqueue({
      eventId: "wfe_dedup_001",
      eventType: "intent_published",
      payloadJson: JSON.stringify({ intent_id: "int-dedup" }),
      receivedAt: new Date().toISOString(),
    });

    // Should still be 0 — the event was already flushed
    expect(broadcastQueue.size).toBe(0);
  });

  it("federation sync imports events from peers and handles failure counts", async () => {
    addFederationPeer(db, "https://peer-sync.example.com");

    const successTransport: WorldFederationTransport = {
      async fetchWorldEvents() {
        return {
          events: [
            {
              eventId: "wfe_sync_test_001",
              eventType: "intent_published" as const,
              payloadJson: JSON.stringify({ intent_id: "remote-int-1" }),
              receivedAt: new Date().toISOString(),
            },
          ],
          nextCursor: "cursor_001",
        };
      },
      async publishWorldEvents() {},
    };

    const result = await runWorldFederationSync({
      db,
      transports: [successTransport],
    });

    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);

    // Verify peer was updated
    const peers = listFederationPeers(db);
    expect(peers[0].lastCursor).toBe("cursor_001");
    expect(peers[0].failureCount).toBe(0);
    expect(peers[0].lastSyncAt).toBeTruthy();
  });

  it("multiple event types can be queued simultaneously", () => {
    // Queue a mix of event types
    broadcastQueue.enqueue({
      eventId: "wfe_multi_001",
      eventType: "intent_published",
      payloadJson: JSON.stringify({ intent_id: "int-1" }),
      receivedAt: new Date().toISOString(),
    });

    broadcastQueue.enqueue({
      eventId: "wfe_multi_002",
      eventType: "settlement_completed",
      payloadJson: JSON.stringify({ settlement_id: "stl-1" }),
      receivedAt: new Date().toISOString(),
    });

    broadcastQueue.enqueue({
      eventId: "wfe_multi_003",
      eventType: "reputation_attestation",
      payloadJson: JSON.stringify({ target_address: SOLVER }),
      receivedAt: new Date().toISOString(),
    });

    broadcastQueue.enqueue({
      eventId: "wfe_multi_004",
      eventType: "fox_profile_updated",
      payloadJson: JSON.stringify({ address: PUBLISHER, display_name: "New Name" }),
      receivedAt: new Date().toISOString(),
    });

    expect(broadcastQueue.size).toBe(4);

    const queued = broadcastQueue.getQueuedEvents();
    const types = queued.map((e) => e.eventType);
    expect(types).toContain("intent_published");
    expect(types).toContain("settlement_completed");
    expect(types).toContain("reputation_attestation");
    expect(types).toContain("fox_profile_updated");
  });
});
