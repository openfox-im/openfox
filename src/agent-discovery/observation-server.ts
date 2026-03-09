import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import net from "net";
import { URL } from "url";
import { createLogger } from "../observability/logger.js";
import {
  DEFAULT_X402_SERVER_CONFIG,
  type OpenFoxConfig,
  type OpenFoxDatabase,
  type OpenFoxIdentity,
} from "../types.js";
import {
  buildX402ServerRequirement,
  createX402PaymentManager,
  hashX402RequestPayload,
  writeX402RequirementResponse,
  X402ServerPaymentRejectedError,
} from "../tos/x402-server.js";
import { normalizeTOSAddress as normalizeAddress } from "../tos/address.js";
import {
  buildObservationServerUrl,
  type AgentDiscoveryObservationServerConfig,
  type ObservationInvocationRequest,
  type ObservationInvocationResponse,
} from "./types.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "./security.js";
import type { SettlementPublisher } from "../settlement/publisher.js";
import type { SettlementCallbackDispatcher } from "../settlement/callbacks.js";
import type { MarketBindingPublisher } from "../market/publisher.js";
import type { MarketContractDispatcher } from "../market/contracts.js";

const logger = createLogger("agent-discovery.observation");

export interface AgentDiscoveryObservationServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoveryObservationServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db: OpenFoxDatabase;
  observationConfig: AgentDiscoveryObservationServerConfig;
  settlementPublisher?: SettlementPublisher;
  settlementCallbacks?: SettlementCallbackDispatcher;
  marketBindingPublisher?: MarketBindingPublisher;
  marketContracts?: MarketContractDispatcher;
}

const BODY_LIMIT_BYTES = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

interface StoredObservationJob {
  jobId: string;
  requestKey: string;
  request: ObservationInvocationRequest;
  response: ObservationInvocationResponse;
  requesterIdentity: string;
  capability: string;
  createdAt: string;
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

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const ipType = net.isIP(normalized);
  if (ipType === 4) {
    if (normalized.startsWith("10.") || normalized.startsWith("127.") || normalized.startsWith("192.168.")) {
      return true;
    }
    const second = Number(normalized.split(".")[1] || "0");
    if (normalized.startsWith("172.") && second >= 16 && second <= 31) {
      return true;
    }
  }
  if (ipType === 6 && normalized.startsWith("fc")) return true;
  return false;
}

function validateRequest(
  request: ObservationInvocationRequest,
  config: AgentDiscoveryObservationServerConfig,
): { requestNonce: string; targetUrl: URL } {
  if (request.capability !== config.capability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  const requestNonce = normalizeNonce(request.request_nonce);
  validateRequestExpiry(request.request_expires_at);
  const targetUrl = new URL(request.target_url);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new Error("target_url must use http or https");
  }
  if (!config.allowPrivateTargets && isPrivateHost(targetUrl.hostname)) {
    throw new Error("private target URLs are not allowed");
  }
  return { requestNonce, targetUrl };
}

function buildObservationJobId(request: ObservationInvocationRequest): string {
  return createHash("sha256")
    .update(
      `${request.requester.identity.value.toLowerCase()}|${request.capability}|${normalizeNonce(request.request_nonce)}`,
    )
    .digest("hex");
}

function buildObservationRequestKey(request: ObservationInvocationRequest): string {
  return [
    "agent_discovery:observation:request",
    request.requester.identity.value.toLowerCase(),
    request.capability,
    normalizeNonce(request.request_nonce),
  ].join(":");
}

function getObservationJobKey(jobId: string): string {
  return `agent_discovery:observation:job:${jobId}`;
}

function buildObservationResultPath(jobId: string): string {
  return `/jobs/${jobId}`;
}

