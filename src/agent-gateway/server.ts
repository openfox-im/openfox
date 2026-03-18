import http, { type IncomingMessage, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createLogger } from "../observability/logger.js";
import type { AgentGatewayServerConfig } from "../types.js";
import {
  submitPayment,
  verifyPayment,
  writePaymentRequired,
  readPaymentEnvelope,
  type PaymentEnvelope,
} from "../chain/x402.js";
import {
  formatNetwork as formatNetwork,
  ChainRpcClient as RpcClient,
} from "../chain/client.js";
import { normalizeAddress } from "../chain/address.js";
import { verifyGatewaySessionAuth } from "./auth.js";
import {
  buildGatewayPublicUrl,
  buildGatewaySessionUrl,
  buildStableGatewayPathToken,
  gatewayAgentIdFromIdentity,
  normalizeGatewayPath,
  type AgentGatewayAllocatedEndpoint,
  type AgentGatewayErrorFrame,
  type AgentGatewayFrame,
  type AgentGatewayRelayRequest,
  type AgentGatewayRelayResponse,
  type AgentGatewayRelayResponseChunk,
  type AgentGatewayRelayResponseEnd,
  type AgentGatewayRelayResponseStart,
  type AgentGatewayRouteAdd,
  type AgentGatewayRouteRegistration,
  type AgentGatewayRouteRemove,
  type AgentGatewaySessionOpen,
  type AgentGatewaySessionResume,
  type StartedAgentGatewayServer,
} from "./types.js";

const logger = createLogger("agent-gateway.server");
const BODY_LIMIT_FALLBACK = 128 * 1024;

interface LiveSession {
  id: string;
  agentId: string;
  primaryIdentity: string;
  ws: WebSocket;
  routes: Map<string, AgentGatewayRouteRegistration>;
  publicPathToken: string;
}

interface StoredSessionState {
  sessionId: string;
  agentId: string;
  primaryIdentity: string;
  publicPathToken: string;
  routes: AgentGatewayRouteRegistration[];
  updatedAt: number;
}

interface PendingForward {
  req: IncomingMessage;
  res: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
  started: boolean;
  completed: boolean;
  resolve(): void;
  reject(error: Error): void;
}

function parsePositiveWei(value: string | undefined): bigint {
  if (!value || !/^\d+$/.test(value.trim())) {
    return 0n;
  }
  return BigInt(value.trim());
}

