/**
 * Mail CLI Commands
 *
 * P2P Agent Mail: Send, receive, and manage encrypted mail messages.
 *
 * Usage:
 *   openfox mail inbox [--limit N] [--unread]
 *   openfox mail sent [--limit N]
 *   openfox mail read <messageId>
 *   openfox mail send --to <address> --subject <subj> --body <body>
 *   openfox mail reply <messageId> --body <body>
 *   openfox mail search --query <text> [--from <addr>] [--limit N]
 *   openfox mail threads [--limit N]
 *   openfox mail folders
 *   openfox mail move <messageId> --folder <name>
 *   openfox mail delete <messageId>
 */

import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  listMessages,
  getMessage,
  searchMessages,
  listThreads,
  getFolderSummaries,
  moveToFolder,
  deleteMessage,
  updateStatus,
} from "../mail/store.js";
import { deliverMessage } from "../mail/client.js";
import type { MailFolder } from "../mail/types.js";

const logger = createLogger("mail");

export async function handleMailCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (
    !subcommand ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    subcommand === "help"
  ) {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "inbox":
      return handleInbox(args.slice(1));
    case "sent":
      return handleSent(args.slice(1));
    case "read":
      return handleRead(args.slice(1));
    case "send":
      return handleSend(args.slice(1));
    case "reply":
      return handleReply(args.slice(1));
    case "search":
      return handleSearch(args.slice(1));
    case "threads":
      return handleThreads(args.slice(1));
    case "folders":
      return handleFolders();
    case "move":
      return handleMove(args.slice(1));
    case "delete":
      return handleDelete(args.slice(1));
    default:
      logger.error(`Unknown mail subcommand: ${subcommand}`);
      printUsage();
  }
}

// ── inbox ──────────────────────────────────────────────────────────

async function handleInbox(args: string[]): Promise<void> {
  const limit = parseInt(parseFlag(args, "--limit", "20"), 10);
  const unreadOnly = args.includes("--unread");

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const messages = listMessages(db, "inbox", { limit, unreadOnly });

    if (messages.length === 0) {
      logger.info("Inbox is empty.");
      return;
    }

    logger.info(`Inbox (${messages.length} messages):\n`);
    for (const msg of messages) {
      const flag = msg.status === "unread" ? "[NEW]" : "     ";
      const ts = new Date(msg.sentAt * 1000).toISOString();
      logger.info(`${flag} ${msg.id} | From: ${msg.from} | ${msg.subject} | ${ts}`);
    }
  } finally {
    db.close();
  }
}

// ── sent ───────────────────────────────────────────────────────────

async function handleSent(args: string[]): Promise<void> {
  const limit = parseInt(parseFlag(args, "--limit", "20"), 10);

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const messages = listMessages(db, "sent", { limit });

    if (messages.length === 0) {
      logger.info("Sent folder is empty.");
      return;
    }

    logger.info(`Sent (${messages.length} messages):\n`);
    for (const msg of messages) {
      const ts = new Date(msg.sentAt * 1000).toISOString();
      logger.info(`${msg.id} | To: ${msg.to.join(", ")} | ${msg.subject} | ${ts}`);
    }
  } finally {
    db.close();
  }
}

// ── read ───────────────────────────────────────────────────────────

