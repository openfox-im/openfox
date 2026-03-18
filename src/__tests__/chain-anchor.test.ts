/**
 * Chain Anchoring Tests
 *
 * Validates Merkle root building, on-chain group registration,
 * state commitment publishing, and commitment listing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  buildEventsMerkleRoot,
  registerGroupOnChain,
  publishGroupStateCommitment,
  listChainCommitments,
  getLatestChainCommitment,
  type SendActionFn,
} from "../group/chain-anchor.js";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-chain-anchor-test-"),
  );
  return path.join(tmpDir, "test.db");
}

const CREATOR_ADDR = "0xaaaa000000000000000000000000000000000001";
const MOCK_TX_HASH = "0x" + "ab".repeat(32);

function seedTestGroup(db: OpenFoxDatabase, groupId: string): void {
  db.raw
    .prepare(
      `INSERT INTO groups (
        group_id, name, description, visibility, join_mode,
        creator_address, current_epoch, current_policy_hash, current_members_root,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      groupId,
      "Test Group",
      "A test group",
      "public",
      "request_approval",
      CREATOR_ADDR,
      1,
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "active",
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

function seedGroupEvent(
  db: OpenFoxDatabase,
  groupId: string,
  eventHash: string,
): void {
  const eventId = `gev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.raw
    .prepare(
      `INSERT INTO group_events (
        event_id, group_id, kind, epoch, channel_id,
        actor_address, actor_agent_id, parent_event_ids_json,
        payload_json, signature, event_hash,
        created_at, expires_at, received_at, source_kind,
        reducer_status, rejection_reason
      ) VALUES (?, ?, 'test', 1, NULL,
        ?, NULL, '[]',
        '{}', '', ?,
        ?, NULL, ?, 'local',
        'accepted', NULL)`,
    )
    .run(
      eventId,
      groupId,
      CREATOR_ADDR,
      eventHash,
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

const mockSendAction: SendActionFn = async (params) => {
  return {
    signed: {},
    txHash: MOCK_TX_HASH as any,
    receipt: { blockNumber: 42 },
  };
};

describe("chain anchoring", () => {
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

  // ── Merkle Root ──

  it("should return zero hash for group with no events", () => {
    seedTestGroup(db, "group-empty");
    const root = buildEventsMerkleRoot(db, "group-empty");
    expect(root).toBe("0x" + "0".repeat(64));
  });

  it("should compute Merkle root for single event", () => {
    seedTestGroup(db, "group-single");
    seedGroupEvent(db, "group-single", "0x" + "aa".repeat(32));
    const root = buildEventsMerkleRoot(db, "group-single");
    // Single event: root is the hash itself
    expect(root).toBe("0x" + "aa".repeat(32));
  });

  it("should compute Merkle root for multiple events", () => {
    seedTestGroup(db, "group-multi");
    seedGroupEvent(db, "group-multi", "0x" + "aa".repeat(32));
    seedGroupEvent(db, "group-multi", "0x" + "bb".repeat(32));
    seedGroupEvent(db, "group-multi", "0x" + "cc".repeat(32));
    const root = buildEventsMerkleRoot(db, "group-multi");
    expect(root).toMatch(/^0x[a-f0-9]{64}$/);
    // Root should differ from any individual hash
    expect(root).not.toBe("0x" + "aa".repeat(32));
    expect(root).not.toBe("0x" + "bb".repeat(32));
    expect(root).not.toBe("0x" + "cc".repeat(32));
  });

  // ── Register ──

  it("should register a group on-chain", async () => {
    seedTestGroup(db, "group-register");
    const result = await registerGroupOnChain({
      db,
      groupId: "group-register",
      privateKey: ("0x" + "ff".repeat(32)) as any,
      rpcUrl: "http://localhost:8545",
      sendAction: mockSendAction,
    });
    expect(result.txHash).toBe(MOCK_TX_HASH);
    expect(result.commitmentId).toBeTruthy();

    const commitments = listChainCommitments(db, "group-register");
    expect(commitments).toHaveLength(1);
    expect(commitments[0].actionType).toBe("register");
  });

  it("should throw for nonexistent group", async () => {
    await expect(
      registerGroupOnChain({
        db,
        groupId: "nonexistent",
        privateKey: ("0x" + "ff".repeat(32)) as any,
        rpcUrl: "http://localhost:8545",
        sendAction: mockSendAction,
      }),
    ).rejects.toThrow(/Group not found/);
  });

  // ── State Commit ──

  it("should publish a state commitment", async () => {
    seedTestGroup(db, "group-commit");
    seedGroupEvent(db, "group-commit", "0x" + "dd".repeat(32));

    const result = await publishGroupStateCommitment({
      db,
      groupId: "group-commit",
      privateKey: ("0x" + "ff".repeat(32)) as any,
      rpcUrl: "http://localhost:8545",
      sendAction: mockSendAction,
    });

    expect(result.txHash).toBe(MOCK_TX_HASH);
    expect(result.commitmentId).toBeTruthy();

    const commitment = getLatestChainCommitment(db, "group-commit");
    expect(commitment).not.toBeNull();
    expect(commitment!.actionType).toBe("state_commit");
    expect(commitment!.eventsMerkleRoot).toMatch(/^0x[a-f0-9]{64}$/);
  });

  // ── Listing ──

  it("should list commitments ordered by epoch", async () => {
    seedTestGroup(db, "group-list");

    await registerGroupOnChain({
      db,
      groupId: "group-list",
      privateKey: ("0x" + "ff".repeat(32)) as any,
      rpcUrl: "http://localhost:8545",
      sendAction: mockSendAction,
    });

    await publishGroupStateCommitment({
      db,
      groupId: "group-list",
      privateKey: ("0x" + "ff".repeat(32)) as any,
      rpcUrl: "http://localhost:8545",
      sendAction: mockSendAction,
    });

    const commitments = listChainCommitments(db, "group-list");
    expect(commitments).toHaveLength(2);
  });

  it("should return null for group with no commitments", () => {
    seedTestGroup(db, "group-no-commit");
    const latest = getLatestChainCommitment(db, "group-no-commit");
    expect(latest).toBeNull();
  });
});
