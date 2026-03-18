/**
 * Agent Mail Tools
 *
 * Tool definitions for the agent loop to send, read, and search
 * P2P agent mail. Registered alongside intent tools.
 */

import type { OpenFoxTool, ToolContext } from "../types.js";
import {
  getMessage,
  listMessages,
  searchMessages,
  listThreads,
  getThread,
  updateStatus,
} from "../mail/store.js";
import { deliverMessage } from "../mail/client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("mail-tools");

export function createMailTools(): OpenFoxTool[] {
  return [
    // ── mail_send ─────────────────────────────────────────────────
    {
      name: "mail_send",
      description:
        "Send a P2P mail message to another agent. Resolves the recipient's agent card, delivers directly or via gateway relay, and stores a copy in sent folder.",
      category: "communication",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient agent address (0x...)",
          },
          subject: {
            type: "string",
            description: "Message subject",
          },
          body: {
            type: "string",
            description: "Message body (plaintext)",
          },
        },
        required: ["to", "subject", "body"],
      },
      execute: async (
        args: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<string> => {
        try {
          const to = args.to as string;
          const subject = args.subject as string;
          const body = args.body as string;

          const result = await deliverMessage({
            to: [to],
            subject,
            body,
            account: ctx.identity.account,
            fromAddress: ctx.identity.address,
            db: ctx.db,
            config: ctx.config,
          });

          const lines = [
            `Mail sent. Message ID: ${result.messageId}`,
            `Thread ID: ${result.threadId}`,
          ];
          for (const d of result.deliveries) {
            lines.push(`  ${d.recipient}: ${d.status}${d.reason ? ` (${d.reason})` : ""}`);
          }
          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`mail_send failed: ${message}`);
          return `Error sending mail: ${message}`;
        }
      },
    },

    // ── mail_inbox ────────────────────────────────────────────────
    {
      name: "mail_inbox",
      description:
        "List inbox messages. Returns subject, sender, and status for recent messages.",
      category: "communication",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max messages to return (default: 20)",
          },
          unread: {
            type: "boolean",
            description: "Only show unread messages",
          },
        },
      },
      execute: async (
        args: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<string> => {
        try {
          const limit = (args.limit as number) ?? 20;
          const unreadOnly = (args.unread as boolean) ?? false;

          const messages = listMessages(ctx.db, "inbox", {
            limit,
            unreadOnly,
          });

          if (messages.length === 0) {
            return "Inbox is empty.";
          }

          const lines = [`Inbox (${messages.length} messages):\n`];
          for (const msg of messages) {
            const flag = msg.status === "unread" ? "[NEW]" : "     ";
            const ts = new Date(msg.sentAt * 1000).toISOString();
            lines.push(
              `${flag} ${msg.id} | From: ${msg.from} | ${msg.subject} | ${ts}`,
            );
          }
          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error listing inbox: ${message}`;
        }
      },
    },

    // ── mail_read ─────────────────────────────────────────────────
    {
      name: "mail_read",
      description:
        "Read a specific mail message by ID. Marks the message as read.",
      category: "communication",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description: "The message ID to read",
          },
        },
        required: ["messageId"],
      },
      execute: async (
        args: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<string> => {
        try {
          const messageId = args.messageId as string;
          const msg = getMessage(ctx.db, messageId);

          if (!msg) {
            return `Message ${messageId} not found.`;
          }

          // Mark as read
          if (msg.status === "unread") {
            updateStatus(ctx.db, messageId, "read");
          }

          const lines = [
            `ID: ${msg.id}`,
            `Thread: ${msg.threadId}`,
            `From: ${msg.from}`,
            `To: ${msg.to.join(", ")}`,
            msg.cc ? `Cc: ${msg.cc.join(", ")}` : null,
            `Subject: ${msg.subject}`,
            `Sent: ${new Date(msg.sentAt * 1000).toISOString()}`,
            `Folder: ${msg.folder}`,
            `Status: ${msg.status}`,
            msg.inReplyTo ? `In-Reply-To: ${msg.inReplyTo}` : null,
            "",
            msg.body,
          ].filter((l) => l !== null);

          if (msg.attachments && msg.attachments.length > 0) {
            lines.push("", "Attachments:");
            for (const att of msg.attachments) {
              lines.push(`  ${att.name} (${att.mime_type}, ${att.size_bytes} bytes)`);
            }
          }

          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error reading message: ${message}`;
        }
      },
    },

    // ── mail_search ───────────────────────────────────────────────
    {
      name: "mail_search",
      description:
        "Search mail messages by query text, sender address, or subject.",
      category: "communication",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search in subject and body",
          },
          from: {
            type: "string",
            description: "Filter by sender address",
          },
          limit: {
            type: "number",
            description: "Max results (default: 20)",
          },
        },
      },
      execute: async (
        args: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<string> => {
        try {
          const messages = searchMessages(ctx.db, {
            query: args.query as string | undefined,
            from: args.from as string | undefined,
            limit: (args.limit as number) ?? 20,
          });

          if (messages.length === 0) {
            return "No messages found.";
          }

          const lines = [`Search results (${messages.length}):\n`];
          for (const msg of messages) {
            const ts = new Date(msg.sentAt * 1000).toISOString();
            lines.push(
              `${msg.id} | ${msg.folder} | From: ${msg.from} | ${msg.subject} | ${ts}`,
            );
          }
          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error searching mail: ${message}`;
        }
      },
    },

    // ── mail_reply ────────────────────────────────────────────────
    {
      name: "mail_reply",
      description:
        "Reply to a mail message. Automatically threads the reply and sends to the original sender.",
      category: "communication",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description: "The message ID to reply to",
          },
          body: {
            type: "string",
            description: "Reply body (plaintext)",
          },
        },
        required: ["messageId", "body"],
      },
      execute: async (
        args: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<string> => {
        try {
          const messageId = args.messageId as string;
          const body = args.body as string;

          const original = getMessage(ctx.db, messageId);
          if (!original) {
            return `Message ${messageId} not found.`;
          }

          const result = await deliverMessage({
            to: [original.from],
            subject: original.subject.startsWith("Re: ")
              ? original.subject
              : `Re: ${original.subject}`,
            body,
            inReplyTo: messageId,
            account: ctx.identity.account,
            fromAddress: ctx.identity.address,
            db: ctx.db,
            config: ctx.config,
          });

          const lines = [
            `Reply sent. Message ID: ${result.messageId}`,
            `Thread ID: ${result.threadId}`,
          ];
          for (const d of result.deliveries) {
            lines.push(`  ${d.recipient}: ${d.status}${d.reason ? ` (${d.reason})` : ""}`);
          }
          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`mail_reply failed: ${message}`);
          return `Error replying to mail: ${message}`;
        }
      },
    },

    // ── mail_threads ──────────────────────────────────────────────
    {
      name: "mail_threads",
      description:
        "List conversation threads with participant counts and last activity.",
      category: "communication",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max threads to return (default: 20)",
          },
        },
      },
      execute: async (
        args: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<string> => {
        try {
          const limit = (args.limit as number) ?? 20;
          const threads = listThreads(ctx.db, { limit });

          if (threads.length === 0) {
            return "No threads found.";
          }

          const lines = [`Threads (${threads.length}):\n`];
          for (const t of threads) {
            const unread = t.unreadCount > 0 ? ` [${t.unreadCount} unread]` : "";
            lines.push(
              `${t.id} | ${t.subject} | ${t.messageCount} msgs | ${t.participants.length} participants${unread} | Last: ${t.lastMessageAt}`,
            );
          }
          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error listing threads: ${message}`;
        }
      },
    },
  ];
}
