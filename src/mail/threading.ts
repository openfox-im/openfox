/**
 * P2P Agent Mail — Thread Management
 *
 * Resolves and maintains conversation threads.
 */

import type { OpenFoxDatabase } from "../types.js";
import type { MailMessage } from "./types.js";
import { ulid } from "ulid";

interface MailMessageRow {
  thread_id: string;
}

interface CountRow {
  count: number;
}

/**
 * Resolve the thread ID for a new message. If `inReplyTo` is provided and
 * the referenced message exists, reuse its thread. Otherwise create a new
 * thread ID.
 */
export function resolveThreadId(
  db: OpenFoxDatabase,
  inReplyTo?: string,
): string {
  if (inReplyTo) {
    const row = db.raw
      .prepare("SELECT thread_id FROM mail_messages WHERE id = ?")
      .get(inReplyTo) as MailMessageRow | undefined;
    if (row) {
      return row.thread_id;
    }
  }
  return ulid();
}

/**
 * Upsert thread summary after inserting a message.
 */
export function updateThreadSummary(
  db: OpenFoxDatabase,
  threadId: string,
  msg: MailMessage,
): void {
  // Collect all participants across the thread
  const participantSet = new Set<string>();
  const rows = db.raw
    .prepare(
      "SELECT from_address, to_addresses, cc_addresses FROM mail_messages WHERE thread_id = ?",
    )
    .all(threadId) as Array<{
    from_address: string;
    to_addresses: string;
    cc_addresses: string;
  }>;

  for (const row of rows) {
    participantSet.add(row.from_address);
    const toAddrs: string[] = JSON.parse(row.to_addresses);
    for (const addr of toAddrs) participantSet.add(addr);
    if (row.cc_addresses) {
      const ccAddrs: string[] = JSON.parse(row.cc_addresses);
      for (const addr of ccAddrs) participantSet.add(addr);
    }
  }

  const messageCount = rows.length;
  const unreadRow = db.raw
    .prepare(
      "SELECT COUNT(*) as count FROM mail_messages WHERE thread_id = ? AND status = 'unread'",
    )
    .get(threadId) as CountRow;

  const participants = JSON.stringify([...participantSet]);
  const subject = msg.subject || "";
  const now = new Date().toISOString();
  const sentAt = new Date(msg.sentAt * 1000).toISOString();

  // Upsert
  const existing = db.raw
    .prepare("SELECT id FROM mail_threads WHERE id = ?")
    .get(threadId) as { id: string } | undefined;

  if (existing) {
    db.raw
      .prepare(
        `UPDATE mail_threads SET
          participants = ?,
          message_count = ?,
          unread_count = ?,
          last_message_at = ?
        WHERE id = ?`,
      )
      .run(participants, messageCount, unreadRow.count, sentAt, threadId);
  } else {
    db.raw
      .prepare(
        `INSERT INTO mail_threads (id, subject, participants, message_count, unread_count, last_message_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        subject,
        participants,
        messageCount,
        unreadRow.count,
        sentAt,
        now,
      );
  }
}