async function handleRead(args: string[]): Promise<void> {
  const messageId = args[0];
  if (!messageId) {
    logger.error("Usage: openfox mail read <messageId>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const msg = getMessage(db, messageId);
    if (!msg) {
      logger.error(`Message ${messageId} not found.`);
      return;
    }

    // Mark as read
    if (msg.status === "unread") {
      updateStatus(db, messageId, "read");
    }

    logger.info(`ID: ${msg.id}`);
    logger.info(`Thread: ${msg.threadId}`);
    logger.info(`From: ${msg.from}`);
    logger.info(`To: ${msg.to.join(", ")}`);
    if (msg.cc) logger.info(`Cc: ${msg.cc.join(", ")}`);
    logger.info(`Subject: ${msg.subject}`);
    logger.info(`Sent: ${new Date(msg.sentAt * 1000).toISOString()}`);
    logger.info(`Folder: ${msg.folder}`);
    logger.info(`Status: ${msg.status}`);
    if (msg.inReplyTo) logger.info(`In-Reply-To: ${msg.inReplyTo}`);
    logger.info("");
    logger.info(msg.body);

    if (msg.attachments && msg.attachments.length > 0) {
      logger.info("\nAttachments:");
      for (const att of msg.attachments) {
        logger.info(`  ${att.name} (${att.mime_type}, ${att.size_bytes} bytes)`);
      }
    }
  } finally {
    db.close();
  }
}

// ── send ───────────────────────────────────────────────────────────

async function handleSend(args: string[]): Promise<void> {
  const to = parseFlag(args, "--to", "");
  const subject = parseFlag(args, "--subject", "");
  const body = parseFlag(args, "--body", "");

  if (!to || !subject || !body) {
    logger.error(
      "Usage: openfox mail send --to <address> --subject <subj> --body <body>",
    );
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    // Load wallet for signing
    const walletRaw = db.getKV("wallet");
    if (!walletRaw) {
      logger.error("No wallet configured. Run openfox onboard first.");
      return;
    }
    const wallet = JSON.parse(walletRaw) as { privateKey: `0x${string}` };

    // Create a minimal account for signing
    const { privateKeyToAccount } = await import("tosdk");
    const account = privateKeyToAccount(wallet.privateKey);

    const result = await deliverMessage({
      to: [to],
      subject,
      body,
      account,
      fromAddress: account.address,
      db,
      config,
    });

    logger.info(`Mail sent. Message ID: ${result.messageId}`);
    logger.info(`Thread ID: ${result.threadId}`);
    for (const d of result.deliveries) {
      logger.info(`  ${d.recipient}: ${d.status}${d.reason ? ` (${d.reason})` : ""}`);
    }
  } finally {
    db.close();
  }
}

// ── reply ──────────────────────────────────────────────────────────

async function handleReply(args: string[]): Promise<void> {
  const messageId = args[0];
  const body = parseFlag(args, "--body", "");

  if (!messageId || !body) {
    logger.error("Usage: openfox mail reply <messageId> --body <body>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const original = getMessage(db, messageId);
    if (!original) {
      logger.error(`Message ${messageId} not found.`);
      return;
    }

    const walletRaw = db.getKV("wallet");
    if (!walletRaw) {
      logger.error("No wallet configured. Run openfox onboard first.");
      return;
    }
    const wallet = JSON.parse(walletRaw) as { privateKey: `0x${string}` };
    const { privateKeyToAccount } = await import("tosdk");
    const account = privateKeyToAccount(wallet.privateKey);

    const result = await deliverMessage({
      to: [original.from],
      subject: original.subject.startsWith("Re: ")
        ? original.subject
        : `Re: ${original.subject}`,
      body,
      inReplyTo: messageId,
      account,
      fromAddress: account.address,
      db,
      config,
    });

    logger.info(`Reply sent. Message ID: ${result.messageId}`);
    logger.info(`Thread ID: ${result.threadId}`);
    for (const d of result.deliveries) {
      logger.info(`  ${d.recipient}: ${d.status}${d.reason ? ` (${d.reason})` : ""}`);
    }
  } finally {
    db.close();
  }
}

// ── search ─────────────────────────────────────────────────────────

async function handleSearch(args: string[]): Promise<void> {
  const query = parseFlag(args, "--query", "");
  const from = parseFlag(args, "--from", "");
  const limit = parseInt(parseFlag(args, "--limit", "20"), 10);

  if (!query && !from) {
    logger.error(
      "Usage: openfox mail search --query <text> [--from <addr>] [--limit N]",
    );
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const messages = searchMessages(db, {
      query: query || undefined,
      from: from || undefined,
      limit,
    });

    if (messages.length === 0) {
      logger.info("No messages found.");
      return;
    }

    logger.info(`Search results (${messages.length}):\n`);
    for (const msg of messages) {
      const ts = new Date(msg.sentAt * 1000).toISOString();
      logger.info(
        `${msg.id} | ${msg.folder} | From: ${msg.from} | ${msg.subject} | ${ts}`,
      );
    }
  } finally {
    db.close();
  }
}

// ── threads ────────────────────────────────────────────────────────

async function handleThreads(args: string[]): Promise<void> {
  const limit = parseInt(parseFlag(args, "--limit", "20"), 10);

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const threads = listThreads(db, { limit });

    if (threads.length === 0) {
      logger.info("No threads found.");
      return;
    }

    logger.info(`Threads (${threads.length}):\n`);
    for (const t of threads) {
      const unread = t.unreadCount > 0 ? ` [${t.unreadCount} unread]` : "";
      logger.info(
        `${t.id} | ${t.subject} | ${t.messageCount} msgs | ${t.participants.length} participants${unread} | Last: ${t.lastMessageAt}`,
      );
    }
  } finally {
    db.close();
  }
}

// ── folders ────────────────────────────────────────────────────────

async function handleFolders(): Promise<void> {
  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const summaries = getFolderSummaries(db);

    logger.info("Mail Folders:\n");
    for (const s of summaries) {
      const unread = s.unread > 0 ? ` (${s.unread} unread)` : "";
      logger.info(`  ${s.folder.padEnd(10)} ${s.total} messages${unread}`);
    }
  } finally {
    db.close();
  }
}

