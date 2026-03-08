import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import net from "net";
import { URL } from "url";
import { createLogger } from "../observability/logger.js";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
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
} from "../tos/x402.js";
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

async function requirePayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenFoxConfig;
  providerAddress: string;
  amountWei: string;
}): Promise<boolean> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the observation server");
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
    description: "OpenFox observation.once payment",
  };
  const envelope = readTOSPaymentEnvelope(params.req);
  if (!envelope) {
    writeTOSPaymentRequired(params.res, requirement);
    return false;
  }
  const verified = verifyTOSPayment(requirement, envelope);
  await submitTOSPayment(rpcUrl, verified);
  return true;
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
  const { observationConfig, config, db, address } = params;
  const path = observationConfig.path.startsWith("/") ? observationConfig.path : `/${observationConfig.path}`;
  const healthzPath = `${path}/healthz`;

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
      if (url.pathname === path && req.method === "HEAD") {
        const paid = await requirePayment({
          req,
          res,
          config,
          providerAddress: address,
          amountWei: observationConfig.priceWei,
        });
        if (paid) {
          res.statusCode = 200;
          res.end();
        }
        return;
      }
      if (req.method !== "POST" || url.pathname !== path) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = (await readJsonBody(req)) as ObservationInvocationRequest;
      const { requestNonce, targetUrl } = validateRequest(body, observationConfig);
      const requesterIdentity = body.requester.identity.value.toLowerCase();
      ensureRequestNotReplayed({
        db,
        scope: "observation",
        requesterIdentity,
        capability: body.capability,
        nonce: requestNonce,
      });

      const paid = await requirePayment({
        req,
        res,
        config,
        providerAddress: address,
        amountWei: observationConfig.priceWei,
      });
      if (!paid) {
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

      const result = await fetchObservation(
        targetUrl,
        observationConfig.requestTimeoutMs,
        observationConfig.maxResponseBytes,
      );
      db.setKV(
        "agent_discovery:observation:last_served",
        JSON.stringify({
          at: new Date().toISOString(),
          requesterIdentity,
          targetUrl: result.target_url,
          requestNonce,
        }),
      );
      json(res, 200, result);
    } catch (error) {
      logger.warn(
        `Observation request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
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
