import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import type { WorldPresenceEffectiveStatus } from "./presence.js";

export interface WorldFoxDirectoryEntry {
  address: string;
  agentId: string | null;
  displayName: string;
  tnsName: string | null;
  activeGroupCount: number;
  roles: string[];
  presenceStatus: WorldPresenceEffectiveStatus | null;
  lastSeenAt: string | null;
  capabilityNames: string[];
  bio: string | null;
  avatarUrl: string | null;
  tags: string[];
}

export interface WorldFoxDirectorySnapshot {
  generatedAt: string;
  items: WorldFoxDirectoryEntry[];
  summary: string;
}

export interface WorldGroupDirectoryEntry {
  groupId: string;
  name: string;
  description: string;
  visibility: "private" | "listed" | "public";
  joinMode: "invite_only" | "request_approval";
  tags: string[];
  activeMemberCount: number;
  roleSummary: Record<string, number>;
  updatedAt: string;
}

export interface WorldGroupDirectorySnapshot {
  generatedAt: string;
  items: WorldGroupDirectoryEntry[];
  summary: string;
}

function normalizeAddressLike(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`invalid address-like value: ${value}`);
  }
  return trimmed;
}

function parseJsonSafe<T>(value: string | undefined, fallback: T): T {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function containsText(haystack: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return haystack.some((value) => value?.toLowerCase().includes(normalized));
}

function loadLocalCapabilities(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  address: string,
): string[] {
  if (normalizeAddressLike(config.walletAddress) !== address) {
    return [];
  }
  const raw = db.getKV("agent_discovery:last_published_card");
  const parsed = parseJsonSafe<{ capabilities?: Array<{ name?: string }> } | null>(raw, null);
  return (parsed?.capabilities ?? [])
    .map((entry) => entry.name?.trim())
    .filter((value): value is string => Boolean(value));
}

function resolveFoxDirectoryEntry(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  address: string,
): WorldFoxDirectoryEntry {
  const normalizedAddress = normalizeAddressLike(address);
  const memberIdentity = db.raw
    .prepare(
      `SELECT display_name, member_agent_id, member_tns_name
       FROM group_members
       WHERE member_address = ?
       ORDER BY joined_at DESC
       LIMIT 1`,
    )
    .get(normalizedAddress) as
    | {
        display_name: string | null;
        member_agent_id: string | null;
        member_tns_name: string | null;
      }
    | undefined;
  const presenceIdentity = db.raw
    .prepare(
      `SELECT display_name, agent_id, status, expires_at, updated_at
       FROM world_presence
       WHERE actor_address = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(normalizedAddress) as
    | {
        display_name: string | null;
        agent_id: string | null;
        status: "online" | "busy" | "away" | "recently_active";
        expires_at: string;
        updated_at: string;
      }
    | undefined;
  const activeGroupCountRow = db.raw
    .prepare(
      `SELECT COUNT(*) AS count
       FROM group_members
       WHERE member_address = ? AND membership_state = 'active'`,
    )
    .get(normalizedAddress) as { count: number };
  const roleRows = db.raw
    .prepare(
      `SELECT DISTINCT role
       FROM group_member_roles
       WHERE member_address = ? AND active = 1
       ORDER BY role ASC`,
    )
    .all(normalizedAddress) as Array<{ role: string }>;
  const capabilityNames = loadLocalCapabilities(db, config, normalizedAddress);
  const expired =
    presenceIdentity?.expires_at
      ? new Date(presenceIdentity.expires_at).getTime() <= Date.now()
      : false;

  // Load published profile metadata if available
  let bio: string | null = null;
  let avatarUrl: string | null = null;
  let tags: string[] = [];
  try {
    const profileRow = db.raw
      .prepare(
        `SELECT bio, avatar_url, tags FROM fox_profiles WHERE address = ?`,
      )
      .get(normalizedAddress) as {
      bio: string | null;
      avatar_url: string | null;
      tags: string;
    } | undefined;
    if (profileRow) {
      bio = profileRow.bio;
      avatarUrl = profileRow.avatar_url;
      tags = parseJsonSafe<string[]>(profileRow.tags, []);
    }
  } catch {
    // fox_profiles table may not exist yet
  }

  return {
    address: normalizedAddress,
    agentId:
      (normalizeAddressLike(config.walletAddress) === normalizedAddress
        ? config.agentId
        : null) ||
      presenceIdentity?.agent_id ||
      memberIdentity?.member_agent_id ||
      null,
    displayName:
      presenceIdentity?.display_name ||
      memberIdentity?.display_name ||
      (normalizeAddressLike(config.walletAddress) === normalizedAddress
        ? config.agentDiscovery?.displayName?.trim() || config.name
        : normalizedAddress),
    tnsName: memberIdentity?.member_tns_name ?? null,
    activeGroupCount: activeGroupCountRow.count,
    roles: roleRows.map((row) => row.role),
    presenceStatus: presenceIdentity
      ? expired
        ? "expired"
        : presenceIdentity.status
      : null,
    lastSeenAt: presenceIdentity?.updated_at ?? null,
    capabilityNames,
    bio,
    avatarUrl,
    tags,
  };
}

export function getWorldFoxDirectoryEntry(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  address: string,
): WorldFoxDirectoryEntry {
  return resolveFoxDirectoryEntry(db, config, address);
}

export function listWorldFoxDirectory(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  options?: {
    query?: string;
    role?: string;
    limit?: number;
  },
): WorldFoxDirectoryEntry[] {
  const addresses = db.raw
    .prepare(
      `SELECT actor_address AS address FROM world_presence
       UNION
       SELECT member_address AS address FROM group_members
       UNION
       SELECT host_address AS address FROM bounties
       UNION
       SELECT requester_address AS address FROM artifacts`,
    )
    .all() as Array<{ address: string }>;

  const roleFilter = options?.role?.trim().toLowerCase() || null;
  const query = options?.query?.trim() || "";
  const items = addresses
    .map((row) => resolveFoxDirectoryEntry(db, config, row.address))
    .filter((item) => {
      if (roleFilter && !item.roles.includes(roleFilter)) return false;
      return containsText(
        [item.address, item.agentId, item.displayName, item.tnsName],
        query,
      );
    })
    .sort((a, b) => {
      const byPresence = Number(Boolean(b.presenceStatus)) - Number(Boolean(a.presenceStatus));
      if (byPresence !== 0) return byPresence;
      const byGroups = b.activeGroupCount - a.activeGroupCount;
      if (byGroups !== 0) return byGroups;
      return a.displayName.localeCompare(b.displayName);
    });

  return items.slice(0, Math.max(1, options?.limit ?? 50));
}

export function buildWorldFoxDirectorySnapshot(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  options?: {
    query?: string;
    role?: string;
    limit?: number;
  },
): WorldFoxDirectorySnapshot {
  const items = listWorldFoxDirectory(db, config, options);
  return {
    generatedAt: new Date().toISOString(),
    items,
    summary: items.length
      ? `Fox directory contains ${items.length} profile(s).`
      : "Fox directory is currently empty.",
  };
}

export function listWorldGroupDirectory(
  db: OpenFoxDatabase,
  options?: {
    query?: string;
    visibility?: "private" | "listed" | "public";
    tag?: string;
    role?: string;
    limit?: number;
  },
): WorldGroupDirectoryEntry[] {
  const groups = db.raw
    .prepare(
      `SELECT group_id, name, description, visibility, join_mode, tags_json, updated_at
       FROM groups
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    group_id: string;
    name: string;
    description: string;
    visibility: "private" | "listed" | "public";
    join_mode: "invite_only" | "request_approval";
    tags_json: string;
    updated_at: string;
  }>;

  const roleFilter = options?.role?.trim().toLowerCase() || null;
  const tagFilter = options?.tag?.trim().toLowerCase() || null;
  const query = options?.query?.trim() || "";
  const items = groups.map((group) => {
    const activeMemberCountRow = db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM group_members
         WHERE group_id = ? AND membership_state = 'active'`,
      )
      .get(group.group_id) as { count: number };
    const roleRows = db.raw
      .prepare(
        `SELECT role, COUNT(*) AS count
         FROM group_member_roles
         WHERE group_id = ? AND active = 1
         GROUP BY role
         ORDER BY role ASC`,
      )
      .all(group.group_id) as Array<{ role: string; count: number }>;
    return {
      groupId: group.group_id,
      name: group.name,
      description: group.description,
      visibility: group.visibility,
      joinMode: group.join_mode,
      tags: parseJsonSafe<string[]>(group.tags_json, []),
      activeMemberCount: activeMemberCountRow.count,
      roleSummary: Object.fromEntries(roleRows.map((row) => [row.role, row.count])),
      updatedAt: group.updated_at,
    } satisfies WorldGroupDirectoryEntry;
  }).filter((item) => {
    if (options?.visibility && item.visibility !== options.visibility) return false;
    if (tagFilter && !item.tags.some((tag) => tag.toLowerCase() === tagFilter)) return false;
    if (roleFilter && !(item.roleSummary[roleFilter] > 0)) return false;
    return containsText([item.name, item.description, ...item.tags], query);
  });

  return items.slice(0, Math.max(1, options?.limit ?? 50));
}

export function buildWorldGroupDirectorySnapshot(
  db: OpenFoxDatabase,
  options?: {
    query?: string;
    visibility?: "private" | "listed" | "public";
    tag?: string;
    role?: string;
    limit?: number;
  },
): WorldGroupDirectorySnapshot {
  const items = listWorldGroupDirectory(db, options);
  return {
    generatedAt: new Date().toISOString(),
    items,
    summary: items.length
      ? `Group directory contains ${items.length} group(s).`
      : "Group directory is currently empty.",
  };
}
