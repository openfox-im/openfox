/**
 * OpenFox Group Sync Protocol
 *
 * Core sync primitives for replicating group state between nodes.
 * Builds on top of the existing event/reducer model in store.ts.
 */

import { ulid } from "ulid";
import { keccak256, toHex, type Hex } from "tosdk";
import type { OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  getGroup,
  listGroupEvents,
  listGroupMembers,
  listGroupChannels,
  listGroupAnnouncements,
  type GroupRecord,
  type GroupEventRecord,
  type GroupMemberRecord,
  type GroupChannelRecord,
  type GroupAnnouncementRecord,
  type GroupEventSourceKind,
} from "./store.js";

const logger = createLogger("group-sync");

const textEncoder = new TextEncoder();

// ─── Types ──────────────────────────────────────────────────────

export interface GroupSyncOffer {
  groupId: string;
  latestEventId: string | null;
  latestEventCreatedAt: string | null;
  epoch: number;
  membersRoot: Hex;
  eventCount: number;
}

export interface GroupSyncBundle {
  groupId: string;
  sinceEventId: string | null;
  events: GroupEventRecord[];
  bundleHash: Hex;
  createdAt: string;
}

export interface GroupSnapshot {
  snapshotId: string;
  groupId: string;
  group: GroupRecord;
  members: GroupMemberRecord[];
  channels: GroupChannelRecord[];
  announcements: GroupAnnouncementRecord[];
  events: GroupEventRecord[];
  snapshotHash: Hex;
  createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function hashCanonical(value: unknown): Hex {
  return keccak256(toHex(textEncoder.encode(stableStringify(value)))) as Hex;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Sync Offer ─────────────────────────────────────────────────

/**
 * Build a sync offer advertising this node's current state for a group.
 * The remote peer uses this to determine what events it needs to send.
 */
export function buildGroupSyncOffer(
  db: OpenFoxDatabase,
  groupId: string,
): GroupSyncOffer {
  const group = getGroup(db, groupId);
  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }

  const latestEvent = db.raw
    .prepare(
      `SELECT event_id, created_at FROM group_events
       WHERE group_id = ? AND reducer_status = 'accepted'
       ORDER BY created_at DESC, event_id DESC
       LIMIT 1`,
    )
    .get(groupId) as { event_id: string; created_at: string } | undefined;

  const eventCount = (
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM group_events
         WHERE group_id = ? AND reducer_status = 'accepted'`,
      )
      .get(groupId) as { count: number }
  ).count;

  return {
    groupId,
    latestEventId: latestEvent?.event_id ?? null,
    latestEventCreatedAt: latestEvent?.created_at ?? null,
    epoch: group.currentEpoch,
    membersRoot: group.currentMembersRoot,
    eventCount,
  };
}

// ─── Sync Bundle ────────────────────────────────────────────────

/**
 * Build a bundle of events since a given cursor for a remote peer.
 * If sinceEventCursor is null, returns all events.
 */
export function buildGroupSyncBundle(
  db: OpenFoxDatabase,
  groupId: string,
  sinceEventCursor: string | null,
): GroupSyncBundle {
  const group = getGroup(db, groupId);
  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }

  let events: GroupEventRecord[];
  if (sinceEventCursor) {
    // Get the created_at of the cursor event to filter
    const cursorRow = db.raw
      .prepare(
        `SELECT created_at FROM group_events
         WHERE group_id = ? AND event_id = ?`,
      )
      .get(groupId, sinceEventCursor) as { created_at: string } | undefined;

    if (cursorRow) {
      // Get events created after the cursor event
      const rows = db.raw
        .prepare(
          `SELECT * FROM group_events
           WHERE group_id = ? AND reducer_status = 'accepted'
             AND (created_at > ? OR (created_at = ? AND event_id > ?))
           ORDER BY created_at ASC, event_id ASC`,
        )
        .all(
          groupId,
          cursorRow.created_at,
          cursorRow.created_at,
          sinceEventCursor,
        ) as any[];
      events = rows.map(mapEventRow);
    } else {
      // Cursor not found, send all events
      logger.warn(
        `Sync cursor event not found: ${sinceEventCursor}, sending all events`,
      );
      const rows = db.raw
        .prepare(
          `SELECT * FROM group_events
           WHERE group_id = ? AND reducer_status = 'accepted'
           ORDER BY created_at ASC, event_id ASC`,
        )
        .all(groupId) as any[];
      events = rows.map(mapEventRow);
    }
  } else {
    // No cursor, send all events
    const rows = db.raw
      .prepare(
        `SELECT * FROM group_events
         WHERE group_id = ? AND reducer_status = 'accepted'
         ORDER BY created_at ASC, event_id ASC`,
      )
      .all(groupId) as any[];
    events = rows.map(mapEventRow);
  }

  const bundleHash = hashCanonical({
    group_id: groupId,
    since: sinceEventCursor,
    event_ids: events.map((e) => e.eventId),
  });

  return {
    groupId,
    sinceEventId: sinceEventCursor,
    events,
    bundleHash,
    createdAt: nowIso(),
  };
}

// ─── Apply Sync Bundle ──────────────────────────────────────────

export interface ApplySyncBundleResult {
  applied: number;
  skipped: number;
  rejected: number;
  rejectedEventIds: string[];
}

/**
 * Apply a received sync bundle to the local database.
 * Events are validated and applied through the existing reducer model.
 * Already-seen events are idempotently skipped (replay-safe).
 * Invalid events are rejected and recorded.
 */
export function applyGroupSyncBundle(
  db: OpenFoxDatabase,
  groupId: string,
  bundle: GroupSyncBundle,
): ApplySyncBundleResult {
  const result: ApplySyncBundleResult = {
    applied: 0,
    skipped: 0,
    rejected: 0,
    rejectedEventIds: [],
  };

  // Verify the bundle is for the right group
  if (bundle.groupId !== groupId) {
    throw new Error(
      `Bundle group mismatch: expected ${groupId}, got ${bundle.groupId}`,
    );
  }

  if (bundle.events.length === 0) {
    return result;
  }

  db.runTransaction(() => {
    for (const event of bundle.events) {
      // Check if event already exists (replay safety)
      const existing = db.raw
        .prepare(
          `SELECT event_id FROM group_events
           WHERE group_id = ? AND event_id = ?`,
        )
        .get(groupId, event.eventId) as { event_id: string } | undefined;

      if (existing) {
        result.skipped++;
        continue;
      }

      // Validate the event
      const validation = validateSyncEvent(db, groupId, event);
      if (!validation.valid) {
        logger.warn(
          `Rejecting sync event ${event.eventId}: ${validation.reason}`,
        );
        // Only persist the rejection if the event's groupId matches
        // (otherwise FK constraint prevents insert)
        if (event.groupId === groupId) {
          insertSyncEvent(db, {
            ...event,
            sourceKind: "peer",
            reducerStatus: "rejected",
            rejectionReason: validation.reason,
            receivedAt: nowIso(),
          });
        }
        result.rejected++;
        result.rejectedEventIds.push(event.eventId);
        continue;
      }

      // Apply the event
      insertSyncEvent(db, {
        ...event,
        sourceKind: "peer",
        reducerStatus: "accepted",
        rejectionReason: null,
        receivedAt: nowIso(),
      });
      applySyncEventSideEffects(db, groupId, event);
      result.applied++;
    }
  });

  logger.info(
    `Applied sync bundle for ${groupId}: ${result.applied} applied, ${result.skipped} skipped, ${result.rejected} rejected`,
  );

  return result;
}

// ─── Event Validation ───────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  reason: string;
}

function validateSyncEvent(
  db: OpenFoxDatabase,
  groupId: string,
  event: GroupEventRecord,
): ValidationResult {
  // Must be for the right group
  if (event.groupId !== groupId) {
    return { valid: false, reason: `Group mismatch: ${event.groupId}` };
  }

  // Must have a valid event ID
  if (!event.eventId || !event.eventId.startsWith("gev_")) {
    return { valid: false, reason: `Invalid event ID: ${event.eventId}` };
  }

  // Must have a valid kind
  if (!event.kind || typeof event.kind !== "string") {
    return { valid: false, reason: `Invalid event kind: ${event.kind}` };
  }

  // Must have a signature
  if (!event.signature) {
    return { valid: false, reason: "Missing signature" };
  }

  // Must have an event hash
  if (!event.eventHash) {
    return { valid: false, reason: "Missing event hash" };
  }

  // Must have a valid epoch (non-negative)
  if (typeof event.epoch !== "number" || event.epoch < 1) {
    return { valid: false, reason: `Invalid epoch: ${event.epoch}` };
  }

  // Must have an actor address
  if (!event.actorAddress) {
    return { valid: false, reason: "Missing actor address" };
  }

  return { valid: true, reason: "" };
}

// ─── Event Application ─────────────────────────────────────────

function insertSyncEvent(db: OpenFoxDatabase, event: GroupEventRecord): void {
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO group_events (
        event_id,
        group_id,
        kind,
        epoch,
        channel_id,
        actor_address,
        actor_agent_id,
        parent_event_ids_json,
        payload_json,
        signature,
        event_hash,
        created_at,
        expires_at,
        received_at,
        source_kind,
        reducer_status,
        rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      event.groupId,
      event.kind,
      event.epoch,
      event.channelId,
      event.actorAddress,
      event.actorAgentId,
      JSON.stringify(event.parentEventIds),
      JSON.stringify(event.payload),
      event.signature,
      event.eventHash,
      event.createdAt,
      event.expiresAt,
      event.receivedAt,
      event.sourceKind,
      event.reducerStatus,
      event.rejectionReason,
    );
}

/**
 * Apply side-effects of a synced event to projection tables.
 * This mirrors the logic in the store's transaction blocks but
 * operates from event payloads rather than function parameters.
 */
function applySyncEventSideEffects(
  db: OpenFoxDatabase,
  groupId: string,
  event: GroupEventRecord,
): void {
  const payload = event.payload;
  const now = event.createdAt;

  switch (event.kind) {
    case "group.created": {
      // Group was already created on the source node; if it does not
      // exist locally this should be handled via snapshot, not events.
      // Update the group row if it exists but skip if not (the snapshot
      // path will create it).
      break;
    }

    case "channel.created": {
      const channelId = payload.channel_id as string;
      if (!channelId) break;
      db.raw
        .prepare(
          `INSERT OR IGNORE INTO group_channels (
            channel_id, group_id, name, description, visibility,
            status, created_by_address, created_at, archived_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
        )
        .run(
          channelId,
          groupId,
          payload.name ?? "",
          payload.description ?? "",
          payload.visibility ?? "group",
          event.actorAddress,
          now,
        );
      break;
    }

    case "announcement.posted": {
      const announcementId = payload.announcement_id as string;
      if (!announcementId) break;
      db.raw
        .prepare(
          `INSERT OR IGNORE INTO group_announcements (
            announcement_id, group_id, channel_id, event_id,
            title, body_text, pinned, posted_by_address, created_at, redacted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          announcementId,
          groupId,
          event.channelId,
          event.eventId,
          payload.title ?? "",
          payload.body_text ?? "",
          payload.pinned ? 1 : 0,
          event.actorAddress,
          now,
        );
      break;
    }

    case "announcement.pinned": {
      const announcementId = payload.announcement_id as string;
      if (!announcementId) break;
      db.raw
        .prepare(
          "UPDATE group_announcements SET pinned = 0 WHERE group_id = ?",
        )
        .run(groupId);
      db.raw
        .prepare(
          "UPDATE group_announcements SET pinned = 1 WHERE announcement_id = ?",
        )
        .run(announcementId);
      db.raw
        .prepare(
          "UPDATE groups SET pinned_announcement_id = ?, updated_at = ? WHERE group_id = ?",
        )
        .run(announcementId, now, groupId);
      break;
    }

    case "membership.add.committed": {
      const memberAddress = (payload.member_address as string)
        ?.trim()
        .toLowerCase();
      const roles = (payload.roles as string[]) ?? ["member"];
      const joinedVia = (payload.joined_via as string) ?? "invite";
      if (!memberAddress) break;
      db.raw
        .prepare(
          `INSERT OR REPLACE INTO group_members (
            group_id, member_address, member_agent_id, member_tns_name,
            display_name, membership_state, joined_via, joined_at,
            left_at, mute_until, last_event_id
          ) VALUES (?, ?, NULL, NULL, NULL, 'active', ?, ?, NULL, NULL, ?)`,
        )
        .run(groupId, memberAddress, joinedVia, now, event.eventId);
      for (const role of roles) {
        db.raw
          .prepare(
            `INSERT OR REPLACE INTO group_member_roles (
              group_id, member_address, role, active,
              granted_by_address, granted_at, revoked_at, last_event_id
            ) VALUES (?, ?, ?, 1, ?, ?, NULL, ?)`,
          )
          .run(
            groupId,
            memberAddress,
            role,
            event.actorAddress,
            now,
            event.eventId,
          );
      }
      break;
    }

    case "membership.leave.committed": {
      const memberAddress = (payload.member_address as string)
        ?.trim()
        .toLowerCase();
      if (!memberAddress) break;
      db.raw
        .prepare(
          `UPDATE group_members
           SET membership_state = 'left', left_at = ?, last_event_id = ?
           WHERE group_id = ? AND member_address = ?`,
        )
        .run(now, event.eventId, groupId, memberAddress);
      db.raw
        .prepare(
          `UPDATE group_member_roles
           SET active = 0, revoked_at = ?, last_event_id = ?
           WHERE group_id = ? AND member_address = ? AND active = 1`,
        )
        .run(now, event.eventId, groupId, memberAddress);
      break;
    }

    case "membership.remove.committed": {
      const memberAddress = (payload.member_address as string)
        ?.trim()
        .toLowerCase();
      if (!memberAddress) break;
      db.raw
        .prepare(
          `UPDATE group_members
           SET membership_state = 'removed', left_at = ?, last_event_id = ?
           WHERE group_id = ? AND member_address = ?`,
        )
        .run(now, event.eventId, groupId, memberAddress);
      db.raw
        .prepare(
          `UPDATE group_member_roles
           SET active = 0, revoked_at = ?, last_event_id = ?
           WHERE group_id = ? AND member_address = ? AND active = 1`,
        )
        .run(now, event.eventId, groupId, memberAddress);
      break;
    }

    case "moderation.member.banned": {
      const targetAddress = (payload.target_address as string)
        ?.trim()
        .toLowerCase();
      if (!targetAddress) break;
      db.raw
        .prepare(
          `UPDATE group_members
           SET membership_state = 'banned', left_at = ?, mute_until = NULL, last_event_id = ?
           WHERE group_id = ? AND member_address = ?`,
        )
        .run(now, event.eventId, groupId, targetAddress);
      db.raw
        .prepare(
          `UPDATE group_member_roles
           SET active = 0, revoked_at = ?, last_event_id = ?
           WHERE group_id = ? AND member_address = ? AND active = 1`,
        )
        .run(now, event.eventId, groupId, targetAddress);
      break;
    }

    case "moderation.member.unbanned": {
      const targetAddress = (payload.target_address as string)
        ?.trim()
        .toLowerCase();
      if (!targetAddress) break;
      db.raw
        .prepare(
          `UPDATE group_members
           SET membership_state = 'removed', mute_until = NULL, last_event_id = ?
           WHERE group_id = ? AND member_address = ?`,
        )
        .run(event.eventId, groupId, targetAddress);
      break;
    }

    case "moderation.member.muted": {
      const targetAddress = (payload.target_address as string)
        ?.trim()
        .toLowerCase();
      const muteUntil = payload.mute_until as string;
      if (!targetAddress || !muteUntil) break;
      db.raw
        .prepare(
          `UPDATE group_members
           SET mute_until = ?, last_event_id = ?
           WHERE group_id = ? AND member_address = ?`,
        )
        .run(muteUntil, event.eventId, groupId, targetAddress);
      break;
    }

    case "moderation.member.unmuted": {
      const targetAddress = (payload.target_address as string)
        ?.trim()
        .toLowerCase();
      if (!targetAddress) break;
      db.raw
        .prepare(
          `UPDATE group_members
           SET mute_until = NULL, last_event_id = ?
           WHERE group_id = ? AND member_address = ?`,
        )
        .run(event.eventId, groupId, targetAddress);
      break;
    }

    case "epoch.rotated": {
      const nextEpoch = payload.next_epoch as number;
      if (typeof nextEpoch !== "number") break;
      // Recompute members root
      const activeMembers = db.raw
        .prepare(
          `SELECT member_address FROM group_members
           WHERE group_id = ? AND membership_state = 'active'
           ORDER BY member_address ASC`,
        )
        .all(groupId) as Array<{ member_address: string }>;
      const activeRoles = db.raw
        .prepare(
          `SELECT member_address, role FROM group_member_roles
           WHERE group_id = ? AND active = 1
           ORDER BY member_address ASC, role ASC`,
        )
        .all(groupId) as Array<{ member_address: string; role: string }>;
      const rolesByMember = new Map<string, string[]>();
      for (const row of activeRoles) {
        const roles = rolesByMember.get(row.member_address) ?? [];
        roles.push(row.role);
        rolesByMember.set(row.member_address, roles);
      }
      const membersRoot = hashCanonical(
        activeMembers
          .map((m) => ({
            address: m.member_address.trim().toLowerCase(),
            roles: [
              ...new Set(
                (rolesByMember.get(m.member_address) ?? [])
                  .map((r) => r.trim())
                  .filter(Boolean),
              ),
            ].sort(),
          }))
          .sort((a, b) => a.address.localeCompare(b.address)),
      );
      db.raw
        .prepare(
          `UPDATE groups
           SET current_epoch = ?, current_members_root = ?, updated_at = ?
           WHERE group_id = ?`,
        )
        .run(nextEpoch, membersRoot, now, groupId);
      break;
    }

    case "message.posted":
    case "message.reply.posted": {
      const messageId = payload.message_id as string;
      const channelId = (payload.channel_id as string) ?? event.channelId;
      if (!messageId || !channelId) break;
      db.raw
        .prepare(
          `INSERT OR IGNORE INTO group_messages (
            message_id, group_id, channel_id, original_event_id,
            latest_event_id, sender_address, sender_agent_id,
            reply_to_message_id, ciphertext, preview_text,
            mentions_json, reaction_summary_json, redacted,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, ?, ?)`,
        )
        .run(
          messageId,
          groupId,
          channelId,
          event.eventId,
          event.eventId,
          event.actorAddress,
          event.actorAgentId,
          (payload.reply_to as string) ?? null,
          (payload.ciphertext as string) ?? "",
          (payload.plaintext_summary as string) ?? null,
          JSON.stringify((payload.mentions as string[]) ?? []),
          now,
          now,
        );
      break;
    }

    case "message.edited": {
      const messageId = payload.message_id as string;
      if (!messageId) break;
      db.raw
        .prepare(
          `UPDATE group_messages
           SET latest_event_id = ?, ciphertext = ?, preview_text = ?,
               mentions_json = ?, updated_at = ?
           WHERE group_id = ? AND message_id = ?`,
        )
        .run(
          event.eventId,
          (payload.ciphertext as string) ?? "",
          (payload.plaintext_summary as string) ?? null,
          JSON.stringify((payload.mentions as string[]) ?? []),
          now,
          groupId,
          messageId,
        );
      break;
    }

    case "message.redacted": {
      const messageId = payload.message_id as string;
      if (!messageId) break;
      db.raw
        .prepare(
          `UPDATE group_messages
           SET latest_event_id = ?, redacted = 1, preview_text = '[redacted]', updated_at = ?
           WHERE group_id = ? AND message_id = ?`,
        )
        .run(event.eventId, now, groupId, messageId);
      break;
    }

    case "message.reaction.added": {
      const messageId = payload.message_id as string;
      const reactionCode = payload.reaction_code as string;
      if (!messageId || !reactionCode) break;
      db.raw
        .prepare(
          `INSERT OR REPLACE INTO group_message_reactions (
            group_id, message_id, reactor_address, reaction_code,
            event_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          groupId,
          messageId,
          event.actorAddress,
          reactionCode,
          event.eventId,
          now,
        );
      // Recompute reaction summary
      const reactionRows = db.raw
        .prepare(
          `SELECT reaction_code, COUNT(*) AS count
           FROM group_message_reactions
           WHERE group_id = ? AND message_id = ?
           GROUP BY reaction_code`,
        )
        .all(groupId, messageId) as Array<{
        reaction_code: string;
        count: number;
      }>;
      const summary: Record<string, number> = {};
      for (const row of reactionRows) {
        summary[row.reaction_code] = row.count;
      }
      db.raw
        .prepare(
          `UPDATE group_messages
           SET reaction_summary_json = ?, updated_at = ?
           WHERE group_id = ? AND message_id = ?`,
        )
        .run(JSON.stringify(summary), now, groupId, messageId);
      break;
    }

    default: {
      // For other event kinds (invite.proposed, invite.approved, invite.accepted,
      // join.requested, join.approved, join.withdrawn, system.notice.posted, etc.)
      // we update the groups timestamp
      db.raw
        .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
        .run(now, groupId);
      break;
    }
  }
}

function shouldReplaySnapshotProjection(eventKind: string): boolean {
  return (
    eventKind === "message.posted" ||
    eventKind === "message.reply.posted" ||
    eventKind === "message.edited" ||
    eventKind === "message.redacted" ||
    eventKind === "message.reaction.added"
  );
}

// ─── Snapshot ───────────────────────────────────────────────────

/**
 * Create a full state snapshot of a group for initial sync.
 */
export function buildGroupSnapshot(
  db: OpenFoxDatabase,
  groupId: string,
): GroupSnapshot {
  const group = getGroup(db, groupId);
  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }

