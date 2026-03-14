import type {
  GroupAnnouncementRecord,
  GroupChannelRecord,
  GroupEventRecord,
  GroupMemberRecord,
  GroupMessageRecord,
  GroupRecord,
} from "../group/store.js";
import {
  getGroup,
  listGroupAnnouncements,
  listGroupChannels,
  listGroupEvents,
  listGroupMembers,
  listGroupMessages,
} from "../group/store.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  buildWorldFeedSnapshot,
  type WorldFeedSnapshot,
} from "./feed.js";
import {
  listWorldPresence,
  type WorldPresenceRecord,
} from "./presence.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";

export interface GroupPageSnapshot {
  generatedAt: string;
  group: GroupRecord;
  channels: GroupChannelRecord[];
  members: GroupMemberRecord[];
  announcements: GroupAnnouncementRecord[];
  recentMessages: GroupMessageRecord[];
  recentEvents: GroupEventRecord[];
  presence: WorldPresenceRecord[];
  activityFeed: WorldFeedSnapshot;
  roleSummary: Record<string, number>;
  stats: {
    channelCount: number;
    memberCount: number;
    activeMemberCount: number;
    announcementCount: number;
    presenceCount: number;
    messageCount: number;
  };
}

export function buildGroupPageSnapshot(
  db: OpenFoxDatabase,
  options: {
    groupId: string;
    messageLimit?: number;
    announcementLimit?: number;
    eventLimit?: number;
    presenceLimit?: number;
    activityLimit?: number;
  },
): GroupPageSnapshot {
  const group = getGroup(db, options.groupId);
  if (!group) {
    throw new Error(`group not found: ${options.groupId}`);
  }

  const channels = listGroupChannels(db, group.groupId);
  const members = listGroupMembers(db, group.groupId);
  const announcements = listGroupAnnouncements(
    db,
    group.groupId,
    Math.max(1, options.announcementLimit ?? 10),
  );
  const recentMessages = listGroupMessages(db, group.groupId, {
    limit: Math.max(1, options.messageLimit ?? 20),
  });
  const recentEvents = listGroupEvents(
    db,
    group.groupId,
    Math.max(1, options.eventLimit ?? 20),
  );
  const presence = listWorldPresence(db, {
    groupId: group.groupId,
    limit: Math.max(1, options.presenceLimit ?? 20),
  });
  const activityFeed = buildWorldFeedSnapshot(db, {
    groupId: group.groupId,
    limit: Math.max(1, options.activityLimit ?? 20),
  });

  const roleSummary: Record<string, number> = {};
  for (const member of members) {
    if (member.membershipState !== "active") continue;
    for (const role of member.roles) {
      roleSummary[role] = (roleSummary[role] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    group,
    channels,
    members,
    announcements,
    recentMessages,
    recentEvents,
    presence,
    activityFeed,
    roleSummary,
    stats: {
      channelCount: channels.length,
      memberCount: members.length,
      activeMemberCount: members.filter((entry) => entry.membershipState === "active").length,
      announcementCount: announcements.length,
      presenceCount: presence.length,
      messageCount: recentMessages.length,
    },
  };
}

export function buildGroupPageHtml(
  snapshot: GroupPageSnapshot,
  options?: {
    homeHref?: string;
    foxDirectoryHref?: string;
    groupDirectoryHref?: string;
    searchHref?: string;
    foxHrefsByAddress?: Record<string, string>;
  },
): string {
  const tagItems = snapshot.group.tags
    .slice(0, 20)
    .map((tag) => `<li>${escapeHtml(tag)}</li>`)
    .join("");
  const channelItems = snapshot.channels
    .slice(0, 12)
    .map(
      (channel) => `<li><strong>#${escapeHtml(channel.name)}</strong><span>${escapeHtml(channel.visibility)} · ${escapeHtml(channel.status)}</span></li>`,
    )
    .join("");
  const memberItems = snapshot.members
    .slice(0, 12)
    .map(
      (member) => {
        const href = options?.foxHrefsByAddress?.[member.memberAddress];
        const label = href
          ? `<a href="${escapeHtml(href)}">${escapeHtml(member.displayName || member.memberAgentId || member.memberAddress)}</a>`
          : escapeHtml(member.displayName || member.memberAgentId || member.memberAddress);
        return `<li><strong>${label}</strong><span>${escapeHtml(member.membershipState)} · ${escapeHtml(member.roles.join(", ") || "no roles")}</span></li>`;
      },
    )
    .join("");
  const announcementItems = snapshot.announcements
    .slice(0, 8)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.createdAt)}</span><span>${item.pinned ? '<span class="accent">pinned</span>' : "announcement"}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.bodyText)}</p>
