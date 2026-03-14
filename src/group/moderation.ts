/**
 * OpenFox Group Moderation — Extended moderation workflows
 *
 * Warnings, reports, appeals, and anti-spam controls.
 * Built on top of the existing group moderation primitives in store.ts.
 */

import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import {
  muteGroupMember,
  banGroupMember,
  unmuteGroupMember,
  unbanGroupMember,
} from "./store.js";
import type { OpenFoxDatabase } from "../types.js";
import type { PrivateKeyAccount } from "tosdk";

const logger = createLogger("group-moderation");

// ─── Types ───────────────────────────────────────────────────────

export type WarningSeverity = "mild" | "moderate" | "severe";
export type ReportCategory = "spam" | "harassment" | "off_topic" | "illegal" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ReportResolution = "warn" | "mute" | "ban" | "dismiss";
export type AppealStatus = "pending" | "approved" | "rejected";
export type AppealActionKind = "mute" | "ban" | "warning";
export type AppealDecision = "approved" | "rejected";

export interface GroupWarningRecord {
  warningId: string;
  groupId: string;
  targetAddress: string;
  issuerAddress: string;
  severity: WarningSeverity;
  reason: string;
  escalationAction: string | null;
  createdAt: string;
}

export interface GroupReportRecord {
  reportId: string;
  groupId: string;
  reporterAddress: string;
  targetAddress: string | null;
  messageId: string | null;
  category: ReportCategory;
  reason: string;
  status: ReportStatus;
  resolverAddress: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface GroupAppealRecord {
  appealId: string;
  groupId: string;
  appealerAddress: string;
  actionKind: AppealActionKind;
  reason: string;
  status: AppealStatus;
  resolverAddress: string | null;
  decision: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface GroupRateLimitConfig {
  groupId: string;
  maxPerMinute: number;
  maxPerHour: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

interface WarningRow {
  warning_id: string;
  group_id: string;
  target_address: string;
  issuer_address: string;
  severity: string;
  reason: string;
  escalation_action: string | null;
  created_at: string;
}

function warningFromRow(row: WarningRow): GroupWarningRecord {
  return {
    warningId: row.warning_id,
    groupId: row.group_id,
    targetAddress: row.target_address,
    issuerAddress: row.issuer_address,
    severity: row.severity as WarningSeverity,
    reason: row.reason,
    escalationAction: row.escalation_action,
    createdAt: row.created_at,
  };
}

interface ReportRow {
  report_id: string;
  group_id: string;
  reporter_address: string;
  target_address: string | null;
  message_id: string | null;
  category: string;
  reason: string;
  status: string;
  resolver_address: string | null;
  resolution: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

function reportFromRow(row: ReportRow): GroupReportRecord {
  return {
    reportId: row.report_id,
    groupId: row.group_id,
    reporterAddress: row.reporter_address,
    targetAddress: row.target_address,
    messageId: row.message_id,
    category: row.category as ReportCategory,
    reason: row.reason,
    status: row.status as ReportStatus,
    resolverAddress: row.resolver_address,
    resolution: row.resolution,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

interface AppealRow {
  appeal_id: string;
  group_id: string;
  appealer_address: string;
  action_kind: string;
  reason: string;
  status: string;
  resolver_address: string | null;
  decision: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

function appealFromRow(row: AppealRow): GroupAppealRecord {
  return {
    appealId: row.appeal_id,
    groupId: row.group_id,
    appealerAddress: row.appealer_address,
    actionKind: row.action_kind as AppealActionKind,
    reason: row.reason,
    status: row.status as AppealStatus,
    resolverAddress: row.resolver_address,
    decision: row.decision,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

// ─── Warnings ────────────────────────────────────────────────────

export interface IssueGroupWarningParams {
  groupId: string;
  targetAddress: string;
  issuerAddress: string;
  reason: string;
  severity?: WarningSeverity;
}

export interface IssueGroupWarningResult {
  warning: GroupWarningRecord;
  escalationAction: string | null;
}

/**
 * Issue a warning to a group member.
 * Auto-escalation rules:
 *   - 3 mild warnings -> auto-mute 1 hour
 *   - 2 moderate warnings -> auto-mute 24 hours
 *   - 1 severe warning -> auto-ban
 */
export async function issueGroupWarning(
  db: OpenFoxDatabase,
  params: IssueGroupWarningParams,
  account?: PrivateKeyAccount,
): Promise<IssueGroupWarningResult> {
  const severity = params.severity ?? "mild";
  const warningId = ulid();
  const createdAt = nowIso();
  const targetAddress = params.targetAddress.toLowerCase();
  const issuerAddress = params.issuerAddress.toLowerCase();

  // Count existing warnings of this severity for this member
  const existingCount = getGroupWarningCount(db, params.groupId, targetAddress, severity);

  // Determine escalation
  let escalationAction: string | null = null;
  if (severity === "mild" && existingCount >= 2) {
    escalationAction = "auto_mute_1h";
  } else if (severity === "moderate" && existingCount >= 1) {
    escalationAction = "auto_mute_24h";
  } else if (severity === "severe") {
    escalationAction = "auto_ban";
  }

  db.raw
    .prepare(
      `INSERT INTO group_warnings (warning_id, group_id, target_address, issuer_address, severity, reason, escalation_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(warningId, params.groupId, targetAddress, issuerAddress, severity, params.reason, escalationAction, createdAt);

  logger.info(
    `Warning issued: ${warningId} severity=${severity} target=${targetAddress} group=${params.groupId}${escalationAction ? ` escalation=${escalationAction}` : ""}`,
  );

  // Apply escalation if we have an account to sign events
  if (escalationAction && account) {
    try {
      if (escalationAction === "auto_mute_1h") {
        const muteUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await muteGroupMember({
          db,
          account,
          input: {
            groupId: params.groupId,
            targetAddress,
            until: muteUntil,
            reason: `Auto-escalation: ${existingCount + 1} mild warnings`,
            actorAddress: issuerAddress,
          },
        });
        logger.info(`Auto-mute applied for 1 hour: target=${targetAddress}`);
      } else if (escalationAction === "auto_mute_24h") {
        const muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await muteGroupMember({
          db,
          account,
          input: {
            groupId: params.groupId,
            targetAddress,
            until: muteUntil,
            reason: `Auto-escalation: ${existingCount + 1} moderate warnings`,
            actorAddress: issuerAddress,
          },
        });
        logger.info(`Auto-mute applied for 24 hours: target=${targetAddress}`);
      } else if (escalationAction === "auto_ban") {
        await banGroupMember({
          db,
          account,
          input: {
            groupId: params.groupId,
            targetAddress,
            reason: `Auto-escalation: severe warning`,
            actorAddress: issuerAddress,
          },
        });
        logger.info(`Auto-ban applied: target=${targetAddress}`);
      }
    } catch (err) {
      logger.warn(`Escalation failed for warning ${warningId}: ${(err as Error).message}`);
    }
  }

  const warning = warningFromRow(
    db.raw
      .prepare("SELECT * FROM group_warnings WHERE warning_id = ?")
      .get(warningId) as WarningRow,
  );

  return { warning, escalationAction };
}

export function listGroupWarnings(
  db: OpenFoxDatabase,
  groupId: string,
  options?: { targetAddress?: string; limit?: number },
): GroupWarningRecord[] {
  const limit = options?.limit ?? 50;
  if (options?.targetAddress) {
    const rows = db.raw
      .prepare(
        `SELECT * FROM group_warnings
         WHERE group_id = ? AND target_address = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(groupId, options.targetAddress.toLowerCase(), limit) as WarningRow[];
    return rows.map(warningFromRow);
  }
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_warnings
       WHERE group_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(groupId, limit) as WarningRow[];
  return rows.map(warningFromRow);
}

export function getGroupWarningCount(
  db: OpenFoxDatabase,
  groupId: string,
  targetAddress: string,
  severity?: WarningSeverity,
): number {
  if (severity) {
    const row = db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM group_warnings
         WHERE group_id = ? AND target_address = ? AND severity = ?`,
      )
      .get(groupId, targetAddress.toLowerCase(), severity) as { count: number };
    return row.count;
  }
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM group_warnings
       WHERE group_id = ? AND target_address = ?`,
    )
    .get(groupId, targetAddress.toLowerCase()) as { count: number };
  return row.count;
}

// ─── Reports ─────────────────────────────────────────────────────

export interface ReportGroupMessageParams {
  groupId: string;
  messageId: string;
  reporterAddress: string;
  reason: string;
  category: ReportCategory;
}

export function reportGroupMessage(
  db: OpenFoxDatabase,
  params: ReportGroupMessageParams,
): GroupReportRecord {
  const reportId = ulid();
  const createdAt = nowIso();
  const reporterAddress = params.reporterAddress.toLowerCase();

  // Look up the message to get its sender as target_address
  const msg = db.raw
    .prepare("SELECT sender_address FROM group_messages WHERE group_id = ? AND message_id = ?")
    .get(params.groupId, params.messageId) as { sender_address: string } | undefined;

  const targetAddress = msg?.sender_address ?? null;

  db.raw
    .prepare(
      `INSERT INTO group_reports (report_id, group_id, reporter_address, target_address, message_id, category, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(reportId, params.groupId, reporterAddress, targetAddress, params.messageId, params.category, params.reason, createdAt);

  logger.info(`Message reported: ${reportId} message=${params.messageId} group=${params.groupId}`);

  return reportFromRow(
    db.raw.prepare("SELECT * FROM group_reports WHERE report_id = ?").get(reportId) as ReportRow,
  );
}

export interface ReportGroupMemberParams {
  groupId: string;
  targetAddress: string;
  reporterAddress: string;
  reason: string;
  category: ReportCategory;
}

export function reportGroupMember(
  db: OpenFoxDatabase,
  params: ReportGroupMemberParams,
): GroupReportRecord {
  const reportId = ulid();
  const createdAt = nowIso();

  db.raw
    .prepare(
      `INSERT INTO group_reports (report_id, group_id, reporter_address, target_address, message_id, category, reason, status, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'open', ?)`,
    )
    .run(
      reportId,
      params.groupId,
      params.reporterAddress.toLowerCase(),
      params.targetAddress.toLowerCase(),
      params.category,
      params.reason,
      createdAt,
    );

  logger.info(`Member reported: ${reportId} target=${params.targetAddress} group=${params.groupId}`);

  return reportFromRow(
    db.raw.prepare("SELECT * FROM group_reports WHERE report_id = ?").get(reportId) as ReportRow,
  );
}

export function listGroupReports(
  db: OpenFoxDatabase,
  groupId: string,
  options?: { status?: ReportStatus; limit?: number },
): GroupReportRecord[] {
  const limit = options?.limit ?? 50;
  if (options?.status) {
    const rows = db.raw
      .prepare(
        `SELECT * FROM group_reports
         WHERE group_id = ? AND status = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(groupId, options.status, limit) as ReportRow[];
    return rows.map(reportFromRow);
  }
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_reports
       WHERE group_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(groupId, limit) as ReportRow[];
  return rows.map(reportFromRow);
}

export interface ResolveGroupReportParams {
  resolverAddress: string;
  resolution: ReportResolution;
  note?: string;
}

export async function resolveGroupReport(
  db: OpenFoxDatabase,
  reportId: string,
  params: ResolveGroupReportParams,
  account?: PrivateKeyAccount,
): Promise<GroupReportRecord> {
  const existing = db.raw
    .prepare("SELECT * FROM group_reports WHERE report_id = ?")
    .get(reportId) as ReportRow | undefined;
  if (!existing) {
    throw new Error(`Report not found: ${reportId}`);
  }
  if (existing.status !== "open") {
    throw new Error(`Report is already ${existing.status}: ${reportId}`);
  }

  const resolvedAt = nowIso();
  const resolverAddress = params.resolverAddress.toLowerCase();
  const finalStatus: ReportStatus = params.resolution === "dismiss" ? "dismissed" : "resolved";

  db.raw
    .prepare(
      `UPDATE group_reports
       SET status = ?, resolver_address = ?, resolution = ?, resolution_note = ?, resolved_at = ?
       WHERE report_id = ?`,
    )
    .run(finalStatus, resolverAddress, params.resolution, params.note ?? null, resolvedAt, reportId);

  // Apply action if resolution is not dismiss and we have an account + target
  if (params.resolution !== "dismiss" && account && existing.target_address) {
    try {
      if (params.resolution === "warn") {
        await issueGroupWarning(db, {
          groupId: existing.group_id,
          targetAddress: existing.target_address,
          issuerAddress: resolverAddress,
          reason: `Report resolution: ${params.note ?? existing.reason}`,
          severity: "mild",
        }, account);
      } else if (params.resolution === "mute") {
        const muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await muteGroupMember({
          db,
          account,
          input: {
            groupId: existing.group_id,
            targetAddress: existing.target_address,
            until: muteUntil,
            reason: `Report resolution: ${params.note ?? existing.reason}`,
            actorAddress: resolverAddress,
          },
        });
      } else if (params.resolution === "ban") {
        await banGroupMember({
          db,
          account,
          input: {
            groupId: existing.group_id,
            targetAddress: existing.target_address,
            reason: `Report resolution: ${params.note ?? existing.reason}`,
            actorAddress: resolverAddress,
          },
        });
      }
    } catch (err) {
      logger.warn(`Failed to apply report resolution action: ${(err as Error).message}`);
    }
  }

  logger.info(`Report resolved: ${reportId} resolution=${params.resolution}`);

  return reportFromRow(
    db.raw.prepare("SELECT * FROM group_reports WHERE report_id = ?").get(reportId) as ReportRow,
  );
}

// ─── Appeals ─────────────────────────────────────────────────────

export interface AppealGroupActionParams {
  groupId: string;
  appealerAddress: string;
  actionKind: AppealActionKind;
  reason: string;
}

export function appealGroupAction(
  db: OpenFoxDatabase,
  params: AppealGroupActionParams,
): GroupAppealRecord {
  const appealId = ulid();
  const createdAt = nowIso();

  db.raw
    .prepare(
      `INSERT INTO group_appeals (appeal_id, group_id, appealer_address, action_kind, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      appealId,
      params.groupId,
      params.appealerAddress.toLowerCase(),
      params.actionKind,
      params.reason,
      createdAt,
    );

  logger.info(`Appeal created: ${appealId} action=${params.actionKind} group=${params.groupId}`);

  return appealFromRow(
    db.raw.prepare("SELECT * FROM group_appeals WHERE appeal_id = ?").get(appealId) as AppealRow,
  );
}

export function listGroupAppeals(
  db: OpenFoxDatabase,
  groupId: string,
  options?: { status?: AppealStatus; limit?: number },
): GroupAppealRecord[] {
  const limit = options?.limit ?? 50;
  if (options?.status) {
    const rows = db.raw
      .prepare(
        `SELECT * FROM group_appeals
         WHERE group_id = ? AND status = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(groupId, options.status, limit) as AppealRow[];
    return rows.map(appealFromRow);
  }
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_appeals
       WHERE group_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(groupId, limit) as AppealRow[];
  return rows.map(appealFromRow);
}

export interface ResolveGroupAppealParams {
  resolverAddress: string;
  decision: AppealDecision;
  note?: string;
}

export async function resolveGroupAppeal(
  db: OpenFoxDatabase,
  appealId: string,
  params: ResolveGroupAppealParams,
  account?: PrivateKeyAccount,
): Promise<GroupAppealRecord> {
  const existing = db.raw
    .prepare("SELECT * FROM group_appeals WHERE appeal_id = ?")
    .get(appealId) as AppealRow | undefined;
  if (!existing) {
    throw new Error(`Appeal not found: ${appealId}`);
  }
  if (existing.status !== "pending") {
    throw new Error(`Appeal is already ${existing.status}: ${appealId}`);
  }

  const resolvedAt = nowIso();
  const resolverAddress = params.resolverAddress.toLowerCase();

  db.raw
    .prepare(
      `UPDATE group_appeals
       SET status = ?, resolver_address = ?, decision = ?, resolution_note = ?, resolved_at = ?
       WHERE appeal_id = ?`,
    )
    .run(params.decision, resolverAddress, params.decision, params.note ?? null, resolvedAt, appealId);

  // If approved, reverse the original action
  if (params.decision === "approved" && account) {
    try {
      if (existing.action_kind === "mute") {
        await unmuteGroupMember({
          db,
          account,
          input: {
            groupId: existing.group_id,
            targetAddress: existing.appealer_address,
            actorAddress: resolverAddress,
          },
        });
        logger.info(`Appeal approved - unmuted: ${existing.appealer_address}`);
      } else if (existing.action_kind === "ban") {
        await unbanGroupMember({
          db,
          account,
          input: {
            groupId: existing.group_id,
            targetAddress: existing.appealer_address,
            actorAddress: resolverAddress,
          },
        });
        logger.info(`Appeal approved - unbanned: ${existing.appealer_address}`);
      }
      // For warnings, there is no direct reversal - the appeal is simply approved
    } catch (err) {
      logger.warn(`Failed to reverse action for appeal ${appealId}: ${(err as Error).message}`);
    }
  }

  logger.info(`Appeal resolved: ${appealId} decision=${params.decision}`);

  return appealFromRow(
    db.raw.prepare("SELECT * FROM group_appeals WHERE appeal_id = ?").get(appealId) as AppealRow,
  );
}

// ─── Anti-Spam ───────────────────────────────────────────────────

export function setGroupRateLimitConfig(
  db: OpenFoxDatabase,
  groupId: string,
  config: { maxPerMinute?: number; maxPerHour?: number },
): GroupRateLimitConfig {
  const maxPerMinute = config.maxPerMinute ?? 10;
  const maxPerHour = config.maxPerHour ?? 100;

  db.raw
    .prepare(
      `INSERT INTO group_rate_limits (group_id, max_per_minute, max_per_hour)
       VALUES (?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET max_per_minute = excluded.max_per_minute, max_per_hour = excluded.max_per_hour`,
    )
    .run(groupId, maxPerMinute, maxPerHour);

  return { groupId, maxPerMinute, maxPerHour };
}

export function getGroupRateLimitConfig(
  db: OpenFoxDatabase,
  groupId: string,
): GroupRateLimitConfig {
  const row = db.raw
    .prepare("SELECT * FROM group_rate_limits WHERE group_id = ?")
    .get(groupId) as { group_id: string; max_per_minute: number; max_per_hour: number } | undefined;

  if (row) {
    return {
      groupId: row.group_id,
      maxPerMinute: row.max_per_minute,
      maxPerHour: row.max_per_hour,
    };
  }

  // Return defaults
  return { groupId, maxPerMinute: 10, maxPerHour: 100 };
}

export interface RateLimitCheckResult {
  limited: boolean;
  reason?: string;
  messagesInLastMinute: number;
  messagesInLastHour: number;
}

export function checkGroupRateLimit(
  db: OpenFoxDatabase,
  groupId: string,
  senderAddress: string,
): RateLimitCheckResult {
  const config = getGroupRateLimitConfig(db, groupId);
  const normalizedSender = senderAddress.toLowerCase();

  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const minuteCount = (
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM group_messages
         WHERE group_id = ? AND sender_address = ? AND created_at > ?`,
      )
      .get(groupId, normalizedSender, oneMinuteAgo) as { count: number }
  ).count;

  const hourCount = (
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM group_messages
         WHERE group_id = ? AND sender_address = ? AND created_at > ?`,
      )
      .get(groupId, normalizedSender, oneHourAgo) as { count: number }
  ).count;

  if (minuteCount >= config.maxPerMinute) {
    return {
      limited: true,
      reason: `Rate limited: ${minuteCount} messages in the last minute (max ${config.maxPerMinute})`,
      messagesInLastMinute: minuteCount,
      messagesInLastHour: hourCount,
    };
  }

  if (hourCount >= config.maxPerHour) {
    return {
      limited: true,
      reason: `Rate limited: ${hourCount} messages in the last hour (max ${config.maxPerHour})`,
      messagesInLastMinute: minuteCount,
      messagesInLastHour: hourCount,
    };
  }

  return {
    limited: false,
    messagesInLastMinute: minuteCount,
    messagesInLastHour: hourCount,
  };
}

// ─── Content Filtering ──────────────────────────────────────────

const REPEATED_CHAR_PATTERN = /(.)\1{9,}/;
const EXCESSIVE_CAPS_THRESHOLD = 0.7;
const MIN_LENGTH_FOR_CAPS_CHECK = 10;
const URL_PATTERN = /https?:\/\/\S+/gi;
const MAX_URLS_THRESHOLD = 5;

export function isGroupContentFiltered(content: string): boolean {
  if (!content || content.trim().length === 0) {
    return false;
  }

  // Check for repeated characters (e.g., "aaaaaaaaaa")
  if (REPEATED_CHAR_PATTERN.test(content)) {
    return true;
  }

  // Check for excessive caps (only for longer messages)
  if (content.length >= MIN_LENGTH_FOR_CAPS_CHECK) {
    const letters = content.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= MIN_LENGTH_FOR_CAPS_CHECK) {
      const upperCount = (letters.match(/[A-Z]/g) || []).length;
      if (upperCount / letters.length > EXCESSIVE_CAPS_THRESHOLD) {
        return true;
      }
    }
  }

  // Check for link spam (many URLs in a single message)
  const urls = content.match(URL_PATTERN);
  if (urls && urls.length >= MAX_URLS_THRESHOLD) {
    return true;
  }

  return false;
}
