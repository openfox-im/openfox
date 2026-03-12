import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import {
  DEFAULT_X402_SERVER_CONFIG,
} from "../types.js";
import type {
  InferenceClient,
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  buildX402ServerRequirement,
  createX402PaymentManager,
  hashX402RequestPayload,
  writeX402RequirementResponse,
} from "../chain/x402-server.js";
import { normalizeAddress } from "../chain/address.js";
import {
  buildSentimentAnalysisServerUrl,
  type SentimentAnalysisRequest,
  type SentimentAnalysisResponse,
  type SentimentLabel,
  type AgentDiscoverySentimentAnalysisServerConfig,
} from "./types.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "./security.js";

const logger = createLogger("agent-discovery.sentiment-analysis");

export interface AgentDiscoverySentimentAnalysisServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoverySentimentAnalysisServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  sentimentConfig: AgentDiscoverySentimentAnalysisServerConfig;
}

interface StoredSentimentJob {
  resultId: string;
  requestKey: string;
  request: SentimentAnalysisRequest;
  response: SentimentAnalysisResponse;
  requesterIdentity: string;
  capability: string;
  createdAt: string;
}

const BODY_LIMIT_BYTES = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function parseJsonObject<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildSentimentResultId(request: SentimentAnalysisRequest): string {
  return createHash("sha256")
    .update(
      `${request.requester.identity.value.toLowerCase()}|${request.capability}|${normalizeNonce(request.request_nonce)}`,
    )
    .digest("hex");
}

function buildSentimentRequestKey(request: SentimentAnalysisRequest): string {
  return [
    "agent_discovery:sentiment:request",
    normalizeAddress(request.requester.identity.value),
    request.capability,
    normalizeNonce(request.request_nonce),
  ].join(":");
}

function buildSentimentPrompt(text: string): string {
  return [
    "Classify the sentiment of the following text as exactly one of: positive, negative, neutral, mixed.",
    "Return only a JSON object with this exact shape:",
    '{"sentiment":"positive|negative|neutral|mixed","confidence":0.0,"summary":"one sentence explanation"}',
    "",
    `Text: ${text}`,
  ].join("\n");
}

const VALID_SENTIMENTS: SentimentLabel[] = ["positive", "negative", "neutral", "mixed"];

function parseSentimentResult(raw: string): {
  sentiment: SentimentLabel;
  confidence: number;
  summary: string;
} {
  const parsed = parseJsonObject<{
    sentiment?: string;
    confidence?: number;
    summary?: string;
  }>(raw);
  if (!parsed) {
    return { sentiment: "neutral", confidence: 0, summary: "Could not parse model response." };
  }
  const sentiment: SentimentLabel = VALID_SENTIMENTS.includes(parsed.sentiment as SentimentLabel)
    ? (parsed.sentiment as SentimentLabel)
    : "neutral";
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "No summary provided.";
  return { sentiment, confidence, summary };
}

export async function startAgentDiscoverySentimentAnalysisServer(
  params: StartAgentDiscoverySentimentAnalysisServerParams,
): Promise<AgentDiscoverySentimentAnalysisServer> {
  const { identity, config, db, inference, sentimentConfig } = params;
  const url = buildSentimentAnalysisServerUrl(sentimentConfig);
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;

  const x402Config = config.x402Server ?? DEFAULT_X402_SERVER_CONFIG;
  const paymentManager =
    x402Config.enabled && rpcUrl
      ? createX402PaymentManager({
          db,
          rpcUrl,
          config: x402Config,
        })
      : null;

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { error: "method_not_allowed" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as SentimentAnalysisRequest;
      if (!body.capability || !body.requester?.identity?.value || !body.text) {
        json(res, 400, { error: "missing required fields: capability, requester, text" });
        return;
      }
      if (body.text.length > sentimentConfig.maxTextChars) {
        json(res, 400, { error: `text exceeds max length of ${sentimentConfig.maxTextChars} chars` });
        return;
      }

      validateRequestExpiry(body.request_expires_at);
      const nonce = normalizeNonce(body.request_nonce);

      const resultId = buildSentimentResultId(body);
      const requestKey = buildSentimentRequestKey(body);
      const existingRaw = db.getKV(requestKey);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as StoredSentimentJob;
        json(res, 200, { ...existing.response, idempotent: true });
        return;
      }

      const requesterIdentity = normalizeAddress(body.requester.identity.value);
      ensureRequestNotReplayed({
        db,
        scope: "sentiment",
        requesterIdentity,
        capability: body.capability,
        nonce,
      });

      if (paymentManager) {
        const requestHash = hashX402RequestPayload({
          capability: body.capability,
          requester_identity: body.requester.identity.value.toLowerCase(),
          text: body.text,
          reason: body.reason ?? "",
        });
        const payment = await paymentManager.requirePayment({
          req,
          serviceKind: "sentiment",
          providerAddress: identity.address,
          requestKey,
          requestHash,
          amountWei: sentimentConfig.priceWei,
          description: `OpenFox sentiment.analyze payment`,
        });
        if (payment.state === "required") {
          writeX402RequirementResponse({ res, requirement: payment.requirement });
          return;
        }
        if (payment.state === "pending") {
          json(res, 202, {
            status: "pending",
            reason: payment.reason,
            payment_tx_hash: payment.payment.txHash,
            payment_status: payment.payment.status,
          });
          return;
        }
      }

      const prompt = buildSentimentPrompt(body.text);
      const response = await inference.chat(
        [{ role: "system", content: prompt }],
        { temperature: 0, maxTokens: 256 },
      );

      const result = parseSentimentResult(response.message.content || "");

      const sentimentResponse: SentimentAnalysisResponse = {
        status: "ok",
        result_id: resultId,
        analyzed_at: Date.now(),
        text_preview: body.text.slice(0, 120),
        sentiment: result.sentiment,
        confidence: result.confidence,
        summary: result.summary,
      };

      const job: StoredSentimentJob = {
        resultId,
        requestKey,
        request: body,
        response: sentimentResponse,
        requesterIdentity: normalizeAddress(body.requester.identity.value),
        capability: body.capability,
        createdAt: new Date().toISOString(),
      };
      db.setKV(requestKey, JSON.stringify(job));
      recordRequestNonce({
        db,
        scope: "sentiment",
        requesterIdentity,
        capability: body.capability,
        nonce,
        expiresAt: body.request_expires_at,
      });
      logger.info(`Sentiment analysis completed: result_id=${resultId} sentiment=${result.sentiment}`);
      json(res, 200, sentimentResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Sentiment analysis request failed: ${message}`);
      json(res, 400, { error: message });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(sentimentConfig.port, sentimentConfig.bindHost, () => {
      resolve({
        url,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
    server.on("error", reject);
  });
}
