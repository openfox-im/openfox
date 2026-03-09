import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import type {
  InferenceClient,
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  TOSRpcClient as RpcClient,
  formatTOSNetwork as formatNetwork,
} from "../tos/client.js";
import {
  readTOSPaymentEnvelope,
  submitTOSPayment,
  verifyTOSPayment,
  writeTOSPaymentRequired,
  type TOSPaymentRequirement,
  type VerifiedTOSPayment,
} from "../tos/x402.js";
import { normalizeTOSAddress as normalizeAddress } from "../tos/address.js";
import {
  buildOracleServerUrl,
  type OracleResolutionRequest,
  type OracleResolutionResponse,
  type AgentDiscoveryOracleServerConfig,
} from "./types.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "./security.js";
import type { SettlementPublisher } from "../settlement/publisher.js";
import type { SettlementCallbackDispatcher } from "../settlement/callbacks.js";

const logger = createLogger("agent-discovery.oracle");

export interface AgentDiscoveryOracleServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoveryOracleServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  oracleConfig: AgentDiscoveryOracleServerConfig;
  settlementPublisher?: SettlementPublisher;
  settlementCallbacks?: SettlementCallbackDispatcher;
}

interface StoredOracleJob {
  resultId: string;
  requestKey: string;
  request: OracleResolutionRequest;
  response: OracleResolutionResponse;
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

function buildOracleResultId(request: OracleResolutionRequest): string {
  return createHash("sha256")
    .update(
      `${request.requester.identity.value.toLowerCase()}|${request.capability}|${normalizeNonce(request.request_nonce)}`,
    )
    .digest("hex");
}

function buildOracleRequestKey(request: OracleResolutionRequest): string {
  return [
    "agent_discovery:oracle:request",
    request.requester.identity.value.toLowerCase(),
    request.capability,
    normalizeNonce(request.request_nonce),
  ].join(":");
}

function getOracleJobKey(resultId: string): string {
  return `agent_discovery:oracle:job:${resultId}`;
}

function buildOracleResultPath(resultId: string): string {
  return `/oracle/result/${resultId}`;
}

function loadStoredOracleJob(
  db: OpenFoxDatabase,
  resultId: string,
): StoredOracleJob | null {
  const raw = db.getKV(getOracleJobKey(resultId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredOracleJob;
}

function storeOracleJob(db: OpenFoxDatabase, job: StoredOracleJob): void {
  db.setKV(getOracleJobKey(job.resultId), JSON.stringify(job));
  db.setKV(job.requestKey, job.resultId);
}

function validateRequest(
  request: OracleResolutionRequest,
  config: AgentDiscoveryOracleServerConfig,
): string {
  if (request.capability !== config.capability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  validateRequestExpiry(request.request_expires_at);
  normalizeNonce(request.request_nonce);
  const query = request.query.trim();
  if (!query) {
    throw new Error("query is required");
  }
  if (query.length > config.maxQuestionChars) {
    throw new Error(`query exceeds maxQuestionChars (${config.maxQuestionChars})`);
  }
  if (request.context && request.context.length > config.maxContextChars) {
    throw new Error(`context exceeds maxContextChars (${config.maxContextChars})`);
  }
  if (!["binary", "enum", "scalar", "text"].includes(request.query_kind)) {
    throw new Error(`unsupported query_kind ${request.query_kind}`);
  }
  if (request.query_kind === "enum") {
    if (!Array.isArray(request.options) || request.options.length === 0) {
      throw new Error("enum queries require at least one option");
    }
    if (request.options.length > config.maxOptions) {
      throw new Error(`enum queries support at most ${config.maxOptions} options`);
    }
  }
  return request.requester.identity.value.toLowerCase();
}

async function requirePayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenFoxConfig;
  providerAddress: string;
  amountWei: string;
}): Promise<VerifiedTOSPayment | null> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the oracle server");
  }
  const client = new RpcClient({ rpcUrl });
  const chainId = params.config.chainId ? BigInt(params.config.chainId) : await client.getChainId();
  const requirement: TOSPaymentRequirement = {
    scheme: "exact",
    network: formatNetwork(chainId),
    maxAmountRequired: params.amountWei,
    payToAddress: normalizeAddress(params.providerAddress),
    asset: "native",
    requiredDeadlineSeconds: 300,
    description: "OpenFox oracle.resolve payment",
  };
  const envelope = readTOSPaymentEnvelope(params.req);
  if (!envelope) {
    writeTOSPaymentRequired(params.res, requirement);
    return null;
  }
  const verified = verifyTOSPayment(requirement, envelope);
  await submitTOSPayment(rpcUrl, verified);
  return verified;
}

