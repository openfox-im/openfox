import type { OpenFoxDatabase } from "../types.js";

export type WorldPresenceStatus =
  | "online"
  | "busy"
  | "away"
  | "recently_active";
export type WorldPresenceScopeKind = "world" | "group";
export type WorldPresenceSourceKind = "self" | "peer" | "relay" | "snapshot";
export type WorldPresenceEffectiveStatus = WorldPresenceStatus | "expired";

export interface WorldPresenceRecord {
  actorAddress: string;
  scopeKind: WorldPresenceScopeKind;
  scopeRef: string;
  groupId: string | null;
  groupName: string | null;
  agentId: string | null;
  displayName: string | null;
  status: WorldPresenceStatus;
  effectiveStatus: WorldPresenceEffectiveStatus;
  summary: string | null;
  sourceKind: WorldPresenceSourceKind;
  lastSeenAt: string;
  expiresAt: string;
  updatedAt: string;
  expired: boolean;
}

export interface WorldPresenceSnapshot {
  generatedAt: string;
  activeCount: number;
  items: WorldPresenceRecord[];
  summary: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAddressLike(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`invalid address-like value: ${value}`);
  }
  return trimmed;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function computeEffectiveStatus(
  status: WorldPresenceStatus,
  expiresAt: string,
): WorldPresenceEffectiveStatus {
  return new Date(expiresAt).getTime() > Date.now() ? status : "expired";
}

function mapPresenceRow(row: {
  actor_address: string;
  scope_kind: WorldPresenceScopeKind;
  scope_ref: string;
  agent_id: string | null;
  display_name: string | null;
  status: WorldPresenceStatus;
  summary: string | null;
  source_kind: WorldPresenceSourceKind;
  last_seen_at: string;
  expires_at: string;
  updated_at: string;
  group_name?: string | null;
}): WorldPresenceRecord {
  const expired = new Date(row.expires_at).getTime() <= Date.now();
  return {
    actorAddress: row.actor_address,
    scopeKind: row.scope_kind,
    scopeRef: row.scope_ref,
    groupId: row.scope_kind === "group" ? row.scope_ref : null,
    groupName: row.group_name ?? null,
    agentId: row.agent_id ?? null,
    displayName: row.display_name ?? null,
    status: row.status,
    effectiveStatus: expired ? "expired" : row.status,
    summary: row.summary ?? null,
    sourceKind: row.source_kind,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    expired,
  };
}

