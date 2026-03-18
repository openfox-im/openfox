import type { OpenFoxDatabase } from "../types.js";
import { hasMatchingSubscriptionForActivity } from "./subscriptions.js";

export type WorldNotificationKind =
  | "group_invite_received"
  | "group_join_request_pending"
  | "group_join_request_approved"
  | "group_moderation_notice"
  | "group_message_mention"
  | "group_message_reply"
  | "group_announcement_posted";

export interface WorldNotificationRecord {
  notificationId: string;
  kind: WorldNotificationKind;
  occurredAt: string;
  actorAddress?: string | null;
  targetAddress?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  channelId?: string | null;
  title: string;
  summary: string;
  refs: Record<string, string>;
  readAt: string | null;
  dismissedAt: string | null;
}

export interface WorldNotificationSnapshot {
  generatedAt: string;
  unreadCount: number;
  items: WorldNotificationRecord[];
  summary: string;
}

interface WorldNotificationState {
  notificationId: string;
  readAt: string | null;
  dismissedAt: string | null;
  updatedAt: string;
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

function trimSummary(value: string, limit = 220): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}...`;
}

function loadNotificationStateMap(
  db: OpenFoxDatabase,
  notificationIds: string[],
): Map<string, WorldNotificationState> {
  if (!notificationIds.length) {
    return new Map();
  }
  const placeholders = notificationIds.map(() => "?").join(", ");
  const rows = db.raw
    .prepare(
      `SELECT notification_id, read_at, dismissed_at, updated_at
       FROM world_notification_state
       WHERE notification_id IN (${placeholders})`,
    )
    .all(...notificationIds) as Array<{
    notification_id: string;
    read_at: string | null;
    dismissed_at: string | null;
    updated_at: string;
  }>;
  return new Map(
    rows.map((row) => [
      row.notification_id,
      {
        notificationId: row.notification_id,
        readAt: row.read_at ?? null,
        dismissedAt: row.dismissed_at ?? null,
        updatedAt: row.updated_at,
      } satisfies WorldNotificationState,
    ]),
  );
}

function sortItems(
  items: WorldNotificationRecord[],
  limit: number,
): WorldNotificationRecord[] {
  return items
    .sort((a, b) => {
      const byTime = b.occurredAt.localeCompare(a.occurredAt);
      if (byTime !== 0) return byTime;
      return a.notificationId.localeCompare(b.notificationId);
    })
    .slice(0, Math.max(1, limit));
}

function shouldAlwaysIncludeNotification(
  item: WorldNotificationRecord,
): boolean {
  return (
    item.kind === "group_invite_received" ||
    item.kind === "group_join_request_pending" ||
    item.kind === "group_join_request_approved" ||
    item.kind === "group_moderation_notice"
  );
}

function matchesSubscriptionFilter(
  db: OpenFoxDatabase,
  actorAddress: string,
  item: WorldNotificationRecord,
): boolean {
  if (shouldAlwaysIncludeNotification(item)) {
    return true;
  }
  switch (item.kind) {
    case "group_announcement_posted":
      return hasMatchingSubscriptionForActivity(db, actorAddress, {
        eventKind: "announcement",
        actorAddress: item.actorAddress ?? null,
        groupId: item.groupId ?? null,
      });
    case "group_message_mention":
    case "group_message_reply":
      return hasMatchingSubscriptionForActivity(db, actorAddress, {
        eventKind: "message",
        actorAddress: item.actorAddress ?? null,
        groupId: item.groupId ?? null,
      });
    default:
      return true;
  }
}

function buildInviteNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         p.proposal_id,
         p.group_id,
         g.name AS group_name,
         p.target_roles_json,
         p.opened_by_address,
         p.reason,
         p.updated_at
       FROM group_proposals p
       JOIN groups g ON g.group_id = p.group_id
       WHERE p.proposal_kind = 'invite'
         AND p.target_address = ?
         AND p.status = 'open'
         AND (? IS NULL OR p.group_id = ?)
       ORDER BY p.updated_at DESC
       LIMIT ?`,
    )
    .all(
      params.actorAddress,
      params.groupId ?? null,
      params.groupId ?? null,
      params.limit,
    ) as Array<{
    proposal_id: string;
    group_id: string;
    group_name: string;
    target_roles_json: string;
    opened_by_address: string;
    reason: string | null;
    updated_at: string;
  }>;

  return rows.map((row) => {
    const roles = parseJsonSafe<string[]>(row.target_roles_json, []);
    const rolesLabel = roles.length ? ` as ${roles.join(", ")}` : "";
    const reason = normalizeOptionalText(row.reason);
    return {
      notificationId: `notif:invite:${row.proposal_id}`,
      kind: "group_invite_received",
      occurredAt: row.updated_at,
      actorAddress: row.opened_by_address,
      targetAddress: params.actorAddress,
      groupId: row.group_id,
      groupName: row.group_name,
      title: "Group invite received",
      summary: trimSummary(
        `You were invited to join ${row.group_name}${rolesLabel}.${reason ? ` Reason: ${reason}` : ""}`,
      ),
      refs: {
        proposalId: row.proposal_id,
      },
      readAt: null,
      dismissedAt: null,
    };
  });
}

function buildPendingJoinRequestNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         jr.request_id,
         jr.group_id,
         g.name AS group_name,
         jr.applicant_address,
         jr.applicant_agent_id,
         jr.applicant_tns_name,
         jr.requested_roles_json,
         jr.request_message,
         jr.updated_at
       FROM group_join_requests jr
       JOIN groups g ON g.group_id = jr.group_id
       WHERE jr.status = 'open'
         AND (? IS NULL OR jr.group_id = ?)
         AND EXISTS (
           SELECT 1
           FROM group_member_roles r
           JOIN group_members m
             ON m.group_id = r.group_id
            AND m.member_address = r.member_address
           WHERE r.group_id = jr.group_id
             AND r.member_address = ?
             AND r.active = 1
             AND r.role IN ('owner', 'admin')
             AND m.membership_state = 'active'
         )
       ORDER BY jr.updated_at DESC
       LIMIT ?`,
    )
    .all(
      params.groupId ?? null,
      params.groupId ?? null,
      params.actorAddress,
      params.limit,
    ) as Array<{
    request_id: string;
    group_id: string;
    group_name: string;
    applicant_address: string;
    applicant_agent_id: string | null;
    applicant_tns_name: string | null;
    requested_roles_json: string;
    request_message: string;
    updated_at: string;
  }>;

  return rows.map((row) => {
    const roles = parseJsonSafe<string[]>(row.requested_roles_json, []);
    const identity =
      normalizeOptionalText(row.applicant_tns_name) ||
      normalizeOptionalText(row.applicant_agent_id) ||
      row.applicant_address;
    const requestMessage = normalizeOptionalText(row.request_message);
    return {
      notificationId: `notif:join-request:pending:${row.request_id}:${params.actorAddress}`,
      kind: "group_join_request_pending",
      occurredAt: row.updated_at,
      actorAddress: row.applicant_address,
      targetAddress: params.actorAddress,
      groupId: row.group_id,
      groupName: row.group_name,
      title: "Join request pending approval",
      summary: trimSummary(
        `${identity} requested to join ${row.group_name}${roles.length ? ` as ${roles.join(", ")}` : ""}.${requestMessage ? ` Message: ${requestMessage}` : ""}`,
      ),
      refs: {
        requestId: row.request_id,
      },
      readAt: null,
      dismissedAt: null,
    };
  });
}

function buildApprovedJoinRequestNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         jr.request_id,
         jr.group_id,
         g.name AS group_name,
         jr.requested_roles_json,
         jr.updated_at,
         jr.committed_event_id
       FROM group_join_requests jr
       JOIN groups g ON g.group_id = jr.group_id
       WHERE jr.applicant_address = ?
         AND jr.status = 'committed'
         AND (? IS NULL OR jr.group_id = ?)
       ORDER BY jr.updated_at DESC
       LIMIT ?`,
    )
    .all(
      params.actorAddress,
      params.groupId ?? null,
      params.groupId ?? null,
      params.limit,
    ) as Array<{
    request_id: string;
    group_id: string;
    group_name: string;
    requested_roles_json: string;
    updated_at: string;
    committed_event_id: string | null;
  }>;

  return rows.map((row) => {
    const roles = parseJsonSafe<string[]>(row.requested_roles_json, []);
    return {
      notificationId: `notif:join-request:approved:${row.request_id}`,
      kind: "group_join_request_approved",
      occurredAt: row.updated_at,
      actorAddress: null,
      targetAddress: params.actorAddress,
      groupId: row.group_id,
      groupName: row.group_name,
      title: "Join request approved",
      summary: trimSummary(
        `Your join request for ${row.group_name} was approved${roles.length ? ` as ${roles.join(", ")}` : ""}.`,
      ),
      refs: {
        requestId: row.request_id,
        eventId: row.committed_event_id ?? "",
      },
      readAt: null,
      dismissedAt: null,
    };
  });
}