function readNonce(db: OpenFoxDatabase | undefined, key: string): boolean {
  if (!db) return false;
  const raw = db.getKV(key);
  if (!raw) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { expiresAt?: number };
    if (
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Math.floor(Date.now() / 1000)
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function recordNonce(
  db: OpenFoxDatabase | undefined,
  key: string,
  expiresAt: number,
): void {
  if (!db) return;
  db.setKV(key, JSON.stringify({ expiresAt }));
}

function nonceKey(gatewayAgentId: string, nonce: string): string {
  return `agent_gateway:session_nonce:${gatewayAgentId}:${nonce.toLowerCase()}`;
}

function storedSessionKey(gatewayAgentId: string, agentId: string): string {
  return `agent_gateway:server_session:${gatewayAgentId}:${agentId.toLowerCase()}`;
}

function loadStoredSession(
  db: OpenFoxDatabase | undefined,
  gatewayAgentId: string,
  agentId: string,
): StoredSessionState | null {
  if (!db) {
    return null;
  }
  const raw = db.getKV(storedSessionKey(gatewayAgentId, agentId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredSessionState;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.agentId !== "string" ||
      typeof parsed.primaryIdentity !== "string" ||
      typeof parsed.publicPathToken !== "string" ||
      !Array.isArray(parsed.routes)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(
  db: OpenFoxDatabase | undefined,
  gatewayAgentId: string,
  session: LiveSession,
): void {
  if (!db) {
    return;
  }
  const value: StoredSessionState = {
    sessionId: session.id,
    agentId: session.agentId,
    primaryIdentity: session.primaryIdentity,
    publicPathToken: session.publicPathToken,
    routes: [...session.routes.values()],
    updatedAt: Date.now(),
  };
  db.setKV(
    storedSessionKey(gatewayAgentId, session.agentId),
    JSON.stringify(value),
  );
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    res.setHeader(key, value);
  }
  res.end(payload);
}

async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
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
  return Buffer.concat(chunks);
}

function sendFrame(ws: WebSocket, frame: AgentGatewayFrame): void {
  ws.send(JSON.stringify(frame));
}

function buildSessionId(): string {
  return randomBytes(8).toString("hex");
}

function buildRequestId(): string {
  return randomBytes(12).toString("hex");
}

function parseFrame(raw: unknown): AgentGatewayFrame {
  const payload =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Buffer.from(raw as ArrayBuffer).toString("utf8");
  return JSON.parse(payload) as AgentGatewayFrame;
}

function normalizeForwardHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function applyResponseHeaders(
  res: ServerResponse,
  headers: Record<string, string>,
  bodyLength?: number,
): void {
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "connection") {
      continue;
    }
    if (lower === "content-length" && bodyLength === undefined) {
      continue;
    }
    res.setHeader(key, value);
  }
  if (bodyLength !== undefined) {
    res.setHeader("Content-Length", bodyLength);
  }
}

function relayPaymentAmount(gatewayConfig: AgentGatewayServerConfig): bigint {
  if (
    (gatewayConfig.paymentDirection === "requester_pays" ||
      gatewayConfig.paymentDirection === "split") &&
    parsePositiveWei(gatewayConfig.perRequestFeeWei) > 0n
  ) {
    return parsePositiveWei(gatewayConfig.perRequestFeeWei);
  }
  if (gatewayConfig.relayPaymentEnabled) {
    return parsePositiveWei(gatewayConfig.relayPriceWei);
  }
  return 0n;
}

function sessionPaymentAmount(gatewayConfig: AgentGatewayServerConfig): bigint {
  if (
    (gatewayConfig.paymentDirection === "provider_pays" ||
      gatewayConfig.paymentDirection === "split") &&
    parsePositiveWei(gatewayConfig.sessionFeeWei) > 0n
  ) {
    return parsePositiveWei(gatewayConfig.sessionFeeWei);
  }
  return 0n;
}

async function enforceRelayPayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config?: OpenFoxConfig;
  gatewayAddress: string;
  gatewayConfig: AgentGatewayServerConfig;
}): Promise<boolean> {
  const relayPriceWei = relayPaymentAmount(params.gatewayConfig);
  if (relayPriceWei === 0n) {
    return true;
  }
  const rpcUrl = params.config?.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required for relay payment enforcement");
  }
  const client = new RpcClient({ rpcUrl });
  const chainId = params.config?.chainId
    ? BigInt(params.config.chainId)
    : await client.getChainId();
  const requirement = {
    scheme: "exact" as const,
    network: formatNetwork(chainId),
    maxAmountRequired: relayPriceWei.toString(),
    payToAddress: normalizeAddress(params.gatewayAddress),
    asset: "native",
    requiredDeadlineSeconds:
      params.gatewayConfig.relayPaymentRequiredDeadlineSeconds ?? 300,
    description:
      params.gatewayConfig.relayPaymentDescription ||
      "OpenFox gateway relay payment",
  };
  const envelope = readPaymentEnvelope(params.req);
  if (!envelope) {
    writePaymentRequired(params.res, requirement);
    return false;
  }
  const verified = verifyPayment(requirement, envelope);
  await submitPayment(rpcUrl, verified);
  return true;
}

