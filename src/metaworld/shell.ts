import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { buildWorldBoardSnapshot } from "./boards.js";
import {
  buildWorldFoxDirectorySnapshot,
  buildWorldGroupDirectorySnapshot,
} from "./directory.js";
import { buildWorldFeedSnapshot } from "./feed.js";
import { buildGroupPageSnapshot, type GroupPageSnapshot } from "./group-page.js";
import { buildWorldNotificationsSnapshot } from "./notifications.js";
import { buildWorldPresenceSnapshot } from "./presence.js";
import { buildFoxProfile, type FoxProfile } from "./profile.js";

export interface MetaWorldShellSnapshot {
  generatedAt: string;
  fox: FoxProfile;
  notifications: ReturnType<typeof buildWorldNotificationsSnapshot>;
  feed: ReturnType<typeof buildWorldFeedSnapshot>;
  presence: ReturnType<typeof buildWorldPresenceSnapshot>;
  boards: {
    work: ReturnType<typeof buildWorldBoardSnapshot>;
    opportunity: ReturnType<typeof buildWorldBoardSnapshot>;
    artifact: ReturnType<typeof buildWorldBoardSnapshot>;
    settlement: ReturnType<typeof buildWorldBoardSnapshot>;
  };
  directories: {
    foxes: ReturnType<typeof buildWorldFoxDirectorySnapshot>;
    groups: ReturnType<typeof buildWorldGroupDirectorySnapshot>;
  };
  activeGroups: GroupPageSnapshot[];
}

export interface MetaWorldShellHtmlOptions {
  foxDirectoryHref?: string;
  groupDirectoryHref?: string;
  publicationHref?: string;
  searchHref?: string;
  foxHrefsByAddress?: Record<string, string>;
  groupHrefsById?: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBoardSection(
  title: string,
  snapshot: ReturnType<typeof buildWorldBoardSnapshot>,
): string {
  const items = snapshot.items
    .slice(0, 8)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.status)}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.summary)}</p>
</article>`,
    )
    .join("");
  return `<section class="panel">
  <div class="section-head">
    <h3>${escapeHtml(title)}</h3>
    <span>${snapshot.items.length} item(s)</span>
  </div>
  <div class="list-grid">${items || '<p class="empty">No items yet.</p>'}</div>
</section>`;
}

function renderGroupSection(
  page: GroupPageSnapshot,
  options?: MetaWorldShellHtmlOptions,
): string {
  const roleSummary = Object.entries(page.roleSummary)
    .map(([role, count]) => `${escapeHtml(role)}=${count}`)
    .join(", ");
  const announcements = page.announcements
    .slice(0, 3)
    .map(
      (item) => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.createdAt)}</span></li>`,
    )
    .join("");
  const messages = page.recentMessages
    .slice(0, 4)
    .map(
      (item) => `<li><strong>${escapeHtml(item.senderAgentId || item.senderAddress)}</strong><span>${escapeHtml(item.previewText || item.ciphertext || "")}</span></li>`,
    )
    .join("");
  const groupHref = options?.groupHrefsById?.[page.group.groupId];
  const title = groupHref
    ? `<a href="${escapeHtml(groupHref)}">${escapeHtml(page.group.name)}</a>`
    : escapeHtml(page.group.name);
  return `<section class="panel group-panel">
  <div class="section-head">
    <h3>${title}</h3>
    <span>${escapeHtml(page.group.visibility)} · ${escapeHtml(page.group.joinMode)}</span>
  </div>
  <p class="lede">${escapeHtml(page.group.description || "No description set yet.")}</p>
  <div class="stats-row">
    <span>${page.stats.activeMemberCount} active members</span>
    <span>${page.stats.channelCount} channels</span>
    <span>${page.stats.presenceCount} present</span>
  </div>
  <p class="muted">${roleSummary || "No active roles"}</p>
  <div class="split">
    <div>
      <h4>Announcements</h4>
      <ul class="compact-list">${announcements || "<li class=\"empty\">No announcements.</li>"}</ul>
    </div>
    <div>
      <h4>Messages</h4>
      <ul class="compact-list">${messages || "<li class=\"empty\">No recent messages.</li>"}</ul>
    </div>
  </div>
</section>`;
}

