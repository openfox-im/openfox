import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import type {
  GroupAnnouncementRecord,
  GroupMessageRecord,
} from "../group/store.js";
import {
  buildFoxProfile,
  type FoxProfile,
} from "./profile.js";
import {
  getWorldFoxDirectoryEntry,
  type WorldFoxDirectoryEntry,
} from "./directory.js";
import { listWorldFeedItems, type WorldFeedItem } from "./feed.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";
import type {
  WorldPresenceRecord,
  WorldPresenceScopeKind,
  WorldPresenceSourceKind,
  WorldPresenceStatus,
} from "./presence.js";

export interface FoxPageAnnouncementRecord extends GroupAnnouncementRecord {
  groupName: string;
  channelName: string | null;
}

export interface FoxPageMessageRecord extends GroupMessageRecord {
  groupName: string;
  channelName: string | null;
}

export interface FoxPageSnapshot {
  generatedAt: string;
  fox: FoxProfile;
  directoryEntry: WorldFoxDirectoryEntry;
  presence: WorldPresenceRecord[];
  recentActivity: WorldFeedItem[];
  recentAnnouncements: FoxPageAnnouncementRecord[];
  recentMessages: FoxPageMessageRecord[];
  roleSummary: Record<string, number>;
  stats: {
    groupCount: number;
    activeGroupCount: number;
    presenceCount: number;
    recentActivityCount: number;
    announcementCount: number;
    messageCount: number;
    capabilityCount: number;
  };
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
  group_name: string | null;
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

function listFoxPresence(
  db: OpenFoxDatabase,
  address: string,
  limit: number,
): WorldPresenceRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT wp.*, g.name AS group_name
       FROM world_presence wp
       LEFT JOIN groups g ON g.group_id = wp.scope_ref AND wp.scope_kind = 'group'
       WHERE wp.actor_address = ?
       ORDER BY wp.updated_at DESC
       LIMIT ?`,
    )
    .all(address, Math.max(1, limit)) as Array<{
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

  return rows.map(mapPresenceRow);
}

function listFoxAnnouncements(
  db: OpenFoxDatabase,
  address: string,
  limit: number,
): FoxPageAnnouncementRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT
         a.*,
         g.name AS group_name,
         c.name AS channel_name
       FROM group_announcements a
       JOIN groups g ON g.group_id = a.group_id
       LEFT JOIN group_channels c ON c.channel_id = a.channel_id
       WHERE a.posted_by_address = ?
         AND a.redacted_at IS NULL
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(address, Math.max(1, limit)) as Array<{
    announcement_id: string;
    group_id: string;
    channel_id: string | null;
    event_id: string;
    title: string;
    body_text: string;
    pinned: number;
    posted_by_address: string;
    created_at: string;
    redacted_at: string | null;
    group_name: string;
    channel_name: string | null;
  }>;

  return rows.map((row) => ({
    announcementId: row.announcement_id,
    groupId: row.group_id,
    channelId: row.channel_id,
    eventId: row.event_id,
    title: row.title,
    bodyText: row.body_text,
    pinned: Boolean(row.pinned),
    postedByAddress: row.posted_by_address,
    createdAt: row.created_at,
    redactedAt: row.redacted_at ?? null,
    groupName: row.group_name,
    channelName: row.channel_name ?? null,
  }));
}

function listFoxMessages(
  db: OpenFoxDatabase,
  address: string,
  limit: number,
): FoxPageMessageRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT
         m.*,
         g.name AS group_name,
         c.name AS channel_name
       FROM group_messages m
       JOIN groups g ON g.group_id = m.group_id
       LEFT JOIN group_channels c ON c.channel_id = m.channel_id
       WHERE m.sender_address = ?
       ORDER BY m.updated_at DESC
       LIMIT ?`,
    )
    .all(address, Math.max(1, limit)) as Array<{
    message_id: string;
    group_id: string;
    channel_id: string;
    original_event_id: string;
    latest_event_id: string;
    sender_address: string;
    sender_agent_id: string | null;
    reply_to_message_id: string | null;
    ciphertext: string;
    preview_text: string | null;
    mentions_json: string;
    reaction_summary_json: string;
    redacted: number;
    created_at: string;
    updated_at: string;
    group_name: string;
    channel_name: string | null;
  }>;

  return rows.map((row) => ({
    messageId: row.message_id,
    groupId: row.group_id,
    channelId: row.channel_id,
    originalEventId: row.original_event_id,
    latestEventId: row.latest_event_id,
    senderAddress: row.sender_address,
    senderAgentId: row.sender_agent_id ?? null,
    replyToMessageId: row.reply_to_message_id ?? null,
    ciphertext: row.ciphertext,
    previewText: row.preview_text ?? null,
    mentions: parseJsonSafe<string[]>(row.mentions_json, []),
    reactionSummary: parseJsonSafe<Record<string, number>>(
      row.reaction_summary_json,
      {},
    ),
    redacted: Boolean(row.redacted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupName: row.group_name,
    channelName: row.channel_name ?? null,
  }));
}

