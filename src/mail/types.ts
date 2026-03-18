/**
 * P2P Agent Mail — Domain Types
 *
 * Types for peer-to-peer agent mail within the openfox ecosystem.
 * Messages are E2E encrypted using SECP256K1-AES256GCM and delivered
 * directly or via gateway relay.
 */

import type { AgentGatewayEncryptedEnvelope } from "../agent-gateway/e2e.js";

// ─── Enums ────────────────────────────────────────────────────────

export type MailFolder = "inbox" | "sent" | "drafts" | "trash" | "archive";
export type MailStatus = "unread" | "read" | "flagged";

// ─── Core Types ───────────────────────────────────────────────────

export interface MailAttachment {
  name: string;
  mime_type: string;
  size_bytes: number;
  data_base64: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  inReplyTo?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  folder: MailFolder;
  status: MailStatus;
  signature: `0x${string}`;
  sentAt: number;
  receivedAt: number;
  attachments?: MailAttachment[];
}

// ─── Delivery Protocol ────────────────────────────────────────────

export interface MailDeliveryRequest {
  version: 1;
  message: {
    id: string;
    thread_id: string;
    in_reply_to?: string;
    from: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    body_html?: string;
    sent_at: number;
    attachments?: MailAttachment[];
  };
  sender_signature: `0x${string}`;
  encrypted_envelope?: AgentGatewayEncryptedEnvelope;
}

export interface MailDeliveryResponse {
  status: "accepted" | "rejected" | "rate_limited";
  message_id: string;
  reason?: string;
}

// ─── Thread Summary ───────────────────────────────────────────────

export interface MailThreadSummary {
  id: string;
  subject: string;
  participants: string[];
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
}

// ─── Folder Summary ───────────────────────────────────────────────

export interface MailFolderSummary {
  folder: MailFolder;
  total: number;
  unread: number;
}

// ─── Query Options ────────────────────────────────────────────────

export interface MailListOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface MailSearchOptions {
  query?: string;
  from?: string;
  limit?: number;
}