async function enforceSessionPayment(params: {
  config?: OpenFoxConfig;
  gatewayAddress: string;
  gatewayConfig: AgentGatewayServerConfig;
  payment?: PaymentEnvelope;
}): Promise<void> {
  const sessionFeeWei = sessionPaymentAmount(params.gatewayConfig);
  if (sessionFeeWei === 0n) {
    return;
  }
  if (!params.payment) {
    throw new Error("provider session payment required");
  }
  const rpcUrl = params.config?.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required for provider session payment");
  }
  const client = new RpcClient({ rpcUrl });
  const chainId = params.config?.chainId
    ? BigInt(params.config.chainId)
    : await client.getChainId();
  const requirement = {
    scheme: "exact" as const,
    network: formatNetwork(chainId),
    maxAmountRequired: sessionFeeWei.toString(),
    payToAddress: normalizeAddress(params.gatewayAddress),
    asset: "native",
    requiredDeadlineSeconds:
      params.gatewayConfig.relayPaymentRequiredDeadlineSeconds ?? 300,
    description: "OpenFox gateway session payment",
  };
  const verified = verifyPayment(requirement, params.payment);
  await submitPayment(rpcUrl, verified);
}

function allocateEndpoints(params: {
  session: LiveSession;
  routes: AgentGatewayRouteRegistration[];
  publicBaseUrl: string;
  publicPathPrefix: string;
}): AgentGatewayAllocatedEndpoint[] {
  return params.routes.map((route) => ({
    path: route.path,
    public_url: buildGatewayPublicUrl({
      publicBaseUrl: params.publicBaseUrl,
      publicPathPrefix: params.publicPathPrefix,
      pathToken: params.session.publicPathToken,
      path: route.path,
    }),
  }));
}

function normalizeRoutes(
  routes: AgentGatewayRouteRegistration[],
  maxRoutesPerSession: number,
): Map<string, AgentGatewayRouteRegistration> {
  if (routes.length > maxRoutesPerSession) {
    throw new Error("too many routes");
  }
  const normalized = new Map<string, AgentGatewayRouteRegistration>();
  for (const route of routes) {
    const path = normalizeGatewayPath(route.path);
    if (normalized.has(path)) {
      throw new Error(`duplicate route ${path}`);
    }
    normalized.set(path, { ...route, path });
  }
  return normalized;
}

