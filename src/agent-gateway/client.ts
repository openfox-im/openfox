import { WebSocket } from "ws";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  discoverCapabilityProviders,
  recordAgentDiscoveryProviderFeedback,
} from "../agent-discovery/client.js";
import type { VerifiedAgentProvider } from "../agent-discovery/types.js";
import { loadWalletPrivateKey } from "../identity/wallet.js";
import {
  buildTOSX402Payment as buildPayment,
  recordTOSReputationScore as recordReputationScore,
  type TOSPaymentEnvelope,
} from "../tos/client.js";
import { resolveVerifiedGatewayBootnodes } from "./bootnodes.js";
import { signGatewaySessionAuth } from "./auth.js";
import {
  AGENT_GATEWAY_E2E_HEADER,
  AGENT_GATEWAY_E2E_RESPONSE_HEADER,
  AGENT_GATEWAY_E2E_SCHEME,
  decryptAgentGatewayPayload,
  encryptAgentGatewayPayload,
  type AgentGatewayEncryptedEnvelope,
} from "./e2e.js";
import {
  buildStableGatewayPathToken,
  normalizeGatewayPath,
  type AgentGatewayAllocatedEndpoint,
  type AgentGatewayErrorFrame,
  type AgentGatewayFrame,
  type AgentGatewayProviderRoute,
  type AgentGatewayRelayRequest,
  type AgentGatewayRelayResponse,
  type AgentGatewayRelayResponseChunk,
  type AgentGatewayRelayResponseEnd,
  type AgentGatewayRelayResponseStart,
  type AgentGatewayRouteAdd,
  type AgentGatewayRouteRegistration,
  type AgentGatewayRouteRemove,
  type AgentGatewayRouteUpdateAck,
  type AgentGatewaySessionOpen,
  type AgentGatewaySessionResume,
  type StartedAgentGatewayProviderSession,
  type StartedAgentGatewayProviderSessions,
} from "./types.js";

const logger = createLogger("agent-gateway.client");
const BODY_LIMIT_BYTES = 128 * 1024;

interface GatewayTarget {
  gatewayAgentId: string;
  gatewayUrl: string;
  paymentAddress?: `0x${string}`;
  provider?: VerifiedAgentProvider;
  paymentDirection?: "provider_pays" | "requester_pays" | "split";
  sessionFeeWei?: string;
  perRequestFeeWei?: string;
}

interface RouteUpdateWaiter {
  resolve(result: AgentGatewayRouteUpdateAck): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function targetKey(target: GatewayTarget): string {
  return `${target.gatewayAgentId}:${target.gatewayUrl}`;
}

function sessionCacheKey(agentId: string, gatewayAgentId: string): string {
  return `agent_gateway:last_session:${agentId.toLowerCase()}:${gatewayAgentId.toLowerCase()}`;
}

function parseFrame(raw: WebSocket.RawData): AgentGatewayFrame {
  const payload = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  return JSON.parse(payload) as AgentGatewayFrame;
}

function filterForwardHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "connection" ||
      lower === "transfer-encoding" ||
      lower === "content-length"
    ) {
      return;
    }
    out[key] = value;
  });
  return out;
}

function targetPaymentMetadata(
  target: GatewayTarget,
): Pick<
  GatewayTarget,
  "paymentDirection" | "sessionFeeWei" | "perRequestFeeWei"
> {
  const policy =
    target.provider?.matchedCapability.policy &&
    typeof target.provider.matchedCapability.policy === "object"
      ? target.provider.matchedCapability.policy
      : undefined;
  return {
    paymentDirection:
      (typeof policy?.payment_direction === "string"
        ? policy.payment_direction
        : target.paymentDirection) as
        | "provider_pays"
        | "requester_pays"
        | "split"
        | undefined,
    sessionFeeWei:
      typeof policy?.session_fee_tos === "string"
        ? policy.session_fee_tos
        : target.sessionFeeWei,
    perRequestFeeWei:
      typeof policy?.per_request_fee_tos === "string"
        ? policy.per_request_fee_tos
        : target.perRequestFeeWei,
  };
}