</article>`,
    )
    .join("");
  const messageItems = snapshot.recentMessages
    .slice(0, 8)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.updatedAt)}</span><span>#${escapeHtml(snapshot.channels.find((channel) => channel.channelId === item.channelId)?.name || item.channelId)}</span></div>
  <h4>${
    options?.foxHrefsByAddress?.[item.senderAddress]
      ? `<a href="${escapeHtml(options.foxHrefsByAddress[item.senderAddress])}">${escapeHtml(item.senderAgentId || item.senderAddress)}</a>`
      : escapeHtml(item.senderAgentId || item.senderAddress)
  }</h4>
  <p>${escapeHtml(item.previewText || item.ciphertext || "")}</p>
</article>`,
    )
    .join("");
  const feedItems = snapshot.activityFeed.items
    .slice(0, 10)
    .map(
      (item) => `<article class="list-card">
  <div class="meta-row"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div>
  <h4>${escapeHtml(item.title)}</h4>
  <p>${escapeHtml(item.summary)}</p>
</article>`,
    )
    .join("");
  const presenceItems = snapshot.presence
    .slice(0, 10)
    .map(
      (item) => {
        const href = options?.foxHrefsByAddress?.[item.actorAddress];
        const label = href
          ? `<a href="${escapeHtml(href)}">${escapeHtml(item.displayName || item.agentId || item.actorAddress)}</a>`
          : escapeHtml(item.displayName || item.agentId || item.actorAddress);
        return `<li><strong>${label}</strong><span>${escapeHtml(item.effectiveStatus)}${item.summary ? ` · ${escapeHtml(item.summary)}` : ""}</span></li>`;
      },
    )
    .join("");
  const roleSummary = Object.entries(snapshot.roleSummary)
    .map(([role, count]) => `${escapeHtml(role)}=${count}`)
    .join(", ");

  const sections = [
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Overview</h3>
          <span>${escapeHtml(snapshot.group.groupId)}</span>
        </div>
        <p class="lede">${escapeHtml(snapshot.group.description || "No description set yet.")}</p>
        <div class="list-grid">
          <article class="list-card">
            <div class="meta-row"><span>Creator</span><span>${escapeHtml(snapshot.group.creatorAgentId || snapshot.group.creatorAddress)}</span></div>
            <div class="meta-row"><span>Visibility</span><span>${escapeHtml(snapshot.group.visibility)}</span></div>
            <div class="meta-row"><span>Join mode</span><span>${escapeHtml(snapshot.group.joinMode)}</span></div>
          </article>
          <article class="list-card">
            <div class="meta-row"><span>Status</span><span>${escapeHtml(snapshot.group.status)}</span></div>
            <div class="meta-row"><span>Epoch</span><span>${snapshot.group.currentEpoch}</span></div>
            <div class="meta-row"><span>Roles</span><span>${escapeHtml(roleSummary || "none")}</span></div>
          </article>
        </div>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Tags</h3>
          <span>${snapshot.group.tags.length}</span>
        </div>
        <ul class="tag-list">${tagItems || "<li>none</li>"}</ul>
      </section>
    </section>`,
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Channels</h3>
          <span>${snapshot.stats.channelCount}</span>
        </div>
        <ul class="directory-list">${channelItems || '<li class="empty">No channels.</li>'}</ul>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Members</h3>
          <span>${snapshot.stats.activeMemberCount}/${snapshot.stats.memberCount}</span>
        </div>
        <ul class="directory-list">${memberItems || '<li class="empty">No members.</li>'}</ul>
      </section>
    </section>`,
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Presence</h3>
          <span>${snapshot.stats.presenceCount} visible</span>
        </div>
        <ul class="directory-list">${presenceItems || '<li class="empty">No live presence.</li>'}</ul>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Recent Messages</h3>
          <span>${snapshot.stats.messageCount} item(s)</span>
        </div>
        <div class="list-grid">${messageItems || '<p class="empty">No recent messages.</p>'}</div>
      </section>
    </section>`,
    `<section class="grid">
      <section class="panel">
        <div class="section-head">
          <h3>Announcements</h3>
          <span>${snapshot.stats.announcementCount}</span>
        </div>
        <div class="list-grid">${announcementItems || '<p class="empty">No announcements.</p>'}</div>
      </section>
      <section class="panel">
        <div class="section-head">
          <h3>Activity Feed</h3>
          <span>${snapshot.activityFeed.items.length} item(s)</span>
        </div>
        <div class="list-grid">${feedItems || '<p class="empty">No activity yet.</p>'}</div>
      </section>
    </section>`,
  ];

  return renderMetaWorldPageFrame({
    title: `${snapshot.group.name} · OpenFox metaWorld`,
    eyebrow: "OpenFox Group Page",
    heading: snapshot.group.name,
    lede: `Community snapshot for ${snapshot.group.name}, including members, channels, announcements, presence, and recent group activity.`,
    generatedAt: snapshot.generatedAt,
    navLinks: [
      { label: "World Shell", href: options?.homeHref ?? "../index.html" },
      { label: "Fox Directory", href: options?.foxDirectoryHref ?? "../foxes/index.html" },
      { label: "Group Directory", href: options?.groupDirectoryHref ?? "./index.html" },
      { label: "Search", href: options?.searchHref ?? "../search/index.html" },
    ],
    metrics: [
      { label: "Active members", value: snapshot.stats.activeMemberCount },
      { label: "Channels", value: snapshot.stats.channelCount },
      { label: "Announcements", value: snapshot.stats.announcementCount },
      { label: "Presence", value: snapshot.stats.presenceCount },
    ],
    sections,
  });
}
