import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import type { AgentDiscoveryCard } from "../agent-discovery/types.js";
import { listWorldFeedItems, type WorldFeedItem } from "./feed.js";
import { buildWorldNotificationsSnapshot } from "./notifications.js";

export interface FoxProfileGroupMembership {
  groupId: string;
  name: string;
  visibility: "private" | "listed" | "public";
  membershipState: "active" | "left" | "removed" | "banned";
  roles: string[];
  joinedAt: string;
  muteUntil: string | null;
}

export interface FoxProfile {
  address: string;
  agentId: string | null;
  displayName: string;
  runtimeName: string;
  tnsName: string | null;
  discovery: {
    published: boolean;
    lastPublishedAt: string | null;
    discoveryNodeId: string | null;
    capabilityNames: string[];
    endpointUrls: string[];
    card: AgentDiscoveryCard | null;
  };
  groups: FoxProfileGroupMembership[];
  stats: {
    groupCount: number;
    activeGroupCount: number;
    unreadNotificationCount: number;
    recentActivityCount: number;
  };
  recentActivity: WorldFeedItem[];
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

function loadLastPublishedCard(db: OpenFoxDatabase): AgentDiscoveryCard | null {
  const raw = db.getKV("agent_discovery:last_published_card");
  return parseJsonSafe<AgentDiscoveryCard | null>(raw, null);
}

function buildGroupMemberships(
  db: OpenFoxDatabase,
  actorAddress: string,
): FoxProfileGroupMembership[] {
  const memberRows = db.raw
    .prepare(
      `SELECT
         g.group_id,
         g.name,
         g.visibility,
         m.membership_state,
         m.joined_at,
         m.mute_until
       FROM group_members m
       JOIN groups g ON g.group_id = m.group_id
       WHERE m.member_address = ?
       ORDER BY g.updated_at DESC, m.joined_at ASC`,
    )
    .all(actorAddress) as Array<{
    group_id: string;
    name: string;
    visibility: "private" | "listed" | "public";
    membership_state: "active" | "left" | "removed" | "banned";
    joined_at: string;
    mute_until: string | null;
  }>;

  const roleRows = db.raw
    .prepare(
      `SELECT group_id, role
       FROM group_member_roles
       WHERE member_address = ? AND active = 1
       ORDER BY group_id ASC, role ASC`,
    )
    .all(actorAddress) as Array<{
    group_id: string;
    role: string;
  }>;
  const rolesByGroup = new Map<string, string[]>();
  for (const row of roleRows) {
    const roles = rolesByGroup.get(row.group_id) ?? [];
    roles.push(row.role);
    rolesByGroup.set(row.group_id, roles);
  }

  return memberRows.map((row) => ({
    groupId: row.group_id,
    name: row.name,
    visibility: row.visibility,
    membershipState: row.membership_state,
    roles: (rolesByGroup.get(row.group_id) ?? []).sort(),
    joinedAt: row.joined_at,
    muteUntil: row.mute_until ?? null,
  }));
}

export function buildFoxProfile(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  address?: string;
  activityLimit?: number;
  notificationLimit?: number;
}): FoxProfile {
  const address = normalizeAddressLike(params.address ?? params.config.walletAddress);
  const isLocalActor =
    address === normalizeAddressLike(params.config.walletAddress);

  const lastPublishedCard = isLocalActor ? loadLastPublishedCard(params.db) : null;
  const memberIdentity = params.db.raw
    .prepare(
      `SELECT display_name, member_agent_id, member_tns_name
       FROM group_members
       WHERE member_address = ?
       ORDER BY joined_at DESC
       LIMIT 1`,
    )
    .get(address) as
    | {
        display_name: string | null;
        member_agent_id: string | null;
        member_tns_name: string | null;
      }
    | undefined;
  const presenceIdentity = params.db.raw
    .prepare(
      `SELECT display_name, agent_id
       FROM world_presence
       WHERE actor_address = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(address) as
    | {
        display_name: string | null;
        agent_id: string | null;
      }
    | undefined;
  const groups = buildGroupMemberships(params.db, address);
  const tnsRow = params.db.raw
    .prepare(
      `SELECT member_tns_name
       FROM group_members
       WHERE member_address = ? AND member_tns_name IS NOT NULL AND TRIM(member_tns_name) <> ''
       ORDER BY joined_at ASC
       LIMIT 1`,
    )
    .get(address) as { member_tns_name: string | null } | undefined;
  const recentActivity = listWorldFeedItems(params.db, {
    limit: Math.max((params.activityLimit ?? 10) * 3, 30),
  })
    .filter((item) => item.actorAddress?.toLowerCase() === address)
    .slice(0, Math.max(1, params.activityLimit ?? 10));

  const notifications = isLocalActor
    ? buildWorldNotificationsSnapshot(params.db, {
        actorAddress: address,
        unreadOnly: true,
        limit: Math.max(1, params.notificationLimit ?? 20),
      })
    : { unreadCount: 0 };

  return {
    address,
    agentId:
      (isLocalActor ? params.config.agentId : null) ||
      presenceIdentity?.agent_id ||
      memberIdentity?.member_agent_id ||
      lastPublishedCard?.agent_id ||
      null,
    displayName:
      lastPublishedCard?.display_name ||
      presenceIdentity?.display_name ||
      memberIdentity?.display_name ||
      params.config.agentDiscovery?.displayName?.trim() ||
      (isLocalActor ? params.config.name : address),
    runtimeName: params.config.name,
    tnsName: tnsRow?.member_tns_name ?? memberIdentity?.member_tns_name ?? null,
    discovery: {
      published: Boolean(lastPublishedCard && isLocalActor),
      lastPublishedAt: isLocalActor
        ? params.db.getKV("agent_discovery:last_published_at") ?? null
        : null,
      discoveryNodeId: lastPublishedCard?.discovery_node_id ?? null,
      capabilityNames: lastPublishedCard?.capabilities.map((entry) => entry.name) ?? [],
      endpointUrls: lastPublishedCard?.endpoints.map((entry) => entry.url) ?? [],
      card: lastPublishedCard,
    },
    groups,
    stats: {
      groupCount: groups.length,
      activeGroupCount: groups.filter((entry) => entry.membershipState === "active").length,
      unreadNotificationCount: notifications.unreadCount,
      recentActivityCount: recentActivity.length,
    },
    recentActivity,
  };
}