async function resolveOracleRequest(params: {
  inference: InferenceClient;
  request: OracleResolutionRequest;
}): Promise<{
  canonicalResult: string;
  confidence: number;
  summary: string;
}> {
  const prompt = [
    "You are a bounded oracle-style resolver for OpenFox.",
    "Return JSON only.",
    'Use this schema: {"canonical_result":"string","confidence":0.0,"summary":"short explanation"}',
    "Keep the answer concise and deterministic.",
    `Query kind: ${params.request.query_kind}`,
    `Query: ${params.request.query}`,
    params.request.options?.length
      ? `Allowed options: ${params.request.options.join(" | ")}`
      : undefined,
    params.request.context ? `Context: ${params.request.context}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await params.inference.chat(
    [{ role: "system", content: prompt }],
    { temperature: 0, maxTokens: 256 },
  );
  const parsed = parseJsonObject<{
    canonical_result?: unknown;
    confidence?: unknown;
    summary?: unknown;
  }>(response.message.content || "");

  const canonicalResult =
    typeof parsed?.canonical_result === "string" && parsed.canonical_result.trim()
      ? parsed.canonical_result.trim()
      : (response.message.content || "").trim().slice(0, 256);
  const confidence =
    typeof parsed?.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;
  const summary =
    typeof parsed?.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "No summary provided.";

  return { canonicalResult, confidence, summary };
}

export async function startAgentDiscoveryOracleServer(
  params: StartAgentDiscoveryOracleServerParams,
): Promise<AgentDiscoveryOracleServer> {
  const {
    oracleConfig,
    config,
    db,
    address,
    inference,
    settlementPublisher,
    settlementCallbacks,
  } = params;
  const path = oracleConfig.path.startsWith("/") ? oracleConfig.path : `/${oracleConfig.path}`;
  const healthzPath = `${path}/healthz`;
  const resultPathPrefix = "/oracle/result/";
  const requestPaths = new Set([path, "/oracle/resolve"]);
  const quotePaths = new Set(["/oracle/quote"]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          capability: oracleConfig.capability,
          priceWei: oracleConfig.priceWei,
          address,
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(resultPathPrefix)) {
        const resultId = url.pathname.slice(resultPathPrefix.length).trim();
        if (!resultId) {
          json(res, 400, { error: "missing result id" });
          return;
        }
        const job = loadStoredOracleJob(db, resultId);
        if (!job) {
          json(res, 404, { error: "result not found" });
          return;
        }
        json(res, 200, job.response);
        return;
      }
      if (req.method === "POST" && quotePaths.has(url.pathname)) {
        json(res, 200, {
          capability: oracleConfig.capability,
          price_wei: oracleConfig.priceWei,
          query_kinds: ["binary", "enum", "scalar", "text"],
          max_question_chars: oracleConfig.maxQuestionChars,
          max_context_chars: oracleConfig.maxContextChars,
          max_options: oracleConfig.maxOptions,
        });
        return;
      }
      if (requestPaths.has(url.pathname) && req.method === "HEAD") {
        const paid = await requirePayment({
          req,
          res,
          config,
          providerAddress: address,
          amountWei: oracleConfig.priceWei,
        });
        if (paid) {
          res.statusCode = 200;
          res.end();
        }
        return;
      }
      if (req.method !== "POST" || !requestPaths.has(url.pathname)) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = (await readJsonBody(req)) as OracleResolutionRequest;
      const requesterIdentity = validateRequest(body, oracleConfig);
      const requestNonce = normalizeNonce(body.request_nonce);
      const requestKey = buildOracleRequestKey(body);
      const existingResultId = db.getKV(requestKey);
      if (existingResultId) {
        const existingJob = loadStoredOracleJob(db, existingResultId);
        if (!existingJob) {
          json(res, 409, { status: "rejected", reason: "oracle result state is inconsistent" });
          return;
        }
        if (
          existingJob.request.query !== body.query ||
          existingJob.request.query_kind !== body.query_kind ||
          JSON.stringify(existingJob.request.options || []) !==
            JSON.stringify(body.options || [])
        ) {
          json(res, 409, {
            status: "rejected",
            reason: "request nonce is already bound to a different oracle payload",
          });
          return;
        }
        json(res, 200, { ...existingJob.response, idempotent: true });
        return;
      }

      ensureRequestNotReplayed({
        db,
        scope: "oracle",
        requesterIdentity,
        capability: body.capability,
        nonce: requestNonce,
      });

      const paid = await requirePayment({
        req,
        res,
        config,
        providerAddress: address,
        amountWei: oracleConfig.priceWei,
      });
      if (!paid) {
        return;
      }

      recordRequestNonce({
        db,
        scope: "oracle",
        requesterIdentity,
        capability: body.capability,
        nonce: requestNonce,
        expiresAt: body.request_expires_at,
      });

      const resultId = buildOracleResultId(body);
      const resolved = await resolveOracleRequest({
        inference,
        request: body,
      });
      const response: OracleResolutionResponse = {
        status: "ok",
        result_id: resultId,
        result_url: buildOracleResultPath(resultId),
        payment_tx_hash: paid.txHash,
        resolved_at: Math.floor(Date.now() / 1000),
        query: body.query,
        query_kind: body.query_kind,
        canonical_result: resolved.canonicalResult,
        confidence: resolved.confidence,
        summary: resolved.summary,
        ...(body.options?.length ? { options: body.options } : {}),
      };
      if (settlementPublisher) {
        const settlement = await settlementPublisher.publish({
          kind: "oracle",
          subjectId: resultId,
          publisherAddress: address as `0x${string}`,
          capability: body.capability,
          payerAddress:
            body.requester.identity.kind === "tos"
              ? (normalizeAddress(body.requester.identity.value) as `0x${string}`)
              : undefined,
          artifactUrl: response.result_url,
          paymentTxHash: paid.txHash,
          result: {
            query: body.query,
            query_kind: body.query_kind,
            canonical_result: resolved.canonicalResult,
            confidence: resolved.confidence,
            summary: resolved.summary,
            options: body.options,
          },
          metadata: {
            requester_agent_id: body.requester.agent_id,
            reason: body.reason,
          },
        });
        response.receipt_id = settlement.receiptId;
        response.receipt_hash = settlement.receiptHash;
        response.settlement_tx_hash = settlement.settlementTxHash ?? undefined;
        if (settlementCallbacks) {
          await settlementCallbacks.dispatch(settlement);
        }
      }

      db.setKV(
        "agent_discovery:oracle:last_served",
        JSON.stringify({
          at: new Date().toISOString(),
          requesterIdentity,
          resultId,
          query: body.query,
          queryKind: body.query_kind,
          requestNonce,
        }),
      );
      storeOracleJob(db, {
        resultId,
        requestKey,
        request: body,
        response,
        requesterIdentity,
        capability: body.capability,
        createdAt: new Date().toISOString(),
      });
      json(res, 200, response);
    } catch (error) {
      logger.warn(
        `Oracle request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(oracleConfig.port, oracleConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    url: buildOracleServerUrl({
      ...oracleConfig,
      port: (server.address() as { port: number }).port,
    }),
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
