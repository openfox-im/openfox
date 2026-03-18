import type {
  AgentDiscoveryCapabilityConfig,
  AgentDiscoveryCapabilityMode,
  AgentDiscoveryConfig,
  AgentDiscoveryEndpointConfig,
  AgentDiscoveryFaucetServerConfig,
  AgentDiscoveryNewsFetchServerConfig,
  NewsFetchSourcePolicyConfig,
  AgentDiscoveryObservationServerConfig,
  AgentDiscoveryOracleServerConfig,
  AgentDiscoveryPolicyProfiles,
  AgentDiscoveryProofVerifyServerConfig,
  ProofVerifierClass,
  AgentDiscoverySelectionPolicy,
  AgentDiscoverySentimentAnalysisServerConfig,
  AgentDiscoveryStorageServerConfig,
  VerificationSurfaceMode,
} from "../types.js";

export type {
  AgentDiscoveryConfig,
  AgentDiscoveryCapabilityConfig,
  AgentDiscoveryEndpointConfig,
  AgentDiscoveryFaucetServerConfig,
  AgentDiscoveryNewsFetchServerConfig,
  NewsFetchSourcePolicyConfig,
  AgentDiscoveryObservationServerConfig,
  AgentDiscoveryOracleServerConfig,
  AgentDiscoveryPolicyProfiles,
  AgentDiscoveryProofVerifyServerConfig,
  ProofVerifierClass,
  AgentDiscoverySelectionPolicy,
  AgentDiscoverySentimentAnalysisServerConfig,
  AgentDiscoveryStorageServerConfig,
  VerificationSurfaceMode,
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
  status: "ok" | "pending";
  job_id?: string;
  result_url?: string;
  payment_tx_hash?: string;
  payment_status?: string;
  reason?: string;
  binding_id?: string;
  binding_hash?: string;
  market_callback_tx_hash?: string;
  receipt_id?: string;
  receipt_hash?: string;
  settlement_tx_hash?: string;
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

export type OracleResolutionQueryKind = "binary" | "enum" | "scalar" | "text";

export interface OracleResolutionRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  query: string;
  query_kind: OracleResolutionQueryKind;
  options?: string[];
  context?: string;
  reason: string;
}

export interface OracleResolutionResponse {
  status: "ok" | "pending";
  result_id?: string;
  result_url?: string;
  price_wei?: string;
  payment_tx_hash?: string;
  payment_status?: string;
  reason?: string;
  binding_id?: string;
  binding_hash?: string;
  market_callback_tx_hash?: string;
  receipt_id?: string;
  receipt_hash?: string;
  settlement_tx_hash?: string;
  idempotent?: boolean;
  resolved_at: number;
  query: string;
  query_kind: OracleResolutionQueryKind;
  canonical_result: string;
  confidence: number;
  summary: string;
  options?: string[];
}

export interface SentimentAnalysisRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  text: string;
  reason: string;
}

export type SentimentLabel = "positive" | "negative" | "neutral" | "mixed";

export interface SentimentAnalysisResponse {
  status: "ok";
  result_id?: string;
  payment_tx_hash?: string;
  payment_status?: string;
  idempotent?: boolean;
  analyzed_at: number;
  text_preview: string;
  sentiment: SentimentLabel;
  confidence: number;
  summary: string;
}

export interface NewsFetchInvocationRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  source_url: string;
  source_policy_id?: string;
  publisher_hint?: string;
  headline_hint?: string;
  reason: string;
}

export interface NewsFetchInvocationResponse {
  status: "ok" | "integration_required";
  job_id?: string;
  result_url?: string;
  price_wei?: string;
  payment_tx_hash?: string;
  idempotent?: boolean;
  fetched_at: number;
  source_url: string;
  canonical_url?: string;
  publisher?: string;
  headline?: string;
  article_sha256?: string;
  article_text?: string;
  verification_mode?: VerificationSurfaceMode;
  native_proof_status?: "native_attested" | "fallback_only";
  zktls_bundle_format?: string;
  zktls_bundle_sha256?: string;
  zktls_bundle_url?: string;
  zktls_attestation_sha256?: string;
  zktls_attestation_url?: string;
  worker_provenance?: {
    worker: string;
    backend: string;
    native: boolean;
  };
  integration_message?: string;
  metadata?: Record<string, unknown>;
}