// ── move ───────────────────────────────────────────────────────────

async function handleMove(args: string[]): Promise<void> {
  const messageId = args[0];
  const folder = parseFlag(args, "--folder", "") as MailFolder;

  if (!messageId || !folder) {
    logger.error("Usage: openfox mail move <messageId> --folder <name>");
    return;
  }

  const validFolders: MailFolder[] = ["inbox", "sent", "drafts", "trash", "archive"];
  if (!validFolders.includes(folder)) {
    logger.error(`Invalid folder. Choose from: ${validFolders.join(", ")}`);
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const msg = getMessage(db, messageId);
    if (!msg) {
      logger.error(`Message ${messageId} not found.`);
      return;
    }

    moveToFolder(db, messageId, folder);
    logger.info(`Moved message ${messageId} to ${folder}.`);
  } finally {
    db.close();
  }
}

// ── delete ─────────────────────────────────────────────────────────

async function handleDelete(args: string[]): Promise<void> {
  const messageId = args[0];
  if (!messageId) {
    logger.error("Usage: openfox mail delete <messageId>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const msg = getMessage(db, messageId);
    if (!msg) {
      logger.error(`Message ${messageId} not found.`);
      return;
    }

    deleteMessage(db, messageId);
    if (msg.folder === "trash") {
      logger.info(`Permanently deleted message ${messageId}.`);
    } else {
      logger.info(`Moved message ${messageId} to trash.`);
    }
  } finally {
    db.close();
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function printUsage(): void {
  logger.info(`
OpenFox P2P Agent Mail

Usage:
  openfox mail inbox [--limit N] [--unread]
  openfox mail sent [--limit N]
  openfox mail read <messageId>
  openfox mail send --to <address> --subject <subj> --body <body>
  openfox mail reply <messageId> --body <body>
  openfox mail search --query <text> [--from <addr>] [--limit N]
  openfox mail threads [--limit N]
  openfox mail folders
  openfox mail move <messageId> --folder <name>
  openfox mail delete <messageId>

Subcommands:
  inbox      List inbox messages
  sent       List sent messages
  read       Read a specific message (marks as read)
  send       Send a new mail message to an agent
  reply      Reply to a message (auto-threads)
  search     Search messages by text or sender
  threads    List conversation threads
  folders    Show folder summaries with unread counts
  move       Move a message to a different folder
  delete     Delete a message (trash, or permanent from trash)
`);
}

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    return null;
  }
  return config;
}

function parseFlag(args: string[], flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1]!;
  }
  return defaultValue;
}
