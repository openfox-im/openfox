/**
 * Global Reputation Graph Tests
 *
 * Validates multi-dimensional reputation scoring, exponential decay,
 * leaderboards, trust paths, and attestation sign/verify/import.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  emitReputationEvent,
  getReputationCard,
  getReputationLeaderboard,
  findTrustPath,
  signReputationAttestation,
  verifyReputationAttestation,
  importReputationAttestation,
  listReputationEvents,
  type ReputationAttestation,
} from "../metaworld/reputation.js";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-world-reputation-test-"),
  );
  return path.join(tmpDir, "test.db");
}

const ADDR_A = "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d";
const ADDR_B = "0x473302ca547d5f9877e272cffe58d4def43198b66ba35cff4b2e584be19efa05";
const ADDR_C = "0xdf96edbc954f43d46dc80e0180291bb781ac0a8a3a69c785631d4193e9a9d5e7";
const ADDR_ISSUER = "0xf4897a85e6ac20f6b7b22e2c3a8fac52fb6c36430b80655354e5aa4f5e1a3533";
const GROUP_1 = "group-rep-1";
const GROUP_2 = "group-rep-2";

describe("global reputation graph", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;

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

  it("emit event creates record and updates score", () => {
    const event = emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.8,
      sourceType: "intent_completion",
      issuerAddress: ADDR_ISSUER,
    });

    expect(event.eventId).toBeTruthy();
    expect(event.targetAddress).toBe(ADDR_A);
    expect(event.dimension).toBe("reliability");
    expect(event.delta).toBe(0.8);

    // Score should be updated
    const card = getReputationCard(db, ADDR_A);
    expect(card.dimensions.length).toBe(1);
    expect(card.dimensions[0].dimension).toBe("reliability");
    expect(card.dimensions[0].eventCount).toBe(1);
    expect(card.dimensions[0].score).toBeGreaterThan(0);
  });

  it("multiple events apply exponential decay weighting recent higher", () => {
    // Emit an old negative event
    const oldEvent = emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "quality",
      delta: -0.5,
      sourceType: "moderation",
      issuerAddress: ADDR_ISSUER,
    });

    // Backdate the old event to 100 days ago
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.raw
      .prepare(`UPDATE world_reputation_events SET created_at = ? WHERE event_id = ?`)
      .run(oldDate, oldEvent.eventId);

    // Emit a recent positive event
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "quality",
      delta: 0.5,
      sourceType: "peer_endorsement",
      issuerAddress: ADDR_ISSUER,
    });

    const card = getReputationCard(db, ADDR_A);
    const qualityDim = card.dimensions.find((d) => d.dimension === "quality");
    expect(qualityDim).toBeTruthy();
    // Recent positive should outweigh old negative due to decay
    expect(qualityDim!.score).toBeGreaterThan(0.5);
  });

  it("positive deltas produce score > 0.5", () => {
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "collaboration",
      delta: 0.9,
      sourceType: "peer_endorsement",
      issuerAddress: ADDR_ISSUER,
    });

    const card = getReputationCard(db, ADDR_A);
    const dim = card.dimensions.find((d) => d.dimension === "collaboration");
    expect(dim!.score).toBeGreaterThan(0.5);
  });

  it("negative deltas produce score < 0.5", () => {
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "economic",
      delta: -0.7,
      sourceType: "settlement",
      issuerAddress: ADDR_ISSUER,
    });

    const card = getReputationCard(db, ADDR_A);
    const dim = card.dimensions.find((d) => d.dimension === "economic");
    expect(dim!.score).toBeLessThan(0.5);
  });

  it("mixed deltas produce score reflecting balance", () => {
    // Equal positive and negative, same time -> score = 0.5
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "moderation",
      delta: 0.5,
      sourceType: "moderation",
      issuerAddress: ADDR_ISSUER,
    });
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "moderation",
      delta: -0.5,
      sourceType: "moderation",
      issuerAddress: ADDR_B,
    });

    const card = getReputationCard(db, ADDR_A);
    const dim = card.dimensions.find((d) => d.dimension === "moderation");
    // Should be approximately 0.5 since deltas cancel out
    expect(dim!.score).toBeCloseTo(0.5, 1);
  });

  it("reputation card returns all dimensions", () => {
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.8,
      sourceType: "intent_completion",
      issuerAddress: ADDR_ISSUER,
    });
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "quality",
      delta: 0.6,
      sourceType: "peer_endorsement",
      issuerAddress: ADDR_ISSUER,
    });
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "collaboration",
      delta: 0.4,
      sourceType: "peer_endorsement",
      issuerAddress: ADDR_ISSUER,
    });

    const card = getReputationCard(db, ADDR_A);
    expect(card.address).toBe(ADDR_A);
    expect(card.entityType).toBe("fox");
    expect(card.dimensions.length).toBe(3);
    expect(card.overallScore).toBeGreaterThan(0);
    // Overall is average of dimension scores
    const expectedOverall =
      card.dimensions.reduce((s, d) => s + d.score, 0) / card.dimensions.length;
    expect(card.overallScore).toBeCloseTo(expectedOverall, 5);
  });

  it("leaderboard sorted by score descending", () => {
    // Create multiple foxes with different effective scores.
    // Mix positive and negative events so the decay-normalized scores differ.
    // ADDR_A: positive + negative -> balanced -> ~0.5
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.3,
      sourceType: "intent_completion",
      issuerAddress: ADDR_ISSUER,
    });
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "reliability",
      delta: -0.3,
      sourceType: "moderation",
      issuerAddress: ADDR_ISSUER,
    });

    // ADDR_B: strong positive only -> high score
    emitReputationEvent(db, {
      targetAddress: ADDR_B,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.9,
      sourceType: "intent_completion",
      issuerAddress: ADDR_ISSUER,
    });

    // ADDR_C: positive with small negative -> moderate score
    emitReputationEvent(db, {
      targetAddress: ADDR_C,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.6,
      sourceType: "intent_completion",
      issuerAddress: ADDR_ISSUER,
    });
    emitReputationEvent(db, {
      targetAddress: ADDR_C,
      targetType: "fox",
      dimension: "reliability",
      delta: -0.1,
      sourceType: "moderation",
      issuerAddress: ADDR_ISSUER,
    });

    const leaderboard = getReputationLeaderboard(db, "fox", "reliability", 10);
    expect(leaderboard.length).toBe(3);
    expect(leaderboard[0].address).toBe(ADDR_B); // highest: all positive
    expect(leaderboard[2].address).toBe(ADDR_A); // lowest: balanced
    // Verify descending order
    for (let i = 1; i < leaderboard.length; i++) {
      expect(leaderboard[i - 1].score).toBeGreaterThanOrEqual(leaderboard[i].score);
    }
  });

  it("trust path through shared group returns path", () => {
    // Set up group membership: A and B in GROUP_1, B and C in GROUP_2
    const now = new Date().toISOString();
    db.raw
      .prepare(
        `INSERT INTO groups (group_id, name, description, visibility, join_mode, max_members, tags_json, creator_address, current_policy_hash, current_members_root, created_at, updated_at)
         VALUES (?, 'TestGroup1', 'test', 'public', 'invite_only', 100, '[]', ?, 'hash1', 'root1', ?, ?)`,
      )
      .run(GROUP_1, ADDR_ISSUER, now, now);
    db.raw
      .prepare(
        `INSERT INTO groups (group_id, name, description, visibility, join_mode, max_members, tags_json, creator_address, current_policy_hash, current_members_root, created_at, updated_at)
         VALUES (?, 'TestGroup2', 'test', 'public', 'invite_only', 100, '[]', ?, 'hash2', 'root2', ?, ?)`,
      )
      .run(GROUP_2, ADDR_ISSUER, now, now);

    db.raw
      .prepare(
        `INSERT INTO group_members (group_id, member_address, membership_state, joined_via, joined_at, last_event_id)
         VALUES (?, ?, 'active', 'genesis', ?, 'evt-3')`,
      )
      .run(GROUP_1, ADDR_A, now);
    db.raw
      .prepare(
        `INSERT INTO group_members (group_id, member_address, membership_state, joined_via, joined_at, last_event_id)
         VALUES (?, ?, 'active', 'genesis', ?, 'evt-4')`,
      )
      .run(GROUP_1, ADDR_B, now);
    db.raw
      .prepare(
        `INSERT INTO group_members (group_id, member_address, membership_state, joined_via, joined_at, last_event_id)
         VALUES (?, ?, 'active', 'genesis', ?, 'evt-5')`,
      )
      .run(GROUP_2, ADDR_B, now);
    db.raw
      .prepare(
        `INSERT INTO group_members (group_id, member_address, membership_state, joined_via, joined_at, last_event_id)
         VALUES (?, ?, 'active', 'genesis', ?, 'evt-6')`,
      )
      .run(GROUP_2, ADDR_C, now);

    // A -> B through GROUP_1
    const directPath = findTrustPath(db, ADDR_A, ADDR_B);
    expect(directPath).not.toBeNull();
    expect(directPath!.hops.length).toBe(1);
    expect(directPath!.hops[0].type).toBe("shared_group");
    expect(directPath!.hops[0].ref).toBe(GROUP_1);
    expect(directPath!.strength).toBe(0.5); // 1 / (1 + 1)

    // A -> C through GROUP_1 -> B -> GROUP_2
    const indirectPath = findTrustPath(db, ADDR_A, ADDR_C);
    expect(indirectPath).not.toBeNull();
    expect(indirectPath!.hops.length).toBe(2);
    expect(indirectPath!.strength).toBeCloseTo(1 / 3, 5); // 1 / (2 + 1)
  });

  it("trust path no connection returns null", () => {
    const path = findTrustPath(db, ADDR_A, ADDR_C);
    expect(path).toBeNull();
  });

  it("attestation sign produces signature", () => {
    const payload: Omit<ReputationAttestation, "signature"> = {
      targetAddress: ADDR_A,
      dimension: "reliability",
      score: 0.85,
      eventCount: 10,
      issuerGroupId: GROUP_1,
      issuerAddress: ADDR_ISSUER,
      timestamp: new Date().toISOString(),
    };

    const attestation = signReputationAttestation(payload, "0xfakeprivatekey");
    expect(attestation.signature).toBeTruthy();
    expect(typeof attestation.signature).toBe("string");
    expect(attestation.signature.startsWith("0x")).toBe(true);
  });

  it("attestation verify valid signature passes", () => {
    const payload: Omit<ReputationAttestation, "signature"> = {
      targetAddress: ADDR_A,
      dimension: "quality",
      score: 0.9,
      eventCount: 5,
      issuerGroupId: GROUP_1,
      issuerAddress: ADDR_ISSUER,
      timestamp: new Date().toISOString(),
    };

    const attestation = signReputationAttestation(payload, "0xfakeprivatekey");
    expect(verifyReputationAttestation(attestation)).toBe(true);
  });

  it("attestation tampered verification fails", () => {
    const payload: Omit<ReputationAttestation, "signature"> = {
      targetAddress: ADDR_A,
      dimension: "reliability",
      score: 0.7,
      eventCount: 3,
      issuerGroupId: GROUP_1,
      issuerAddress: ADDR_ISSUER,
      timestamp: new Date().toISOString(),
    };

    const attestation = signReputationAttestation(payload, "0xfakeprivatekey");
    // Tamper with the score
    const tampered = { ...attestation, score: 0.99 };
    expect(verifyReputationAttestation(tampered)).toBe(false);
  });

  it("import attestation creates reputation event", () => {
    const payload: Omit<ReputationAttestation, "signature"> = {
      targetAddress: ADDR_A,
      dimension: "collaboration",
      score: 0.8,
      eventCount: 7,
      issuerGroupId: GROUP_1,
      issuerAddress: ADDR_ISSUER,
      timestamp: new Date().toISOString(),
    };

    const attestation = signReputationAttestation(payload, "0xfakeprivatekey");
    const event = importReputationAttestation(db, attestation);

    expect(event.targetAddress).toBe(ADDR_A);
    expect(event.dimension).toBe("collaboration");
    expect(event.sourceType).toBe("peer_endorsement");
    expect(event.issuerGroupId).toBe(GROUP_1);

    // Should have created a score record
    const card = getReputationCard(db, ADDR_A);
    expect(card.dimensions.length).toBe(1);
    expect(card.dimensions[0].dimension).toBe("collaboration");
  });

  it("listReputationEvents returns events for target", () => {
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.5,
      sourceType: "intent_completion",
      issuerAddress: ADDR_ISSUER,
    });
    emitReputationEvent(db, {
      targetAddress: ADDR_A,
      targetType: "fox",
      dimension: "quality",
      delta: 0.3,
      sourceType: "peer_endorsement",
      issuerAddress: ADDR_ISSUER,
    });

    const allEvents = listReputationEvents(db, ADDR_A);
    expect(allEvents.length).toBe(2);

    const reliabilityEvents = listReputationEvents(db, ADDR_A, "reliability");
    expect(reliabilityEvents.length).toBe(1);
    expect(reliabilityEvents[0].dimension).toBe("reliability");
  });
});
