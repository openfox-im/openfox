import type {
  ArtifactRecord,
  BountyRecord,
  OpenFoxDatabase,
  SettlementRecord,
} from "../types.js";
import {
  listGroupAnnouncements,
  listGroupEvents,
  listGroupMessages,
  type GroupAnnouncementRecord,
  type GroupEventRecord,
  type GroupMessageRecord,
} from "../group/store.js";

export type WorldFeedItemKind =
  | "group_announcement"
  | "group_notice"
  | "group_message"
  | "bounty_opened"
  | "artifact_published"
  | "settlement_completed";

export interface WorldFeedItem {
  itemId: string;
  kind: WorldFeedItemKind;
  occurredAt: string;
  actorAddress?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  channelId?: string | null;
  title: string;
  summary: string;
  refs: Record<string, string>;
  visibility: "local" | "group" | "world";
}

export interface WorldFeedSnapshot {
  generatedAt: string;
  items: WorldFeedItem[];
  summary: string;
}

function trimSummary(value: string, limit = 220): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}...`;
}

function parseNoticeSummary(event: GroupEventRecord): {
  title: string;
  summary: string;
} {
  const noticeType = String(event.payload.notice_type || "group_notice");
  const memberAddress = String(event.payload.member_address || "").trim();
  const reason = String(event.payload.reason || "").trim();
  const muteUntil = String(event.payload.mute_until || "").trim();

  switch (noticeType) {
    case "member_joined":
      return {
        title: "Member joined",
        summary: memberAddress ? `${memberAddress} joined the group.` : "A member joined the group.",
      };
    case "member_left":
      return {
        title: "Member left",
        summary: memberAddress ? `${memberAddress} left the group.` : "A member left the group.",
      };
    case "member_removed":
      return {
        title: "Member removed",
        summary: trimSummary(
          memberAddress
            ? `${memberAddress} was removed from the group${reason ? `: ${reason}` : "."}`
            : `A member was removed${reason ? `: ${reason}` : "."}`,
        ),
      };
    case "member_muted":
      return {
        title: "Member muted",
        summary: trimSummary(
          memberAddress
            ? `${memberAddress} was muted${muteUntil ? ` until ${muteUntil}` : ""}${reason ? `: ${reason}` : "."}`
            : `A member was muted${reason ? `: ${reason}` : "."}`,
        ),
      };
    case "member_unmuted":
      return {
        title: "Member unmuted",
        summary: memberAddress
          ? `${memberAddress} was unmuted.`
          : "A member was unmuted.",
      };
    case "member_banned":
      return {
        title: "Member banned",
        summary: trimSummary(
          memberAddress
            ? `${memberAddress} was banned${reason ? `: ${reason}` : "."}`
            : `A member was banned${reason ? `: ${reason}` : "."}`,
        ),
      };
    case "member_unbanned":
      return {
        title: "Member unbanned",
        summary: memberAddress
          ? `${memberAddress} was unbanned.`
          : "A member was unbanned.",
      };
    default:
      return {
        title: "Group notice",
        summary: trimSummary(stableNoticeFallback(event.payload)),
      };
  }
}

function stableNoticeFallback(payload: Record<string, unknown>): string {
  const pairs = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length ? pairs.join(", ") : "Group notice";
}

function mapAnnouncementItem(
  announcement: GroupAnnouncementRecord,
  groupName: string | null,
): WorldFeedItem {
  return {
    itemId: `feed:announcement:${announcement.announcementId}`,
    kind: "group_announcement",
    occurredAt: announcement.createdAt,
    actorAddress: announcement.postedByAddress,
    groupId: announcement.groupId,
    groupName,
    channelId: announcement.channelId,
    title: announcement.title,
    summary: trimSummary(announcement.bodyText),
    refs: {
      announcementId: announcement.announcementId,
      eventId: announcement.eventId,
    },
    visibility: "group",
  };
}

function mapNoticeItem(event: GroupEventRecord, groupName: string | null): WorldFeedItem {
  const parsed = parseNoticeSummary(event);
  return {
    itemId: `feed:notice:${event.eventId}`,
    kind: "group_notice",
    occurredAt: event.createdAt,
    actorAddress: event.actorAddress,
    groupId: event.groupId,
    groupName,
    channelId: event.channelId,
    title: parsed.title,
    summary: parsed.summary,
    refs: {
      eventId: event.eventId,
    },
    visibility: "group",
  };
}

function mapMessageItem(message: GroupMessageRecord, groupName: string | null): WorldFeedItem {
  return {
    itemId: `feed:message:${message.messageId}`,
    kind: "group_message",
    occurredAt: message.createdAt,
    actorAddress: message.senderAddress,
    groupId: message.groupId,
    groupName,
    channelId: message.channelId,
    title: message.replyToMessageId ? "Group reply" : "Group message",
    summary: trimSummary(message.previewText || message.ciphertext || "[encrypted]"),
    refs: {
      messageId: message.messageId,
      eventId: message.latestEventId,
    },
    visibility: "group",
  };
}

function mapBountyItem(bounty: BountyRecord): WorldFeedItem {
  return {
    itemId: `feed:bounty:${bounty.bountyId}`,
    kind: "bounty_opened",
    occurredAt: bounty.createdAt,
    actorAddress: bounty.hostAddress,
    title: bounty.title,
    summary: trimSummary(
      `${bounty.kind} bounty opened with reward ${bounty.rewardWei} wei.`,
    ),
    refs: {
      bountyId: bounty.bountyId,
      kind: bounty.kind,
    },
    visibility: "world",
  };
}

function mapArtifactItem(artifact: ArtifactRecord): WorldFeedItem {
  return {
    itemId: `feed:artifact:${artifact.artifactId}`,
    kind: "artifact_published",
    occurredAt: artifact.createdAt,
    actorAddress: artifact.requesterAddress,
    title: artifact.title,
    summary: trimSummary(
      artifact.summaryText ||
        `${artifact.kind} artifact ${artifact.status} with cid ${artifact.cid}.`,
    ),
    refs: {
      artifactId: artifact.artifactId,
      cid: artifact.cid,
      status: artifact.status,
    },
    visibility: "world",
  };
}

function mapSettlementItem(settlement: SettlementRecord): WorldFeedItem {
  return {
    itemId: `feed:settlement:${settlement.receiptId}`,
    kind: "settlement_completed",
    occurredAt: settlement.createdAt,
    title: `Settlement completed: ${settlement.kind}`,
    summary: trimSummary(
      `${settlement.kind} settlement recorded for ${settlement.subjectId}.`,
    ),
    refs: {
      receiptId: settlement.receiptId,
      subjectId: settlement.subjectId,
      kind: settlement.kind,
    },
    visibility: "world",
  };
}

function sortItems(items: WorldFeedItem[], limit: number): WorldFeedItem[] {
  return items
    .sort((a, b) => {
      const byTime = b.occurredAt.localeCompare(a.occurredAt);
      if (byTime !== 0) return byTime;
      return a.itemId.localeCompare(b.itemId);
    })
    .slice(0, Math.max(1, limit));
}

export function listWorldFeedItems(
  db: OpenFoxDatabase,
  options?: {
    groupId?: string;
    limit?: number;
  },
): WorldFeedItem[] {
  const limit = Math.max(1, options?.limit ?? 50);
  const groups = options?.groupId
    ? db.raw
        .prepare("SELECT group_id, name FROM groups WHERE group_id = ?")
        .all(options.groupId)
    : db.raw
        .prepare("SELECT group_id, name FROM groups")
        .all();
  const groupNameById = new Map<string, string>();
  for (const row of groups as Array<{ group_id: string; name: string }>) {
    groupNameById.set(row.group_id, row.name);
  }
  const groupIds = options?.groupId ? [options.groupId] : [...groupNameById.keys()];

  const items: WorldFeedItem[] = [];
  for (const groupId of groupIds) {
    const groupName = groupNameById.get(groupId) ?? null;
    for (const announcement of listGroupAnnouncements(db, groupId, limit)) {
      items.push(mapAnnouncementItem(announcement, groupName));
    }
    for (const event of listGroupEvents(db, groupId, limit)) {
      if (event.kind === "system.notice.posted") {
        items.push(mapNoticeItem(event, groupName));
      }
    }
    for (const message of listGroupMessages(db, groupId, { limit })) {
      items.push(mapMessageItem(message, groupName));
    }
  }

  if (!options?.groupId) {
    for (const bounty of db.listBounties().slice(0, limit)) {
      items.push(mapBountyItem(bounty));
    }
    for (const artifact of db.listArtifacts(limit)) {
      items.push(mapArtifactItem(artifact));
    }
    for (const settlement of db.listSettlementReceipts(limit)) {
      items.push(mapSettlementItem(settlement));
    }
  }

  return sortItems(items, limit);
}

export function buildWorldFeedSnapshot(
  db: OpenFoxDatabase,
  options?: {
    groupId?: string;
    limit?: number;
  },
): WorldFeedSnapshot {
  const items = listWorldFeedItems(db, options);
  const generatedAt = new Date().toISOString();
  const groupScope = options?.groupId ? ` for ${options.groupId}` : "";
  return {
    generatedAt,
    items,
    summary: items.length
      ? `World feed${groupScope} contains ${items.length} recent activity items.`
      : `World feed${groupScope} is currently empty.`,
  };
}
