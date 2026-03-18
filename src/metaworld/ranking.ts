/**
 * World Ranking — personalized feed and recommendations.
 *
 * Builds on top of the existing world feed, directory, and follow
 * systems to produce:
 * - A personalized feed where followed/joined items rank higher
 * - Fox recommendations based on shared groups and capabilities
 * - Group recommendations based on tag overlap and member follows
 */

import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { listWorldFeedItems, type WorldFeedItem } from "./feed.js";

export interface PersonalizedFeedItem extends WorldFeedItem {
  boostScore: number;
  boostReasons: string[];
}

export interface PersonalizedFeedSnapshot {
  generatedAt: string;
  items: PersonalizedFeedItem[];
  summary: string;
}

export interface RecommendedFoxEntry {
  address: string;
  displayName: string;
  reason: string;
  score: number;
  sharedGroupCount: number;
}

export interface RecommendedFoxesSnapshot {
  generatedAt: string;
  items: RecommendedFoxEntry[];
  summary: string;
}

export interface RecommendedGroupEntry {
  groupId: string;
  name: string;
  description: string;
  reason: string;
  score: number;
  tags: string[];
  activeMemberCount: number;
}

export interface RecommendedGroupsSnapshot {
  generatedAt: string;
  items: RecommendedGroupEntry[];
  summary: string;
}