function loadStoredObservationJob(
  db: OpenFoxDatabase,
  jobId: string,
): StoredObservationJob | null {
  const raw = db.getKV(getObservationJobKey(jobId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredObservationJob;
}

function storeObservationJob(db: OpenFoxDatabase, job: StoredObservationJob): void {
  db.setKV(getObservationJobKey(job.jobId), JSON.stringify(job));
  db.setKV(job.requestKey, job.jobId);
}

async function fetchObservation(
  targetUrl: URL,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<ObservationInvocationResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    const limited = buffer.length > maxResponseBytes ? buffer.subarray(0, maxResponseBytes) : buffer;
    const bodyHash = createHash("sha256").update(limited).digest("hex");
    const result: ObservationInvocationResponse = {
      status: "ok",
      observed_at: Math.floor(Date.now() / 1000),
      target_url: targetUrl.toString(),
      http_status: response.status,
      content_type: contentType,
      body_sha256: `0x${bodyHash}`,
      size_bytes: limited.byteLength,
    };
    if (contentType.includes("application/json")) {
      result.body_json = JSON.parse(limited.toString("utf8"));
    } else {
      result.body_text = limited.toString("utf8");
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function startAgentDiscoveryObservationServer(
  params: StartAgentDiscoveryObservationServerParams,
): Promise<AgentDiscoveryObservationServer> {
  const {
    observationConfig,
    config,
    db,
    address,
    settlementPublisher,
    settlementCallbacks,
    marketBindingPublisher,
    marketContracts,
  } = params;
  const path = observationConfig.path.startsWith("/") ? observationConfig.path : `/${observationConfig.path}`;
  const healthzPath = `${path}/healthz`;
  const resultPathPrefix = "/jobs/";
  const requestPaths = new Set([path, "/observe"]);
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
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          capability: observationConfig.capability,
          priceWei: observationConfig.priceWei,
          address,
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(resultPathPrefix)) {
        const jobId = url.pathname.slice(resultPathPrefix.length).trim();
        if (!jobId) {
          json(res, 400, { error: "missing job id" });
          return;
        }
        const job = loadStoredObservationJob(db, jobId);
        if (!job) {
          json(res, 404, { error: "job not found" });
          return;
        }
        json(res, 200, job.response);
        return;
      }
      if (requestPaths.has(url.pathname) && req.method === "HEAD") {
        if (!rpcUrl) {
          throw new Error("Chain RPC is required to run the observation server");
        }
        const requirement = await buildX402ServerRequirement({
          rpcUrl,
          chainId: config.chainId,
          providerAddress: address,
          amountWei: observationConfig.priceWei,
          description: "OpenFox observation.once payment",
        });
        writeX402RequirementResponse({ res, requirement });
        return;
      }
      if (req.method !== "POST" || !requestPaths.has(url.pathname)) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = (await readJsonBody(req)) as ObservationInvocationRequest;
      const { requestNonce, targetUrl } = validateRequest(body, observationConfig);
      const requesterIdentity = body.requester.identity.value.toLowerCase();
      const requestKey = buildObservationRequestKey(body);
      const requestHash = hashX402RequestPayload({
        capability: body.capability,
        requester_identity: body.requester.identity.value.toLowerCase(),
        target_url: body.target_url,
        reason: body.reason ?? "",
      });
      const existingJobId = db.getKV(requestKey);
      if (existingJobId) {
        const existingJob = loadStoredObservationJob(db, existingJobId);
        if (!existingJob) {
          json(res, 409, { status: "rejected", reason: "observation job state is inconsistent" });
          return;
        }
        if (
          existingJob.request.target_url !== body.target_url ||
          existingJob.request.reason !== body.reason
        ) {
          json(res, 409, {
            status: "rejected",
            reason: "request nonce is already bound to a different observation payload",
          });
          return;
        }
        json(res, 200, { ...existingJob.response, idempotent: true });
        return;
      }
      ensureRequestNotReplayed({
        db,
        scope: "observation",
        requesterIdentity,
        capability: body.capability,
        nonce: requestNonce,
      });

      if (!paymentManager) {
        throw new Error("x402 payment manager is unavailable; configure rpcUrl");
      }
      const payment = await paymentManager.requirePayment({
        req,
        serviceKind: "observation",
        providerAddress: address,
        requestKey,
        requestHash,
        amountWei: observationConfig.priceWei,
        description: "OpenFox observation.once payment",
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

      recordRequestNonce({
        db,
        scope: "observation",
        requesterIdentity,
        capability: body.capability,
        nonce: requestNonce,
        expiresAt: body.request_expires_at,
      });

      const jobId = buildObservationJobId(body);
      const resultPath = buildObservationResultPath(jobId);
      const result = await fetchObservation(
        targetUrl,
        observationConfig.requestTimeoutMs,
        observationConfig.maxResponseBytes,
      );
      result.job_id = jobId;
      result.result_url = resultPath;
      result.payment_tx_hash = payment.payment.txHash;
      result.payment_status = payment.payment.status;
      if (marketBindingPublisher) {
        const binding = marketBindingPublisher.publish({
          kind: "observation",
          subjectId: jobId,
          publisherAddress: address as `0x${string}`,
          capability: body.capability,
          requesterAddress:
            body.requester.identity.kind === "tos"
              ? (normalizeAddress(body.requester.identity.value) as `0x${string}`)
              : undefined,
          artifactUrl: resultPath,
          paymentTxHash: payment.payment.txHash,
          metadata: {
            requester_agent_id: body.requester.agent_id,
            target_url: result.target_url,
            reason: body.reason,
          },
        });
        result.binding_id = binding.bindingId;
        result.binding_hash = binding.receiptHash;
        if (marketContracts) {
          const dispatch = await marketContracts.dispatch(binding);
          result.market_callback_tx_hash = dispatch.callback?.callbackTxHash ?? undefined;
        }
      }
      if (settlementPublisher) {
        const settlement = await settlementPublisher.publish({
          kind: "observation",
          subjectId: jobId,
          publisherAddress: address as `0x${string}`,
          capability: body.capability,
          payerAddress:
            body.requester.identity.kind === "tos"
              ? (normalizeAddress(body.requester.identity.value) as `0x${string}`)
              : undefined,
          artifactUrl: resultPath,
          paymentTxHash: payment.payment.txHash,
          result,
          metadata: {
            requester_agent_id: body.requester.agent_id,
            target_url: result.target_url,
          },
        });
        result.receipt_id = settlement.receiptId;
        result.receipt_hash = settlement.receiptHash;
        result.settlement_tx_hash = settlement.settlementTxHash ?? undefined;
        if (settlementCallbacks) {
          await settlementCallbacks.dispatch(settlement);
        }
      }
      paymentManager.bindPayment({
        paymentId: payment.payment.paymentId,
        boundKind: "observation_job",
        boundSubjectId: jobId,
        artifactUrl: resultPath,
      });
      db.setKV(
        "agent_discovery:observation:last_served",
        JSON.stringify({
          at: new Date().toISOString(),
          requesterIdentity,
          targetUrl: result.target_url,
          requestNonce,
          jobId,
        }),
      );
      storeObservationJob(db, {
        jobId,
        requestKey,
        request: body,
        response: result,
        requesterIdentity,
        capability: body.capability,
        createdAt: new Date().toISOString(),
      });
      json(res, 200, result);
    } catch (error) {
      const statusCode =
        error instanceof X402ServerPaymentRejectedError ? error.statusCode : 400;
      logger.warn(
        `Observation request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, statusCode, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(observationConfig.port, observationConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr ? addr.port : observationConfig.port;
  const actualURL = buildObservationServerUrl({
    ...observationConfig,
    port: boundPort,
  });
  logger.info(`Agent Discovery observation server listening on ${actualURL}`);

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
