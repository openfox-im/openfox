/**
 * P2P Agent Mail — Client (Send Side)
 *
 * Resolves recipient mail endpoints from agent cards and delivers
 * messages via HTTP POST. Supports E2E encryption when the recipient
 * publishes a relay_encryption_pubkey.
 */

import { ulid } from "ulid";
import type { PrivateKeyAccount } from "tosdk";
import { createLogger } from "../observability/logger.js";
import {
  validateHttpTargetUrl,
} from "../agent-discovery/http-fetch.js";
import {
  encryptAgentGatewayPayload,
} from "../agent-gateway/e2e.js";
import type { OpenFoxDatabase, OpenFoxConfig } from "../types.js";
import type {
  MailDeliveryRequest,
  MailDeliveryResponse,
  MailMessage,
  MailAttachment,
} from "./types.js";
import { insertMessage } from "./store.js";
import { resolveThreadId, updateThreadSummary } from "./threading.js";
import { isTnsName, resolveMailAddresses } from "./tns.js";

const logger = createLogger("mail.client");

// ─── Agent Card Lookup ────────────────────────────────────────────

interface ResolvedMailEndpoint {
  url: string;
  recipientPubkey?: `0x${string}`;
}

/**
 * Resolve mail endpoint for a recipient by looking up their agent card
 * in the local discovery cache. Returns the endpoint URL and optional
 * encryption pubkey.
 */
export function resolveMailEndpoint(
  db: OpenFoxDatabase,
  recipientAddress: string,
): ResolvedMailEndpoint | undefined {
  // Look up cached agent card for the recipient
  const row = db.raw
    .prepare(
      "SELECT card_json FROM agent_discovery_cards WHERE agent_id = ? OR LOWER(agent_id) = LOWER(?)",
    )
    .get(recipientAddress, recipientAddress) as
    | { card_json: string }
    | undefined;

  if (!row) return undefined;

  try {
    const card = JSON.parse(row.card_json);

    // Check for "mail" capability
    const hasMailCapability = card.capabilities?.some(
      (c: { name: string }) => c.name === "mail",
    );
    if (!hasMailCapability) return undefined;

    // Find mail endpoint
    const mailEndpoint = card.endpoints?.find(
      (e: { role?: string }) => e.role === "mail",
    );
    if (!mailEndpoint?.url) return undefined;

    return {
      url: mailEndpoint.url,
      recipientPubkey: card.relay_encryption_pubkey,
    };
  } catch {
    return undefined;
  }
}

// ─── Message Signing ──────────────────────────────────────────────

