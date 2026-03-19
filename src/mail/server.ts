/**
 * P2P Agent Mail — Server (Receive Side)
 *
 * Native HTTP server that accepts incoming mail delivery requests.
 * Same pattern as faucet-server.ts.
 */

import http, { type IncomingMessage, type ServerResponse } from "http";
import { verifyMessage } from "@tosnetwork/tosdk";
import { createLogger } from "../observability/logger.js";
import { decryptAgentGatewayPayload } from "../agent-gateway/e2e.js";
import {
  ensureRequestNotReplayed,
  recordRequestNonce,
} from "../agent-discovery/security.js";
import type {
  OpenFoxDatabase,
  OpenFoxIdentity,
  OpenFoxConfig,
  AgentDiscoveryMailServerConfig,
} from "../types.js";
import type {
  MailDeliveryRequest,
  MailDeliveryResponse,
  MailMessage,
} from "./types.js";
import { insertMessage } from "./store.js";
import { resolveThreadId, updateThreadSummary } from "./threading.js";

const logger = createLogger("mail.server");

const BODY_LIMIT_BYTES = 256 * 1024; // 256KB default

// ─── Server Interface ─────────────────────────────────────────────

export interface MailServer {
  close(): Promise<void>;
  url: string;
}

export interface StartMailServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  mailConfig: AgentDiscoveryMailServerConfig;
  privateKey: `0x${string}`;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

// ─── Rate Limiting ────────────────────────────────────────────────

function rateLimitKey(sender: string): string {
  return `mail:rate_limit:${sender.toLowerCase()}`;
}

function checkRateLimit(
  db: OpenFoxDatabase,
  sender: string,
  maxPerWindow: number,
): boolean {
  const key = rateLimitKey(sender);
  const raw = db.getKV(key);
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 60;

  if (!raw) {
    db.setKV(key, JSON.stringify({ count: 1, windowStart: now }));
    return true;
  }

  try {
    const data = JSON.parse(raw) as { count: number; windowStart: number };
    if (now - data.windowStart > windowSeconds) {
      // Reset window
      db.setKV(key, JSON.stringify({ count: 1, windowStart: now }));
      return true;
    }
    if (data.count >= maxPerWindow) {
      return false;
    }
    db.setKV(
      key,
      JSON.stringify({ count: data.count + 1, windowStart: data.windowStart }),
    );
    return true;
  } catch {
    db.setKV(key, JSON.stringify({ count: 1, windowStart: now }));
    return true;
  }
}

// ─── Request Validation ───────────────────────────────────────────

function validateDeliveryRequest(body: unknown): MailDeliveryRequest {
  const req = body as Record<string, unknown>;
  if (req.version !== 1) {
    throw new Error("unsupported protocol version");
  }
  const msg = req.message as Record<string, unknown> | undefined;
  if (!msg) {
    throw new Error("missing message payload");
  }
  if (typeof msg.id !== "string" || !msg.id) {
    throw new Error("missing message.id");
  }
  if (typeof msg.thread_id !== "string" || !msg.thread_id) {
    throw new Error("missing message.thread_id");
  }
  if (typeof msg.from !== "string" || !msg.from) {
    throw new Error("missing message.from");
  }
  if (!Array.isArray(msg.to) || msg.to.length === 0) {
    throw new Error("missing message.to");
  }
  if (typeof msg.subject !== "string") {
    throw new Error("missing message.subject");
  }
  if (typeof msg.body !== "string") {
    throw new Error("missing message.body");
  }
  if (typeof msg.sent_at !== "number") {
    throw new Error("missing message.sent_at");
  }
  if (
    typeof req.sender_signature !== "string" ||
    !req.sender_signature.startsWith("0x")
  ) {
    throw new Error("missing or invalid sender_signature");
  }

  return body as MailDeliveryRequest;
}

// ─── Signature Verification ───────────────────────────────────────

