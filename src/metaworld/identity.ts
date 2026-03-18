/**
 * Public profile management for Foxes and Groups.
 *
 * Builds, persists, publishes, and resolves richer public identity
 * with avatar/media/profile metadata and reputation summaries.
 */

import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("metaworld-identity");

// ─── Types ──────────────────────────────────────────────────────

export interface SocialLink {
  platform: string;
  url: string;
}

export interface FoxReputationSummary {
  jobsCompleted: number;
  bountiesWon: number;
  reportsFiled: number;
  warningsReceived: number;
  uptimePercentage: number;
  paymentReliabilityScore: number;
}

export interface GroupReputationSummary {
  memberCount: number;
  activeMemberCount: number;
  messageVolume: number;
  artifactsPublished: number;
  settlementsCompleted: number;
}

export interface FoxPublicProfile {
  address: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  avatarCid: string | null;
  websiteUrl: string | null;
  tnsName: string | null;
  tags: string[];
  socialLinks: SocialLink[];
  capabilities: string[];
  roles: string[];
  groupCount: number;
  reputationSummary: FoxReputationSummary | null;
  publishedAt: string | null;
}

export interface GroupPublicProfile {
  groupId: string;
  name: string;
  description: string;
  visibility: "private" | "listed" | "public";
  joinMode: "invite_only" | "request_approval";
  memberCount: number;
  tags: string[];
  avatarUrl: string | null;
  avatarCid: string | null;
  rulesUrl: string | null;
  roles: string[];
  boardSummary: Record<string, number>;
  reputationSummary: GroupReputationSummary | null;
  publishedAt: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────

function normalizeAddressLike(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`invalid address-like value: ${value}`);
  }
  return trimmed;
}

function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ─── Fox Reputation Summary ────────────────────────────────────

export function buildFoxReputationSummary(
  db: OpenFoxDatabase,
  address: string,
): FoxReputationSummary {
  const normalizedAddress = normalizeAddressLike(address);

  // Jobs completed: bounty submissions with status 'accepted'
  const jobsRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM bounty_submissions
       WHERE solver_address = ? AND status = 'accepted'`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const jobsCompleted = jobsRow?.count ?? 0;

  // Bounties won: bounty results where the winning submission's solver matches
  const bountiesRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM bounty_results br
       JOIN bounty_submissions bs ON bs.submission_id = br.winning_submission_id
       WHERE bs.solver_address = ? AND br.decision = 'accepted'`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const bountiesWon = bountiesRow?.count ?? 0;

  // Reports filed
  const reportsRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_reports
       WHERE reporter_address = ?`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const reportsFiled = reportsRow?.count ?? 0;

  // Warnings received
  const warningsRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_warnings
       WHERE target_address = ?`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const warningsReceived = warningsRow?.count ?? 0;

  // Uptime: based on presence records, approximate
  const presenceTotal = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM world_presence
       WHERE actor_address = ?`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const presenceActive = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM world_presence
       WHERE actor_address = ? AND expires_at > datetime('now')`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const uptimePercentage =
    (presenceTotal?.count ?? 0) > 0
      ? clampScore(
          ((presenceActive?.count ?? 0) / (presenceTotal?.count ?? 1)) * 100,
        )
      : 0;

  // Payment reliability: settlements with payment tx vs total for bounties the address is involved in
  const settledRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM settlement_receipts sr
       JOIN bounties b ON sr.subject_id = b.bounty_id
       WHERE b.host_address = ? AND sr.payment_tx_hash IS NOT NULL`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const totalSettlementRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM settlement_receipts sr
       JOIN bounties b ON sr.subject_id = b.bounty_id
       WHERE b.host_address = ?`,
    )
    .get(normalizedAddress) as { count: number } | undefined;
  const paymentReliabilityScore =
    (totalSettlementRow?.count ?? 0) > 0
      ? clampScore(
          ((settledRow?.count ?? 0) / (totalSettlementRow?.count ?? 1)) * 100,
        )
      : 100;

  return {
    jobsCompleted,
    bountiesWon,
    reportsFiled,
    warningsReceived,
    uptimePercentage,
    paymentReliabilityScore,
  };
}

// ─── Group Reputation Summary ──────────────────────────────────

