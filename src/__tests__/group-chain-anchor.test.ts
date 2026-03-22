/**
 * Group Chain Anchor Tests
 *
 * Tests on-chain group anchoring: Merkle root building,
 * GROUP_REGISTER and GROUP_STATE_COMMIT system actions,
 * and commitment listing/retrieval.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase } from "../types.js";
import { keccak256 } from "@tosnetwork/tosdk";
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

const CREATOR_ADDR = "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d";
const GROUP_ID = "test-group-chain-1";
const PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000001" as any;
const RPC_URL = "http://localhost:9999";

const mockSendAction: SendActionFn = async (_params: any) => ({
  signed: {} as any,
  txHash: ("0x" + "ab".repeat(32)) as any,
  receipt: null,
});

function insertTestGroup(db: OpenFoxDatabase, groupId: string): void {
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO groups (group_id, name, description, visibility, join_mode, max_members, tags_json, creator_address, current_policy_hash, current_members_root, created_at, updated_at)
       VALUES (?, 'TestGroup', 'A test group', 'public', 'invite_only', 100, '[]', ?, 'hash1', '0xroot1', ?, ?)`,
    )
    .run(groupId, CREATOR_ADDR, now, now);
}

function insertTestEvent(
  db: OpenFoxDatabase,
  groupId: string,
  eventId: string,
  eventHash: string,
): void {
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO group_events (event_id, group_id, kind, epoch, actor_address, payload_json, signature, event_hash, created_at, reducer_status)
       VALUES (?, ?, 'message', 0, ?, '{}', 'sig', ?, ?, 'accepted')`,
    )
    .run(eventId, groupId, CREATOR_ADDR, eventHash, now);
}

describe("group chain anchor", () => {
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

  describe("buildEventsMerkleRoot", () => {
    it("returns zero hash when no events", () => {
      insertTestGroup(db, GROUP_ID);
      const root = buildEventsMerkleRoot(db, GROUP_ID);
      expect(root).toBe("0x" + "0".repeat(64));
    });

    it("returns the event hash directly when only one event", () => {
      insertTestGroup(db, GROUP_ID);
      const hash = keccak256("0x01");
      insertTestEvent(db, GROUP_ID, "evt-1", hash);
      const root = buildEventsMerkleRoot(db, GROUP_ID);
      // With one element, hashes.length is 1, so while loop doesn't execute
      expect(root).toBe(hash);
    });

    it("returns deterministic root with multiple events", () => {
      insertTestGroup(db, GROUP_ID);
      const h1 = keccak256("0x01");
      const h2 = keccak256("0x02");
      const h3 = keccak256("0x03");
      insertTestEvent(db, GROUP_ID, "evt-1", h1);
      insertTestEvent(db, GROUP_ID, "evt-2", h2);
      insertTestEvent(db, GROUP_ID, "evt-3", h3);

      const root = buildEventsMerkleRoot(db, GROUP_ID);
      expect(root).toBeTruthy();
      expect(root).toMatch(/^0x[0-9a-f]{64}$/);

      // Compute expected: pair(h1,h2) and pair(h3,h3), then pair those two
      const p1 = keccak256(h1 + h2.replace("0x", ""));
      const p2 = keccak256(h3 + h3.replace("0x", ""));
      const expected = keccak256(p1 + p2.replace("0x", ""));
      expect(root).toBe(expected);
    });

    it("is deterministic (same events give same root)", () => {
      insertTestGroup(db, GROUP_ID);
      const h1 = keccak256("0xaa");
      const h2 = keccak256("0xbb");
      insertTestEvent(db, GROUP_ID, "evt-1", h1);
      insertTestEvent(db, GROUP_ID, "evt-2", h2);

      const root1 = buildEventsMerkleRoot(db, GROUP_ID);
      const root2 = buildEventsMerkleRoot(db, GROUP_ID);
      expect(root1).toBe(root2);
    });

    it("ignores rejected events", () => {
      insertTestGroup(db, GROUP_ID);
      const h1 = keccak256("0x01");
      insertTestEvent(db, GROUP_ID, "evt-1", h1);

      // Insert a rejected event
      const now = new Date().toISOString();
      db.raw
        .prepare(
          `INSERT INTO group_events (event_id, group_id, kind, epoch, actor_address, payload_json, signature, event_hash, created_at, reducer_status)
           VALUES (?, ?, 'message', 0, ?, '{}', 'sig', ?, ?, 'rejected')`,
        )
        .run("evt-rejected", GROUP_ID, CREATOR_ADDR, keccak256("0xff"), now);

      // Root should be same as with just one accepted event
      const rootWith = buildEventsMerkleRoot(db, GROUP_ID);
      // With one accepted event, root is that event's hash
      expect(rootWith).toBe(h1);
    });
  });

  describe("registerGroupOnChain", () => {
    it("calls sendAction with GROUP_REGISTER and records commitment", async () => {
      insertTestGroup(db, GROUP_ID);
      const sendSpy = vi.fn(mockSendAction);

      const result = await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      expect(sendSpy).toHaveBeenCalledOnce();
      const callArgs = sendSpy.mock.calls[0][0];
      expect(callArgs.action).toBe("GROUP_REGISTER");
      expect(callArgs.payload.group_id).toBe(GROUP_ID);
      expect(callArgs.payload.creator_address).toBe(CREATOR_ADDR);
      expect(callArgs.payload.members_root).toBe("0xroot1");

      expect(result.txHash).toBe("0x" + "ab".repeat(32));
      expect(result.commitmentId).toBeTruthy();

      // Check DB record
      const commitment = getLatestChainCommitment(db, GROUP_ID);
      expect(commitment).not.toBeNull();
      expect(commitment!.actionType).toBe("register");
      expect(commitment!.txHash).toBe(result.txHash);
      expect(commitment!.commitmentId).toBe(result.commitmentId);
    });

    it("duplicate registration works (re-registers)", async () => {
      insertTestGroup(db, GROUP_ID);
      const sendSpy = vi.fn(mockSendAction);

      const r1 = await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });
      const r2 = await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(r1.commitmentId).not.toBe(r2.commitmentId);

      const commitments = listChainCommitments(db, GROUP_ID);
      expect(commitments.length).toBe(2);
    });

    it("throws when group not found", async () => {
      await expect(
        registerGroupOnChain({
          db,
          groupId: "nonexistent",
          privateKey: PRIVATE_KEY,
          rpcUrl: RPC_URL,
          sendAction: mockSendAction,
        }),
      ).rejects.toThrow("Group not found");
    });
  });

  describe("publishGroupStateCommitment", () => {
    it("calls sendAction with GROUP_STATE_COMMIT and records commitment", async () => {
      insertTestGroup(db, GROUP_ID);
      const h1 = keccak256("0x01");
      insertTestEvent(db, GROUP_ID, "evt-1", h1);

      const sendSpy = vi.fn(mockSendAction);

      const result = await publishGroupStateCommitment({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      expect(sendSpy).toHaveBeenCalledOnce();
      const callArgs = sendSpy.mock.calls[0][0];
      expect(callArgs.action).toBe("GROUP_STATE_COMMIT");
      expect(callArgs.payload.group_id).toBe(GROUP_ID);
      expect(callArgs.payload.epoch).toBe(1);
      expect(callArgs.payload.members_root).toBe("0xroot1");
      expect(callArgs.payload.events_merkle_root).toMatch(/^0x[0-9a-f]{64}$/);
      expect(callArgs.payload.treasury_balance_tomi).toBe("0");

      expect(result.txHash).toBe("0x" + "ab".repeat(32));
      expect(result.commitmentId).toBeTruthy();

      const commitment = getLatestChainCommitment(db, GROUP_ID);
      expect(commitment).not.toBeNull();
      expect(commitment!.actionType).toBe("state_commit");
      expect(commitment!.eventsMerkleRoot).toBeTruthy();
    });

    it("includes treasury balance when treasury exists", async () => {
      insertTestGroup(db, GROUP_ID);
      const now = new Date().toISOString();
      db.raw
        .prepare(
          `INSERT INTO group_treasury (group_id, treasury_address, balance_tomi, status, created_at, updated_at)
           VALUES (?, '0xtreas1', '1000000', 'active', ?, ?)`,
        )
        .run(GROUP_ID, now, now);

      const sendSpy = vi.fn(mockSendAction);

      await publishGroupStateCommitment({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      const callArgs = sendSpy.mock.calls[0][0];
      expect(callArgs.payload.treasury_balance_tomi).toBe("1000000");

      const commitment = getLatestChainCommitment(db, GROUP_ID);
      expect(commitment!.treasuryBalanceTomi).toBe("1000000");
    });
  });

  describe("listChainCommitments", () => {
    it("returns commitments ordered by epoch descending", async () => {
      insertTestGroup(db, GROUP_ID);
      const sendSpy = vi.fn(mockSendAction);

      // Register (epoch 0)
      await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      // Bump epoch and commit
      db.raw
        .prepare("UPDATE groups SET current_epoch = 2 WHERE group_id = ?")
        .run(GROUP_ID);
      await publishGroupStateCommitment({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      const commitments = listChainCommitments(db, GROUP_ID);
      expect(commitments.length).toBe(2);
      // First should be epoch 2 (higher epoch first)
      expect(commitments[0].epoch).toBe(2);
      expect(commitments[1].epoch).toBe(1);
    });

    it("respects limit parameter", async () => {
      insertTestGroup(db, GROUP_ID);
      const sendSpy = vi.fn(mockSendAction);

      await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });
      await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      const commitments = listChainCommitments(db, GROUP_ID, 1);
      expect(commitments.length).toBe(1);
    });
  });

  describe("getLatestChainCommitment", () => {
    it("returns null when no commitments exist", () => {
      insertTestGroup(db, GROUP_ID);
      const result = getLatestChainCommitment(db, GROUP_ID);
      expect(result).toBeNull();
    });

    it("returns most recent commitment", async () => {
      insertTestGroup(db, GROUP_ID);
      const sendSpy = vi.fn(mockSendAction);

      await registerGroupOnChain({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      db.raw
        .prepare("UPDATE groups SET current_epoch = 5 WHERE group_id = ?")
        .run(GROUP_ID);
      await publishGroupStateCommitment({
        db,
        groupId: GROUP_ID,
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        sendAction: sendSpy,
      });

      const latest = getLatestChainCommitment(db, GROUP_ID);
      expect(latest).not.toBeNull();
      expect(latest!.epoch).toBe(5);
      expect(latest!.actionType).toBe("state_commit");
    });
  });
});