export function publishWorldPresence(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  agentId?: string;
  displayName?: string;
  status?: WorldPresenceStatus;
  summary?: string;
  groupId?: string;
  ttlSeconds?: number;
  sourceKind?: WorldPresenceSourceKind;
  publishedAt?: string;
}): WorldPresenceRecord {
  const actorAddress = normalizeAddressLike(params.actorAddress);
  const scopeKind: WorldPresenceScopeKind = params.groupId ? "group" : "world";
  const scopeRef = params.groupId?.trim() || "";
  const status = params.status ?? "online";
  const ttlSeconds = Math.max(30, Math.min(24 * 60 * 60, params.ttlSeconds ?? 120));
  const publishedAt = params.publishedAt ?? nowIso();
  const expiresAt = new Date(Date.parse(publishedAt) + ttlSeconds * 1000).toISOString();
  const sourceKind = params.sourceKind ?? "self";

  if (scopeKind === "group") {
    const membershipRow = params.db.raw
      .prepare(
        `SELECT membership_state
         FROM group_members
         WHERE group_id = ? AND member_address = ?`,
      )
      .get(scopeRef, actorAddress) as { membership_state: string } | undefined;
    if (membershipRow?.membership_state !== "active") {
      throw new Error(`actor is not an active member of group ${scopeRef}`);
    }
  }

  params.db.raw
    .prepare(
      `INSERT OR REPLACE INTO world_presence (
         actor_address,
         scope_kind,
         scope_ref,
         agent_id,
         display_name,
         status,
         summary,
         source_kind,
         last_seen_at,
         expires_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      actorAddress,
      scopeKind,
      scopeRef,
      normalizeOptionalText(params.agentId),
      normalizeOptionalText(params.displayName),
      status,
      normalizeOptionalText(params.summary),
      sourceKind,
      publishedAt,
      expiresAt,
      publishedAt,
    );

  const row = params.db.raw
    .prepare(
      `SELECT wp.*, g.name AS group_name
       FROM world_presence wp
       LEFT JOIN groups g ON g.group_id = wp.scope_ref AND wp.scope_kind = 'group'
       WHERE wp.actor_address = ? AND wp.scope_kind = ? AND wp.scope_ref = ?`,
    )
    .get(actorAddress, scopeKind, scopeRef) as
    | {
        actor_address: string;
        scope_kind: WorldPresenceScopeKind;
        scope_ref: string;
        agent_id: string | null;
        display_name: string | null;
        status: WorldPresenceStatus;
        summary: string | null;
        source_kind: WorldPresenceSourceKind;
        last_seen_at: string;
        expires_at: string;
        updated_at: string;
        group_name: string | null;
      }
    | undefined;
  if (!row) {
    throw new Error("failed to load persisted world presence");
  }
  return mapPresenceRow(row);
}

export function listWorldPresence(
  db: OpenFoxDatabase,
  options?: {
    groupId?: string;
    limit?: number;
    status?: WorldPresenceEffectiveStatus | "all";
    includeExpired?: boolean;
  },
): WorldPresenceRecord[] {
  const limit = Math.max(1, options?.limit ?? 50);
  const rows = db.raw
    .prepare(
      `SELECT wp.*, g.name AS group_name
       FROM world_presence wp
       LEFT JOIN groups g ON g.group_id = wp.scope_ref AND wp.scope_kind = 'group'
       WHERE (? IS NULL AND wp.scope_kind = 'world')
          OR (? IS NOT NULL AND wp.scope_kind = 'group' AND wp.scope_ref = ?)
       ORDER BY wp.updated_at DESC
       LIMIT ?`,
    )
    .all(
      options?.groupId ?? null,
      options?.groupId ?? null,
      options?.groupId ?? null,
      Math.max(limit * 3, 100),
    ) as Array<{
    actor_address: string;
    scope_kind: WorldPresenceScopeKind;
    scope_ref: string;
    agent_id: string | null;
    display_name: string | null;
    status: WorldPresenceStatus;
    summary: string | null;
    source_kind: WorldPresenceSourceKind;
    last_seen_at: string;
    expires_at: string;
    updated_at: string;
    group_name: string | null;
  }>;

  const items = rows.map(mapPresenceRow).filter((item) => {
    if (!options?.includeExpired && item.expired) return false;
    if (!options?.status || options.status === "all") return true;
    return item.effectiveStatus === options.status;
  });

  return items.slice(0, limit);
}

export function buildWorldPresenceSnapshot(
  db: OpenFoxDatabase,
  options?: {
    groupId?: string;
    limit?: number;
    status?: WorldPresenceEffectiveStatus | "all";
    includeExpired?: boolean;
  },
): WorldPresenceSnapshot {
  const items = listWorldPresence(db, options);
  const activeCount = items.filter((item) => !item.expired).length;
  const scope = options?.groupId ? ` for ${options.groupId}` : "";
  return {
    generatedAt: nowIso(),
    activeCount,
    items,
    summary: items.length
      ? `World presence${scope} shows ${items.length} actor(s), ${activeCount} active.`
      : `World presence${scope} is currently empty.`,
  };
}

export function pruneExpiredWorldPresence(
  db: OpenFoxDatabase,
  olderThanSeconds = 24 * 60 * 60,
): number {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  const result = db.raw
    .prepare(
      `DELETE FROM world_presence
       WHERE expires_at < ? AND updated_at < ?`,
    )
    .run(cutoff, cutoff);
  return result.changes;
}
