import type {
  AgentDiscoveryCapabilityConfig,
  AgentDiscoveryCapabilityMode,
  AgentDiscoveryConfig,
  AgentDiscoveryEndpointConfig,
  AgentDiscoveryFaucetServerConfig,
  AgentDiscoveryObservationServerConfig,
  AgentDiscoveryPolicyProfiles,
  AgentDiscoverySelectionPolicy,
} from "../types.js";

export type {
  AgentDiscoveryConfig,
  AgentDiscoveryCapabilityConfig,
  AgentDiscoveryEndpointConfig,
  AgentDiscoveryFaucetServerConfig,
  AgentDiscoveryObservationServerConfig,
  AgentDiscoveryPolicyProfiles,
  AgentDiscoverySelectionPolicy,
};

export interface AgentDiscoveryIdentityRef {
  kind: string;
  value: string;
}

export interface AgentDiscoveryEndpoint {
  kind: AgentDiscoveryEndpointConfig["kind"];
  url: string;
  via_gateway?: string;
  role?: string;
}

export interface AgentDiscoveryCapability {
  name: string;
  mode: AgentDiscoveryCapabilityMode;
  policy_ref?: string;
  policy?: Record<string, unknown>;
  rate_limit?: string;
  max_amount?: string;
  price_model?: string;
  description?: string;
}

export interface AgentDiscoveryCardPayload {
  version: number;
  agent_id: string;
  primary_identity: AgentDiscoveryIdentityRef;
  discovery_node_id: string;
  card_seq: number;
  issued_at: number;
  expires_at: number;
  display_name: string;
  endpoints: AgentDiscoveryEndpoint[];
  capabilities: AgentDiscoveryCapability[];
  reputation_refs: string[];
  relay_encryption_pubkey?: `0x${string}`;
  metadata_signer: {
    kind: "eip191";
    address: string;
  };
}

export interface AgentDiscoveryCard extends AgentDiscoveryCardPayload {
  signature: `0x${string}`;
}

export interface AgentDiscoveryInfo {
  enabled: boolean;
  profileVersion: number;
  talkProtocol: string;
  nodeId?: string;
  nodeRecord?: string;
  primaryIdentity?: string;
  cardSequence?: number;
  connectionModes?: number;
  capabilities?: string[];
  hasPublishedCard?: boolean;
}

export interface AgentDiscoverySearchResult {
  nodeId: string;
  nodeRecord: string;
  primaryIdentity?: string;
  connectionModes?: number;
  cardSequence?: number;
  capabilities?: string[];
  trust?: AgentDiscoveryTrustSummary;
}

export interface AgentDiscoveryTrustSummary {
  registered: boolean;
  suspended: boolean;
  stake: string;
  stakeBucket?: string;
  reputation: string;
  reputationBucket?: string;
  ratingCount: string;
  capabilityRegistered: boolean;
  capabilityBit?: number;
  hasOnchainCapability: boolean;
  localRankScore?: number;
  localRankReason?: string;
}

export interface AgentDiscoveryLocalFeedback {
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  malformedCount: number;
  lastOutcomeAt?: string;
  localScore: number;
}

export interface AgentDiscoveryCardResponse {
  nodeId: string;
  nodeRecord: string;
  cardJson: string;
}

export interface VerifiedAgentProvider {
  search: AgentDiscoverySearchResult;
  card: AgentDiscoveryCard;
  matchedCapability: AgentDiscoveryCapability;
  endpoint: AgentDiscoveryEndpoint;
  localFeedback?: AgentDiscoveryLocalFeedback;
}

export interface FaucetInvocationRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  requested_amount: string;
  reason: string;
}

export interface FaucetInvocationResponse {
  status:
    | "approved"
    | "rejected"
    | "challenge_required"
    | "paid_upgrade_required";
  transfer_network?: string;
  tx_hash?: string;
  amount?: string;
  cooldown_until?: number;
  reason?: string;
}

export interface ObservationInvocationRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  target_url: string;
  reason: string;
}

export interface ObservationInvocationResponse {
  status: "ok";
  job_id?: string;
  result_url?: string;
  payment_tx_hash?: string;
  idempotent?: boolean;
  observed_at: number;
  target_url: string;
  http_status: number;
  content_type: string;
  body_text?: string;
  body_json?: unknown;
  body_sha256: string;
  size_bytes: number;
}

export function capabilityFromConfig(
  capability: AgentDiscoveryCapabilityConfig,
): AgentDiscoveryCapability {
  return {
    name: capability.name.trim().toLowerCase(),
    mode: capability.mode,
    policy_ref: capability.policyRef,
    policy: capability.policy,
    rate_limit: capability.rateLimit,
    max_amount: capability.maxAmount,
    price_model: capability.priceModel,
    description: capability.description,
  };
}

export function normalizeAgentDiscoveryConfig(
  config: AgentDiscoveryConfig | undefined,
  options?: { includeHostedServerEndpoints?: boolean },
): AgentDiscoveryConfig | null {
  if (!config?.enabled || !config.publishCard) {
    return null;
  }
  const includeHostedServerEndpoints =
    options?.includeHostedServerEndpoints ?? true;
  const endpoints = config.endpoints.filter(
    (entry) => entry.url.trim().length > 0,
  );
  const capabilities = config.capabilities
    .map(capabilityFromConfig)
    .filter((entry) => entry.name.length > 0);
  const faucetServer = config.faucetServer;
  if (includeHostedServerEndpoints && faucetServer?.enabled) {
    const faucetUrl = buildFaucetServerUrl(faucetServer);
    if (!endpoints.some((entry) => entry.url === faucetUrl)) {
      endpoints.push({
        kind: "http",
        url: faucetUrl,
        role: "requester_invocation",
      });
    }
    if (!capabilities.some((entry) => entry.name === faucetServer.capability)) {
      capabilities.push({
        name: faucetServer.capability,
        mode: "sponsored",
        max_amount: faucetServer.maxAmountWei,
        rate_limit: `1/${Math.max(1, faucetServer.cooldownSeconds)}s`,
      });
    }
  }
  const observationServer = config.observationServer;
  if (includeHostedServerEndpoints && observationServer?.enabled) {
    const observationUrl = buildObservationServerUrl(observationServer);
    if (!endpoints.some((entry) => entry.url === observationUrl)) {
      endpoints.push({
        kind: "http",
        url: observationUrl,
        role: "requester_invocation",
      });
    }
    if (
      !capabilities.some((entry) => entry.name === observationServer.capability)
    ) {
      capabilities.push({
        name: observationServer.capability,
        mode: "paid",
        price_model: "x402-exact",
        description: "One-shot paid observation capability",
      });
    }
  }
  if (!endpoints.length || !capabilities.length) {
    return null;
  }
  return {
    ...config,
    endpoints,
    capabilities: capabilities.map((entry) => ({
      name: entry.name,
      mode: entry.mode,
      policyRef: entry.policy_ref,
      rateLimit: entry.rate_limit,
      policy: entry.policy,
      maxAmount: entry.max_amount,
      priceModel: entry.price_model,
      description: entry.description,
    })),
  };
}

export function buildFaucetServerUrl(
  config: AgentDiscoveryFaucetServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}

export function buildObservationServerUrl(
  config: AgentDiscoveryObservationServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}