async function selectGatewayTargets(params: {
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
}): Promise<GatewayTarget[]> {
  const client = params.config.agentDiscovery?.gatewayClient;
  const targets: GatewayTarget[] = [];
  const seen = new Set<string>();

  const addTarget = (target: GatewayTarget) => {
    const key = targetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  if (client?.gatewayAgentId && client.gatewayUrl) {
    addTarget({
      gatewayAgentId: client.gatewayAgentId.toLowerCase(),
      gatewayUrl: client.gatewayUrl,
    });
  }

  if (params.config.agentDiscovery?.enabled) {
    try {
      const providers = await discoverCapabilityProviders({
        config: params.config,
        capability: "gateway.relay",
        limit: Math.max(5, client?.maxGatewaySessions ?? 1),
        db: params.db,
      });
      for (const provider of providers) {
        if (provider.endpoint.kind !== "ws") {
          continue;
        }
        const payment = targetPaymentMetadata({
          gatewayAgentId: provider.card.agent_id.toLowerCase(),
          gatewayUrl: provider.endpoint.url,
          provider,
        });
        addTarget({
          gatewayAgentId: provider.card.agent_id.toLowerCase(),
          gatewayUrl: provider.endpoint.url,
          paymentAddress: provider.search.primaryIdentity as `0x${string}` | undefined,
          provider,
          ...payment,
        });
      }
    } catch (error) {
      logger.warn(
        `Gateway discovery failed, falling back to bootnodes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const bootnode of await resolveVerifiedGatewayBootnodes(params.config)) {
    addTarget({
      gatewayAgentId: bootnode.agentId.toLowerCase(),
      gatewayUrl: bootnode.url,
      paymentAddress: bootnode.payToAddress,
      paymentDirection: bootnode.paymentDirection,
      sessionFeeWei: bootnode.sessionFeeWei,
      perRequestFeeWei: bootnode.perRequestFeeWei,
    });
  }

  const limit = Math.max(1, client?.maxGatewaySessions ?? 1);
  return targets.slice(0, limit);
}

function recordGatewayFeedback(params: {
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
  target: GatewayTarget;
  outcome: "success" | "failure" | "timeout" | "malformed";
  requestNonce?: string;
  privateKey?: `0x${string}`;
}): void {
  if (!params.target.provider) {
    return;
  }
  const gatewayFeedbackEnabled =
    params.config.agentDiscovery?.gatewayClient?.feedback?.enabled ?? false;
  recordAgentDiscoveryProviderFeedback({
    db: params.db,
    config: params.config,
    provider: params.target.provider,
    capability: "gateway.relay",
    outcome: params.outcome,
    requestNonce: params.requestNonce,
    skipReputationUpdate: gatewayFeedbackEnabled,
  });
  if (!gatewayFeedbackEnabled) {
    return;
  }
  const feedback = params.config.agentDiscovery?.gatewayClient?.feedback;
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  const who = params.target.provider.search.primaryIdentity;
  const privateKey = params.privateKey || loadWalletPrivateKey();
  if (!feedback || !rpcUrl || !who || !privateKey) {
    return;
  }
  const delta =
    params.outcome === "success"
      ? feedback.successDelta
      : params.outcome === "timeout"
        ? feedback.timeoutDelta
        : params.outcome === "malformed"
          ? feedback.malformedDelta
          : feedback.failureDelta;
  recordReputationScore({
    rpcUrl,
    privateKey,
    who,
    delta,
    reason: `${feedback.reasonPrefix}:${params.outcome}:gateway.relay`,
    refId: [
      "agent-gateway",
      params.target.provider.search.nodeId,
      params.requestNonce || "no-nonce",
    ].join(":"),
    gas: BigInt(feedback.gas),
    waitForReceipt: false,
  }).catch(() => undefined);
}

async function buildSessionPayment(params: {
  config: OpenFoxConfig;
  target: GatewayTarget;
  privateKey?: `0x${string}`;
}): Promise<TOSPaymentEnvelope | undefined> {
  const payment = targetPaymentMetadata(params.target);
  if (
    payment.paymentDirection !== "provider_pays" &&
    payment.paymentDirection !== "split"
  ) {
    return undefined;
  }
  const sessionFeeWei = payment.sessionFeeWei || "0";
  if (!/^\d+$/.test(sessionFeeWei) || BigInt(sessionFeeWei) === 0n) {
    return undefined;
  }
  const privateKey = params.privateKey || loadWalletPrivateKey();
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!privateKey || !rpcUrl) {
    throw new Error("gateway session payment requires a local wallet and chain RPC");
  }
  const payToAddress = params.target.paymentAddress;
  if (!payToAddress) {
    throw new Error("gateway session payment requires the gateway payment address");
  }
  const chainId =
    params.config.chainId !== undefined
      ? BigInt(params.config.chainId)
      : undefined;
  return buildPayment({
    privateKey,
    rpcUrl,
    requirement: {
      scheme: "exact",
      network: chainId ? `tos:${chainId}` : "tos:1666",
      maxAmountRequired: sessionFeeWei,
      payToAddress,
    },
  });
}

async function handleRelayRequest(params: {
  config: OpenFoxConfig;
  routeMap: Map<string, AgentGatewayProviderRoute>;
  frame: AgentGatewayRelayRequest;
  privateKey?: `0x${string}`;
}): Promise<
  | AgentGatewayRelayResponse
  | AgentGatewayErrorFrame
  | AgentGatewayRelayResponseStart
  | AgentGatewayRelayResponseChunk
  | AgentGatewayRelayResponseEnd
  | Array<
      | AgentGatewayRelayResponseStart
      | AgentGatewayRelayResponseChunk
      | AgentGatewayRelayResponseEnd
      | AgentGatewayErrorFrame
    >
> {
  const route = params.routeMap.get(normalizeGatewayPath(params.frame.path));
  if (!route) {
    return {
      type: "error",
      request_id: params.frame.request_id,
      error: `unregistered route ${params.frame.path}`,
    };
  }

  const headers = { ...params.frame.headers };
  let body: Uint8Array | undefined =
    params.frame.body_base64 &&
    params.frame.method !== "GET" &&
    params.frame.method !== "HEAD"
      ? Uint8Array.from(Buffer.from(params.frame.body_base64, "base64"))
      : undefined;

  const wantsE2E =
    headers[AGENT_GATEWAY_E2E_HEADER] === AGENT_GATEWAY_E2E_SCHEME &&
    params.config.agentDiscovery?.gatewayClient?.enableE2E;
  const localPrivateKey =
    wantsE2E ? params.privateKey || loadWalletPrivateKey() : undefined;
  let encryptedResponse = false;
  if (wantsE2E) {
    if (!localPrivateKey) {
      return {
        type: "error",
        request_id: params.frame.request_id,
        error: "missing local wallet private key for E2E relay",
      };
    }
    const envelope = JSON.parse(
      Buffer.from(body || new Uint8Array()).toString("utf8") || "{}",
    ) as AgentGatewayEncryptedEnvelope;
    body = decryptAgentGatewayPayload({
      envelope,
      recipientPrivateKey: localPrivateKey,
    });
    delete headers[AGENT_GATEWAY_E2E_HEADER];
    encryptedResponse = true;
  }

  try {
    if (body && body.byteLength > BODY_LIMIT_BYTES) {
      throw new Error("relayed body exceeds local limit");
    }

    const response = await fetch(route.targetUrl, {
      method: params.frame.method,
      headers,
      body:
        params.frame.method === "GET" || params.frame.method === "HEAD"
          ? undefined
          : body
            ? Buffer.from(body)
            : undefined,
    });

    const responseHeaders = filterForwardHeaders(response.headers);
    if (
      route.stream ||
      response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      if (encryptedResponse) {
        return {
          type: "error",
          request_id: params.frame.request_id,
          error: "E2E relay is not supported for streaming routes",
        };
      }
      const frames: Array<
        | AgentGatewayRelayResponseStart
        | AgentGatewayRelayResponseChunk
        | AgentGatewayRelayResponseEnd
        | AgentGatewayErrorFrame
      > = [
        {
          type: "response_start",
          request_id: params.frame.request_id,
          status: response.status,
          headers: responseHeaders,
        },
      ];
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          frames.push({
            type: "response_chunk",
            request_id: params.frame.request_id,
            body_base64: Buffer.from(chunk.value).toString("base64"),
          });
        }
      }
      frames.push({
        type: "response_end",
        request_id: params.frame.request_id,
      });
      return frames;
    }

    const responseBody =
      params.frame.method === "HEAD"
        ? Buffer.alloc(0)
        : Buffer.from(await response.arrayBuffer());

    if (encryptedResponse && localPrivateKey) {
      const requestEnvelope = JSON.parse(
        params.frame.body_base64
          ? Buffer.from(params.frame.body_base64, "base64").toString("utf8")
          : "{}",
      ) as AgentGatewayEncryptedEnvelope;
      const encrypted = encryptAgentGatewayPayload({
        plaintext: responseBody,
        recipientPublicKey: requestEnvelope.ephemeral_pubkey,
      });
      responseHeaders[AGENT_GATEWAY_E2E_RESPONSE_HEADER] =
        AGENT_GATEWAY_E2E_SCHEME;
      responseHeaders["content-type"] = "application/json";
      return {
        type: "response",
        request_id: params.frame.request_id,
        status: response.status,
        headers: responseHeaders,
        body_base64: Buffer.from(JSON.stringify(encrypted), "utf8").toString(
          "base64",
        ),
      };
    }

    return {
      type: "response",
      request_id: params.frame.request_id,
      status: response.status,
      headers: responseHeaders,
      body_base64: responseBody.byteLength
        ? responseBody.toString("base64")
        : undefined,
    };
  } catch (error) {
    return {
      type: "error",
      request_id: params.frame.request_id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function establishGatewaySession(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  routes: AgentGatewayProviderRoute[];
  target: GatewayTarget;
  db?: OpenFoxDatabase;
  privateKey?: `0x${string}`;
  previousSessionId?: string;
}): Promise<StartedAgentGatewayProviderSession> {
  const clientConfig = params.config.agentDiscovery?.gatewayClient;
  if (!clientConfig?.enabled) {
    throw new Error("gateway client is not enabled");
  }

  const auth = await signGatewaySessionAuth({
    account: params.identity.account,
    agentId: (params.config.agentId || params.identity.address).toLowerCase(),
    primaryIdentity: {
      kind: "tos",
      value: params.address.toLowerCase(),
    },
    gatewayAgentId: params.target.gatewayAgentId,
    ttlSeconds: clientConfig.sessionTtlSeconds,
  });
  const payment = await buildSessionPayment({
    config: params.config,
    target: params.target,
    privateKey: params.privateKey,
  });
  const normalizedRoutes = params.routes.map((route) => ({
    path: normalizeGatewayPath(route.path),
    capability: route.capability,
    mode: route.mode,
    stream: route.stream,
  }));
  const initialFrame: AgentGatewaySessionOpen | AgentGatewaySessionResume =
    params.previousSessionId
      ? {
          type: "session_resume",
          previous_session_id: params.previousSessionId,
          auth,
          routes: normalizedRoutes,
          payment,
        }
      : {
          type: "session_open",
          auth,
          routes: normalizedRoutes,
          payment,
        };

  const ws = new WebSocket(params.target.gatewayUrl);
  const routeMap = new Map(
    params.routes.map((route) => [normalizeGatewayPath(route.path), route]),
  );

  return await new Promise<StartedAgentGatewayProviderSession>(
    (resolve, reject) => {
      let sessionId: string | null = null;
      let publicPathToken = "";
      let settled = false;
      let allocatedEndpoints: AgentGatewayAllocatedEndpoint[] = [];
      let closing = false;
      let closed = false;
      let closedResolve!: () => void;
      const closedPromise = new Promise<void>((resolveClosed) => {
        closedResolve = resolveClosed;
      });
      let pendingRouteUpdate: RouteUpdateWaiter | null = null;

      const clearPendingRouteUpdate = (error?: Error) => {
        if (!pendingRouteUpdate) return;
        clearTimeout(pendingRouteUpdate.timer);
        const waiter = pendingRouteUpdate;
        pendingRouteUpdate = null;
        if (error) {
          waiter.reject(error);
          return;
        }
      };

      const finalizeClose = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearPendingRouteUpdate(new Error("gateway session closed"));
        closedResolve();
      };

      const openTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          recordGatewayFeedback({
            config: params.config,
            db: params.db,
            target: params.target,
            outcome: "timeout",
            requestNonce: auth.session_nonce,
            privateKey: params.privateKey,
          });
          reject(new Error("gateway session open timed out"));
        }
      }, clientConfig.requestTimeoutMs);

      const sendRouteUpdate = async (
        frame: AgentGatewayRouteAdd | AgentGatewayRouteRemove,
      ): Promise<AgentGatewayRouteUpdateAck> => {
        if (closed) {
          throw new Error("gateway session is closed");
        }
        if (pendingRouteUpdate) {
          throw new Error("another gateway route update is in flight");
        }
        return await new Promise<AgentGatewayRouteUpdateAck>((resolveAck, rejectAck) => {
          const timer = setTimeout(() => {
            pendingRouteUpdate = null;
            rejectAck(new Error("gateway route update timed out"));
          }, clientConfig.requestTimeoutMs);
          pendingRouteUpdate = {
            resolve: resolveAck,
            reject: rejectAck,
            timer,
          };
          ws.send(JSON.stringify(frame));
        });
      };

      ws.on("open", () => {
        ws.send(JSON.stringify(initialFrame));
      });

      ws.on("message", async (raw) => {
        try {
          const frame = parseFrame(raw);
          if (frame.type === "session_open_ack") {
            sessionId = frame.session_id;
            allocatedEndpoints = frame.allocated_endpoints;
            publicPathToken =
              allocatedEndpoints[0]?.public_url
                .replace(/^https?:\/\/[^/]+\//, "")
                .split("/")[1] ||
              buildStableGatewayPathToken(
                params.config.agentId || params.identity.address,
              );
            if (params.db) {
              params.db.setKV(
                sessionCacheKey(
                  params.config.agentId || params.identity.address,
                  params.target.gatewayAgentId,
                ),
                JSON.stringify({
                  sessionId,
                  publicPathToken,
                  updatedAt: new Date().toISOString(),
                }),
              );
            }
            if (!settled) {
              settled = true;
              clearTimeout(openTimer);
              recordGatewayFeedback({
                config: params.config,
                db: params.db,
                target: params.target,
                outcome: "success",
                requestNonce: auth.session_nonce,
                privateKey: params.privateKey,
              });
              const session: StartedAgentGatewayProviderSession = {
                gatewayAgentId: params.target.gatewayAgentId,
                gatewayUrl: params.target.gatewayUrl,
                sessionId,
                allocatedEndpoints,
                publicPathToken,
                provider: params.target.provider
                  ? {
                      nodeId: params.target.provider.search.nodeId,
                      reputation:
                        params.target.provider.search.trust?.reputation,
                      stake: params.target.provider.search.trust?.stake,
                    }
                  : undefined,
                closed: closedPromise,
                addRoutes: async (routes) => {
                  const normalized = routes.map((route) => ({
                    path: normalizeGatewayPath(route.path),
                    capability: route.capability,
                    mode: route.mode,
                    stream: route.stream,
                  }));
                  const ack = await sendRouteUpdate({
                    type: "route_add",
                    routes: normalized,
                  });
                  for (const route of routes) {
                    routeMap.set(normalizeGatewayPath(route.path), route);
                  }
                  allocatedEndpoints = [
                    ...allocatedEndpoints.filter(
                      (endpoint) =>
                        !ack.added.some(
                          (added) => added.path === endpoint.path,
                        ),
                    ),
                    ...ack.added,
                  ];
                  session.allocatedEndpoints = allocatedEndpoints;
                  return ack.added;
                },
                removeRoutes: async (paths) => {
                  const normalized = paths.map((path) => normalizeGatewayPath(path));
                  const ack = await sendRouteUpdate({
                    type: "route_remove",
                    paths: normalized,
                  });
                  for (const path of normalized) {
                    routeMap.delete(path);
                  }
                  allocatedEndpoints = allocatedEndpoints.filter(
                    (endpoint) => !ack.removed.includes(endpoint.path),
                  );
                  session.allocatedEndpoints = allocatedEndpoints;
                  return ack.removed;
                },
                close: async () => {
                  if (closing || closed) {
                    await closedPromise;
                    return;
                  }
                  closing = true;
                  ws.close();
                  await closedPromise;
                },
              };
              resolve(session);
            }
            return;
          }

          if (frame.type === "route_update_ack") {
            if (!pendingRouteUpdate) {
              return;
            }
            clearTimeout(pendingRouteUpdate.timer);
            const waiter = pendingRouteUpdate;
            pendingRouteUpdate = null;
            waiter.resolve(frame);
            return;
          }

          if (frame.type === "request") {
            const response = await handleRelayRequest({
              config: params.config,
              routeMap,
              frame,
              privateKey: params.privateKey,
            });
            const frames = Array.isArray(response) ? response : [response];
            for (const entry of frames) {
              ws.send(JSON.stringify(entry));
            }
            return;
          }

          if (frame.type === "error") {
            if (pendingRouteUpdate) {
              const waiter = pendingRouteUpdate;
              pendingRouteUpdate = null;
              clearTimeout(waiter.timer);
              waiter.reject(new Error(frame.error));
              return;
            }
            if (!settled) {
              settled = true;
              clearTimeout(openTimer);
              recordGatewayFeedback({
                config: params.config,
                db: params.db,
                target: params.target,
                outcome: "malformed",
                requestNonce: auth.session_nonce,
                privateKey: params.privateKey,
              });
              reject(new Error(frame.error));
            }
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            clearTimeout(openTimer);
            recordGatewayFeedback({
              config: params.config,
              db: params.db,
              target: params.target,
              outcome: "malformed",
              requestNonce: auth.session_nonce,
              privateKey: params.privateKey,
            });
            reject(error instanceof Error ? error : new Error(String(error)));
          } else if (pendingRouteUpdate) {
            const waiter = pendingRouteUpdate;
            pendingRouteUpdate = null;
            clearTimeout(waiter.timer);
            waiter.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
          } else {
            logger.warn(
              `Gateway provider session message handling failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      });

      ws.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(openTimer);
          recordGatewayFeedback({
            config: params.config,
            db: params.db,
            target: params.target,
            outcome: "failure",
            requestNonce: auth.session_nonce,
            privateKey: params.privateKey,
          });
          reject(error);
        } else if (pendingRouteUpdate) {
          clearPendingRouteUpdate(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });

      ws.on("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(openTimer);
          recordGatewayFeedback({
            config: params.config,
            db: params.db,
            target: params.target,
            outcome: "failure",
            requestNonce: auth.session_nonce,
            privateKey: params.privateKey,
          });
          reject(new Error("gateway session closed before ack"));
        } else if (sessionId) {
          logger.warn(`Gateway provider session ${sessionId} closed`);
        }
        finalizeClose();
      });
    },
  );
}