  const members = listGroupMembers(db, groupId);
  const channels = listGroupChannels(db, groupId);
  const announcements = listGroupAnnouncements(db, groupId, 1000);

  // Get ALL events for the group
  const eventRows = db.raw
    .prepare(
      `SELECT * FROM group_events
       WHERE group_id = ? AND reducer_status = 'accepted'
       ORDER BY created_at ASC, event_id ASC`,
    )
    .all(groupId) as any[];
  const events = eventRows.map(mapEventRow);

  const snapshotId = `gsnp_${ulid()}`;
  const snapshotHash = hashCanonical({
    snapshot_id: snapshotId,
    group_id: groupId,
    epoch: group.currentEpoch,
    members_root: group.currentMembersRoot,
    event_count: events.length,
    member_count: members.length,
  });

  const snapshot: GroupSnapshot = {
    snapshotId,
    groupId,
    group,
    members,
    channels,
    announcements,
    events,
    snapshotHash,
    createdAt: nowIso(),
  };

  // Build roles JSON from members
  const rolesForSnapshot: Array<{
    group_id: string;
    member_address: string;
    role: string;
  }> = [];
  for (const member of members) {
    for (const role of member.roles) {
      rolesForSnapshot.push({
        group_id: groupId,
        member_address: member.memberAddress,
        role,
      });
    }
  }

