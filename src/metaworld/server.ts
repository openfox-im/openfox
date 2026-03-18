import http, { type IncomingMessage, type ServerResponse } from "http";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import { loadWalletAccount } from "../identity/wallet.js";
import { escapeHtml } from "./render.js";
import { buildMetaWorldLayout } from "./layout.js";
import { buildMetaWorldRouterScript } from "./router.js";
import {
  listIntents,
  getIntent,
  listIntentResponses,
  type IntentKind,
  type IntentStatus,
} from "./intents.js";
import {
  buildMetaWorldShellSnapshot,
  buildMetaWorldShellHtml,
} from "./shell.js";
import {
  buildFoxPageSnapshot,
  buildFoxPageHtml,
} from "./fox-page.js";
import {
  buildGroupPageSnapshot,
  buildGroupPageHtml,
} from "./group-page.js";
import {
  buildArtifactPageSnapshot,
  buildArtifactPageHtml,
} from "./artifact-page.js";
import {
  buildSettlementPageSnapshot,
  buildSettlementPageHtml,
} from "./settlement-page.js";
import {
  buildWorldFoxDirectorySnapshot,
  buildWorldGroupDirectorySnapshot,
} from "./directory.js";
import { buildWorldFeedSnapshot } from "./feed.js";
import {
  buildWorldBoardSnapshot,
  type WorldBoardKind,
} from "./boards.js";
import {
  buildWorldPresenceSnapshot,
  publishWorldPresence,
  type WorldPresenceStatus,
} from "./presence.js";
import {
  buildWorldNotificationsSnapshot,
  markWorldNotificationRead,
  dismissWorldNotification,
} from "./notifications.js";
import { buildFoxProfile } from "./profile.js";
import { buildSearchResultSnapshot } from "./search.js";
import {
  getReputationCard,
  getReputationLeaderboard,
  type ReputationDimension,
  type ReputationEntityType,
} from "./reputation.js";
import {
  buildGroupGovernanceHtml,
  buildGroupGovernanceSnapshot,
} from "./governance.js";
import {
  buildGovernanceV2Snapshot,
  listGovernanceProposals,
  getGovernanceProposalWithVotes,
  createGovernanceProposal,
  voteOnProposal,
  type GovernanceProposalType,
  type GovernanceVote,
} from "../group/governance.js";
import {
  buildGroupTreasuryHtml,
  buildGroupTreasurySnapshot,
} from "./treasury.js";
import {
  buildMetaWorldPublicationHtml,
  buildMetaWorldPublicationSnapshot,
} from "./publication.js";
import {
  buildPersonalizedFeedSnapshot,
  buildRecommendedFoxes,
  buildRecommendedGroups,
} from "./ranking.js";
import { listSubscriptions } from "./subscriptions.js";
import {
  getFollowCounts,
  getGroupFollowerCount,
  listFollowedFoxes,
  listFollowedGroups,
  listFoxFollowers,
  listGroupFollowers,
} from "./follows.js";
import { worldEventBus, type WorldEventKind } from "./event-bus.js";
import {
  listFederationPeers,
  listFederationEvents,
  buildFederationSnapshot,
  type FederationEventType,
} from "./federation.js";

const logger = createLogger("metaworld-server");

export interface MetaWorldServer {
  url: string;
  close(): Promise<void>;
}