function parseModerationNotice(
  payloadJson: string,
  actorAddress: string,
): {
  title: string;
  summary: string;
} | null {
  const payload = parseJsonSafe<Record<string, unknown>>(payloadJson, {});
  const rawMemberAddress = normalizeOptionalText(payload.member_address);
  if (!rawMemberAddress) {
    return null;
  }
  let memberAddress: string;
  try {
    memberAddress = normalizeAddressLike(rawMemberAddress);
  } catch {
    return null;
  }
  if (memberAddress !== actorAddress) {
    return null;
  }
  const reason = normalizeOptionalText(payload.reason);
  const muteUntil = normalizeOptionalText(payload.mute_until);
  switch (payload.notice_type) {
    case "member_muted":
      return {
        title: "Muted in group",
        summary: trimSummary(
          `You were muted${muteUntil ? ` until ${muteUntil}` : ""}.${reason ? ` Reason: ${reason}` : ""}`,
        ),
      };
    case "member_unmuted":
      return {
        title: "Unmuted in group",
        summary: "Your group mute was lifted.",
      };
    case "member_banned":
      return {
        title: "Banned from group",
        summary: trimSummary(
          `You were banned from the group.${reason ? ` Reason: ${reason}` : ""}`,
        ),
      };
    case "member_unbanned":
      return {
        title: "Unbanned from group",
        summary: "Your group ban was lifted.",
      };
    case "member_removed":
      return {
        title: "Removed from group",
        summary: trimSummary(
          `You were removed from the group.${reason ? ` Reason: ${reason}` : ""}`,
        ),
      };
    default:
      return null;
  }
}

function buildModerationNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         e.event_id,
         e.group_id,
         g.name AS group_name,
         e.actor_address,
         e.payload_json,
         e.created_at
       FROM group_events e
       JOIN groups g ON g.group_id = e.group_id
       WHERE e.kind = 'system.notice.posted'
         AND (? IS NULL OR e.group_id = ?)
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
    .all(
      params.groupId ?? null,
      params.groupId ?? null,
      Math.max(params.limit * 3, 100),
    ) as Array<{
    event_id: string;
    group_id: string;
    group_name: string;
    actor_address: string;
    payload_json: string;
    created_at: string;
  }>;

  const items: WorldNotificationRecord[] = [];
  for (const row of rows) {
    const parsed = parseModerationNotice(row.payload_json, params.actorAddress);
    if (!parsed) continue;
    items.push({
      notificationId: `notif:moderation:${row.event_id}:${params.actorAddress}`,
      kind: "group_moderation_notice",
      occurredAt: row.created_at,
      actorAddress: row.actor_address,
      targetAddress: params.actorAddress,
      groupId: row.group_id,
      groupName: row.group_name,
      title: parsed.title,
      summary: parsed.summary,
      refs: {
        eventId: row.event_id,
      },
      readAt: null,
      dismissedAt: null,
    });
  }
  return items.slice(0, params.limit);
}

function buildAnnouncementNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         a.announcement_id,
         a.group_id,
         g.name AS group_name,
         a.channel_id,
         a.posted_by_address,
         a.title,
         a.body_text,
         a.created_at
       FROM group_announcements a
       JOIN groups g ON g.group_id = a.group_id
       JOIN group_members m ON m.group_id = a.group_id
       WHERE m.member_address = ?
         AND m.membership_state = 'active'
         AND a.posted_by_address <> ?
         AND a.redacted_at IS NULL
         AND (? IS NULL OR a.group_id = ?)
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(
      params.actorAddress,
      params.actorAddress,
      params.groupId ?? null,
      params.groupId ?? null,
      params.limit,
    ) as Array<{
    announcement_id: string;
    group_id: string;
    group_name: string;
    channel_id: string | null;
    posted_by_address: string;
    title: string;
    body_text: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    notificationId: `notif:announcement:${row.announcement_id}:${params.actorAddress}`,
    kind: "group_announcement_posted",
    occurredAt: row.created_at,
    actorAddress: row.posted_by_address,
    targetAddress: params.actorAddress,
    groupId: row.group_id,
    groupName: row.group_name,
    channelId: row.channel_id,
    title: row.title,
    summary: trimSummary(row.body_text),
    refs: {
      announcementId: row.announcement_id,
    },
    readAt: null,
    dismissedAt: null,
  }));
}

function buildReplyNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         child.message_id,
         child.group_id,
         g.name AS group_name,
         child.channel_id,
         child.sender_address,
         child.preview_text,
         child.latest_event_id,
         child.created_at
       FROM group_messages child
       JOIN group_messages parent
         ON parent.group_id = child.group_id
        AND parent.message_id = child.reply_to_message_id
       JOIN groups g ON g.group_id = child.group_id
       JOIN group_members m ON m.group_id = child.group_id
       WHERE m.member_address = ?
         AND m.membership_state = 'active'
         AND parent.sender_address = ?
         AND child.sender_address <> ?
         AND child.redacted = 0
         AND (? IS NULL OR child.group_id = ?)
       ORDER BY child.created_at DESC
       LIMIT ?`,
    )
    .all(
      params.actorAddress,
      params.actorAddress,
      params.actorAddress,
      params.groupId ?? null,
      params.groupId ?? null,
      params.limit,
    ) as Array<{
    message_id: string;
    group_id: string;
    group_name: string;
    channel_id: string;
    sender_address: string;
    preview_text: string | null;
    latest_event_id: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    notificationId: `notif:reply:${row.message_id}:${params.actorAddress}`,
    kind: "group_message_reply",
    occurredAt: row.created_at,
    actorAddress: row.sender_address,
    targetAddress: params.actorAddress,
    groupId: row.group_id,
    groupName: row.group_name,
    channelId: row.channel_id,
    title: "Reply in group",
    summary: trimSummary(row.preview_text || "Someone replied to your message."),
    refs: {
      messageId: row.message_id,
      eventId: row.latest_event_id,
    },
    readAt: null,
    dismissedAt: null,
  }));
}

function buildMentionNotifications(params: {
  db: OpenFoxDatabase;
  actorAddress: string;
  groupId?: string;
  limit: number;
  skipMessageIds: Set<string>;
}): WorldNotificationRecord[] {
  const rows = params.db.raw
    .prepare(
      `SELECT
         gm.message_id,
         gm.group_id,
         g.name AS group_name,
         gm.channel_id,
         gm.sender_address,
         gm.preview_text,
         gm.latest_event_id,
         gm.mentions_json,
         gm.created_at
       FROM group_messages gm
       JOIN groups g ON g.group_id = gm.group_id
       JOIN group_members m ON m.group_id = gm.group_id
       WHERE m.member_address = ?
         AND m.membership_state = 'active'
         AND gm.sender_address <> ?
         AND gm.redacted = 0
         AND (? IS NULL OR gm.group_id = ?)
       ORDER BY gm.created_at DESC
       LIMIT ?`,
    )
    .all(
      params.actorAddress,
      params.actorAddress,
      params.groupId ?? null,
      params.groupId ?? null,
      Math.max(params.limit * 3, 100),
    ) as Array<{
    message_id: string;
    group_id: string;
    group_name: string;
    channel_id: string;
    sender_address: string;
    preview_text: string | null;
    latest_event_id: string;
    mentions_json: string;
    created_at: string;
  }>;

  const items: WorldNotificationRecord[] = [];
  for (const row of rows) {
    if (params.skipMessageIds.has(row.message_id)) continue;
    const mentions = parseJsonSafe<string[]>(row.mentions_json, []).map((value) =>
      normalizeAddressLike(value),
    );
    if (!mentions.includes(params.actorAddress)) continue;
    items.push({
      notificationId: `notif:mention:${row.message_id}:${params.actorAddress}`,
      kind: "group_message_mention",
      occurredAt: row.created_at,
      actorAddress: row.sender_address,
      targetAddress: params.actorAddress,
      groupId: row.group_id,
      groupName: row.group_name,
      channelId: row.channel_id,
      title: "Mention in group",
      summary: trimSummary(row.preview_text || "Someone mentioned you."),
      refs: {
        messageId: row.message_id,
        eventId: row.latest_event_id,
      },
      readAt: null,
      dismissedAt: null,
    });
  }
  return items.slice(0, params.limit);
}

function applyNotificationState(
  db: OpenFoxDatabase,
  items: WorldNotificationRecord[],
): WorldNotificationRecord[] {
  const stateById = loadNotificationStateMap(
    db,
    items.map((item) => item.notificationId),
  );
  return items.map((item) => {
    const state = stateById.get(item.notificationId);
    return {
      ...item,
      readAt: state?.readAt ?? null,
      dismissedAt: state?.dismissedAt ?? null,
    };
  });
}

export function listWorldNotifications(
  db: OpenFoxDatabase,
  options: {
    actorAddress: string;
    groupId?: string;
    limit?: number;
    unreadOnly?: boolean;
    includeDismissed?: boolean;
    subscribedOnly?: boolean;
  },
): WorldNotificationRecord[] {
  const actorAddress = normalizeAddressLike(options.actorAddress);
  const limit = Math.max(1, options.limit ?? 25);
  const sourceLimit = Math.max(limit * 3, 100);

  const items: WorldNotificationRecord[] = [];
  items.push(
    ...buildInviteNotifications({ db, actorAddress, groupId: options.groupId, limit: sourceLimit }),
    ...buildPendingJoinRequestNotifications({
      db,
      actorAddress,
      groupId: options.groupId,
      limit: sourceLimit,
    }),
    ...buildApprovedJoinRequestNotifications({
      db,
      actorAddress,
      groupId: options.groupId,
      limit: sourceLimit,
    }),
    ...buildModerationNotifications({
      db,
      actorAddress,
      groupId: options.groupId,
      limit: sourceLimit,
    }),
    ...buildAnnouncementNotifications({
      db,
      actorAddress,
      groupId: options.groupId,
      limit: sourceLimit,
    }),
  );

  const replyItems = buildReplyNotifications({
    db,
    actorAddress,
    groupId: options.groupId,
    limit: sourceLimit,
  });
  items.push(...replyItems);
  items.push(
    ...buildMentionNotifications({
      db,
      actorAddress,
      groupId: options.groupId,
      limit: sourceLimit,
      skipMessageIds: new Set(replyItems.map((item) => item.refs.messageId).filter(Boolean)),
    }),
  );

  const withState = applyNotificationState(db, items);
  const filtered = withState.filter((item) => {
    if (!options.includeDismissed && item.dismissedAt) return false;
    if (options.unreadOnly && item.readAt) return false;
    if (options.subscribedOnly && !matchesSubscriptionFilter(db, actorAddress, item)) {
      return false;
    }
    return true;
  });
  return sortItems(filtered, limit);
}

export function buildWorldNotificationsSnapshot(
  db: OpenFoxDatabase,
  options: {
    actorAddress: string;
    groupId?: string;
    limit?: number;
    unreadOnly?: boolean;
    includeDismissed?: boolean;
    subscribedOnly?: boolean;
  },
): WorldNotificationSnapshot {
  const items = listWorldNotifications(db, options);
  const unreadCount = items.filter((item) => !item.readAt).length;
  const groupScope = options.groupId ? ` for ${options.groupId}` : "";
  const subscriptionScope = options.subscribedOnly ? " matching subscriptions" : "";
  return {
    generatedAt: nowIso(),
    unreadCount,
    items,
    summary: items.length
      ? `World notifications${groupScope}${subscriptionScope} contain ${items.length} item(s), ${unreadCount} unread.`
      : `World notifications${groupScope}${subscriptionScope} are currently empty.`,
  };
}

export function markWorldNotificationRead(
  db: OpenFoxDatabase,
  notificationId: string,
  readAt = nowIso(),
): WorldNotificationState {
  const existing = db.raw
    .prepare(
      `SELECT notification_id, read_at, dismissed_at, updated_at
       FROM world_notification_state
       WHERE notification_id = ?`,
    )
    .get(notificationId) as
    | {
        notification_id: string;
        read_at: string | null;
        dismissed_at: string | null;
        updated_at: string;
      }
    | undefined;
  const next: WorldNotificationState = {
    notificationId,
    readAt: existing?.read_at ?? readAt,
    dismissedAt: existing?.dismissed_at ?? null,
    updatedAt: readAt,
  };
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO world_notification_state (
         notification_id,
         read_at,
         dismissed_at,
         updated_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      next.notificationId,
      next.readAt,
      next.dismissedAt,
      next.updatedAt,
    );
  return next;
}

export function dismissWorldNotification(
  db: OpenFoxDatabase,
  notificationId: string,
  dismissedAt = nowIso(),
): WorldNotificationState {
  const existing = db.raw
    .prepare(
      `SELECT notification_id, read_at, dismissed_at, updated_at
       FROM world_notification_state
       WHERE notification_id = ?`,
    )
    .get(notificationId) as
    | {
        notification_id: string;
        read_at: string | null;
        dismissed_at: string | null;
        updated_at: string;
      }
    | undefined;
  const next: WorldNotificationState = {
    notificationId,
    readAt: existing?.read_at ?? dismissedAt,
    dismissedAt,
    updatedAt: dismissedAt,
  };
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO world_notification_state (
         notification_id,
         read_at,
         dismissed_at,
         updated_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      next.notificationId,
      next.readAt,
      next.dismissedAt,
      next.updatedAt,
    );
  return next;
}
