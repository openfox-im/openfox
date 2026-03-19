/**
 * On-Chain Group Anchoring
 *
 * Registers groups and publishes state commitments to the TOS chain
 * via GROUP_REGISTER and GROUP_STATE_COMMIT system actions.
 */

import { ulid } from "ulid";
import { keccak256, toHex, type Hex } from "tosdk";
import type { OpenFoxDatabase } from "../types.js";
import type { HexString } from "../chain/address.js";
import { sendSystemAction } from "../chain/client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("chain-anchor");

export interface ChainCommitmentRecord {
  commitmentId: string;
  groupId: string;
  actionType: "register" | "state_commit";
  epoch: number;
  membersRoot: string;
  eventsMerkleRoot: string | null;
  treasuryBalanceTomi: string | null;
  txHash: string;
  blockNumber: number | null;
  createdAt: string;
}

export type SendActionFn = (params: {
  rpcUrl: string;
  privateKey: HexString;
  action: string;
  payload?: Record<string, unknown>;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}) => Promise<{
  signed: any;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}>;

const ZERO_HASH = "0x" + "0".repeat(64);

/**
 * Build a Merkle root from all accepted group events' hashes.
 * Simple binary tree: pair adjacent hashes, keccak256 each pair, repeat until root.
 * If odd number, duplicate last hash.
 */
export function buildEventsMerkleRoot(
  db: OpenFoxDatabase,
  groupId: string,
): string {
  const stmt = db.raw.prepare(
    "SELECT event_hash FROM group_events WHERE group_id = ? AND reducer_status = 'accepted' ORDER BY event_id",
  );
  const rows = stmt.all(groupId) as Array<{ event_hash: string }>;

  if (rows.length === 0) return ZERO_HASH;

  let hashes = rows.map((r) => r.event_hash);

  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = i + 1 < hashes.length ? hashes[i + 1] : left;
      // Concatenate left + right (stripping 0x prefix from right)
      const combined = left + right.replace("0x", "");
      next.push(keccak256(combined as Hex));
    }
    hashes = next;
  }

  return hashes[0];
}

function mapCommitmentRow(row: any): ChainCommitmentRecord {
  return {
    commitmentId: row.commitment_id,
    groupId: row.group_id,
    actionType: row.action_type,
    epoch: row.epoch,
    membersRoot: row.members_root,
    eventsMerkleRoot: row.events_merkle_root ?? null,
    treasuryBalanceTomi: row.treasury_balance_tomi ?? null,
    txHash: row.tx_hash,
    blockNumber: row.block_number ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Register a group on-chain via GROUP_REGISTER system action.
 */
export async function registerGroupOnChain(params: {
  db: OpenFoxDatabase;
  groupId: string;
  privateKey: HexString;
  rpcUrl: string;
  sendAction?: SendActionFn;
}): Promise<{ txHash: string; commitmentId: string }> {
  const { db, groupId, privateKey, rpcUrl } = params;
  const send = params.sendAction ?? sendSystemAction;

  const group = db.raw
    .prepare("SELECT * FROM groups WHERE group_id = ?")
    .get(groupId) as any | undefined;

  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }

  // Check for treasury address
  const treasury = db.raw
    .prepare("SELECT treasury_address FROM group_treasury WHERE group_id = ?")
    .get(groupId) as { treasury_address: string } | undefined;

  const manifestHash = keccak256(
    toHex(
      JSON.stringify({
        name: group.name,
        description: group.description,
        visibility: group.visibility,
        joinMode: group.join_mode,
      }),
    ),
  );

  const result = await send({
    rpcUrl,
    privateKey,
    action: "GROUP_REGISTER",
    payload: {
      group_id: groupId,
      manifest_hash: manifestHash,
      treasury_address: treasury?.treasury_address ?? "",
      creator_address: group.creator_address,
      members_root: group.current_members_root,
    },
  });

  const commitmentId = ulid();
  const now = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO group_chain_commitments
       (commitment_id, group_id, action_type, epoch, members_root, events_merkle_root, treasury_balance_tomi, tx_hash, block_number, created_at)
       VALUES (?, ?, 'register', ?, ?, NULL, NULL, ?, NULL, ?)`,
    )
    .run(
      commitmentId,
      groupId,
      group.current_epoch ?? 0,
      group.current_members_root,
      result.txHash,
      now,
    );

  logger.info(
    `Registered group ${groupId} on-chain, tx=${result.txHash}, commitment=${commitmentId}`,
  );

  return { txHash: result.txHash, commitmentId };
}

/**
 * Publish a group state commitment on-chain via GROUP_STATE_COMMIT system action.
 */
export async function publishGroupStateCommitment(params: {
  db: OpenFoxDatabase;
  groupId: string;
  privateKey: HexString;
  rpcUrl: string;
  sendAction?: SendActionFn;
}): Promise<{ txHash: string; commitmentId: string }> {
  const { db, groupId, privateKey, rpcUrl } = params;
  const send = params.sendAction ?? sendSystemAction;

  const group = db.raw
    .prepare("SELECT * FROM groups WHERE group_id = ?")
    .get(groupId) as any | undefined;

  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }

  const eventsMerkleRoot = buildEventsMerkleRoot(db, groupId);

  // Get treasury balance if available
  const treasury = db.raw
    .prepare("SELECT balance_tomi FROM group_treasury WHERE group_id = ?")
    .get(groupId) as { balance_tomi: string } | undefined;

  const treasuryBalanceTomi = treasury?.balance_tomi ?? "0";
  const epoch = group.current_epoch ?? 0;
  const membersRoot = group.current_members_root;

  const result = await send({
    rpcUrl,
    privateKey,
    action: "GROUP_STATE_COMMIT",
    payload: {
      group_id: groupId,
      epoch,
      members_root: membersRoot,
      events_merkle_root: eventsMerkleRoot,
      treasury_balance_tomi: treasuryBalanceTomi,
    },
  });

  const commitmentId = ulid();
  const now = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO group_chain_commitments
       (commitment_id, group_id, action_type, epoch, members_root, events_merkle_root, treasury_balance_tomi, tx_hash, block_number, created_at)
       VALUES (?, ?, 'state_commit', ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      commitmentId,
      groupId,
      epoch,
      membersRoot,
      eventsMerkleRoot,
      treasuryBalanceTomi,
      result.txHash,
      now,
    );

  logger.info(
    `Published state commitment for group ${groupId} epoch=${epoch}, tx=${result.txHash}, commitment=${commitmentId}`,
  );

  return { txHash: result.txHash, commitmentId };
}

/**
 * List recent chain commitments for a group, ordered by epoch descending.
 */
export function listChainCommitments(
  db: OpenFoxDatabase,
  groupId: string,
  limit: number = 20,
): ChainCommitmentRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_chain_commitments
       WHERE group_id = ?
       ORDER BY epoch DESC, created_at DESC
       LIMIT ?`,
    )
    .all(groupId, limit) as any[];

  return rows.map(mapCommitmentRow);
}

/**
 * Get the most recent chain commitment for a group.
 */
export function getLatestChainCommitment(
  db: OpenFoxDatabase,
  groupId: string,
): ChainCommitmentRecord | null {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_chain_commitments
       WHERE group_id = ?
       ORDER BY epoch DESC, created_at DESC
       LIMIT 1`,
    )
    .get(groupId) as any | undefined;

  return row ? mapCommitmentRow(row) : null;
}