export async function startAgentGatewayServer(params: {
  identity: OpenFoxIdentity;
  config?: OpenFoxConfig;
  db?: OpenFoxDatabase;
  gatewayConfig: AgentGatewayServerConfig;
}): Promise<StartedAgentGatewayServer> {
  const { identity, config, db, gatewayConfig } = params;
  const gatewayAgentId = gatewayAgentIdFromIdentity(identity);
  const gatewayAddress = config?.walletAddress
    ? normalizeAddress(config.walletAddress)
    : undefined;
  const sessionsByID = new Map<string, LiveSession>();
  const sessionsByPathToken = new Map<string, LiveSession>();
  const sessionsByAgentID = new Map<string, LiveSession>();
  const pending = new Map<string, PendingForward>();
  const alive = new WeakMap<WebSocket, boolean>();
  let resolvedPublicBaseUrl = gatewayConfig.publicBaseUrl.replace(/\/$/, "");

  const detachSession = (session: LiveSession) => {
    if (sessionsByID.get(session.id) === session) {
      sessionsByID.delete(session.id);
    }
    if (sessionsByPathToken.get(session.publicPathToken) === session) {
      sessionsByPathToken.delete(session.publicPathToken);
    }
    if (sessionsByAgentID.get(session.agentId) === session) {
      sessionsByAgentID.delete(session.agentId);
    }
  };

  const replaceLiveSession = (session: LiveSession) => {
    const existingByAgent = sessionsByAgentID.get(session.agentId);
    if (existingByAgent && existingByAgent !== session) {
      detachSession(existingByAgent);
      existingByAgent.ws.close(4000, "replaced by newer session");
    }
    const existingByPath = sessionsByPathToken.get(session.publicPathToken);
    if (existingByPath && existingByPath !== session) {
      detachSession(existingByPath);
      existingByPath.ws.close(4001, "route ownership moved");
    }
    sessionsByID.set(session.id, session);
    sessionsByPathToken.set(session.publicPathToken, session);
    sessionsByAgentID.set(session.agentId, session);
    storeSession(db, gatewayAgentId, session);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`,
      );
      const prefix = gatewayConfig.publicPathPrefix.startsWith("/")
        ? gatewayConfig.publicPathPrefix
        : `/${gatewayConfig.publicPathPrefix}`;
      if (req.method === "GET" && url.pathname === `${prefix}/healthz`) {
        json(res, 200, {
          ok: true,
          gatewayAgentId,
          capability: gatewayConfig.capability,
          paymentDirection: gatewayConfig.paymentDirection,
          relayPaymentEnabled: relayPaymentAmount(gatewayConfig) > 0n,
        });
        return;
      }
      if (!url.pathname.startsWith(`${prefix}/`)) {
        json(res, 404, { error: "not found" });
        return;
      }
      const remainder = url.pathname.slice(prefix.length + 1);
      const slashIndex = remainder.indexOf("/");
      if (slashIndex <= 0) {
        json(res, 404, { error: "unknown relay path" });
        return;
      }
      const pathToken = remainder.slice(0, slashIndex);
      const routePath = normalizeGatewayPath(remainder.slice(slashIndex));
      const session = sessionsByPathToken.get(pathToken);
      if (!session) {
        json(res, 503, { error: "provider session unavailable" });
        return;
      }
      const route = session.routes.get(routePath);
      if (!route) {
        json(res, 404, { error: "route not registered" });
        return;
      }
      if (relayPaymentAmount(gatewayConfig) > 0n) {
        if (!gatewayAddress) {
          throw new Error("gateway wallet address is required for relay operation");
        }
        const paid = await enforceRelayPayment({
          req,
          res,
          config,
          gatewayAddress,
          gatewayConfig,
        });
        if (!paid) {
          return;
        }
      }
      const body =
        req.method === "GET" || req.method === "HEAD"
          ? Buffer.alloc(0)
          : await readBody(
              req,
              gatewayConfig.maxRequestBodyBytes || BODY_LIMIT_FALLBACK,
            );
      const requestId = buildRequestId();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("gateway relay timed out"));
        }, gatewayConfig.requestTimeoutMs);
        pending.set(requestId, {
          req,
          res,
          timer,
          started: false,
          completed: false,
          resolve,
          reject,
        });
        const frame: AgentGatewayRelayRequest = {
          type: "request",
          request_id: requestId,
          method: req.method || "GET",
          path: routePath,
          headers: normalizeForwardHeaders(req.headers),
          body_base64: body.byteLength ? body.toString("base64") : undefined,
        };
        sendFrame(session.ws, frame);
      });
    } catch (error) {
      if (!res.headersSent) {
        json(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.end();
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const sessionPath = gatewayConfig.sessionPath.startsWith("/")
      ? gatewayConfig.sessionPath
      : `/${gatewayConfig.sessionPath}`;
    if (url.pathname !== sessionPath) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    let session: LiveSession | null = null;

    ws.on("message", async (raw) => {
      try {
        const frame = parseFrame(raw);
        if (!session) {
          if (frame.type !== "session_open" && frame.type !== "session_resume") {
            sendFrame(ws, {
              type: "error",
              error: "expected session_open or session_resume",
            });
            ws.close();
            return;
          }

          const incoming =
            frame.type === "session_resume"
              ? (frame as AgentGatewaySessionResume)
              : (frame as AgentGatewaySessionOpen);
          const valid = await verifyGatewaySessionAuth({
            auth: incoming.auth,
            expectedGatewayAgentId: gatewayAgentId,
          });
          if (!valid) {
            sendFrame(ws, { type: "error", error: "invalid session auth" });
            ws.close();
            return;
          }
          const replayKey = nonceKey(gatewayAgentId, incoming.auth.session_nonce);
          if (readNonce(db, replayKey)) {
            sendFrame(ws, { type: "error", error: "duplicate session nonce" });
            ws.close();
            return;
          }
          if (sessionPaymentAmount(gatewayConfig) > 0n) {
            if (!gatewayAddress) {
              throw new Error("gateway wallet address is required for gateway sessions");
            }
            await enforceSessionPayment({
              config,
              gatewayAddress,
              gatewayConfig,
              payment: incoming.payment,
            });
          }
          recordNonce(db, replayKey, incoming.auth.expires_at);

          const providedRoutes = incoming.routes ?? [];
          let routeMap: Map<string, AgentGatewayRouteRegistration>;
          if (providedRoutes.length > 0) {
            routeMap = normalizeRoutes(
              providedRoutes,
              gatewayConfig.maxRoutesPerSession,
            );
          } else if (frame.type === "session_resume") {
            const stored = loadStoredSession(
              db,
              gatewayAgentId,
              incoming.auth.agent_id.toLowerCase(),
            );
            if (!stored || stored.routes.length === 0) {
              sendFrame(ws, {
                type: "error",
                error: "session resume unavailable",
              });
              ws.close();
              return;
            }
            routeMap = normalizeRoutes(
              stored.routes,
              gatewayConfig.maxRoutesPerSession,
            );
          } else {
            sendFrame(ws, { type: "error", error: "no routes provided" });
            ws.close();
            return;
          }

          const stored = loadStoredSession(
            db,
            gatewayAgentId,
            incoming.auth.agent_id.toLowerCase(),
          );
          const resumeFrame =
            frame.type === "session_resume"
              ? (frame as AgentGatewaySessionResume)
              : null;
          const previousSessionId = resumeFrame
            ? resumeFrame.previous_session_id.trim()
            : "";
          const requestedSessionID =
            previousSessionId.length > 0
              ? previousSessionId
              : undefined;
          const publicPathToken =
            stored?.publicPathToken ||
            buildStableGatewayPathToken(incoming.auth.agent_id);
          const sessionId =
            requestedSessionID &&
            (!sessionsByID.has(requestedSessionID) ||
              sessionsByID.get(requestedSessionID)?.agentId ===
                incoming.auth.agent_id.toLowerCase())
              ? requestedSessionID
              : frame.type === "session_resume" &&
                  stored?.sessionId &&
                  (!sessionsByID.has(stored.sessionId) ||
                    sessionsByID.get(stored.sessionId)?.agentId ===
                      incoming.auth.agent_id.toLowerCase())
                ? stored.sessionId
                : buildSessionId();

          session = {
            id: sessionId,
            agentId: incoming.auth.agent_id.toLowerCase(),
            primaryIdentity: incoming.auth.primary_identity.value.toLowerCase(),
            ws,
            routes: routeMap,
            publicPathToken,
          };
          replaceLiveSession(session);
          const allocatedEndpoints = allocateEndpoints({
            session,
            routes: [...routeMap.values()],
            publicBaseUrl: resolvedPublicBaseUrl,
            publicPathPrefix: gatewayConfig.publicPathPrefix,
          });
          sendFrame(ws, {
            type: "session_open_ack",
            session_id: sessionId,
            allocated_endpoints: allocatedEndpoints,
            relay_pricing: {
              mode: gatewayConfig.mode,
              note:
                gatewayConfig.paymentDirection === "provider_pays"
                  ? "provider session fee"
                  : gatewayConfig.paymentDirection === "split"
                    ? "provider session fee + requester relay fee"
                    : gatewayConfig.priceModel,
            },
          });
          logger.info(
            `Gateway session active for ${session.agentId} with ${routeMap.size} route(s)`,
          );
          return;
        }

        if (frame.type === "route_add") {
          const add = frame as AgentGatewayRouteAdd;
          const normalized = normalizeRoutes(
            add.routes,
            gatewayConfig.maxRoutesPerSession,
          );
          if (session.routes.size+ normalized.size > gatewayConfig.maxRoutesPerSession) {
            sendFrame(ws, {
              type: "error",
              error: "too many routes",
            });
            return;
          }
          const addedRoutes: AgentGatewayRouteRegistration[] = [];
          for (const [path, route] of normalized.entries()) {
            if (session.routes.has(path)) {
              sendFrame(ws, {
                type: "error",
                error: `route already registered: ${path}`,
              });
              return;
            }
            session.routes.set(path, route);
            addedRoutes.push(route);
          }
          storeSession(db, gatewayAgentId, session);
          sendFrame(ws, {
            type: "route_update_ack",
            added: allocateEndpoints({
              session,
              routes: addedRoutes,
              publicBaseUrl: resolvedPublicBaseUrl,
              publicPathPrefix: gatewayConfig.publicPathPrefix,
            }),
            removed: [],
          });
          return;
        }

        if (frame.type === "route_remove") {
          const remove = frame as AgentGatewayRouteRemove;
          const removed: string[] = [];
          for (const path of remove.paths.map((entry) => normalizeGatewayPath(entry))) {
            if (session.routes.delete(path)) {
              removed.push(path);
            }
          }
          storeSession(db, gatewayAgentId, session);
          sendFrame(ws, {
            type: "route_update_ack",
            added: [],
            removed,
          });
          return;
        }

        if (frame.type === "response_start") {
          const waiter = pending.get(frame.request_id);
          if (!waiter || waiter.completed) {
            return;
          }
          waiter.started = true;
          waiter.res.statusCode = frame.status;
          applyResponseHeaders(waiter.res, frame.headers);
          return;
        }

        if (frame.type === "response_chunk") {
          const waiter = pending.get(frame.request_id);
          if (!waiter || waiter.completed) {
            return;
          }
          if (!waiter.started) {
            waiter.res.statusCode = 200;
            waiter.started = true;
          }
          waiter.res.write(Buffer.from(frame.body_base64, "base64"));
          return;
        }

        if (frame.type === "response_end") {
          const waiter = pending.get(frame.request_id);
          if (!waiter || waiter.completed) {
            return;
          }
          pending.delete(frame.request_id);
          waiter.completed = true;
          clearTimeout(waiter.timer);
          waiter.res.end();
          waiter.resolve();
          return;
        }

        if (frame.type === "response" || frame.type === "error") {
          const requestId = frame.request_id;
          if (!requestId) {
            return;
          }
          const waiter = pending.get(requestId);
          if (!waiter || waiter.completed) {
            return;
          }
          pending.delete(requestId);
          waiter.completed = true;
          clearTimeout(waiter.timer);
          if (frame.type === "error") {
            if (!waiter.res.headersSent) {
              json(waiter.res, 502, { error: frame.error });
            } else {
              waiter.res.end();
            }
            waiter.reject(new Error(frame.error));
            return;
          }
          const responseBody = frame.body_base64
            ? Buffer.from(frame.body_base64, "base64")
            : Buffer.alloc(0);
          waiter.res.statusCode = frame.status;
          applyResponseHeaders(waiter.res, frame.headers, responseBody.byteLength);
          if (waiter.req.method === "HEAD") {
            waiter.res.end();
          } else {
            waiter.res.end(responseBody);
          }
          waiter.resolve();
        }
      } catch (error) {
        sendFrame(ws, {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    ws.on("close", () => {
      if (session) {
        detachSession(session);
        logger.info(`Gateway session closed for ${session.agentId}`);
      }
    });
  });

  const pingTimer = setInterval(() => {
    for (const session of sessionsByID.values()) {
      if (!alive.get(session.ws)) {
        session.ws.terminate();
        detachSession(session);
        continue;
      }
      alive.set(session.ws, false);
      session.ws.ping();
    }
  }, 15_000);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(gatewayConfig.port, gatewayConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr
      ? addr.port
      : gatewayConfig.port;
  const publicBase = new URL(gatewayConfig.publicBaseUrl);
  publicBase.port = String(boundPort);
  resolvedPublicBaseUrl = publicBase.toString().replace(/\/$/, "");
  const sessionUrl = buildGatewaySessionUrl(
    { ...gatewayConfig, publicBaseUrl: resolvedPublicBaseUrl },
    boundPort,
  );

  return {
    gatewayAgentId,
    sessionUrl,
    publicBaseUrl: resolvedPublicBaseUrl,
    close: async () => {
      clearInterval(pingTimer);
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("gateway shutting down"));
      }
      pending.clear();
      for (const session of sessionsByID.values()) {
        session.ws.close();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