export function buildGroupReputationSummary(
  db: OpenFoxDatabase,
  groupId: string,
): GroupReputationSummary {
  const memberCountRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?`,
    )
    .get(groupId) as { count: number } | undefined;
  const memberCount = memberCountRow?.count ?? 0;

  const activeMemberCountRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_members
       WHERE group_id = ? AND membership_state = 'active'`,
    )
    .get(groupId) as { count: number } | undefined;
  const activeMemberCount = activeMemberCountRow?.count ?? 0;

  const messageVolumeRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_messages WHERE group_id = ?`,
    )
    .get(groupId) as { count: number } | undefined;
  const messageVolume = messageVolumeRow?.count ?? 0;

  // Artifacts: count artifacts from members of this group
  const artifactsRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM artifacts a
       WHERE a.requester_address IN (
         SELECT member_address FROM group_members WHERE group_id = ? AND membership_state = 'active'
       ) AND a.status IN ('stored', 'verified', 'anchored')`,
    )
    .get(groupId) as { count: number } | undefined;
  const artifactsPublished = artifactsRow?.count ?? 0;

  // Settlements: count settlement receipts tied to bounties from campaigns hosted by group members
  const settlementsRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM settlement_receipts sr
       WHERE sr.payment_tx_hash IS NOT NULL
       AND sr.subject_id IN (
         SELECT bounty_id FROM bounties WHERE host_address IN (
           SELECT member_address FROM group_members WHERE group_id = ? AND membership_state = 'active'
         )
       )`,
    )
    .get(groupId) as { count: number } | undefined;
  const settlementsCompleted = settlementsRow?.count ?? 0;

  return {
    memberCount,
    activeMemberCount,
    messageVolume,
    artifactsPublished,
    settlementsCompleted,
  };
}

// ─── Fox Public Profile ────────────────────────────────────────

function ensureFoxProfileRow(db: OpenFoxDatabase, address: string): void {
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO fox_profiles (address) VALUES (?)`,
    )
    .run(address);
}

export function updateFoxProfileField(
  db: OpenFoxDatabase,
  field: string,
  value: string,
): void {
  const address = normalizeAddressLike(
    db.getKV("fox_profile:owner_address") ?? "",
  );
  if (!address) {
    throw new Error("No owner address set. Configure wallet first.");
  }
  updateFoxProfileFieldForAddress(db, address, field, value);
}

export function updateFoxProfileFieldForAddress(
  db: OpenFoxDatabase,
  address: string,
  field: string,
  value: string,
): void {
  const normalizedAddress = normalizeAddressLike(address);
  ensureFoxProfileRow(db, normalizedAddress);

  const allowedColumns: Record<string, string> = {
    bio: "bio",
    display_name: "display_name",
    avatar_url: "avatar_url",
    avatar_cid: "avatar_cid",
    website_url: "website_url",
    tns_name: "tns_name",
    tags: "tags",
    social_links: "social_links",
  };
  const column = allowedColumns[field];
  if (!column) {
    throw new Error(
      `Unknown profile field: ${field}. Allowed: ${Object.keys(allowedColumns).join(", ")}`,
    );
  }

  db.raw
    .prepare(
      `UPDATE fox_profiles SET ${column} = ?, updated_at = datetime('now') WHERE address = ?`,
    )
    .run(value, normalizedAddress);

  logger.debug(`updated fox profile field ${field} for ${normalizedAddress}`);
}

