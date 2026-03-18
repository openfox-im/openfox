/**
 * World Follows — follow foxes and groups without joining.
 *
 * Provides a social follow graph layered on top of the existing
 * group membership model. Following is a lighter relationship
 * than membership: it signals interest and drives personalized
 * feed ranking, recommendations, and subscription notifications.
 */

import type { OpenFoxDatabase } from "../types.js";

export interface WorldFollowRecord {
  followerAddress: string;
  targetAddress: string | null;
  targetGroupId: string | null;
  followKind: "fox" | "group";
  createdAt: string;
}

export interface WorldFollowCounts {
  followingFoxes: number;
  followingGroups: number;
  followers: number;
}

function normalizeAddressLike(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`invalid address-like value: ${value}`);
  }
  return trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapFollowRow(row: {
  follower_address: string;
  target_address: string | null;
  target_group_id: string | null;
  follow_kind: string;
  created_at: string;
}): WorldFollowRecord {
  return {
    followerAddress: row.follower_address,
    targetAddress: row.target_address || null,
    targetGroupId: row.target_group_id || null,
    followKind: row.follow_kind as "fox" | "group",
    createdAt: row.created_at,
  };
}

export function followFox(
  db: OpenFoxDatabase,
  params: { followerAddress: string; targetAddress: string },
): WorldFollowRecord {
  const followerAddress = normalizeAddressLike(params.followerAddress);
  const targetAddress = normalizeAddressLike(params.targetAddress);
  if (followerAddress === targetAddress) {
    throw new Error("cannot follow yourself");
  }
  const createdAt = nowIso();
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO world_follows (
         follower_address, target_address, target_group_id, follow_kind, created_at
       ) VALUES (?, ?, '', 'fox', ?)`,
    )
    .run(followerAddress, targetAddress, createdAt);

  const row = db.raw
    .prepare(
      `SELECT * FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'fox' AND target_address = ?`,
    )
    .get(followerAddress, targetAddress) as {
    follower_address: string;
    target_address: string | null;
    target_group_id: string | null;
    follow_kind: string;
    created_at: string;
  };
  return mapFollowRow(row);
}

export function unfollowFox(
  db: OpenFoxDatabase,
  params: { followerAddress: string; targetAddress: string },
): boolean {
  const followerAddress = normalizeAddressLike(params.followerAddress);
  const targetAddress = normalizeAddressLike(params.targetAddress);
  const result = db.raw
    .prepare(
      `DELETE FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'fox' AND target_address = ?`,
    )
    .run(followerAddress, targetAddress);
  return result.changes > 0;
}

export function followGroup(
  db: OpenFoxDatabase,
  params: { followerAddress: string; groupId: string },
): WorldFollowRecord {
  const followerAddress = normalizeAddressLike(params.followerAddress);
  const groupId = params.groupId.trim();
  if (!groupId) {
    throw new Error("groupId cannot be empty");
  }
  const createdAt = nowIso();
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO world_follows (
         follower_address, target_address, target_group_id, follow_kind, created_at
       ) VALUES (?, '', ?, 'group', ?)`,
    )
    .run(followerAddress, groupId, createdAt);

  const row = db.raw
    .prepare(
      `SELECT * FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'group' AND target_group_id = ?`,
    )
    .get(followerAddress, groupId) as {
    follower_address: string;
    target_address: string | null;
    target_group_id: string | null;
    follow_kind: string;
    created_at: string;
  };
  return mapFollowRow(row);
}

export function unfollowGroup(
  db: OpenFoxDatabase,
  params: { followerAddress: string; groupId: string },
): boolean {
  const followerAddress = normalizeAddressLike(params.followerAddress);
  const groupId = params.groupId.trim();
  const result = db.raw
    .prepare(
      `DELETE FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'group' AND target_group_id = ?`,
    )
    .run(followerAddress, groupId);
  return result.changes > 0;
}