function canonicalizeMailMessage(
  msg: MailDeliveryRequest["message"],
): string {
  // Sort keys for deterministic serialization
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(msg).sort()) {
    const value = (msg as Record<string, unknown>)[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

// ─── Delivery ─────────────────────────────────────────────────────

export interface DeliverMessageParams {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  attachments?: MailAttachment[];
  account: PrivateKeyAccount;
  fromAddress: string;
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
}

export interface DeliverMessageResult {
  messageId: string;
  threadId: string;
  deliveries: Array<{
    recipient: string;
    status: "delivered" | "stored_locally" | "failed";
    reason?: string;
  }>;
}

/**
 * Build, sign, and deliver a mail message to all recipients.
 * Falls back to local storage when the recipient's endpoint is unreachable.
 */
export async function deliverMessage(
  params: DeliverMessageParams,
): Promise<DeliverMessageResult> {
  const {
    to,
    cc,
    subject,
    body,
    bodyHtml,
    inReplyTo,
    attachments,
    account,
    fromAddress,
    db,
    config,
  } = params;

  // Resolve TNS names (e.g. "alice@tos.network") to 0x addresses
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;
  const hasTnsNames = [...to, ...(cc ?? [])].some(isTnsName);
  let resolvedTo = to;
  let resolvedCc = cc;
  if (hasTnsNames) {
    const toResult = await resolveMailAddresses(to, rpcUrl);
    if (toResult.errors.length > 0) {
      logger.warn(`Could not resolve TNS names: ${toResult.errors.join(", ")}`);
    }
    resolvedTo = toResult.resolved;
    if (cc && cc.length > 0) {
      const ccResult = await resolveMailAddresses(cc, rpcUrl);
      resolvedCc = ccResult.resolved;
    }
    if (resolvedTo.length === 0) {
      return {
        messageId: "",
        threadId: "",
        deliveries: to.map((r) => ({
          recipient: r,
          status: "failed" as const,
          reason: "TNS name could not be resolved",
        })),
      };
    }
  }

  const messageId = ulid();
  const threadId = resolveThreadId(db, inReplyTo);
  const sentAt = Math.floor(Date.now() / 1000);

  // Build protocol message
  const messagePayload: MailDeliveryRequest["message"] = {
    id: messageId,
    thread_id: threadId,
    in_reply_to: inReplyTo,
    from: fromAddress.toLowerCase(),
    to: resolvedTo.map((a) => a.toLowerCase()),
    cc: resolvedCc?.map((a) => a.toLowerCase()),
    subject,
    body,
    body_html: bodyHtml,
    sent_at: sentAt,
    attachments,
  };

  // Sign with EIP-191
  const canonical = canonicalizeMailMessage(messagePayload);
  const signature = await account.signMessage({ message: canonical });

  // Store in sent folder locally
  const localMsg: MailMessage = {
    id: messageId,
    threadId,
    inReplyTo,
    from: fromAddress.toLowerCase(),
    to: resolvedTo.map((a) => a.toLowerCase()),
    cc: resolvedCc?.map((a) => a.toLowerCase()),
    subject,
    body,
    bodyHtml,
    folder: "sent",
    status: "read",
    signature: signature as `0x${string}`,
    sentAt,
    receivedAt: sentAt,
    attachments,
  };
  insertMessage(db, localMsg);
  updateThreadSummary(db, threadId, localMsg);

  // Deliver to each recipient
  const deliveries: DeliverMessageResult["deliveries"] = [];
  const allRecipients = [...resolvedTo, ...(resolvedCc ?? [])];

  for (const recipient of allRecipients) {
    const endpoint = resolveMailEndpoint(db, recipient);

    if (!endpoint) {
      // No known endpoint — store locally for the recipient if they're us
      deliveries.push({
        recipient,
        status: "stored_locally",
        reason: "no mail endpoint found in agent card",
      });
      continue;
    }

    try {
      // Build delivery request
      const request: MailDeliveryRequest = {
        version: 1,
        message: messagePayload,
        sender_signature: signature as `0x${string}`,
      };

      // E2E encrypt if recipient has a pubkey
      if (endpoint.recipientPubkey) {
        const plaintext = Buffer.from(JSON.stringify(request), "utf-8");
        request.encrypted_envelope = encryptAgentGatewayPayload({
          plaintext,
          recipientPublicKey: endpoint.recipientPubkey,
        });
      }

      // Validate URL before posting
      validateHttpTargetUrl(endpoint.url, {
        allowPrivateTargets: true,
      });

      const postResult = await postJson(endpoint.url, request);

      if (postResult.status === "accepted") {
        deliveries.push({ recipient, status: "delivered" });
      } else {
        deliveries.push({
          recipient,
          status: "failed",
          reason: postResult.reason ?? postResult.status,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to deliver mail to ${recipient}: ${reason}`);
      deliveries.push({ recipient, status: "failed", reason });
    }
  }

  return { messageId, threadId, deliveries };
}

// ─── HTTP POST Helper ─────────────────────────────────────────────

async function postJson(
  url: string,
  body: unknown,
): Promise<MailDeliveryResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await response.json()) as MailDeliveryResponse;
    return json;
  } catch (err) {
    return {
      status: "rejected",
      message_id: "",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}