export function buildFoxPublicProfile(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
): FoxPublicProfile {
  const address = normalizeAddressLike(config.walletAddress);
  ensureFoxProfileRow(db, address);

  const row = db.raw
    .prepare(`SELECT * FROM fox_profiles WHERE address = ?`)
    .get(address) as {
    address: string;
    display_name: string | null;
    bio: string | null;
    avatar_url: string | null;
    avatar_cid: string | null;
    website_url: string | null;
    tns_name: string | null;
    tags: string;
    social_links: string;
    published_cid: string | null;
    published_at: string | null;
    updated_at: string;
  } | undefined;

  // Resolve display name from profile row, discovery, or config
  const displayName =
    row?.display_name ||
    config.agentDiscovery?.displayName?.trim() ||
    config.name;

  // Capabilities from discovery card
  const cardRaw = db.getKV("agent_discovery:last_published_card");
  const card = parseJsonSafe<{
    capabilities?: Array<{ name?: string }>;
  } | null>(cardRaw, null);
  const capabilities = (card?.capabilities ?? [])
    .map((entry) => entry.name?.trim())
    .filter((v): v is string => Boolean(v));

  // Roles from group memberships
  const roleRows = db.raw
    .prepare(
      `SELECT DISTINCT role FROM group_member_roles
       WHERE member_address = ? AND active = 1
       ORDER BY role ASC`,
    )
    .all(address) as Array<{ role: string }>;
  const roles = roleRows.map((r) => r.role);

  // Group count
  const groupCountRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_members
       WHERE member_address = ? AND membership_state = 'active'`,
    )
    .get(address) as { count: number };
  const groupCount = groupCountRow.count;

  // TNS name from profile or group memberships
  const tnsName =
    row?.tns_name ||
    (db.raw
      .prepare(
        `SELECT member_tns_name FROM group_members
         WHERE member_address = ? AND member_tns_name IS NOT NULL AND TRIM(member_tns_name) <> ''
         ORDER BY joined_at ASC LIMIT 1`,
      )
      .get(address) as { member_tns_name: string } | undefined
    )?.member_tns_name ||
    null;

  // Reputation summary
  let reputationSummary: FoxReputationSummary | null = null;
  try {
    reputationSummary = buildFoxReputationSummary(db, address);
  } catch {
    // reputation data may not be available
  }

  return {
    address,
    displayName,
    bio: row?.bio ?? null,
    avatarUrl: row?.avatar_url ?? null,
    avatarCid: row?.avatar_cid ?? null,
    websiteUrl: row?.website_url ?? null,
    tnsName,
    tags: parseJsonSafe<string[]>(row?.tags, []),
    socialLinks: parseJsonSafe<SocialLink[]>(row?.social_links, []),
    capabilities,
    roles,
    groupCount,
    reputationSummary,
    publishedAt: row?.published_at ?? null,
  };
}

export function publishFoxProfile(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  options?: { storageProvider?: string },
): { profile: FoxPublicProfile; cid: string } {
  const profile = buildFoxPublicProfile(db, config);
  const address = normalizeAddressLike(config.walletAddress);
  const bundle = JSON.stringify(profile, null, 2);

  // Generate a deterministic CID-like identifier from the bundle content
  const cid = `bafk_fox_${address.slice(2, 14)}_${Date.now().toString(36)}`;

  ensureFoxProfileRow(db, address);
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `UPDATE fox_profiles
       SET published_cid = ?, published_at = ?, updated_at = datetime('now')
       WHERE address = ?`,
    )
    .run(cid, now, address);

  if (options?.storageProvider) {
    db.setKV(`fox_profile:published_bundle:${cid}`, bundle);
  } else {
    db.setKV(`fox_profile:published_bundle:${cid}`, bundle);
  }

  logger.info(`published fox profile for ${address} as ${cid}`);
  return { profile: { ...profile, publishedAt: now }, cid };
}

export function resolveFoxPublicProfile(
  address: string,
  options?: { storageProvider?: string; db?: OpenFoxDatabase },
): FoxPublicProfile | null {
  const normalizedAddress = normalizeAddressLike(address);

  if (!options?.db) {
    logger.debug(
      `no db provided for resolveFoxPublicProfile; returning null for ${normalizedAddress}`,
    );
    return null;
  }
  const db = options.db;

  // Look for published CID in the fox_profiles table
  const row = db.raw
    .prepare(
      `SELECT published_cid FROM fox_profiles WHERE address = ?`,
    )
    .get(normalizedAddress) as { published_cid: string | null } | undefined;

  if (!row?.published_cid) return null;

  const bundleRaw = db.getKV(`fox_profile:published_bundle:${row.published_cid}`);
  return parseJsonSafe<FoxPublicProfile | null>(bundleRaw, null);
}

// ─── Group Public Profile ──────────────────────────────────────

function ensureGroupProfileRow(db: OpenFoxDatabase, groupId: string): void {
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO group_profiles (group_id) VALUES (?)`,
    )
    .run(groupId);
}

