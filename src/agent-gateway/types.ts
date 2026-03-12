import type {
  AgentDiscoveryCapabilityMode,
  AgentGatewayClientRouteConfig,
  AgentGatewayServerConfig,
  OpenFoxIdentity,
} from "../types.js";
import type { PaymentEnvelope } from "../chain/client.js";
import { createHash } from "crypto";

export interface AgentGatewayIdentityRef {
  kind: string;
  value: string;
}

export interface AgentGatewaySessionAuthPayload {
  version: number;
  agent_id: string;
  primary_identity: AgentGatewayIdentityRef;
  metadata_signer: {
    kind: "eip191";
    address: string;
  };
  gateway_agent_id: string;
  session_nonce: string;
  issued_at: number;
  expires_at: number;
}

export interface AgentGatewaySessionAuth extends AgentGatewaySessionAuthPayload {
  signature: `0x${string}`;
}

export interface AgentGatewayRouteRegistration {
  path: string;
  capability: string;
  mode: AgentDiscoveryCapabilityMode;
  stream?: boolean;
}

export interface AgentGatewayProviderRoute
  extends AgentGatewayClientRouteConfig {}

export interface AgentGatewayAllocatedEndpoint {
  path: string;
  public_url: string;
}

export interface AgentGatewaySessionOpen {
  type: "session_open";
  auth: AgentGatewaySessionAuth;
  routes: AgentGatewayRouteRegistration[];
  payment?: PaymentEnvelope;
}

export interface AgentGatewaySessionResume {
  type: "session_resume";
  previous_session_id: string;
  auth: AgentGatewaySessionAuth;
  routes?: AgentGatewayRouteRegistration[];
  payment?: PaymentEnvelope;
}

export interface AgentGatewaySessionOpenAck {
  type: "session_open_ack";
  session_id: string;
  allocated_endpoints: AgentGatewayAllocatedEndpoint[];
  relay_pricing: {
    mode: AgentDiscoveryCapabilityMode;
    note?: string;
  };
}

export interface AgentGatewayRelayRequest {
  type: "request";
  request_id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body_base64?: string;
}

export interface AgentGatewayRelayResponseStart {
  type: "response_start";
  request_id: string;
  status: number;
  headers: Record<string, string>;
}

export interface AgentGatewayRelayResponseChunk {
  type: "response_chunk";
  request_id: string;
  body_base64: string;
}

export interface AgentGatewayRelayResponse {
  type: "response";
  request_id: string;
  status: number;
  headers: Record<string, string>;
  body_base64?: string;
}

export interface AgentGatewayRelayResponseEnd {
  type: "response_end";
  request_id: string;
}

export interface AgentGatewayRouteAdd {
  type: "route_add";
  routes: AgentGatewayRouteRegistration[];
}

export interface AgentGatewayRouteRemove {
  type: "route_remove";
  paths: string[];
}

export interface AgentGatewayRouteUpdateAck {
  type: "route_update_ack";
  added: AgentGatewayAllocatedEndpoint[];
  removed: string[];
}

export interface AgentGatewayErrorFrame {
  type: "error";
  request_id?: string;
  error: string;
}

export type AgentGatewayFrame =
  | AgentGatewaySessionOpen
  | AgentGatewaySessionResume
  | AgentGatewaySessionOpenAck
  | AgentGatewayRelayRequest
  | AgentGatewayRelayResponseStart
  | AgentGatewayRelayResponseChunk
  | AgentGatewayRelayResponse
  | AgentGatewayRelayResponseEnd
  | AgentGatewayRouteAdd
  | AgentGatewayRouteRemove
  | AgentGatewayRouteUpdateAck
  | AgentGatewayErrorFrame;

export interface StartedAgentGatewayServer {
  gatewayAgentId: string;
  sessionUrl: string;
  publicBaseUrl: string;
  close(): Promise<void>;
}

export interface StartedAgentGatewayProviderSession {
  gatewayAgentId: string;
  gatewayUrl: string;
  sessionId: string;
  allocatedEndpoints: AgentGatewayAllocatedEndpoint[];
  publicPathToken: string;
  provider?: {
    nodeId: string;
    reputation?: string;
    stake?: string;
  };
  closed: Promise<void>;
  addRoutes(routes: AgentGatewayProviderRoute[]): Promise<AgentGatewayAllocatedEndpoint[]>;
  removeRoutes(paths: string[]): Promise<string[]>;
  close(): Promise<void>;
}

export interface StartedAgentGatewayProviderSessions {
  sessions: StartedAgentGatewayProviderSession[];
  close(): Promise<void>;
}

export interface AgentGatewayPublishContext {
  gatewayServer?: StartedAgentGatewayServer;
  providerSession?: StartedAgentGatewayProviderSession;
  providerRoutes?: AgentGatewayProviderRoute[];
}

export function normalizeGatewayPath(path: string): string {
  if (!path.trim()) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

export function gatewayAgentIdFromIdentity(identity: OpenFoxIdentity): string {
  return identity.address.toLowerCase();
}

export function buildGatewaySessionUrl(
  config: AgentGatewayServerConfig,
  port: number,
): string {
  const base = new URL(config.publicBaseUrl);
  base.port = String(port);
  base.pathname = config.sessionPath.startsWith("/")
    ? config.sessionPath
    : `/${config.sessionPath}`;
  if (base.protocol === "https:") {
    base.protocol = "wss:";
  } else if (base.protocol === "http:") {
    base.protocol = "ws:";
  }
  return base.toString();
}

export function buildGatewayPublicUrl(params: {
  publicBaseUrl: string;
  publicPathPrefix: string;
  pathToken: string;
  path: string;
}): string {
  const base = new URL(params.publicBaseUrl);
  const routePath = normalizeGatewayPath(params.path);
  const prefix = params.publicPathPrefix.startsWith("/")
    ? params.publicPathPrefix
    : `/${params.publicPathPrefix}`;
  base.pathname = `${prefix}/${params.pathToken}${routePath}`;
  return base.toString();
}

export function buildStableGatewayPathToken(agentId: string): string {
  return createHash("sha256")
    .update(agentId.toLowerCase())
    .digest("hex")
    .slice(0, 16);
}