export type ProofVerifyVerdict = "valid" | "invalid" | "inconclusive";

export interface ProofVerifyInvocationRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  subject_url?: string;
  subject_sha256?: string;
  proof_bundle_url?: string;
  proof_bundle_sha256?: string;
  verifier_profile?: string;
  reason: string;
}

export interface ProofVerifyInvocationResponse {
  status: "ok" | "integration_required";
  result_id?: string;
  result_url?: string;
  price_wei?: string;
  payment_tx_hash?: string;
  idempotent?: boolean;
  verified_at: number;
  verdict: ProofVerifyVerdict;
  subject_url?: string;
  subject_sha256?: string;
  proof_bundle_sha256?: string;
  verifier_profile?: string;
  verification_mode?: VerificationSurfaceMode;
  verifier_class?: ProofVerifierClass;
  verifier_receipt_sha256?: string;
  attestation_verification?: Record<string, unknown>;
  consensus_verification?: Record<string, unknown>;
  worker_provenance?: {
    worker: string;
    backend: string;
    native: boolean;
  };
  integration_message?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface StoragePutInvocationRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  object_key?: string;
  content_type?: string;
  content_text?: string;
  content_base64?: string;
  ttl_seconds?: number;
  metadata?: Record<string, unknown>;
  reason: string;
}

export interface StoragePutInvocationResponse {
  status: "ok";
  object_id?: string;
  result_url?: string;
  price_wei?: string;
  payment_tx_hash?: string;
  idempotent?: boolean;
  stored_at: number;
  ttl_seconds?: number;
  expires_at?: number;
  object_key?: string;
  content_type: string;
  content_sha256: string;
  size_bytes: number;
  metadata?: Record<string, unknown>;
}

export interface StorageGetInvocationRequest {
  capability: string;
  requester: {
    agent_id: string;
    identity: AgentDiscoveryIdentityRef;
  };
  request_nonce: string;
  request_expires_at: number;
  object_id?: string;
  content_sha256?: string;
  inline_base64?: boolean;
  max_bytes?: number;
  reason: string;
}