async function openSingleGatewaySession(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  routes: AgentGatewayProviderRoute[];
  target: GatewayTarget;
  db?: OpenFoxDatabase;
  privateKey?: `0x${string}`;
}): Promise<StartedAgentGatewayProviderSession> {
  const cacheRaw = params.db?.getKV(
    sessionCacheKey(
      params.config.agentId || params.identity.address,
      params.target.gatewayAgentId,
    ),
  );
  const previousSessionId = cacheRaw
    ? (() => {
        try {
          const parsed = JSON.parse(cacheRaw) as { sessionId?: string };
          return typeof parsed.sessionId === "string" ? parsed.sessionId : undefined;
        } catch {
          return undefined;
        }
      })()
    : undefined;

  if (previousSessionId) {
    try {
      return await establishGatewaySession({
        ...params,
        previousSessionId,
      });
    } catch (error) {
      logger.warn(
        `Gateway session resume failed for ${params.target.gatewayAgentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return establishGatewaySession(params);
}

export async function startAgentGatewayProviderSession(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  routes: AgentGatewayProviderRoute[];
  db?: OpenFoxDatabase;
  privateKey?: `0x${string}`;
}): Promise<StartedAgentGatewayProviderSession> {
  const sessions = await startAgentGatewayProviderSessions(params);
  if (!sessions.sessions.length) {
    throw new Error("no gateway session established");
  }
  return sessions.sessions[0];
}

export async function startAgentGatewayProviderSessions(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  routes: AgentGatewayProviderRoute[];
  db?: OpenFoxDatabase;
  privateKey?: `0x${string}`;
}): Promise<StartedAgentGatewayProviderSessions> {
  const clientConfig = params.config.agentDiscovery?.gatewayClient;
  if (!clientConfig?.enabled) {
    throw new Error("gateway client is not enabled");
  }
  if (!params.routes.length) {
    throw new Error("no gateway routes configured");
  }

  const targets = await selectGatewayTargets({
    config: params.config,
    db: params.db,
  });
  if (!targets.length) {
    throw new Error("no gateway target configured");
  }

  const sessions: StartedAgentGatewayProviderSession[] = [];
  for (const target of targets) {
    try {
      const session = await openSingleGatewaySession({
        identity: params.identity,
        config: params.config,
        address: params.address,
        routes: params.routes,
        target,
        db: params.db,
        privateKey: params.privateKey,
      });
      sessions.push(session);
    } catch (error) {
      logger.warn(
        `Gateway session failed for ${target.gatewayAgentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!sessions.length) {
    throw new Error("failed to establish any gateway session");
  }

  return {
    sessions,
    close: async () => {
      await Promise.allSettled(sessions.map((session) => session.close()));
    },
  };
}