export interface StartMetaWorldServerOptions {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  port?: number;
  host?: string;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function htmlResponse(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseIntParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const BOARD_KINDS = new Set<string>(["work", "opportunity", "artifact", "settlement"]);

function wrapInLayout(title: string, content: string, activeRoute?: string): string {
  return buildMetaWorldLayout({
    title: `${title} — OpenFox metaWorld`,
    content,
    activeRoute,
    scripts: buildMetaWorldRouterScript(),
  });
}

function renderFeedHtml(
  db: OpenFoxDatabase,
  groupId?: string,
  limit = 25,
  subscriberAddress?: string,
  subscribedOnly = false,
  title = "World Feed",
  activeRoute = "/feed",
): string {
  const snapshot = buildWorldFeedSnapshot(db, {
    groupId,
    limit,
    subscriberAddress,
    subscribedOnly,
  });
  const items = snapshot.items
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const content = `<h2 class="mw-title">${escapeHtml(title)}</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<div class="mw-grid">${items || '<p class="mw-empty">No feed items yet.</p>'}</div>`;
  return wrapInLayout(title, content, activeRoute);
}

function renderDirectoryFoxesHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  query?: string,
  role?: string,
  limit = 25,
): string {
  const snapshot = buildWorldFoxDirectorySnapshot(db, config, { query, role, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/fox/${encodeURIComponent(item.address)}">${escapeHtml(item.displayName)}</a></span><span class="mw-li-value">${escapeHtml(item.presenceStatus || "offline")} · groups=${item.activeGroupCount}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Fox Directory</h2>
<p style="margin-bottom:12px;"><a href="/directory/foxes">Foxes</a> | <a href="/directory/groups">Groups</a></p>
<ul class="mw-list">${items || '<li class="mw-empty">No Fox profiles yet.</li>'}</ul>`;
  return wrapInLayout("Fox Directory", content, "/directory/foxes");
}

function renderDirectoryGroupsHtml(
  db: OpenFoxDatabase,
  query?: string,
  visibility?: "private" | "listed" | "public",
  tag?: string,
  limit = 25,
): string {
  const snapshot = buildWorldGroupDirectorySnapshot(db, { query, visibility, tag, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/group/${encodeURIComponent(item.groupId)}">${escapeHtml(item.name)}</a></span><span class="mw-li-value">${item.activeMemberCount} members · ${escapeHtml(item.visibility)}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Group Directory</h2>
<p style="margin-bottom:12px;"><a href="/directory/foxes">Foxes</a> | <a href="/directory/groups">Groups</a></p>
<ul class="mw-list">${items || '<li class="mw-empty">No groups yet.</li>'}</ul>`;
  return wrapInLayout("Group Directory", content, "/directory/foxes");
}

function renderBoardHtml(db: OpenFoxDatabase, kind: WorldBoardKind, limit = 25): string {
  const snapshot = buildWorldBoardSnapshot(db, { boardKind: kind, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.status)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
  const boardNav = (["work", "opportunity", "artifact", "settlement"] as const)
    .map((k) => `<a href="/boards/${k}"${k === kind ? ' style="color:var(--accent)"' : ""}>${k.charAt(0).toUpperCase() + k.slice(1)}</a>`)
    .join(" | ");
  const content = `<h2 class="mw-title">${escapeHtml(kindLabel)} Board</h2>
<p style="margin-bottom:12px;">${boardNav}</p>
<div class="mw-grid">${items || '<p class="mw-empty">No items yet.</p>'}</div>`;
  return wrapInLayout(`${kindLabel} Board`, content, "/boards/work");
}

function renderPresenceHtml(db: OpenFoxDatabase, limit = 25): string {
  const snapshot = buildWorldPresenceSnapshot(db, { limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<li><span class="mw-li-label">${escapeHtml(item.displayName || item.agentId || item.actorAddress)}</span><span class="mw-li-value">${escapeHtml(item.effectiveStatus)}${item.groupName ? ` · ${escapeHtml(item.groupName)}` : ""}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Presence</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<ul class="mw-list">${items || '<li class="mw-empty">No live presence.</li>'}</ul>`;
  return wrapInLayout("Presence", content, "/presence");
}

function renderNotificationsHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  limit = 25,
  subscribedOnly = false,
): string {
  const snapshot = buildWorldNotificationsSnapshot(db, {
    actorAddress: config.walletAddress,
    limit,
    subscribedOnly,
  });
  const items = snapshot.items
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${item.readAt ? "read" : '<span class="mw-badge">unread</span>'}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Notifications</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${snapshot.unreadCount} unread</p>
<div class="mw-grid">${items || '<p class="mw-empty">Nothing needs attention.</p>'}</div>`;
  return wrapInLayout("Notifications", content, "/notifications");
}

function renderSearchHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  query?: string,
  kind?: "fox" | "group" | "board_item",
  limit = 25,
): string {
  const snapshot = buildSearchResultSnapshot(db, config, query || "", {
    kinds: kind ? [kind] : undefined,
    limit,
  });
  function resultHref(item: { kind: "fox" | "group" | "board_item"; sourceId: string }): string | null {
    if (item.kind === "fox") {
      return `/fox/${encodeURIComponent(item.sourceId)}`;
    }
    if (item.kind === "group") {
      return `/group/${encodeURIComponent(item.sourceId)}`;
    }
    return null;
  }
  const items = snapshot.results
    .map((item) => {
      const href = resultHref(item);
      const title = href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.kind)}</span><span>score ${escapeHtml(String(item.relevanceScore))}</span></div><h4>${title}</h4><p>${escapeHtml(item.summary)}</p></div>`;
    })
    .join("");
  const content = `<h2 class="mw-title">Search</h2>
<form method="GET" action="/search" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
  <input name="query" type="search" value="${escapeHtml(query || "")}" placeholder="Search foxes, groups, bounties, and tags" style="flex:1 1 280px;padding:10px 12px;border-radius:12px;border:1px solid var(--text-muted);" />
  <select name="kind" style="padding:10px 12px;border-radius:12px;border:1px solid var(--text-muted);">
    <option value=""${!kind ? " selected" : ""}>All</option>
    <option value="fox"${kind === "fox" ? " selected" : ""}>Foxes</option>
    <option value="group"${kind === "group" ? " selected" : ""}>Groups</option>
    <option value="board_item"${kind === "board_item" ? " selected" : ""}>Board items</option>
  </select>
  <button type="submit" style="padding:10px 14px;border-radius:12px;border:none;background:var(--accent);color:white;">Search</button>
</form>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<div class="mw-grid">${items || '<p class="mw-empty">No results.</p>'}</div>`;
  return wrapInLayout("Search", content, "/search");
}

function renderRecommendedHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  kind: "foxes" | "groups",
  limit = 25,
): string {
  const snapshot =
    kind === "foxes"
      ? buildRecommendedFoxes(db, config, { limit })
      : buildRecommendedGroups(db, config, { limit });
  const items = snapshot.items
    .map((item) => {
      const title = "displayName" in item ? item.displayName : item.name;
      return `<div class="mw-card"><div class="mw-meta"><span>recommended</span><span>${escapeHtml(String(item.score))}</span></div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(item.reason)}</p></div>`;
    })
    .join("");
  const content = `<h2 class="mw-title">${kind === "foxes" ? "Recommended Foxes" : "Recommended Groups"}</h2>
<p style="margin-bottom:12px;"><a href="/recommended/foxes">Foxes</a> | <a href="/recommended/groups">Groups</a></p>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<div class="mw-grid">${items || '<p class="mw-empty">No recommendations yet.</p>'}</div>`;
  return wrapInLayout(
    kind === "foxes" ? "Recommended Foxes" : "Recommended Groups",
    content,
    `/recommended/${kind}`,
  );
}

function renderSubscriptionsHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  kind?: "fox" | "group" | "board",
  limit = 50,
): string {
  const subscriptions = listSubscriptions(db, config.walletAddress, {
    feedKind: kind,
    limit,
  });
  const items = subscriptions
    .map(
      (item) =>
        `<li><span class="mw-li-label">${escapeHtml(`${item.feedKind}:${item.targetId}`)}</span><span class="mw-li-value">${escapeHtml(item.notifyOn.join(", "))}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Subscriptions</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${subscriptions.length} subscription(s).</p>
<ul class="mw-list">${items || '<li class="mw-empty">No subscriptions configured.</li>'}</ul>`;
  return wrapInLayout("Subscriptions", content, "/subscriptions");
}

function getGroupDisplayName(db: OpenFoxDatabase, groupId: string): string {
  const row = db.raw
    .prepare(
      `SELECT name
       FROM groups
       WHERE group_id = ?
       LIMIT 1`,
    )
    .get(groupId) as { name: string } | undefined;
  return row?.name || groupId;
}

function getFoxDisplayName(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  address: string,
): string {
  try {
    return buildFoxProfile({ db, config, address }).displayName;
  } catch {
    return address;
  }
}

function buildFollowingSnapshot(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  limit = 50,
): {
  generatedAt: string;
  summary: string;
  counts: ReturnType<typeof getFollowCounts>;
  followedFoxes: Array<{
    targetAddress: string;
    displayName: string;
    createdAt: string;
    followerCount: number;
  }>;
  followedGroups: Array<{
    groupId: string;
    name: string;
    createdAt: string;
    followerCount: number;
  }>;
} {
  const counts = getFollowCounts(db, config.walletAddress);
  const followedFoxes = listFollowedFoxes(db, config.walletAddress, { limit }).map((record) => ({
    targetAddress: record.targetAddress || "",
    displayName: getFoxDisplayName(db, config, record.targetAddress || ""),
    createdAt: record.createdAt,
    followerCount: record.targetAddress ? getFollowCounts(db, record.targetAddress).followers : 0,
  }));
  const followedGroups = listFollowedGroups(db, config.walletAddress, { limit }).map((record) => ({
    groupId: record.targetGroupId || "",
    name: getGroupDisplayName(db, record.targetGroupId || ""),
    createdAt: record.createdAt,
    followerCount: record.targetGroupId ? getGroupFollowerCount(db, record.targetGroupId) : 0,
  }));
  return {
    generatedAt: new Date().toISOString(),
    summary: `Following ${counts.followingFoxes} fox(es) and ${counts.followingGroups} group(s).`,
    counts,
    followedFoxes,
    followedGroups,
  };
}

function buildFollowersSnapshot(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  limit = 50,
): {
  generatedAt: string;
  summary: string;
  foxFollowers: Array<{
    followerAddress: string;
    displayName: string;
    createdAt: string;
  }>;
  groupFollowers: Array<{
    groupId: string;
    name: string;
    followerCount: number;
    followers: Array<{
      followerAddress: string;
      displayName: string;
      createdAt: string;
    }>;
  }>;
} {
  const profile = buildFoxProfile({ db, config, address: config.walletAddress });
  const foxFollowers = listFoxFollowers(db, config.walletAddress, { limit }).map((record) => ({
    followerAddress: record.followerAddress,
    displayName: getFoxDisplayName(db, config, record.followerAddress),
    createdAt: record.createdAt,
  }));
  const groupFollowers = profile.groups
    .filter((group) => group.membershipState === "active")
    .slice(0, limit)
    .map((group) => ({
      groupId: group.groupId,
      name: group.name,
      followerCount: getGroupFollowerCount(db, group.groupId),
      followers: listGroupFollowers(db, group.groupId, { limit }).map((record) => ({
        followerAddress: record.followerAddress,
        displayName: getFoxDisplayName(db, config, record.followerAddress),
        createdAt: record.createdAt,
      })),
    }));
  return {
    generatedAt: new Date().toISOString(),
    summary: `${foxFollowers.length} fox follower(s), ${groupFollowers.reduce((sum, group) => sum + group.followerCount, 0)} group follower(s) across ${groupFollowers.length} active group(s).`,
    foxFollowers,
    groupFollowers,
  };
}

function renderFollowingHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  limit = 50,
): string {
  const snapshot = buildFollowingSnapshot(db, config, limit);
  const foxItems = snapshot.followedFoxes
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/fox/${encodeURIComponent(item.targetAddress)}">${escapeHtml(item.displayName)}</a></span><span class="mw-li-value">${item.followerCount} follower(s) · ${escapeHtml(item.createdAt)}</span></li>`,
    )
    .join("");
  const groupItems = snapshot.followedGroups
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/group/${encodeURIComponent(item.groupId)}">${escapeHtml(item.name)}</a></span><span class="mw-li-value">${item.followerCount} follower(s) · ${escapeHtml(item.createdAt)}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Following</h2>
<p style="margin-bottom:12px;"><a href="/following">Following</a> | <a href="/followers">Followers</a> | <a href="/subscriptions">Subscriptions</a></p>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<div class="mw-metrics">
  <div class="mw-metric"><strong>${snapshot.counts.followingFoxes}</strong><span>Foxes</span></div>
  <div class="mw-metric"><strong>${snapshot.counts.followingGroups}</strong><span>Groups</span></div>
  <div class="mw-metric"><strong>${snapshot.counts.followers}</strong><span>Followers</span></div>
</div>
<div class="mw-grid">
  <div class="mw-panel"><h3>Followed Foxes</h3><ul class="mw-list">${foxItems || '<li class="mw-empty">No followed foxes.</li>'}</ul></div>
  <div class="mw-panel"><h3>Followed Groups</h3><ul class="mw-list">${groupItems || '<li class="mw-empty">No followed groups.</li>'}</ul></div>
</div>`;
  return wrapInLayout("Following", content, "/following");
}

function renderFollowersHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  limit = 50,
): string {
  const snapshot = buildFollowersSnapshot(db, config, limit);
  const foxItems = snapshot.foxFollowers
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/fox/${encodeURIComponent(item.followerAddress)}">${escapeHtml(item.displayName)}</a></span><span class="mw-li-value">${escapeHtml(item.createdAt)}</span></li>`,
    )
    .join("");
  const groupSections = snapshot.groupFollowers
    .map((group) => {
      const followers = group.followers
        .map(
          (item) =>
            `<li><span class="mw-li-label"><a href="/fox/${encodeURIComponent(item.followerAddress)}">${escapeHtml(item.displayName)}</a></span><span class="mw-li-value">${escapeHtml(item.createdAt)}</span></li>`,
        )
        .join("");
      return `<div class="mw-panel"><h3><a href="/group/${encodeURIComponent(group.groupId)}">${escapeHtml(group.name)}</a></h3><p style="color:var(--text-muted);margin-bottom:12px;">${group.followerCount} follower(s)</p><ul class="mw-list">${followers || '<li class="mw-empty">No followers for this group.</li>'}</ul></div>`;
    })
    .join("");
  const content = `<h2 class="mw-title">Followers</h2>
<p style="margin-bottom:12px;"><a href="/following">Following</a> | <a href="/followers">Followers</a> | <a href="/subscriptions">Subscriptions</a></p>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<div class="mw-grid">
  <div class="mw-panel"><h3>Fox Followers</h3><ul class="mw-list">${foxItems || '<li class="mw-empty">No fox followers yet.</li>'}</ul></div>
  <div>${groupSections || '<div class="mw-panel"><h3>Group Followers</h3><p class="mw-empty">No active groups or no followers yet.</p></div>'}</div>
</div>`;
  return wrapInLayout("Followers", content, "/following");
}

function renderShellHtml(db: OpenFoxDatabase, config: OpenFoxConfig): string {
  const snapshot = buildMetaWorldShellSnapshot({ db, config });
  const feedItems = snapshot.feed.items
    .slice(0, 12)
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const notifItems = snapshot.notifications.items
    .slice(0, 8)
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${item.readAt ? "read" : "unread"}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const presenceItems = snapshot.presence.items
    .slice(0, 8)
    .map(
      (item) =>
        `<li><span class="mw-li-label">${escapeHtml(item.displayName || item.agentId || item.actorAddress)}</span><span class="mw-li-value">${escapeHtml(item.effectiveStatus)}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">${escapeHtml(snapshot.fox.displayName)}</h2>
<div class="mw-metrics">
  <div class="mw-metric"><strong>${snapshot.notifications.unreadCount}</strong><span>Unread</span></div>
  <div class="mw-metric"><strong>${snapshot.fox.stats.activeGroupCount}</strong><span>Groups</span></div>
  <div class="mw-metric"><strong>${snapshot.presence.activeCount}</strong><span>Present</span></div>
  <div class="mw-metric"><strong>${snapshot.feed.items.length}</strong><span>Feed items</span></div>
</div>
<div class="mw-panel"><h3>World Feed</h3><div class="mw-grid">${feedItems || '<p class="mw-empty">No feed items yet.</p>'}</div></div>
<div class="mw-grid">
  <div class="mw-panel"><h3>Notifications</h3><div class="mw-grid">${notifItems || '<p class="mw-empty">Nothing needs attention.</p>'}</div></div>
  <div class="mw-panel"><h3>Presence</h3><ul class="mw-list">${presenceItems || '<li class="mw-empty">No live presence.</li>'}</ul></div>
</div>`;
  return wrapInLayout("Home", content, "/");
}

export async function startMetaWorldServer(
  options: StartMetaWorldServerOptions,
): Promise<MetaWorldServer> {
  const { db, config } = options;
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const pathname = url.pathname;

        // --- JSON API routes ---

        if (req.method === "GET" && pathname === "/api/v1/shell") {
          jsonResponse(res, 200, buildMetaWorldShellSnapshot({ db, config }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/feed") {
          const groupId = url.searchParams.get("group") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const subscribedOnly = url.searchParams.get("subscribed_only") === "1";
          jsonResponse(res, 200, buildWorldFeedSnapshot(db, {
            groupId,
            limit,
            subscriberAddress: config.walletAddress,
            subscribedOnly,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/personalized-feed") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildPersonalizedFeedSnapshot(db, config, { limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/following") {
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          jsonResponse(res, 200, buildFollowingSnapshot(db, config, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/followers") {
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          jsonResponse(res, 200, buildFollowersSnapshot(db, config, limit));
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/fox\/[^/]+$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[4]);
          try {
            const profile = buildFoxProfile({ db, config, address });
            jsonResponse(res, 200, profile);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/group\/[^/]+$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const snapshot = buildGroupPageSnapshot(db, { groupId });
            jsonResponse(res, 200, snapshot);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/artifact\/[^/]+$/.test(pathname)) {
          const artifactId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const snapshot = buildArtifactPageSnapshot(db, {
              artifactId,
              settlementLimit: parseIntParam(url.searchParams.get("settlements"), 8),
            });
            jsonResponse(res, 200, snapshot);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/settlement\/[^/]+$/.test(pathname)) {
          const receiptId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const snapshot = buildSettlementPageSnapshot(db, {
              receiptId,
              artifactLimit: parseIntParam(url.searchParams.get("artifacts"), 8),
            });
            jsonResponse(res, 200, snapshot);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/group\/[^/]+\/governance$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const snapshot = buildGroupGovernanceSnapshot(db, {
              groupId,
              proposalLimit: parseIntParam(url.searchParams.get("proposals"), 20),
              joinRequestLimit: parseIntParam(url.searchParams.get("requests"), 20),
            });
            jsonResponse(res, 200, snapshot);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        // --- Governance v2 API routes ---

        if (req.method === "GET" && /^\/api\/v1\/group\/[^/]+\/governance\/proposals$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const status = url.searchParams.get("status") as string | null;
            const proposals = listGovernanceProposals(
              db,
              groupId,
              (status || undefined) as any,
            );
            jsonResponse(res, 200, { groupId, proposals });
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/group\/[^/]+\/governance\/proposals\/[^/]+$/.test(pathname)) {
          const parts = pathname.split("/");
          const proposalId = decodeURIComponent(parts[6]);
          try {
            const result = getGovernanceProposalWithVotes(db, proposalId);
            if (!result) {
              jsonResponse(res, 404, { error: "proposal not found" });
              return;
            }
            jsonResponse(res, 200, result);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "POST" && /^\/api\/v1\/group\/[^/]+\/governance\/proposals$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const walletAccount = loadWalletAccount();
            if (!walletAccount) {
              jsonResponse(res, 500, { error: "wallet not available" });
              return;
            }
            const body = await readJsonBody(req);
            const proposal = await createGovernanceProposal(db, {
              account: walletAccount,
              groupId,
              proposalType: body.proposalType as GovernanceProposalType,
              title: body.title as string,
              description: typeof body.description === "string" ? body.description : undefined,
              params: typeof body.params === "object" && body.params ? body.params as Record<string, unknown> : undefined,
              proposerAddress: config.walletAddress,
              proposerAgentId: config.agentId,
              durationHours: typeof body.durationHours === "number" ? body.durationHours : undefined,
            });
            jsonResponse(res, 201, proposal);
          } catch (err) {
            jsonResponse(res, 400, { error: err instanceof Error ? err.message : "bad request" });
          }
          return;
        }

        if (req.method === "POST" && /^\/api\/v1\/group\/[^/]+\/governance\/proposals\/[^/]+\/vote$/.test(pathname)) {
          const parts = pathname.split("/");
          const proposalId = decodeURIComponent(parts[6]);
          try {
            const walletAccount = loadWalletAccount();
            if (!walletAccount) {
              jsonResponse(res, 500, { error: "wallet not available" });
              return;
            }
            const body = await readJsonBody(req);
            const result = await voteOnProposal(db, {
              account: walletAccount,
              proposalId,
              voterAddress: config.walletAddress,
              voterAgentId: config.agentId,
              vote: body.vote as GovernanceVote,
              reason: typeof body.reason === "string" ? body.reason : undefined,
            });
            jsonResponse(res, 200, result);
          } catch (err) {
            jsonResponse(res, 400, { error: err instanceof Error ? err.message : "bad request" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/group\/[^/]+\/treasury$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const snapshot = buildGroupTreasurySnapshot(db, {
              groupId,
              campaignLimit: parseIntParam(url.searchParams.get("campaigns"), 12),
              bountyLimit: parseIntParam(url.searchParams.get("bounties"), 12),
              settlementLimit: parseIntParam(url.searchParams.get("settlements"), 12),
            });
            jsonResponse(res, 200, snapshot);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/directory/foxes") {
          const query = url.searchParams.get("query") || undefined;
          const role = url.searchParams.get("role") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldFoxDirectorySnapshot(db, config, { query, role, limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/directory/groups") {
          const query = url.searchParams.get("query") || undefined;
          const visibilityRaw = url.searchParams.get("visibility");
          const visibility =
            visibilityRaw === "private" || visibilityRaw === "listed" || visibilityRaw === "public"
              ? visibilityRaw
              : undefined;
          const tag = url.searchParams.get("tag") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldGroupDirectorySnapshot(db, { query, visibility, tag, limit }));
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/boards\/[^/]+$/.test(pathname)) {
          const kind = pathname.split("/")[4];
          if (!BOARD_KINDS.has(kind)) {
            jsonResponse(res, 400, { error: "invalid board kind" });
            return;
          }
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldBoardSnapshot(db, { boardKind: kind as WorldBoardKind, limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/presence") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldPresenceSnapshot(db, { limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/notifications") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const subscribedOnly = url.searchParams.get("subscribed_only") === "1";
          jsonResponse(res, 200, buildWorldNotificationsSnapshot(db, {
            actorAddress: config.walletAddress,
            limit,
            subscribedOnly,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/search") {
          const query = url.searchParams.get("query") || "";
          const kindRaw = url.searchParams.get("kind");
          const kind =
            kindRaw === "fox" || kindRaw === "group" || kindRaw === "board_item"
              ? kindRaw
              : undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildSearchResultSnapshot(db, config, query, {
            kinds: kind ? [kind] : undefined,
            limit,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/publication") {
          jsonResponse(res, 200, buildMetaWorldPublicationSnapshot(db));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/recommended/foxes") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildRecommendedFoxes(db, config, { limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/recommended/groups") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildRecommendedGroups(db, config, { limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/subscriptions") {
          const kindRaw = url.searchParams.get("kind");
          const kind =
            kindRaw === "fox" || kindRaw === "group" || kindRaw === "board"
              ? kindRaw
              : undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          jsonResponse(res, 200, {
            subscriptions: listSubscriptions(db, config.walletAddress, {
              feedKind: kind,
              limit,
            }),
          });
          return;
        }

        // --- SSE event stream ---

        if (req.method === "GET" && pathname === "/api/v1/events/stream") {
          const kindsParam = url.searchParams.get("kinds");
          const kinds = kindsParam ? kindsParam.split(",") as WorldEventKind[] : undefined;

          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });

          // Send initial comment to establish connection
          res.write(": connected\n\n");

          const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          worldEventBus.subscribe(clientId, kinds);

          // Stream events
          const stream = worldEventBus.getStream(clientId);
          const streamEvents = async () => {
            try {
              for await (const event of stream) {
                if (res.destroyed) break;
                res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event.payload)}\n\n`);
              }
            } catch {
              // Connection closed
            }
          };
          streamEvents();

          // Heartbeat to keep connection alive
          const heartbeat = setInterval(() => {
            if (res.destroyed) {
              clearInterval(heartbeat);
              worldEventBus.unsubscribe(clientId);
              return;
            }
            res.write(": heartbeat\n\n");
          }, 15000);

          req.on("close", () => {
            clearInterval(heartbeat);
            worldEventBus.unsubscribe(clientId);
          });

          return;
        }

        // --- POST action endpoints ---

        if (req.method === "POST" && pathname === "/api/v1/presence/publish") {
          const body = await readJsonBody(req);
          const status = (
            typeof body.status === "string" &&
            (body.status === "online" || body.status === "busy" || body.status === "away" || body.status === "recently_active")
          ) ? body.status as WorldPresenceStatus : "online";
          const record = publishWorldPresence({
            db,
            actorAddress: config.walletAddress,
            agentId: config.agentId,
            displayName: config.agentDiscovery?.displayName?.trim() || config.name,
            status,
            summary: typeof body.summary === "string" ? body.summary : undefined,
            groupId: typeof body.groupId === "string" ? body.groupId : undefined,
            ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : 120,
          });
          worldEventBus.publish({
            kind: "presence.update",
            payload: { actorAddress: config.walletAddress, status, groupId: typeof body.groupId === "string" ? body.groupId : undefined },
            timestamp: new Date().toISOString(),
          });
          jsonResponse(res, 200, record);
          return;
        }

        if (req.method === "POST" && /^\/api\/v1\/notifications\/[^/]+\/read$/.test(pathname)) {
          const notificationId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const state = markWorldNotificationRead(db, notificationId);
            worldEventBus.publish({
              kind: "notification.new",
              payload: { notificationId, action: "read" },
              timestamp: new Date().toISOString(),
            });
            jsonResponse(res, 200, state);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "POST" && /^\/api\/v1\/notifications\/[^/]+\/dismiss$/.test(pathname)) {
          const notificationId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const state = dismissWorldNotification(db, notificationId);
            worldEventBus.publish({
              kind: "notification.new",
              payload: { notificationId, action: "dismissed" },
              timestamp: new Date().toISOString(),
            });
            jsonResponse(res, 200, state);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        // --- Reputation API routes ---

        if (req.method === "GET" && /^\/api\/v1\/reputation\/leaderboard$/.test(pathname)) {
          const entityType = (url.searchParams.get("type") || "fox") as ReputationEntityType;
          const dimension = (url.searchParams.get("dimension") || "reliability") as ReputationDimension;
          const limit = parseIntParam(url.searchParams.get("limit"), 10);
          jsonResponse(res, 200, getReputationLeaderboard(db, entityType, dimension, limit));
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/reputation\/[^/]+$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[4]);
          try {
            const card = getReputationCard(db, address);
            jsonResponse(res, 200, card);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        // --- HTML page routes ---

        if (req.method === "GET" && pathname === "/") {
          htmlResponse(res, 200, renderShellHtml(db, config));
          return;
        }

        if (req.method === "GET" && pathname === "/feed") {
          const groupId = url.searchParams.get("group") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const subscribedOnly = url.searchParams.get("subscribed_only") === "1";
          htmlResponse(
            res,
            200,
            renderFeedHtml(
              db,
              groupId,
              limit,
              config.walletAddress,
              subscribedOnly,
              subscribedOnly ? "Subscribed Feed" : "World Feed",
              "/feed",
            ),
          );
          return;
        }

        if (req.method === "GET" && pathname === "/personalized-feed") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const snapshot = buildPersonalizedFeedSnapshot(db, config, { limit });
          const items = snapshot.items
            .map(
              (item) =>
                `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.boostReasons.join(", ") || "ranked")}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
            )
            .join("");
          htmlResponse(
            res,
            200,
            wrapInLayout(
              "Personalized Feed",
              `<h2 class="mw-title">Personalized Feed</h2><p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p><div class="mw-grid">${items || '<p class="mw-empty">No personalized items yet.</p>'}</div>`,
              "/personalized-feed",
            ),
          );
          return;
        }

        if (req.method === "GET" && pathname === "/search") {
          const query = url.searchParams.get("query") || undefined;
          const kindRaw = url.searchParams.get("kind");
          const kind =
            kindRaw === "fox" || kindRaw === "group" || kindRaw === "board_item"
              ? kindRaw
              : undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderSearchHtml(db, config, query, kind, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/publication") {
          htmlResponse(
            res,
            200,
            buildMetaWorldPublicationHtml(buildMetaWorldPublicationSnapshot(db), {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              searchHref: "/search",
            }),
          );
          return;
        }

        if (req.method === "GET" && pathname === "/following") {
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          htmlResponse(res, 200, renderFollowingHtml(db, config, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/followers") {
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          htmlResponse(res, 200, renderFollowersHtml(db, config, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/recommended/foxes") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderRecommendedHtml(db, config, "foxes", limit));
          return;
        }

        if (req.method === "GET" && pathname === "/recommended/groups") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderRecommendedHtml(db, config, "groups", limit));
          return;
        }

        if (req.method === "GET" && pathname === "/subscriptions") {
          const kindRaw = url.searchParams.get("kind");
          const kind =
            kindRaw === "fox" || kindRaw === "group" || kindRaw === "board"
              ? kindRaw
              : undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          htmlResponse(res, 200, renderSubscriptionsHtml(db, config, kind, limit));
          return;
        }

        if (req.method === "GET" && /^\/fox\/[^/]+$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildFoxPageSnapshot({ db, config, address });
            const html = buildFoxPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              publicationHref: "/publication",
              groupHrefsById: Object.fromEntries(
                snapshot.fox.groups.map((g) => [g.groupId, `/group/${encodeURIComponent(g.groupId)}`]),
              ),
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Fox not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/fox\/[^/]+\/page$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildFoxPageSnapshot({ db, config, address });
            const html = buildFoxPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              publicationHref: "/publication",
              groupHrefsById: Object.fromEntries(
                snapshot.fox.groups.map((g) => [g.groupId, `/group/${encodeURIComponent(g.groupId)}`]),
              ),
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Fox not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/fox\/[^/]+\/reputation$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[2]);
          try {
            const card = getReputationCard(db, address);
            const dimRows = card.dimensions
              .map(
                (d) =>
                  `<tr><td>${escapeHtml(d.dimension)}</td><td>${d.score.toFixed(3)}</td><td>${d.eventCount}</td></tr>`,
              )
              .join("");
            const content = `<h2 class="mw-title">Reputation: ${escapeHtml(address.slice(0, 14))}...</h2>
<p>Entity type: ${escapeHtml(card.entityType)} &middot; Overall: <strong>${card.overallScore.toFixed(3)}</strong></p>
<table class="mw-table"><thead><tr><th>Dimension</th><th>Score</th><th>Events</th></tr></thead><tbody>${dimRows || '<tr><td colspan="3">No reputation scores yet.</td></tr>'}</tbody></table>
<p><a href="/fox/${encodeURIComponent(address)}">Back to profile</a></p>`;
            htmlResponse(res, 200, wrapInLayout(`Reputation: ${address.slice(0, 14)}`, content));
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Fox not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/group\/[^/]+\/reputation$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const card = getReputationCard(db, groupId);
            const dimRows = card.dimensions
              .map(
                (d) =>
                  `<tr><td>${escapeHtml(d.dimension)}</td><td>${d.score.toFixed(3)}</td><td>${d.eventCount}</td></tr>`,
              )
              .join("");
            const content = `<h2 class="mw-title">Reputation: ${escapeHtml(groupId.slice(0, 14))}...</h2>
<p>Entity type: ${escapeHtml(card.entityType)} &middot; Overall: <strong>${card.overallScore.toFixed(3)}</strong></p>
<table class="mw-table"><thead><tr><th>Dimension</th><th>Score</th><th>Events</th></tr></thead><tbody>${dimRows || '<tr><td colspan="3">No reputation scores yet.</td></tr>'}</tbody></table>
<p><a href="/group/${encodeURIComponent(groupId)}">Back to group</a></p>`;
            htmlResponse(res, 200, wrapInLayout(`Reputation: ${groupId.slice(0, 14)}`, content));
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Group not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/group\/[^/]+$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildGroupPageSnapshot(db, { groupId });
            const html = buildGroupPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              publicationHref: "/publication",
              searchHref: "/search",
              foxHrefsByAddress: Object.fromEntries(
                snapshot.members.map((m) => [m.memberAddress, `/fox/${encodeURIComponent(m.memberAddress)}`]),
              ),
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Group not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/artifact\/[^/]+$/.test(pathname)) {
          const artifactId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildArtifactPageSnapshot(db, {
              artifactId,
              settlementLimit: parseIntParam(url.searchParams.get("settlements"), 8),
            });
            const html = buildArtifactPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              searchHref: "/search",
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Artifact not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/settlement\/[^/]+$/.test(pathname)) {
          const receiptId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildSettlementPageSnapshot(db, {
              receiptId,
              artifactLimit: parseIntParam(url.searchParams.get("artifacts"), 8),
            });
            const html = buildSettlementPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              searchHref: "/search",
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Settlement not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/group\/[^/]+\/governance$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildGroupGovernanceSnapshot(db, {
              groupId,
              proposalLimit: parseIntParam(url.searchParams.get("proposals"), 20),
              joinRequestLimit: parseIntParam(url.searchParams.get("requests"), 20),
            });
            const html = buildGroupGovernanceHtml(snapshot, {
              homeHref: "/",
              groupPageHref: `/group/${encodeURIComponent(groupId)}`,
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              searchHref: "/search",
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Group not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/group\/[^/]+\/treasury$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildGroupTreasurySnapshot(db, {
              groupId,
              campaignLimit: parseIntParam(url.searchParams.get("campaigns"), 12),
              bountyLimit: parseIntParam(url.searchParams.get("bounties"), 12),
              settlementLimit: parseIntParam(url.searchParams.get("settlements"), 12),
            });
            const html = buildGroupTreasuryHtml(snapshot, {
              homeHref: "/",
              groupPageHref: `/group/${encodeURIComponent(groupId)}`,
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              searchHref: "/search",
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Group not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && pathname === "/directory/foxes") {
          const query = url.searchParams.get("query") || undefined;
          const role = url.searchParams.get("role") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderDirectoryFoxesHtml(db, config, query, role, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/directory/groups") {
          const query = url.searchParams.get("query") || undefined;
          const visibilityRaw = url.searchParams.get("visibility");
          const visibility =
            visibilityRaw === "private" || visibilityRaw === "listed" || visibilityRaw === "public"
              ? visibilityRaw
              : undefined;
          const tag = url.searchParams.get("tag") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderDirectoryGroupsHtml(db, query, visibility, tag, limit));
          return;
        }

        if (req.method === "GET" && /^\/boards\/[^/]+$/.test(pathname)) {
          const kind = pathname.split("/")[2];
          if (!BOARD_KINDS.has(kind)) {
            htmlResponse(res, 400, wrapInLayout("Bad Request", `<p class="mw-empty">Invalid board kind: ${escapeHtml(kind)}</p>`));
            return;
          }
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderBoardHtml(db, kind as WorldBoardKind, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/presence") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderPresenceHtml(db, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/notifications") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderNotificationsHtml(db, config, limit));
          return;
        }

        // --- Intent API routes ---

        if (req.method === "GET" && pathname === "/api/v1/intents") {
          const kindRaw = url.searchParams.get("kind");
          const statusRaw = url.searchParams.get("status");
          const groupId = url.searchParams.get("group") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const kind = (kindRaw && ["work", "opportunity", "procurement", "collaboration", "custom"].includes(kindRaw))
            ? kindRaw as IntentKind
            : undefined;
          const status = (statusRaw && ["open", "matching", "matched", "in_progress", "review", "completed", "cancelled", "expired"].includes(statusRaw))
            ? statusRaw as IntentStatus
            : undefined;
          jsonResponse(res, 200, { intents: listIntents(db, { kind, status, groupId, limit }) });
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/intents\/[^/]+$/.test(pathname)) {
          const intentId = decodeURIComponent(pathname.split("/")[4]);
          const intent = getIntent(db, intentId);
          if (!intent) {
            jsonResponse(res, 404, { error: "intent not found" });
            return;
          }
          const responses = listIntentResponses(db, intentId);
          jsonResponse(res, 200, { intent, responses });
          return;
        }

        // --- Intent HTML routes ---

        if (req.method === "GET" && pathname === "/intents") {
          const kindRaw = url.searchParams.get("kind");
          const statusRaw = url.searchParams.get("status");
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const kind = (kindRaw && ["work", "opportunity", "procurement", "collaboration", "custom"].includes(kindRaw))
            ? kindRaw as IntentKind
            : undefined;
          const status = (statusRaw && ["open", "matching", "matched", "in_progress", "review", "completed", "cancelled", "expired"].includes(statusRaw))
            ? statusRaw as IntentStatus
            : undefined;
          const intents = listIntents(db, { kind, status, limit });
          const items = intents
            .map(
              (item) =>
                `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.kind)}</span><span>${escapeHtml(item.status)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description || `Published by ${item.publisherAddress.slice(0, 10)}...`)}</p><p style="color:var(--text-muted);font-size:0.85rem;">Expires: ${escapeHtml(item.expiresAt)}</p></div>`,
            )
            .join("");
          const content = `<h2 class="mw-title">Intent Board</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${intents.length} intent(s) found.</p>
<div class="mw-grid">${items || '<p class="mw-empty">No intents yet.</p>'}</div>`;
          htmlResponse(res, 200, wrapInLayout("Intent Board", content, "/intents"));
          return;
        }

        if (req.method === "GET" && /^\/group\/[^/]+\/intents$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[2]);
          const kindRaw = url.searchParams.get("kind");
          const statusRaw = url.searchParams.get("status");
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          const kind = (kindRaw && ["work", "opportunity", "procurement", "collaboration", "custom"].includes(kindRaw))
            ? kindRaw as IntentKind
            : undefined;
          const status = (statusRaw && ["open", "matching", "matched", "in_progress", "review", "completed", "cancelled", "expired"].includes(statusRaw))
            ? statusRaw as IntentStatus
            : undefined;
          const intents = listIntents(db, { groupId, kind, status, limit });
          const groupName = getGroupDisplayName(db, groupId);
          const items = intents
            .map(
              (item) =>
                `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.kind)}</span><span>${escapeHtml(item.status)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description || `Published by ${item.publisherAddress.slice(0, 10)}...`)}</p><p style="color:var(--text-muted);font-size:0.85rem;">Expires: ${escapeHtml(item.expiresAt)}</p></div>`,
            )
            .join("");
          const content = `<h2 class="mw-title">${escapeHtml(groupName)} — Intents</h2>
<p style="margin-bottom:12px;"><a href="/group/${encodeURIComponent(groupId)}">Back to group</a></p>
<p style="color:var(--text-muted);margin-bottom:16px;">${intents.length} intent(s) found.</p>
<div class="mw-grid">${items || '<p class="mw-empty">No intents for this group.</p>'}</div>`;
          htmlResponse(res, 200, wrapInLayout(`${groupName} Intents`, content, `/group/${encodeURIComponent(groupId)}/intents`));
          return;
        }

        // --- Federation API routes ---

        if (req.method === "GET" && pathname === "/api/v1/federation/peers") {
          const peers = listFederationPeers(db);
          jsonResponse(res, 200, { peers });
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/federation/events") {
          const eventType = url.searchParams.get("type") as FederationEventType | null;
          const limit = parseIntParam(url.searchParams.get("limit"), 50);
          const events = listFederationEvents(db, eventType || undefined, limit);
          jsonResponse(res, 200, { events, nextCursor: events.length > 0 ? events[events.length - 1].eventId : "" });
          return;
        }

        if (req.method === "GET" && pathname === "/federation") {
          const snapshot = buildFederationSnapshot(db);
          const peerRows = snapshot.peers
            .map(
              (p) =>
                `<tr><td>${escapeHtml(p.peerUrl)}</td><td>${escapeHtml(p.status)}</td><td>${escapeHtml(p.lastSyncAt || "never")}</td><td>${p.failureCount}</td></tr>`,
            )
            .join("");
          const eventRows = snapshot.recentEvents
            .map(
              (e) =>
                `<tr><td>${escapeHtml(e.eventType)}</td><td>${escapeHtml(e.peerId.slice(0, 10))}...</td><td>${escapeHtml(e.receivedAt)}</td></tr>`,
            )
            .join("");
          const content = `<h2 class="mw-title">World Federation</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<h3>Peers</h3>
<table class="mw-table"><thead><tr><th>URL</th><th>Status</th><th>Last Sync</th><th>Failures</th></tr></thead><tbody>${peerRows || '<tr><td colspan="4">No peers</td></tr>'}</tbody></table>
<h3>Recent Events</h3>
<table class="mw-table"><thead><tr><th>Type</th><th>Peer</th><th>Received</th></tr></thead><tbody>${eventRows || '<tr><td colspan="3">No events</td></tr>'}</tbody></table>`;
          htmlResponse(res, 200, wrapInLayout("Federation", content, "/federation"));
          return;
        }

        // --- 404 ---
        jsonResponse(res, 404, { error: "not found" });
      } catch (error) {
        logger.error(
          "metaWorld server request failed",
          error instanceof Error ? error : undefined,
        );
        jsonResponse(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const boundAddress = server.address();
  const actualPort =
    boundAddress && typeof boundAddress !== "string"
      ? boundAddress.port
      : port;
  const normalizedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const baseUrl = `http://${normalizedHost}:${actualPort}`;
  logger.info(`metaWorld server listening at ${baseUrl}`);

  return {
    url: baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
