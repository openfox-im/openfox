/**
 * P2P Agent Mail — SQLite Storage
 *
 * Local mail storage backed by the openfox SQLite database.
 */

import type { OpenFoxDatabase } from "../types.js";
import type {
  MailMessage,
  MailFolder,
  MailStatus,
  MailListOptions,
  MailSearchOptions,
  MailThreadSummary,
  MailFolderSummary,
  MailAttachment,
} from "./types.js";

// ─── Row types (SQLite shape) ─────────────────────────────────────

interface MailMessageRow {
  id: string;
  thread_id: string;
  in_reply_to: string | null;
  from_address: string;
  to_addresses: string;
  cc_addresses: string;
  subject: string;
  body: string;
  body_html: string | null;
  folder: string;
  status: string;
  sender_signature: string;
  has_attachments: number;
  attachments_json: string;
  size_bytes: number;
  sent_at: string;
  received_at: string;
  created_at: string;
}

interface MailThreadRow {
  id: string;
  subject: string;
  participants: string;
  message_count: number;
  unread_count: number;
  last_message_at: string;
  created_at: string;
}

interface CountRow {
  count: number;
}

// ─── Conversions ──────────────────────────────────────────────────

function rowToMessage(row: MailMessageRow): MailMessage {
  const attachments: MailAttachment[] = row.attachments_json
    ? JSON.parse(row.attachments_json)
    : [];
  return {
    id: row.id,
    threadId: row.thread_id,
    inReplyTo: row.in_reply_to ?? undefined,
    from: row.from_address,
    to: JSON.parse(row.to_addresses),
    cc: row.cc_addresses ? JSON.parse(row.cc_addresses) : undefined,
    subject: row.subject,
    body: row.body,
    bodyHtml: row.body_html ?? undefined,
    folder: row.folder as MailFolder,
    status: row.status as MailStatus,
    signature: row.sender_signature as `0x${string}`,
    sentAt: Math.floor(new Date(row.sent_at).getTime() / 1000),
    receivedAt: Math.floor(new Date(row.received_at).getTime() / 1000),
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function rowToThread(row: MailThreadRow): MailThreadSummary {
  return {
    id: row.id,
    subject: row.subject,
    participants: JSON.parse(row.participants),
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

// ─── Store ────────────────────────────────────────────────────────

export function insertMessage(db: OpenFoxDatabase, msg: MailMessage): void {
  const attachments = msg.attachments ?? [];
  const attachmentsJson = JSON.stringify(attachments);
  const toJson = JSON.stringify(msg.to);
  const ccJson = JSON.stringify(msg.cc ?? []);
  const sizeBytes =
    Buffer.byteLength(msg.subject, "utf-8") +
    Buffer.byteLength(msg.body, "utf-8") +
    attachments.reduce((sum, a) => sum + a.size_bytes, 0);

  db.raw
    .prepare(
      `INSERT INTO mail_messages (
        id, thread_id, in_reply_to, from_address, to_addresses, cc_addresses,
        subject, body, body_html, folder, status, sender_signature,
        has_attachments, attachments_json, size_bytes, sent_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))`,
    )
    .run(
      msg.id,
      msg.threadId,
      msg.inReplyTo ?? null,
      msg.from,
      toJson,
      ccJson,
      msg.subject,
      msg.body,
      msg.bodyHtml ?? null,
      msg.folder,
      msg.status,
      msg.signature,
      attachments.length > 0 ? 1 : 0,
      attachmentsJson,
      sizeBytes,
      msg.sentAt,
      msg.receivedAt,
    );
}

export function getMessage(
  db: OpenFoxDatabase,
  id: string,
): MailMessage | undefined {
  const row = db.raw
    .prepare("SELECT * FROM mail_messages WHERE id = ?")
    .get(id) as MailMessageRow | undefined;
  return row ? rowToMessage(row) : undefined;
}

export function listMessages(
  db: OpenFoxDatabase,
  folder: MailFolder,
  opts?: MailListOptions,
): MailMessage[] {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  if (opts?.unreadOnly) {
    const rows = db.raw
      .prepare(
        "SELECT * FROM mail_messages WHERE folder = ? AND status = 'unread' ORDER BY received_at DESC LIMIT ? OFFSET ?",
      )
      .all(folder, limit, offset) as MailMessageRow[];
    return rows.map(rowToMessage);
  }

  const rows = db.raw
    .prepare(
      "SELECT * FROM mail_messages WHERE folder = ? ORDER BY received_at DESC LIMIT ? OFFSET ?",
    )
    .all(folder, limit, offset) as MailMessageRow[];
  return rows.map(rowToMessage);
}

export function searchMessages(
  db: OpenFoxDatabase,
  opts: MailSearchOptions,
): MailMessage[] {
  const limit = opts.limit ?? 50;
  const conditions: string[] = ["folder != 'trash'"];
  const params: unknown[] = [];

  if (opts.query) {
    conditions.push("(subject LIKE ? OR body LIKE ?)");
    const like = `%${opts.query}%`;
    params.push(like, like);
  }
  if (opts.from) {
    conditions.push("from_address = ?");
    params.push(opts.from.toLowerCase());
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = db.raw
    .prepare(
      `SELECT * FROM mail_messages ${where} ORDER BY received_at DESC LIMIT ?`,
    )
    .all(...params) as MailMessageRow[];
  return rows.map(rowToMessage);
}

export function getThread(
  db: OpenFoxDatabase,
  threadId: string,
): MailMessage[] {
  const rows = db.raw
    .prepare(
      "SELECT * FROM mail_messages WHERE thread_id = ? ORDER BY sent_at ASC",
    )
    .all(threadId) as MailMessageRow[];
  return rows.map(rowToMessage);
}

export function listThreads(
  db: OpenFoxDatabase,
  opts?: MailListOptions,
): MailThreadSummary[] {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const rows = db.raw
    .prepare(
      "SELECT * FROM mail_threads ORDER BY last_message_at DESC LIMIT ? OFFSET ?",
    )
    .all(limit, offset) as MailThreadRow[];
  return rows.map(rowToThread);
}

export function updateStatus(
  db: OpenFoxDatabase,
  id: string,
  status: MailStatus,
): void {
  db.raw
    .prepare("UPDATE mail_messages SET status = ? WHERE id = ?")
    .run(status, id);

  // Update thread unread count
  const msg = getMessage(db, id);
  if (msg) {
    recalculateThreadUnread(db, msg.threadId);
  }
}

export function moveToFolder(
  db: OpenFoxDatabase,
  id: string,
  folder: MailFolder,
): void {
  db.raw
    .prepare("UPDATE mail_messages SET folder = ? WHERE id = ?")
    .run(folder, id);
}

export function deleteMessage(db: OpenFoxDatabase, id: string): void {
  const msg = getMessage(db, id);
  if (!msg) return;

  if (msg.folder === "trash") {
    // Hard delete from trash
    db.raw.prepare("DELETE FROM mail_messages WHERE id = ?").run(id);
  } else {
    // Soft delete: move to trash
    moveToFolder(db, id, "trash");
  }

  // Recalculate thread
  if (msg.threadId) {
    recalculateThreadUnread(db, msg.threadId);
  }
}

export function getUnreadCount(
  db: OpenFoxDatabase,
  folder?: MailFolder,
): number {
  if (folder) {
    const row = db.raw
      .prepare(
        "SELECT COUNT(*) as count FROM mail_messages WHERE folder = ? AND status = 'unread'",
      )
      .get(folder) as CountRow;
    return row.count;
  }
  const row = db.raw
    .prepare(
      "SELECT COUNT(*) as count FROM mail_messages WHERE status = 'unread' AND folder != 'trash'",
    )
    .get() as CountRow;
  return row.count;
}

export function getFolderSummaries(db: OpenFoxDatabase): MailFolderSummary[] {
  const folders: MailFolder[] = ["inbox", "sent", "drafts", "trash", "archive"];
  return folders.map((folder) => {
    const totalRow = db.raw
      .prepare(
        "SELECT COUNT(*) as count FROM mail_messages WHERE folder = ?",
      )
      .get(folder) as CountRow;
    const unreadRow = db.raw
      .prepare(
        "SELECT COUNT(*) as count FROM mail_messages WHERE folder = ? AND status = 'unread'",
      )
      .get(folder) as CountRow;
    return {
      folder,
      total: totalRow.count,
      unread: unreadRow.count,
    };
  });
}

// ─── Internal Helpers ─────────────────────────────────────────────

function recalculateThreadUnread(
  db: OpenFoxDatabase,
  threadId: string,
): void {
  const row = db.raw
    .prepare(
      "SELECT COUNT(*) as count FROM mail_messages WHERE thread_id = ? AND status = 'unread'",
    )
    .get(threadId) as CountRow;
  db.raw
    .prepare("UPDATE mail_threads SET unread_count = ? WHERE id = ?")
    .run(row.count, threadId);
}