export function listFollowedFoxes(
  db: OpenFoxDatabase,
  followerAddress: string,
  options?: { limit?: number },
): WorldFollowRecord[] {
  const address = normalizeAddressLike(followerAddress);
  const limit = Math.max(1, options?.limit ?? 50);
  const rows = db.raw
    .prepare(
      `SELECT * FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'fox'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(address, limit) as Array<{
    follower_address: string;
    target_address: string | null;
    target_group_id: string | null;
    follow_kind: string;
    created_at: string;
  }>;
  return rows.map(mapFollowRow);
}

export function listFollowedGroups(
  db: OpenFoxDatabase,
  followerAddress: string,
  options?: { limit?: number },
): WorldFollowRecord[] {
  const address = normalizeAddressLike(followerAddress);
  const limit = Math.max(1, options?.limit ?? 50);
  const rows = db.raw
    .prepare(
      `SELECT * FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'group'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(address, limit) as Array<{
    follower_address: string;
    target_address: string | null;
    target_group_id: string | null;
    follow_kind: string;
    created_at: string;
  }>;
  return rows.map(mapFollowRow);
}

export function listFoxFollowers(
  db: OpenFoxDatabase,
  targetAddress: string,
  options?: { limit?: number },
): WorldFollowRecord[] {
  const address = normalizeAddressLike(targetAddress);
  const limit = Math.max(1, options?.limit ?? 50);
  const rows = db.raw
    .prepare(
      `SELECT * FROM world_follows
       WHERE target_address = ? AND follow_kind = 'fox'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(address, limit) as Array<{
    follower_address: string;
    target_address: string | null;
    target_group_id: string | null;
    follow_kind: string;
    created_at: string;
  }>;
  return rows.map(mapFollowRow);
}

export function listGroupFollowers(
  db: OpenFoxDatabase,
  groupId: string,
  options?: { limit?: number },
): WorldFollowRecord[] {
  const normalizedGroupId = groupId.trim();
  if (!normalizedGroupId) {
    throw new Error("groupId cannot be empty");
  }
  const limit = Math.max(1, options?.limit ?? 50);
  const rows = db.raw
    .prepare(
      `SELECT * FROM world_follows
       WHERE target_group_id = ? AND follow_kind = 'group'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(normalizedGroupId, limit) as Array<{
    follower_address: string;
    target_address: string | null;
    target_group_id: string | null;
    follow_kind: string;
    created_at: string;
  }>;
  return rows.map(mapFollowRow);
}

export function getGroupFollowerCount(
  db: OpenFoxDatabase,
  groupId: string,
): number {
  const normalizedGroupId = groupId.trim();
  if (!normalizedGroupId) {
    throw new Error("groupId cannot be empty");
  }
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM world_follows
       WHERE target_group_id = ? AND follow_kind = 'group'`,
    )
    .get(normalizedGroupId) as { count: number };
  return row.count;
}

export function getFollowCounts(
  db: OpenFoxDatabase,
  address: string,
): WorldFollowCounts {
  const normalizedAddress = normalizeAddressLike(address);
  const followingFoxesRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'fox'`,
    )
    .get(normalizedAddress) as { count: number };
  const followingGroupsRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'group'`,
    )
    .get(normalizedAddress) as { count: number };
  const followersRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM world_follows
       WHERE target_address = ? AND follow_kind = 'fox'`,
    )
    .get(normalizedAddress) as { count: number };
  return {
    followingFoxes: followingFoxesRow.count,
    followingGroups: followingGroupsRow.count,
    followers: followersRow.count,
  };
}

export function isFollowing(
  db: OpenFoxDatabase,
  followerAddress: string,
  targetAddress: string,
): boolean {
  const follower = normalizeAddressLike(followerAddress);
  const target = normalizeAddressLike(targetAddress);
  const row = db.raw
    .prepare(
      `SELECT 1 FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'fox' AND target_address = ?`,
    )
    .get(follower, target);
  return row !== undefined;
}