export function buildMetaWorldShellSnapshot(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  feedLimit?: number;
  notificationLimit?: number;
  boardLimit?: number;
  directoryLimit?: number;
  groupPageLimit?: number;
}): MetaWorldShellSnapshot {
  const fox = buildFoxProfile({
    db: params.db,
    config: params.config,
    activityLimit: Math.max(1, params.feedLimit ?? 12),
    notificationLimit: Math.max(1, params.notificationLimit ?? 12),
  });
  const notifications = buildWorldNotificationsSnapshot(params.db, {
    actorAddress: params.config.walletAddress,
    limit: Math.max(1, params.notificationLimit ?? 12),
  });
  const feed = buildWorldFeedSnapshot(params.db, {
    limit: Math.max(1, params.feedLimit ?? 16),
  });
  const presence = buildWorldPresenceSnapshot(params.db, {
    limit: Math.max(1, params.directoryLimit ?? 12),
  });
  const boards = {
    work: buildWorldBoardSnapshot(params.db, {
      boardKind: "work",
      limit: Math.max(1, params.boardLimit ?? 8),
    }),
    opportunity: buildWorldBoardSnapshot(params.db, {
      boardKind: "opportunity",
      limit: Math.max(1, params.boardLimit ?? 8),
    }),
    artifact: buildWorldBoardSnapshot(params.db, {
      boardKind: "artifact",
      limit: Math.max(1, params.boardLimit ?? 8),
    }),
    settlement: buildWorldBoardSnapshot(params.db, {
      boardKind: "settlement",
      limit: Math.max(1, params.boardLimit ?? 8),
    }),
  };
  const directories = {
    foxes: buildWorldFoxDirectorySnapshot(params.db, params.config, {
      limit: Math.max(1, params.directoryLimit ?? 12),
    }),
    groups: buildWorldGroupDirectorySnapshot(params.db, {
      limit: Math.max(1, params.directoryLimit ?? 12),
    }),
  };

  const activeGroups = fox.groups
    .filter((group) => group.membershipState === "active")
    .slice(0, Math.max(1, params.groupPageLimit ?? 3))
    .map((group) =>
      buildGroupPageSnapshot(params.db, {
        groupId: group.groupId,
        messageLimit: 6,
        announcementLimit: 4,
        eventLimit: 8,
        presenceLimit: 8,
        activityLimit: 8,
      }),
    );

  return {
    generatedAt: new Date().toISOString(),
    fox,
    notifications,
    feed,
    presence,
    boards,
    directories,
    activeGroups,
  };
}

export function buildMetaWorldShellHtml(
  snapshot: MetaWorldShellSnapshot,
  options?: MetaWorldShellHtmlOptions,
): string {
  const notificationItems = snapshot.notifications.items
    .slice(0, 8)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.occurredAt)}</span><span>${item.readAt ? "read" : "unread"}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.summary)}</p>