function canonicalizeMailMessage(
  msg: MailDeliveryRequest["message"],
): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(msg).sort()) {
    const value = (msg as Record<string, unknown>)[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

async function verifySenderSignature(
  req: MailDeliveryRequest,
): Promise<boolean> {
  const canonical = canonicalizeMailMessage(req.message);
  try {
    return await verifyMessage({
      address: req.message.from as `0x${string}`,
      message: canonical,
      signature: req.sender_signature,
    });
  } catch {
    return false;
  }
}

// ─── Server Factory ───────────────────────────────────────────────

export async function startMailServer(
  params: StartMailServerParams,
): Promise<MailServer> {
  const { mailConfig, db, privateKey } = params;
  const maxBodyBytes = mailConfig.maxBodyBytes ?? BODY_LIMIT_BYTES;
  const rateLimitPerSender = mailConfig.rateLimitPerSender ?? 10;
  const pathPrefix = mailConfig.path.startsWith("/")
    ? mailConfig.path
    : `/${mailConfig.path}`;
  const deliverPath = `${pathPrefix}/deliver`;
  const healthzPath = `${pathPrefix}/healthz`;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`,
      );

      // Health check
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, { ok: true, capability: "mail" });
        return;
      }

      // Only accept POST to deliver path
      if (req.method !== "POST" || url.pathname !== deliverPath) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req, maxBodyBytes);

      // If E2E encrypted, decrypt first
      let deliveryBody = body as Record<string, unknown>;
      if (deliveryBody.encrypted_envelope) {
        try {
          const plaintext = decryptAgentGatewayPayload({
            envelope: deliveryBody.encrypted_envelope as any,
            recipientPrivateKey: privateKey,
          });
          deliveryBody = JSON.parse(plaintext.toString("utf-8"));
        } catch (err) {
          const response: MailDeliveryResponse = {
            status: "rejected",
            message_id: "",
            reason: "failed to decrypt encrypted envelope",
          };
          json(res, 400, response);
          return;
        }
      }

      // Validate request
      const request = validateDeliveryRequest(deliveryBody);

      // Verify sender signature
      const validSignature = await verifySenderSignature(request);
      if (!validSignature) {
        const response: MailDeliveryResponse = {
          status: "rejected",
          message_id: request.message.id,
          reason: "invalid sender signature",
        };
        json(res, 403, response);
        return;
      }

      // Anti-replay: reject duplicate message IDs
      try {
        ensureRequestNotReplayed({
          db,
          scope: "mail",
          requesterIdentity: request.message.from,
          capability: "mail.deliver",
          nonce: request.message.id,
        });
      } catch {
        const response: MailDeliveryResponse = {
          status: "rejected",
          message_id: request.message.id,
          reason: "duplicate message (replay detected)",
        };
        json(res, 409, response);
        return;
      }

      // Check rate limit
      if (!checkRateLimit(db, request.message.from, rateLimitPerSender)) {
        const response: MailDeliveryResponse = {
          status: "rate_limited",
          message_id: request.message.id,
          reason: "rate limit exceeded",
        };
        json(res, 429, response);
        return;
      }

      // Resolve thread
      const threadId = resolveThreadId(db, request.message.in_reply_to);
      const now = Math.floor(Date.now() / 1000);

      // Store message
      const msg: MailMessage = {
        id: request.message.id,
        threadId,
        inReplyTo: request.message.in_reply_to,
        from: request.message.from.toLowerCase(),
        to: request.message.to.map((a) => a.toLowerCase()),
        cc: request.message.cc?.map((a) => a.toLowerCase()),
        subject: request.message.subject,
        body: request.message.body,
        bodyHtml: request.message.body_html,
        folder: "inbox",
        status: "unread",
        signature: request.sender_signature,
        sentAt: request.message.sent_at,
        receivedAt: now,
        attachments: request.message.attachments,
      };

      insertMessage(db, msg);
      updateThreadSummary(db, threadId, msg);

      // Record nonce to prevent replay
      recordRequestNonce({
        db,
        scope: "mail",
        requesterIdentity: request.message.from,
        capability: "mail.deliver",
        nonce: request.message.id,
        expiresAt: now + 86400, // 24h
      });

      logger.info(
        `Received mail ${msg.id} from ${msg.from} (thread: ${threadId})`,
      );

      const response: MailDeliveryResponse = {
        status: "accepted",
        message_id: msg.id,
      };
      json(res, 200, response);
    } catch (error) {
      logger.warn(
        `Mail delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        message_id: "",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(mailConfig.port, mailConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr
      ? addr.port
      : mailConfig.port;
  const actualURL = `http://${mailConfig.bindHost}:${boundPort}${pathPrefix}`;
  logger.info(`Mail server listening on ${actualURL}`);

  return {
    url: actualURL,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