  // Record the snapshot in the database
  db.raw
    .prepare(
      `INSERT INTO group_snapshots (
        snapshot_id, group_id, as_of_event_id, snapshot_hash, snapshot_cid,
        members_json, roles_json, channels_json, announcements_json,
        current_epoch, published_by_address, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshotId,
      groupId,
      events.length > 0 ? events[events.length - 1].eventId : "",
      snapshotHash,
      JSON.stringify(members),
      JSON.stringify(rolesForSnapshot),
      JSON.stringify(channels),
      JSON.stringify(announcements),
      group.currentEpoch,
      group.creatorAddress,
      snapshot.createdAt,
    );

  // Update the latest snapshot reference
  db.raw
    .prepare(
      "UPDATE groups SET latest_snapshot_id = ? WHERE group_id = ?",
    )
    .run(snapshotId, groupId);

  return snapshot;
}

/**
 * Apply a full snapshot for a group not yet known locally.
 * If the group already exists locally, this is a no-op to prevent overwriting.
 */
export function applyGroupSnapshot(
  db: OpenFoxDatabase,
  groupId: string,
  snapshot: GroupSnapshot,
): void {
  if (snapshot.groupId !== groupId) {
    throw new Error(
      `Snapshot group mismatch: expected ${groupId}, got ${snapshot.groupId}`,
    );
  }

  // Check if group already exists
  const existing = getGroup(db, groupId);
  if (existing) {
    logger.info(
      `Group ${groupId} already exists locally, skipping snapshot apply`,
    );
    return;
  }

  const group = snapshot.group;

  db.runTransaction(() => {
    // Insert the group row
    db.raw
      .prepare(
        `INSERT INTO groups (
          group_id, name, description, visibility, join_mode, status,
          max_members, tns_name, tags_json, avatar_artifact_cid,
          rules_artifact_cid, creator_address, creator_agent_id,
          current_epoch, current_policy_hash, current_members_root,
          pinned_announcement_id, latest_snapshot_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        group.groupId,
        group.name,
        group.description,
        group.visibility,
        group.joinMode,
        group.status,
        group.maxMembers,
        group.tnsName,
        JSON.stringify(group.tags),
        group.avatarArtifactCid,
        group.rulesArtifactCid,
        group.creatorAddress,
        group.creatorAgentId,
        group.currentEpoch,
        group.currentPolicyHash,
        group.currentMembersRoot,
        group.pinnedAnnouncementId,
        snapshot.snapshotId,
        group.createdAt,
        group.updatedAt,
      );

    // Insert channels
    for (const channel of snapshot.channels) {
      db.raw
        .prepare(
          `INSERT OR IGNORE INTO group_channels (
            channel_id, group_id, name, description, visibility,
            status, created_by_address, created_at, archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          channel.channelId,
          channel.groupId,
          channel.name,
          channel.description,
          channel.visibility,
          channel.status,
          channel.createdByAddress,
          channel.createdAt,
          channel.archivedAt,
        );
    }

    // Insert members and roles
    for (const member of snapshot.members) {
      db.raw
        .prepare(
          `INSERT OR IGNORE INTO group_members (
            group_id, member_address, member_agent_id, member_tns_name,
            display_name, membership_state, joined_via, joined_at,
            left_at, mute_until, last_event_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          member.groupId,
          member.memberAddress,
          member.memberAgentId,
          member.memberTnsName,
          member.displayName,
          member.membershipState,
          member.joinedVia,
          member.joinedAt,
          member.leftAt,
          member.muteUntil,
          member.lastEventId,
        );

      for (const role of member.roles) {
        db.raw
          .prepare(
            `INSERT OR IGNORE INTO group_member_roles (
              group_id, member_address, role, active,
              granted_by_address, granted_at, revoked_at, last_event_id
            ) VALUES (?, ?, ?, 1, ?, ?, NULL, ?)`,
          )
          .run(
            member.groupId,
            member.memberAddress,
            role,
            member.memberAddress,
            member.joinedAt,
            member.lastEventId,
          );
      }
    }

    // Insert announcements
    for (const ann of snapshot.announcements) {
      db.raw
        .prepare(
          `INSERT OR IGNORE INTO group_announcements (
            announcement_id, group_id, channel_id, event_id,
            title, body_text, pinned, posted_by_address, created_at, redacted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ann.announcementId,
          ann.groupId,
          ann.channelId,
          ann.eventId,
          ann.title,
          ann.bodyText,
          ann.pinned ? 1 : 0,
          ann.postedByAddress,
          ann.createdAt,
          ann.redactedAt,
        );
    }

    // Insert all events
    for (const event of snapshot.events) {
      insertSyncEvent(db, {
        ...event,
        sourceKind: "snapshot",
        receivedAt: nowIso(),
      });
    }

    // Replay message-side projections that are not otherwise materialized
    // by the snapshot payload itself. This restores `group_messages` and
    // `group_message_reactions` on a fresh node without mutating member or
    // announcement rows that were already inserted from the snapshot.
    for (const event of snapshot.events) {
      if (shouldReplaySnapshotProjection(event.kind)) {
        applySyncEventSideEffects(db, groupId, event);
      }
    }

    // Record the snapshot
    db.raw
      .prepare(
        `INSERT OR IGNORE INTO group_snapshots (
          snapshot_id, group_id, as_of_event_id, snapshot_hash, snapshot_cid,
          members_json, roles_json, channels_json, announcements_json,
          current_epoch, published_by_address, created_at
        ) VALUES (?, ?, ?, ?, NULL, '[]', '[]', '[]', '[]', ?, ?, ?)`,
      )
      .run(
        snapshot.snapshotId,
        groupId,
        snapshot.events.length > 0
          ? snapshot.events[snapshot.events.length - 1].eventId
          : "",
        snapshot.snapshotHash,
        snapshot.group.currentEpoch,
        snapshot.group.creatorAddress,
        snapshot.createdAt,
      );
  });

  logger.info(
    `Applied snapshot for group ${groupId}: ${snapshot.members.length} members, ${snapshot.events.length} events`,
  );
}

// ─── Conflict Resolution ────────────────────────────────────────

/**
 * Resolve conflicting events in the same epoch.
 * The event with the lexicographically lower event ID wins.
 * The losing event is marked as rejected.
 */
export function resolveGroupEventConflict(
  db: OpenFoxDatabase,
  groupId: string,
  eventA: GroupEventRecord,
  eventB: GroupEventRecord,
): GroupEventRecord {
  if (eventA.epoch !== eventB.epoch) {
    throw new Error("Cannot resolve conflict between events in different epochs");
  }

  const winner =
    eventA.eventId.localeCompare(eventB.eventId) <= 0 ? eventA : eventB;
  const loser = winner === eventA ? eventB : eventA;

  logger.info(
    `Conflict resolution in epoch ${eventA.epoch}: winner=${winner.eventId}, loser=${loser.eventId}`,
  );

  // Mark the loser as rejected
  db.raw
    .prepare(
      `UPDATE group_events
       SET reducer_status = 'rejected', rejection_reason = ?
       WHERE group_id = ? AND event_id = ?`,
    )
    .run(
      `conflict_resolution: lost to ${winner.eventId}`,
      groupId,
      loser.eventId,
    );

  return winner;
}

// ─── Sync State Management ─────────────────────────────────────

export function updateSyncCursor(
  db: OpenFoxDatabase,
  groupId: string,
  peerRef: string,
  sourceKind: string,
  lastEventId: string,
): void {
  const now = nowIso();
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_sync_state (
        group_id, peer_ref, source_kind, last_event_id,
        last_snapshot_id, last_sync_at, last_success_at, last_error
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`,
    )
    .run(groupId, peerRef, sourceKind, lastEventId, now, now);
}

export function getSyncCursor(
  db: OpenFoxDatabase,
  groupId: string,
  peerRef: string,
  sourceKind: string,
): string | null {
  const row = db.raw
    .prepare(
      `SELECT last_event_id FROM group_sync_state
       WHERE group_id = ? AND peer_ref = ? AND source_kind = ?`,
    )
    .get(groupId, peerRef, sourceKind) as
    | { last_event_id: string }
    | undefined;
  return row?.last_event_id ?? null;
}

export function recordSyncError(
  db: OpenFoxDatabase,
  groupId: string,
  peerRef: string,
  sourceKind: string,
  error: string,
): void {
  const now = nowIso();
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_sync_state (
        group_id, peer_ref, source_kind, last_event_id,
        last_snapshot_id, last_sync_at, last_success_at, last_error
      ) VALUES (
        ?, ?, ?,
        COALESCE((SELECT last_event_id FROM group_sync_state WHERE group_id = ? AND peer_ref = ? AND source_kind = ?), NULL),
        NULL, ?,
        (SELECT last_success_at FROM group_sync_state WHERE group_id = ? AND peer_ref = ? AND source_kind = ?),
        ?
      )`,
    )
    .run(
      groupId,
      peerRef,
      sourceKind,
      groupId,
      peerRef,
      sourceKind,
      now,
      groupId,
      peerRef,
      sourceKind,
      error,
    );
}

// ─── Peer Tracking ──────────────────────────────────────────────

export interface GroupSyncPeer {
  groupId: string;
  peerAddress: string;
  peerEndpoint: string;
  lastSyncAt: string | null;
  lastCursor: string | null;
  syncKind: string;
}

export function upsertSyncPeer(
  db: OpenFoxDatabase,
  peer: GroupSyncPeer,
): void {
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_sync_peers (
        group_id, peer_address, peer_endpoint, last_sync_at,
        last_cursor, sync_kind
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      peer.groupId,
      peer.peerAddress,
      peer.peerEndpoint,
      peer.lastSyncAt,
      peer.lastCursor,
      peer.syncKind,
    );
}

export function listSyncPeers(
  db: OpenFoxDatabase,
  groupId: string,
): GroupSyncPeer[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_sync_peers
       WHERE group_id = ?
       ORDER BY last_sync_at DESC`,
    )
    .all(groupId) as any[];

  return rows.map((row) => ({
    groupId: row.group_id,
    peerAddress: row.peer_address,
    peerEndpoint: row.peer_endpoint,
    lastSyncAt: row.last_sync_at ?? null,
    lastCursor: row.last_cursor ?? null,
    syncKind: row.sync_kind,
  }));
}

// ─── Internal helpers ───────────────────────────────────────────

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapEventRow(row: any): GroupEventRecord {
  return {
    eventId: row.event_id,
    groupId: row.group_id,
    kind: row.kind,
    epoch: row.epoch,
    channelId: row.channel_id ?? null,
    actorAddress: row.actor_address,
    actorAgentId: row.actor_agent_id ?? null,
    parentEventIds: parseJsonSafe<string[]>(row.parent_event_ids_json, []),
    payload: parseJsonSafe<Record<string, unknown>>(row.payload_json, {}),
    signature: row.signature as Hex,
    eventHash: row.event_hash as Hex,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    receivedAt: row.received_at,
    sourceKind: row.source_kind,
    reducerStatus: row.reducer_status,
    rejectionReason: row.rejection_reason ?? null,
  };
}
