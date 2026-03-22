/**
 * World Federation Tests
 *
 * Validates peer management, event import, Fox directory sync,
 * and unreachable peer marking.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  addFederationPeer,
  listFederationPeers,
  removeFederationPeer,
  importFederationEvents,
  importFoxDirectory,
  exportLocalFoxDirectory,
  runWorldFederationSync,
  type WorldFederationTransport,
  type WorldFederationEvent,
} from "../metaworld/federation.js";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-world-federation-test-"),
  );
  return path.join(tmpDir, "test.db");
}

describe("world federation", () => {
  let db: OpenFoxDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  // ── Peer Management ──

  it("should add a federation peer", () => {
    const peer = addFederationPeer(db, "https://node2.example.com", "0xabc123");
    expect(peer.peerId).toMatch(/^wfp_/);
    expect(peer.peerUrl).toBe("https://node2.example.com");
    expect(peer.peerAddress).toBe("0xabc123");
    expect(peer.status).toBe("active");
    expect(peer.failureCount).toBe(0);
  });

  it("should list federation peers", () => {
    addFederationPeer(db, "https://node1.example.com");
    addFederationPeer(db, "https://node2.example.com");
    const peers = listFederationPeers(db);
    expect(peers).toHaveLength(2);
  });

  it("should filter peers by status", () => {
    addFederationPeer(db, "https://node1.example.com");
    const active = listFederationPeers(db, "active");
    expect(active).toHaveLength(1);
    const unreachable = listFederationPeers(db, "unreachable");
    expect(unreachable).toHaveLength(0);
  });

  it("should remove a federation peer", () => {
    const peer = addFederationPeer(db, "https://node1.example.com");
    removeFederationPeer(db, peer.peerId);
    const peers = listFederationPeers(db);
    expect(peers).toHaveLength(0);
  });

  // ── Event Import ──

  it("should import federation events", () => {
    const peer = addFederationPeer(db, "https://node1.example.com");

    const events: WorldFederationEvent[] = [
      {
        eventId: "wfe_001",
        eventType: "group_registered",
        payloadJson: JSON.stringify({ group_id: "grp-1" }),
        receivedAt: new Date().toISOString(),
      },
      {
        eventId: "wfe_002",
        eventType: "intent_published",
        payloadJson: JSON.stringify({ intent_id: "int-1" }),
        receivedAt: new Date().toISOString(),
      },
    ];

    const result = importFederationEvents(db, peer.peerId, events);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("should skip duplicate events", () => {
    const peer = addFederationPeer(db, "https://node1.example.com");

    const events: WorldFederationEvent[] = [
      {
        eventId: "wfe_dup_001",
        eventType: "group_registered",
        payloadJson: JSON.stringify({ group_id: "grp-1" }),
        receivedAt: new Date().toISOString(),
      },
    ];

    importFederationEvents(db, peer.peerId, events);
    const result2 = importFederationEvents(db, peer.peerId, events);
    expect(result2.imported).toBe(0);
    expect(result2.skipped).toBe(1);
  });

  it("should apply fox_profile_updated events to search index", () => {
    const peer = addFederationPeer(db, "https://node1.example.com");

    const events: WorldFederationEvent[] = [
      {
        eventId: "wfe_fox_001",
        eventType: "fox_profile_updated",
        payloadJson: JSON.stringify({
          address: "0xf71d99c2b05b3ab38ebabfae54f08b149f9dffa9fd49cf69e20b9f0ea86514f2",
          display_name: "Remote Fox",
          bio: "A fox from another node",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
        receivedAt: new Date().toISOString(),
      },
    ];

    importFederationEvents(db, peer.peerId, events);

    const entry = db.raw
      .prepare(
        `SELECT * FROM world_search_index WHERE entry_id = ?`,
      )
      .get("fox:0xf71d99c2b05b3ab38ebabfae54f08b149f9dffa9fd49cf69e20b9f0ea86514f2") as any;

    expect(entry).toBeDefined();
    expect(entry.searchable_text).toContain("Remote Fox");
  });

  // ── Fox Directory Import ──

  it("should import Fox directory entries", () => {
    const peer = addFederationPeer(db, "https://node1.example.com");

    const result = importFoxDirectory({
      db,
      entries: [
        {
          address: "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d",
          displayName: "Fox A",
          bio: "First fox",
          tnsName: "fox-a.tos",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          address: "0x473302ca547d5f9877e272cffe58d4def43198b66ba35cff4b2e584be19efa05",
          displayName: "Fox B",
          bio: null,
          tnsName: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      peerId: peer.peerId,
    });

    expect(result.imported).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.conflicts).toBe(0);
  });

  it("should resolve Fox directory conflicts with latest timestamp", () => {
    const peer = addFederationPeer(db, "https://node1.example.com");
    const addr = "0xdf96edbc954f43d46dc80e0180291bb781ac0a8a3a69c785631d4193e9a9d5e7";

    // Import old entry
    importFoxDirectory({
      db,
      entries: [
        {
          address: addr,
          displayName: "Fox Old",
          bio: null,
          tnsName: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      peerId: peer.peerId,
    });

    // Import newer — should update
    const result1 = importFoxDirectory({
      db,
      entries: [
        {
          address: addr,
          displayName: "Fox New",
          bio: "Updated bio",
          tnsName: null,
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      peerId: peer.peerId,
    });

    expect(result1.updated).toBe(1);

    // Import older — should be a conflict (skip)
    const result2 = importFoxDirectory({
      db,
      entries: [
        {
          address: addr,
          displayName: "Fox Ancient",
          bio: null,
          tnsName: null,
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      peerId: peer.peerId,
    });

    expect(result2.conflicts).toBe(1);
  });

  it("should export local Fox directory", () => {
    db.raw
      .prepare(
        `INSERT INTO fox_profiles (address, display_name, bio, tns_name, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d",
        "Local Fox",
        "A local fox",
        "local.tos",
        "2026-01-01T00:00:00.000Z",
      );

    const exports = exportLocalFoxDirectory(db);
    expect(exports).toHaveLength(1);
    expect(exports[0].displayName).toBe("Local Fox");
    expect(exports[0].tnsName).toBe("local.tos");
  });

  // ── Sync Orchestration ──

  it("should sync from peers using transport", async () => {
    addFederationPeer(db, "https://node1.example.com");

    const mockTransport: WorldFederationTransport = {
      async fetchWorldEvents() {
        return {
          events: [
            {
              eventId: "wfe_sync_001",
              eventType: "settlement_completed" as const,
              payloadJson: JSON.stringify({ settlement_id: "stl-1" }),
              receivedAt: new Date().toISOString(),
            },
          ],
          nextCursor: "cursor_after_001",
        };
      },
      async publishWorldEvents() {},
    };

    const result = await runWorldFederationSync({
      db,
      transports: [mockTransport],
    });

    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);

    const peers = listFederationPeers(db);
    expect(peers[0].lastCursor).toBe("cursor_after_001");
    expect(peers[0].lastSyncAt).toBeTruthy();
    expect(peers[0].failureCount).toBe(0);
  });

  it("should mark peer as unreachable after 3 failures", async () => {
    const peer = addFederationPeer(db, "https://bad-node.example.com");

    const failingTransport: WorldFederationTransport = {
      async fetchWorldEvents() {
        throw new Error("connection refused");
      },
      async publishWorldEvents() {},
    };

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await runWorldFederationSync({
        db,
        transports: [failingTransport],
      });
    }

    const peers = listFederationPeers(db);
    const updated = peers.find((p) => p.peerId === peer.peerId);
    expect(updated?.status).toBe("unreachable");
    expect(updated?.failureCount).toBe(3);
  });
});