function normalizeAddressLike(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`invalid address-like value: ${value}`);
  }
  return trimmed;
}

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function computeTimeDecay(occurredAt: string): number {
  const ageMs = Date.now() - new Date(occurredAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  // Decay: items older than 24h get progressively lower scores
  if (ageHours <= 1) return 1.0;
  if (ageHours <= 6) return 0.9;
  if (ageHours <= 24) return 0.7;
  if (ageHours <= 72) return 0.4;
  return 0.2;
}

function getFollowedFoxAddresses(db: OpenFoxDatabase, address: string): Set<string> {
  const rows = db.raw
    .prepare(
      `SELECT target_address FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'fox'`,
    )
    .all(address) as Array<{ target_address: string }>;
  return new Set(rows.map((r) => r.target_address));
}

function getFollowedGroupIds(db: OpenFoxDatabase, address: string): Set<string> {
  const rows = db.raw
    .prepare(
      `SELECT target_group_id FROM world_follows
       WHERE follower_address = ? AND follow_kind = 'group'`,
    )
    .all(address) as Array<{ target_group_id: string }>;
  return new Set(rows.map((r) => r.target_group_id));
}

function getJoinedGroupIds(db: OpenFoxDatabase, address: string): Set<string> {
  const rows = db.raw
    .prepare(
      `SELECT group_id FROM group_members
       WHERE member_address = ? AND membership_state = 'active'`,
    )
    .all(address) as Array<{ group_id: string }>;
  return new Set(rows.map((r) => r.group_id));
}

function getReactionCount(db: OpenFoxDatabase, messageId: string): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_message_reactions
       WHERE message_id = ?`,
    )
    .get(messageId) as { count: number };
  return row.count;
}

export function buildPersonalizedFeedSnapshot(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  options?: { limit?: number },
): PersonalizedFeedSnapshot {
  const limit = Math.max(1, options?.limit ?? 25);
  const address = normalizeAddressLike(config.walletAddress);

  const followedFoxes = getFollowedFoxAddresses(db, address);
  const followedGroups = getFollowedGroupIds(db, address);
  const joinedGroups = getJoinedGroupIds(db, address);

  // Fetch more items than needed for ranking
  const rawItems = listWorldFeedItems(db, { limit: limit * 3 });

  const ranked: PersonalizedFeedItem[] = rawItems.map((item) => {
    let boostScore = 0;
    const boostReasons: string[] = [];

    // Time decay base
    const timeDecay = computeTimeDecay(item.occurredAt);
    boostScore += timeDecay * 10;

    // Followed fox boost
    if (item.actorAddress && followedFoxes.has(item.actorAddress.toLowerCase())) {
      boostScore += 30;
      boostReasons.push("followed_fox");
    }

    // Followed group boost
    if (item.groupId && followedGroups.has(item.groupId)) {
      boostScore += 25;
      boostReasons.push("followed_group");
    }

    // Joined group boost
    if (item.groupId && joinedGroups.has(item.groupId)) {
      boostScore += 20;
      boostReasons.push("joined_group");
    }

    // Reaction/reply boost for messages
    if (item.kind === "group_message" && item.refs.messageId) {
      const reactionCount = getReactionCount(db, item.refs.messageId);
      if (reactionCount > 0) {
        boostScore += Math.min(reactionCount * 2, 10);
        boostReasons.push("has_reactions");
      }
    }

    return {
      ...item,
      boostScore,
      boostReasons,
    };
  });

  ranked.sort((a, b) => {
    const byScore = b.boostScore - a.boostScore;
    if (byScore !== 0) return byScore;
    return b.occurredAt.localeCompare(a.occurredAt);
  });

  const items = ranked.slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    items,
    summary: items.length
      ? `Personalized feed contains ${items.length} item(s).`
      : "Personalized feed is currently empty.",
  };
}

export function buildRecommendedFoxes(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  options?: { limit?: number },
): RecommendedFoxesSnapshot {
  const limit = Math.max(1, options?.limit ?? 10);
  const address = normalizeAddressLike(config.walletAddress);

  const followedFoxes = getFollowedFoxAddresses(db, address);
  const joinedGroups = getJoinedGroupIds(db, address);
  const followedGroups = getFollowedGroupIds(db, address);

  // Find all members from our groups
  const candidateRows = db.raw
    .prepare(
      `SELECT DISTINCT member_address, display_name
       FROM group_members
       WHERE membership_state = 'active'
         AND member_address <> ?`,
    )
    .all(address) as Array<{
    member_address: string;
    display_name: string | null;
  }>;

  const candidateMap = new Map<
    string,
    { displayName: string; score: number; reason: string; sharedGroupCount: number }
  >();

  for (const row of candidateRows) {
    const candidateAddress = row.member_address.toLowerCase();
    if (followedFoxes.has(candidateAddress)) continue;
    if (candidateAddress === address) continue;

    // Count shared groups
    const sharedGroupRows = db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM group_members
         WHERE member_address = ? AND membership_state = 'active'
           AND group_id IN (
             SELECT group_id FROM group_members
             WHERE member_address = ? AND membership_state = 'active'
           )`,
      )
      .get(candidateAddress, address) as { count: number };

    const sharedGroupCount = sharedGroupRows.count;
    if (sharedGroupCount === 0) {
      // Also check if they are in followed groups
      const inFollowedGroupRow = db.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM group_members
           WHERE member_address = ? AND membership_state = 'active'
             AND group_id IN (
               SELECT target_group_id FROM world_follows
               WHERE follower_address = ? AND follow_kind = 'group'
             )`,
        )
        .get(candidateAddress, address) as { count: number };
      if (inFollowedGroupRow.count === 0) continue;
    }

    let score = sharedGroupCount * 10;
    let reason = `shares ${sharedGroupCount} group(s)`;

    // Check if active in followed groups
    const followedGroupArr = Array.from(followedGroups);
    for (const groupId of followedGroupArr) {
      const memberRow = db.raw
        .prepare(
          `SELECT 1 FROM group_members
           WHERE group_id = ? AND member_address = ? AND membership_state = 'active'`,
        )
        .get(groupId, candidateAddress);
      if (memberRow) {
        score += 5;
        reason = `active in followed groups, ${reason}`;
        break;
      }
    }

    // Prefer foxes with presence
    const presenceRow = db.raw
      .prepare(
        `SELECT 1 FROM world_presence
         WHERE actor_address = ? AND expires_at > datetime('now')`,
      )
      .get(candidateAddress);
    if (presenceRow) {
      score += 5;
    }

    const existing = candidateMap.get(candidateAddress);
    if (!existing || score > existing.score) {
      candidateMap.set(candidateAddress, {
        displayName: row.display_name || candidateAddress,
        score,
        reason,
        sharedGroupCount,
      });
    }
  }

  const items = Array.from(candidateMap.entries())
    .map(([addr, data]) => ({
      address: addr,
      displayName: data.displayName,
      reason: data.reason,
      score: data.score,
      sharedGroupCount: data.sharedGroupCount,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    items,
    summary: items.length
      ? `${items.length} recommended fox(es) to follow.`
      : "No fox recommendations at this time.",
  };
}

export function buildRecommendedGroups(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  options?: { limit?: number },
): RecommendedGroupsSnapshot {
  const limit = Math.max(1, options?.limit ?? 10);
  const address = normalizeAddressLike(config.walletAddress);

  const joinedGroups = getJoinedGroupIds(db, address);
  const followedGroups = getFollowedGroupIds(db, address);
  const followedFoxes = getFollowedFoxAddresses(db, address);

  // Collect tags from joined groups
  const myTags = new Set<string>();
  const joinedGroupArr = Array.from(joinedGroups);
  for (const groupId of joinedGroupArr) {
    const row = db.raw
      .prepare(`SELECT tags_json FROM groups WHERE group_id = ?`)
      .get(groupId) as { tags_json: string } | undefined;
    if (row) {
      for (const tag of parseJsonSafe<string[]>(row.tags_json, [])) {
        myTags.add(tag.toLowerCase());
      }
    }
  }

  // Find all groups not joined and not followed
  const allGroups = db.raw
    .prepare(
      `SELECT group_id, name, description, tags_json, join_mode, visibility
       FROM groups
       WHERE status = 'active'
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    group_id: string;
    name: string;
    description: string;
    tags_json: string;
    join_mode: string;
    visibility: string;
  }>;

  const items: RecommendedGroupEntry[] = [];

  for (const group of allGroups) {
    if (joinedGroups.has(group.group_id)) continue;
    if (followedGroups.has(group.group_id)) continue;

    let score = 0;
    const reasons: string[] = [];

    // Tag overlap
    const groupTags = parseJsonSafe<string[]>(group.tags_json, []);
    const tagOverlap = groupTags.filter((t) => myTags.has(t.toLowerCase()));
    if (tagOverlap.length > 0) {
      score += tagOverlap.length * 10;
      reasons.push(`${tagOverlap.length} shared tag(s)`);
    }

    // Followed members are in this group
    let followedMemberCount = 0;
    const followedFoxArr = Array.from(followedFoxes);
    for (const followedAddress of followedFoxArr) {
      const memberRow = db.raw
        .prepare(
          `SELECT 1 FROM group_members
           WHERE group_id = ? AND member_address = ? AND membership_state = 'active'`,
        )
        .get(group.group_id, followedAddress);
      if (memberRow) followedMemberCount++;
    }
    if (followedMemberCount > 0) {
      score += followedMemberCount * 8;
      reasons.push(`${followedMemberCount} followed member(s)`);
    }

    // Active member count
    const memberCountRow = db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM group_members
         WHERE group_id = ? AND membership_state = 'active'`,
      )
      .get(group.group_id) as { count: number };
    const activeMemberCount = memberCountRow.count;
    if (activeMemberCount >= 3) {
      score += 5;
      reasons.push("active group");
    }

    // Prefer request_approval join mode (more accessible)
    if (group.join_mode === "request_approval") {
      score += 3;
    }

    if (score === 0) continue;

    items.push({
      groupId: group.group_id,
      name: group.name,
      description: group.description.slice(0, 120),
      reason: reasons.join(", "),
      score,
      tags: groupTags,
      activeMemberCount,
    });
  }

  items.sort((a, b) => b.score - a.score);
  const sliced = items.slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    items: sliced,
    summary: sliced.length
      ? `${sliced.length} recommended group(s) to explore.`
      : "No group recommendations at this time.",
  };
}