export function buildFoxPageSnapshot(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  address?: string;
  activityLimit?: number;
  announcementLimit?: number;
  messageLimit?: number;
  presenceLimit?: number;
}): FoxPageSnapshot {
  const address = normalizeAddressLike(params.address ?? params.config.walletAddress);
  const activityLimit = Math.max(1, params.activityLimit ?? 12);
  const announcementLimit = Math.max(1, params.announcementLimit ?? 8);
  const messageLimit = Math.max(1, params.messageLimit ?? 10);
  const presenceLimit = Math.max(1, params.presenceLimit ?? 10);

  const fox = buildFoxProfile({
    db: params.db,
    config: params.config,
    address,
    activityLimit,
  });
  const directoryEntry = getWorldFoxDirectoryEntry(params.db, params.config, address);
  const presence = listFoxPresence(params.db, address, presenceLimit);
  const recentActivity = listWorldFeedItems(params.db, {
    limit: Math.max(activityLimit * 4, 40),
  })
    .filter((item) => item.actorAddress?.toLowerCase() === address)
    .slice(0, activityLimit);
  const recentAnnouncements = listFoxAnnouncements(
    params.db,
    address,
    announcementLimit,
  );
  const recentMessages = listFoxMessages(params.db, address, messageLimit);

  const roleSummary: Record<string, number> = {};
  for (const group of fox.groups) {
    if (group.membershipState !== "active") continue;
    for (const role of group.roles) {
      roleSummary[role] = (roleSummary[role] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    fox,
    directoryEntry,
    presence,
    recentActivity,
    recentAnnouncements,
    recentMessages,
    roleSummary,
    stats: {
      groupCount: fox.stats.groupCount,
      activeGroupCount: fox.stats.activeGroupCount,
      presenceCount: presence.length,
      recentActivityCount: recentActivity.length,
      announcementCount: recentAnnouncements.length,
      messageCount: recentMessages.length,
      capabilityCount: directoryEntry.capabilityNames.length,
    },
  };
}

export function buildFoxPageHtml(snapshot: FoxPageSnapshot): string {
  const roleSummary = Object.entries(snapshot.roleSummary)
    .map(([role, count]) => `${escapeHtml(role)}=${count}`)
    .join(", ");
  const groupItems = snapshot.fox.groups
    .slice(0, 12)
    .map(
      (group) => `<li><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.membershipState)} · ${escapeHtml(group.roles.join(", ") || "no roles")}</span></li>`,
    )
    .join("");
  const presenceItems = snapshot.presence
    .slice(0, 10)
    .map(
      (item) => `<li><strong>${escapeHtml(item.scopeKind === "group" ? item.groupName || item.scopeRef : "world")}</strong><span>${escapeHtml(item.effectiveStatus)}${item.summary ? ` · ${escapeHtml(item.summary)}` : ""}</span></li>`,
    )
    .join("");
  const activityItems = snapshot.recentActivity
    .slice(0, 10)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.summary)}</p>
</article>`,
    )
    .join("");
  const announcementItems = snapshot.recentAnnouncements
    .slice(0, 8)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.createdAt)}</span><span>${escapeHtml(item.groupName)}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.bodyText)}</p>
</article>`,
    )
    .join("");
  const messageItems = snapshot.recentMessages
    .slice(0, 8)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.updatedAt)}</span><span>${escapeHtml(item.groupName)}${item.channelName ? ` · #${escapeHtml(item.channelName)}` : ""}</span></div>
  <h4>${escapeHtml(item.senderAgentId || item.senderAddress)}</h4>
  <p>${escapeHtml(item.previewText || item.ciphertext || "")}</p>