</article>`,
    )
    .join("");
  const feedItems = snapshot.feed.items
    .slice(0, 10)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.summary)}</p>
</article>`,
    )
    .join("");
  const foxDirectory = snapshot.directories.foxes.items
    .slice(0, 10)
    .map(
      (item) => {
        const href = options?.foxHrefsByAddress?.[item.address];
        const label = href
          ? `<a href="${escapeHtml(href)}">${escapeHtml(item.displayName)}</a>`
          : escapeHtml(item.displayName);
        return `<li><strong>${label}</strong><span>${escapeHtml(item.presenceStatus || "offline")} · groups=${item.activeGroupCount}</span></li>`;
      },
    )
    .join("");
  const groupDirectory = snapshot.directories.groups.items
    .slice(0, 10)
    .map(
      (item) => {
        const href = options?.groupHrefsById?.[item.groupId];
        const label = href
          ? `<a href="${escapeHtml(href)}">${escapeHtml(item.name)}</a>`
          : escapeHtml(item.name);
        return `<li><strong>${label}</strong><span>${item.activeMemberCount} members · ${escapeHtml(item.visibility)}</span></li>`;
      },
    )
    .join("");
  const presenceItems = snapshot.presence.items
    .slice(0, 8)
    .map(
      (item) => `<li><strong>${escapeHtml(item.displayName || item.agentId || item.actorAddress)}</strong><span>${escapeHtml(item.effectiveStatus)}${item.groupName ? ` · ${escapeHtml(item.groupName)}` : ""}</span></li>`,
    )
    .join("");
  const groupPanels = snapshot.activeGroups
    .map((page) => renderGroupSection(page, options))
    .join("");
  const foxDirectoryTitle = options?.foxDirectoryHref
    ? `<a href="${escapeHtml(options.foxDirectoryHref)}">Fox Directory</a>`
    : "Fox Directory";
  const groupDirectoryTitle = options?.groupDirectoryHref
    ? `<a href="${escapeHtml(options.groupDirectoryHref)}">Group Directory</a>`
    : "Group Directory";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenFox metaWorld</title>
  <style>
    :root {
      --bg: #f3ede2;
      --paper: #fff9f1;
      --ink: #1d241f;
      --muted: #5f695f;
      --line: #d9ccb5;
      --accent: #0e6b54;
      --accent-2: #c96d2d;
      --shadow: 0 16px 40px rgba(37, 31, 20, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(201,109,45,0.14), transparent 28%),
        radial-gradient(circle at top right, rgba(14,107,84,0.16), transparent 30%),
        linear-gradient(180deg, #f8f3ea 0%, var(--bg) 100%);
    }
    .shell {
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px 24px 72px;
    }
    .topnav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 18px;
    }
    .topnav a {
      text-decoration: none;
      color: var(--accent);
      background: rgba(255,255,255,0.66);
      border: 1px solid rgba(14,107,84,0.16);
      border-radius: 999px;
      padding: 9px 14px;
      font-size: 14px;
    }
    .hero {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 20px;
      margin-bottom: 22px;
    }
    .panel {
      background: rgba(255, 249, 241, 0.92);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 20px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    .hero-card {
      min-height: 240px;
      background:
        linear-gradient(140deg, rgba(14,107,84,0.08), transparent 45%),
        linear-gradient(320deg, rgba(201,109,45,0.10), transparent 50%),
        var(--paper);
    }
    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 10px;
    }
    h1, h2, h3, h4 { margin: 0; font-family: "IBM Plex Serif", Georgia, serif; }
    h1 { font-size: 42px; line-height: 1.02; margin-bottom: 12px; }
    h2 { font-size: 24px; }
    h3 { font-size: 20px; }
    h4 { font-size: 16px; margin-bottom: 8px; }
    .lede {
      color: var(--muted);
      line-height: 1.5;
      margin: 12px 0 18px;
    }
    .metric-band {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      padding: 12px 14px;
      background: rgba(255,255,255,0.66);
      border: 1px solid rgba(29,36,31,0.08);
      border-radius: 16px;
    }
    .metric strong {
      display: block;
      font-size: 22px;
      margin-bottom: 4px;
    }
    .section-head, .meta-row, .stats-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
    }
    .meta-row, .stats-row, .muted {
      font-size: 13px;
      color: var(--muted);
    }
    .main-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .stack {
      display: grid;
      gap: 20px;
    }
    .list-grid {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }
    .list-card {
      padding: 14px 15px;
      border-radius: 16px;
      background: rgba(255,255,255,0.64);
      border: 1px solid rgba(29,36,31,0.08);
    }
    .list-card p {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .duo {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .quad {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .directory-list, .compact-list {
      list-style: none;
      margin: 14px 0 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }
    .directory-list li, .compact-list li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.62);
      border: 1px solid rgba(29,36,31,0.08);
    }
    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-top: 16px;
    }
    .empty { color: var(--muted); margin: 10px 0 0; }
    .group-panel { margin-bottom: 18px; }
    .accent { color: var(--accent); }
    .accent-2 { color: var(--accent-2); }
    a { color: var(--accent); }
    @media (max-width: 980px) {
      .hero, .main-grid, .duo, .quad, .split { grid-template-columns: 1fr; }
      h1 { font-size: 34px; }
      .metric-band { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <nav class="topnav">
      <a href="./index.html">World Shell</a>
      ${
        options?.foxDirectoryHref
          ? `<a href="${escapeHtml(options.foxDirectoryHref)}">Fox Directory</a>`
          : ""
      }
      ${
        options?.groupDirectoryHref
          ? `<a href="${escapeHtml(options.groupDirectoryHref)}">Group Directory</a>`
          : ""
      }
      ${
        options?.searchHref
          ? `<a href="${escapeHtml(options.searchHref)}">Search</a>`
          : ""
      }
      ${
        options?.publicationHref
          ? `<a href="${escapeHtml(options.publicationHref)}">Publication</a>`
          : ""
      }
    </nav>
    <section class="hero">
      <article class="panel hero-card">
        <div class="eyebrow">OpenFox metaWorld v1</div>
        <h1>${escapeHtml(snapshot.fox.displayName)}</h1>
        <p class="lede">A local-first Fox world shell that merges identity, communities, notifications, work, artifacts, settlements, and live presence into one navigable surface.</p>
        <div class="metric-band">
          <div class="metric"><strong>${snapshot.notifications.unreadCount}</strong><span>Unread notifications</span></div>
          <div class="metric"><strong>${snapshot.fox.stats.activeGroupCount}</strong><span>Active groups</span></div>
          <div class="metric"><strong>${snapshot.presence.activeCount}</strong><span>Actors present</span></div>
          <div class="metric"><strong>${snapshot.feed.items.length}</strong><span>Recent feed items</span></div>
        </div>
      </article>
      <article class="panel">
        <div class="section-head">
          <h3>Fox Profile</h3>
          <span>${escapeHtml(snapshot.generatedAt)}</span>
        </div>
        <p class="lede">${escapeHtml(snapshot.fox.address)}</p>
        <div class="list-grid">
          <article class="list-card">
            <div class="meta-row"><span>Agent ID</span><span>${escapeHtml(snapshot.fox.agentId || "not set")}</span></div>
            <div class="meta-row"><span>Discovery</span><span>${snapshot.fox.discovery.published ? `<span class="accent">published</span>` : "not published"}</span></div>
            <div class="meta-row"><span>Capabilities</span><span>${snapshot.fox.discovery.capabilityNames.length}</span></div>
          </article>
          <article class="list-card">
            <div class="meta-row"><span>Groups</span><span>${snapshot.fox.stats.groupCount}</span></div>
            <div class="meta-row"><span>Recent activity</span><span>${snapshot.fox.stats.recentActivityCount}</span></div>
            <div class="meta-row"><span>TNS</span><span>${escapeHtml(snapshot.fox.tnsName || "not set")}</span></div>
          </article>
        </div>
      </article>
    </section>

    <section class="main-grid">
      <div class="stack">
        <section class="panel">
          <div class="section-head">
            <h3>World Feed</h3>
            <span>${snapshot.feed.items.length} recent items</span>
          </div>
          <div class="list-grid">${feedItems || '<p class="empty">No world activity yet.</p>'}</div>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>My Groups</h3>
            <span>${snapshot.activeGroups.length} loaded</span>
          </div>
          ${groupPanels || '<p class="empty">No active groups yet.</p>'}
        </section>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="section-head">
            <h3>Notifications</h3>
            <span>${snapshot.notifications.unreadCount} unread</span>
          </div>
          <div class="list-grid">${notificationItems || '<p class="empty">Nothing needs attention.</p>'}</div>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Presence</h3>
            <span>${snapshot.presence.activeCount} active</span>
          </div>
          <ul class="directory-list">${presenceItems || '<li class="empty">No live presence.</li>'}</ul>
        </section>
      </div>
    </section>

    <section class="quad">
      ${renderBoardSection("Work Board", snapshot.boards.work)}
      ${renderBoardSection("Opportunity Board", snapshot.boards.opportunity)}
      ${renderBoardSection("Artifact Board", snapshot.boards.artifact)}
      ${renderBoardSection("Settlement Board", snapshot.boards.settlement)}
    </section>

    <section class="duo">
      <section class="panel">
        <div class="section-head">
          <h3>${foxDirectoryTitle}</h3>
          <span>${snapshot.directories.foxes.items.length} visible</span>
        </div>
        <ul class="directory-list">${foxDirectory || '<li class="empty">No Fox profiles yet.</li>'}</ul>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>${groupDirectoryTitle}</h3>
          <span>${snapshot.directories.groups.items.length} visible</span>
        </div>
        <ul class="directory-list">${groupDirectory || '<li class="empty">No groups yet.</li>'}</ul>
      </section>
    </section>
  </div>
</body>
</html>`;
}