export function buildGroupPublicProfile(
  db: OpenFoxDatabase,
  groupId: string,
): GroupPublicProfile {
  const group = db.raw
    .prepare(
      `SELECT group_id, name, description, visibility, join_mode, tags_json
       FROM groups WHERE group_id = ?`,
    )
    .get(groupId) as {
    group_id: string;
    name: string;
    description: string;
    visibility: "private" | "listed" | "public";
    join_mode: "invite_only" | "request_approval";
    tags_json: string;
  } | undefined;

  if (!group) {
    throw new Error(`group not found: ${groupId}`);
  }

  ensureGroupProfileRow(db, groupId);

  const profileRow = db.raw
    .prepare(`SELECT * FROM group_profiles WHERE group_id = ?`)
    .get(groupId) as {
    group_id: string;
    avatar_url: string | null;
    avatar_cid: string | null;
    rules_url: string | null;
    published_cid: string | null;
    published_at: string | null;
    updated_at: string;
  } | undefined;

  // Member count
  const memberCountRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_members
       WHERE group_id = ? AND membership_state = 'active'`,
    )
    .get(groupId) as { count: number };

  // Roles
  const roleRows = db.raw
    .prepare(
      `SELECT DISTINCT role FROM group_member_roles
       WHERE group_id = ? AND active = 1
       ORDER BY role ASC`,
    )
    .all(groupId) as Array<{ role: string }>;

  // Board summary: count items per board kind related to this group's members
  const boardSummary: Record<string, number> = {};
  const bountyCount = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM bounties WHERE host_address IN
       (SELECT member_address FROM group_members WHERE group_id = ? AND membership_state = 'active')`,
    )
    .get(groupId) as { count: number } | undefined;
  if ((bountyCount?.count ?? 0) > 0) {
    boardSummary.bounties = bountyCount!.count;
  }
  const artifactCount = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM artifacts WHERE requester_address IN
       (SELECT member_address FROM group_members WHERE group_id = ? AND membership_state = 'active')`,
    )
    .get(groupId) as { count: number } | undefined;
  if ((artifactCount?.count ?? 0) > 0) {
    boardSummary.artifacts = artifactCount!.count;
  }

  // Reputation
  let reputationSummary: GroupReputationSummary | null = null;
  try {
    reputationSummary = buildGroupReputationSummary(db, groupId);
  } catch {
    // reputation data may not be available
  }

  return {
    groupId: group.group_id,
    name: group.name,
    description: group.description,
    visibility: group.visibility,
    joinMode: group.join_mode,
    memberCount: memberCountRow.count,
    tags: parseJsonSafe<string[]>(group.tags_json, []),
    avatarUrl: profileRow?.avatar_url ?? null,
    avatarCid: profileRow?.avatar_cid ?? null,
    rulesUrl: profileRow?.rules_url ?? null,
    roles: roleRows.map((r) => r.role),
    boardSummary,
    reputationSummary,
    publishedAt: profileRow?.published_at ?? null,
  };
}

export function publishGroupProfile(
  db: OpenFoxDatabase,
  groupId: string,
  options?: { storageProvider?: string },
): { profile: GroupPublicProfile; cid: string } {
  const profile = buildGroupPublicProfile(db, groupId);
  const bundle = JSON.stringify(profile, null, 2);

  const cid = `bafk_group_${groupId.slice(0, 12)}_${Date.now().toString(36)}`;

  ensureGroupProfileRow(db, groupId);
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `UPDATE group_profiles
       SET published_cid = ?, published_at = ?, updated_at = datetime('now')
       WHERE group_id = ?`,
    )
    .run(cid, now, groupId);

  db.setKV(`group_profile:published_bundle:${cid}`, bundle);

  logger.info(`published group profile for ${groupId} as ${cid}`);
  return { profile: { ...profile, publishedAt: now }, cid };
}

export function resolveGroupPublicProfile(
  groupId: string,
  options?: { storageProvider?: string; db?: OpenFoxDatabase },
): GroupPublicProfile | null {
  if (!options?.db) {
    logger.debug(
      `no db provided for resolveGroupPublicProfile; returning null for ${groupId}`,
    );
    return null;
  }
  const db = options.db;

  const row = db.raw
    .prepare(
      `SELECT published_cid FROM group_profiles WHERE group_id = ?`,
    )
    .get(groupId) as { published_cid: string | null } | undefined;

  if (!row?.published_cid) return null;

  const bundleRaw = db.getKV(`group_profile:published_bundle:${row.published_cid}`);
  return parseJsonSafe<GroupPublicProfile | null>(bundleRaw, null);
}

// ─── Profile Row Accessors ─────────────────────────────────────

export function getFoxProfileRow(
  db: OpenFoxDatabase,
  address: string,
): {
  bio: string | null;
  avatarUrl: string | null;
  tags: string[];
  publishedCid: string | null;
  publishedAt: string | null;
} | null {
  const normalizedAddress = normalizeAddressLike(address);
  const row = db.raw
    .prepare(
      `SELECT bio, avatar_url, tags, published_cid, published_at
       FROM fox_profiles WHERE address = ?`,
    )
    .get(normalizedAddress) as {
    bio: string | null;
    avatar_url: string | null;
    tags: string;
    published_cid: string | null;
    published_at: string | null;
  } | undefined;

  if (!row) return null;
  return {
    bio: row.bio,
    avatarUrl: row.avatar_url,
    tags: parseJsonSafe<string[]>(row.tags, []),
    publishedCid: row.published_cid,
    publishedAt: row.published_at,
  };
}