</article>`,
    )
    .join("");
  const capabilityItems = snapshot.directoryEntry.capabilityNames
    .slice(0, 20)
    .map((name) => `<li>${escapeHtml(name)}</li>`)
    .join("");

  const sections = [
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Identity</h3>
          <span>${escapeHtml(snapshot.fox.address)}</span>
        </div>
        <div class="list-grid">
          <article class="list-card">
            <div class="meta-row"><span>Agent ID</span><span>${escapeHtml(snapshot.fox.agentId || "not set")}</span></div>
            <div class="meta-row"><span>TNS</span><span>${escapeHtml(snapshot.fox.tnsName || "not set")}</span></div>
            <div class="meta-row"><span>Discovery</span><span>${snapshot.fox.discovery.published ? '<span class="accent">published</span>' : "not published"}</span></div>
          </article>
          <article class="list-card">
            <div class="meta-row"><span>Presence</span><span>${escapeHtml(snapshot.directoryEntry.presenceStatus || "offline")}</span></div>
            <div class="meta-row"><span>Active groups</span><span>${snapshot.directoryEntry.activeGroupCount}</span></div>
            <div class="meta-row"><span>Roles</span><span>${escapeHtml(roleSummary || "none")}</span></div>
          </article>
        </div>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Capabilities</h3>
          <span>${snapshot.stats.capabilityCount}</span>
        </div>
        <ul class="tag-list">${capabilityItems || '<li>none</li>'}</ul>
      </section>
    </section>`,
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Group Memberships</h3>
          <span>${snapshot.stats.groupCount} total</span>
        </div>
        <ul class="directory-list">${groupItems || '<li class="empty">No groups yet.</li>'}</ul>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Presence</h3>
          <span>${snapshot.stats.presenceCount} record(s)</span>
        </div>
        <ul class="directory-list">${presenceItems || '<li class="empty">No presence records.</li>'}</ul>
      </section>
    </section>`,
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Recent Activity</h3>
          <span>${snapshot.stats.recentActivityCount} item(s)</span>
        </div>
        <div class="list-grid">${activityItems || '<p class="empty">No recent activity.</p>'}</div>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Recent Messages</h3>
          <span>${snapshot.stats.messageCount} item(s)</span>
        </div>
        <div class="list-grid">${messageItems || '<p class="empty">No recent messages.</p>'}</div>
      </section>
    </section>`,
    `<section class="panel">
      <div class="section-head">
        <h3>Recent Announcements</h3>
        <span>${snapshot.stats.announcementCount} item(s)</span>
      </div>
      <div class="list-grid">${announcementItems || '<p class="empty">No recent announcements.</p>'}</div>
    </section>`,
  ];

  return renderMetaWorldPageFrame({
    title: `${snapshot.fox.displayName} · OpenFox metaWorld`,
    eyebrow: "OpenFox Fox Page",
    heading: snapshot.fox.displayName,
    lede: `Identity, presence, memberships, activity, and authored community output for ${snapshot.fox.displayName}.`,
    generatedAt: snapshot.generatedAt,
    metrics: [
      { label: "Active groups", value: snapshot.stats.activeGroupCount },
      { label: "Presence records", value: snapshot.stats.presenceCount },
      { label: "Recent activity", value: snapshot.stats.recentActivityCount },
      { label: "Capabilities", value: snapshot.stats.capabilityCount },
    ],
    sections,
  });
}