export interface StorageGetInvocationResponse {
  status: "ok";
  payment_tx_hash?: string;
  idempotent?: boolean;
  fetched_at: number;
  object_id: string;
  expires_at?: number;
  content_type: string;
  content_sha256: string;
  size_bytes: number;
  content_text?: string;
  content_base64?: string;
  metadata?: Record<string, unknown>;
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
  const oracleServer = config.oracleServer;
  if (includeHostedServerEndpoints && oracleServer?.enabled) {
    const oracleUrl = buildOracleServerUrl(oracleServer);
    if (!endpoints.some((entry) => entry.url === oracleUrl)) {
      endpoints.push({
        kind: "http",
        url: oracleUrl,
        role: "requester_invocation",
      });
    }
    if (!capabilities.some((entry) => entry.name === oracleServer.capability)) {
      capabilities.push({
        name: oracleServer.capability,
        mode: "paid",
        price_model: "x402-exact",
        description: "Paid oracle-style local resolution capability",
      });
    }
  }
  const newsFetchServer = config.newsFetchServer;
  if (includeHostedServerEndpoints && newsFetchServer?.enabled) {
    const newsFetchUrl = buildNewsFetchServerUrl(newsFetchServer);
    if (!endpoints.some((entry) => entry.url === newsFetchUrl)) {
      endpoints.push({
        kind: "http",
        url: newsFetchUrl,
        role: "requester_invocation",
      });
    }
    if (!capabilities.some((entry) => entry.name === newsFetchServer.capability)) {
      capabilities.push({
        name: newsFetchServer.capability,
        mode: "paid",
        price_model: "x402-exact",
        description: "Paid news.fetch capability with bounded HTTP capture receipts",
      });
    }
  }
  const proofVerifyServer = config.proofVerifyServer;
  if (includeHostedServerEndpoints && proofVerifyServer?.enabled) {
    const proofVerifyUrl = buildProofVerifyServerUrl(proofVerifyServer);
    if (!endpoints.some((entry) => entry.url === proofVerifyUrl)) {
      endpoints.push({
        kind: "http",
        url: proofVerifyUrl,
        role: "requester_invocation",
      });
    }
    if (
      !capabilities.some((entry) => entry.name === proofVerifyServer.capability)
    ) {
      capabilities.push({
        name: proofVerifyServer.capability,
        mode: "paid",
        price_model: "x402-exact",
        description: "Paid proof.verify capability for bounded receipt and hash verification",
      });
    }
  }
  const storageServer = config.storageServer;
  if (includeHostedServerEndpoints && storageServer?.enabled) {
    const storagePutUrl = buildStoragePutServerUrl(storageServer);
    const storageGetUrl = buildStorageGetServerUrl(storageServer);
    if (!endpoints.some((entry) => entry.url === storagePutUrl)) {
      endpoints.push({
        kind: "http",
        url: storagePutUrl,
        role: "requester_invocation",
      });
    }
    if (!endpoints.some((entry) => entry.url === storageGetUrl)) {
      endpoints.push({
        kind: "http",
        url: storageGetUrl,
        role: "requester_invocation",
      });
    }
    if (!capabilities.some((entry) => entry.name === storageServer.putCapability)) {
      capabilities.push({
        name: storageServer.putCapability,
        mode: "paid",
        price_model: "x402-exact",
        description: "Paid storage.put capability for immutable object writes with TTL",
      });
    }
    if (!capabilities.some((entry) => entry.name === storageServer.getCapability)) {
      capabilities.push({
        name: storageServer.getCapability,
        mode: "paid",
        price_model: "x402-exact",
        description: "Paid storage.get capability for immutable object reads with TTL enforcement",
      });
    }
  }
  const sentimentAnalysisServer = config.sentimentAnalysisServer;
  if (includeHostedServerEndpoints && sentimentAnalysisServer?.enabled) {
    const sentimentUrl = buildSentimentAnalysisServerUrl(sentimentAnalysisServer);
    if (!endpoints.some((entry) => entry.url === sentimentUrl)) {
      endpoints.push({
        kind: "http",
        url: sentimentUrl,
        role: "requester_invocation",
      });
    }
    if (
      !capabilities.some((entry) => entry.name === sentimentAnalysisServer.capability)
    ) {
      capabilities.push({
        name: sentimentAnalysisServer.capability,
        mode: "paid",
        price_model: "x402-exact",
        description: "Paid sentiment.analyze capability for bounded text sentiment classification",
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

export function buildOracleServerUrl(
  config: AgentDiscoveryOracleServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}

export function buildNewsFetchServerUrl(
  config: AgentDiscoveryNewsFetchServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}

export function buildProofVerifyServerUrl(
  config: AgentDiscoveryProofVerifyServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}

export function buildStorageServerUrl(
  config: AgentDiscoveryStorageServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}

export function buildStoragePutServerUrl(
  config: AgentDiscoveryStorageServerConfig,
): string {
  return `${buildStorageServerUrl(config)}/put`;
}

export function buildStorageGetServerUrl(
  config: AgentDiscoveryStorageServerConfig,
): string {
  return `${buildStorageServerUrl(config)}/get`;
}

export function buildSentimentAnalysisServerUrl(
  config: AgentDiscoverySentimentAnalysisServerConfig,
): string {
  const host = config.bindHost.includes(":")
    ? `[${config.bindHost}]`
    : config.bindHost;
  const path = config.path.startsWith("/") ? config.path : `/${config.path}`;
  return `http://${host}:${config.port}${path}`;
}
