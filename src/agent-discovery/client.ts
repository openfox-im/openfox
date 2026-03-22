import { randomBytes } from "crypto";
import { loadWalletPrivateKey } from "../identity/wallet.js";
import { checkX402, x402Fetch } from "../runtime/x402.js";
import {
  recordReputationScore as recordReputationScore,
  ChainRpcClient as RpcClient,
} from "../chain/client.js";
import {
  AGENT_GATEWAY_E2E_HEADER,
  AGENT_GATEWAY_E2E_SCHEME,
  maybeDecryptAgentGatewayResponse,
  prepareAgentGatewayEncryptedRequest,
} from "../agent-gateway/e2e.js";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import {
  DEFAULT_AGENT_DISCOVERY_EXECUTION_POLICY,
} from "../types.js";
import {
  buildSignedAgentDiscoveryCard,
  verifyAgentDiscoveryCard,
} from "./card.js";
import {
  normalizeAgentDiscoveryConfig,
  type AgentDiscoveryCard,
  type AgentDiscoveryCardResponse,
  type AgentDiscoveryConfig,
  type AgentDiscoveryExecutionPolicy,
  type AgentDiscoveryInfo,
  type AgentDiscoveryLocalFeedback,
  type AgentDiscoveryProviderDiagnostics,
  type AgentDiscoverySelectionPolicy,
  type AgentDiscoverySearchResult,
  type FaucetInvocationRequest,
  type FaucetInvocationResponse,
  type NewsFetchInvocationRequest,
  type NewsFetchInvocationResponse,
  type ObservationInvocationRequest,
  type ObservationInvocationResponse,
  type OracleResolutionRequest,
  type OracleResolutionResponse,
  type ProofVerifyInvocationRequest,
  type ProofVerifyInvocationResponse,
  type StorageGetInvocationRequest,
  type StorageGetInvocationResponse,
  type StoragePutInvocationRequest,
  type StoragePutInvocationResponse,
  type ResolveCapabilityProviderResult,
  type VerifiedAgentProvider,
} from "./types.js";

class AgentDiscoveryRpcClient {
  private readonly rpcUrl: string;
  private nextId = 1;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Chain RPC ${method} failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (body.error) {
      throw new Error(
        `Chain RPC ${method} error ${body.error.code}: ${body.error.message}`,
      );
    }
    return body.result as T;
  }

  getInfo(): Promise<AgentDiscoveryInfo> {
    return this.request("tos_agentDiscoveryInfo", []);
  }

  publish(args: {
    primaryIdentity: string;
    capabilities: string[];
    connectionModes: string[];
    cardJson: string;
    cardSequence: number;
  }): Promise<AgentDiscoveryInfo> {
    return this.request("tos_agentDiscoveryPublish", [args]);
  }

  clear(): Promise<AgentDiscoveryInfo> {
    return this.request("tos_agentDiscoveryClear", []);
  }

  search(
    capability: string,
    limit: number,
  ): Promise<AgentDiscoverySearchResult[]> {
    return this.request("tos_agentDiscoverySearch", [capability, limit]);
  }

  directorySearch(
    nodeRecord: string,
    capability: string,
    limit: number,
  ): Promise<AgentDiscoverySearchResult[]> {
    return this.request("tos_agentDiscoveryDirectorySearch", [
      nodeRecord,
      capability,
      limit,
    ]);
  }

  getCard(nodeRecord: string): Promise<AgentDiscoveryCardResponse> {
    return this.request("tos_agentDiscoveryGetCard", [nodeRecord]);
  }
}

function requireDiscoveryRpc(config: OpenFoxConfig): AgentDiscoveryRpcClient {
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required for Agent Discovery");
  }
  return new AgentDiscoveryRpcClient(rpcUrl);
}

function deriveConnectionModes(agentDiscovery: AgentDiscoveryConfig): string[] {
  const modes = new Set<string>(["talkreq"]);
  for (const endpoint of agentDiscovery.endpoints) {
    if (endpoint.kind === "https" || endpoint.kind === "http") {
      modes.add("https");
    } else if (endpoint.kind === "ws") {
      modes.add("stream");
    }
  }
  return [...modes];
}

function endpointMatchesCapability(url: string, capability?: string): boolean {
  if (!capability) return false;
  const normalized = url.toLowerCase();
  if (capability === "sponsor.topup.testnet") {
    return normalized.includes("/faucet");
  }
  if (capability.startsWith("observation.")) {
    return normalized.includes("/observe") || normalized.includes("/observation");
  }
  if (capability.startsWith("oracle.")) {
    return normalized.includes("/oracle");
  }
  if (capability === "news.fetch") {
    return normalized.includes("/news/fetch") || normalized.includes("/news-fetch");
  }
  if (capability === "proof.verify") {
    return normalized.includes("/proof/verify") || normalized.includes("/proof-verify");
  }
  if (capability === "storage.put") {
    return (
      normalized.includes("/agent-discovery/storage/put") ||
      normalized.includes("/discovery-storage/put")
    );
  }
  if (capability === "storage.get") {
    return (
      normalized.includes("/agent-discovery/storage/get") ||
      normalized.includes("/discovery-storage/get")
    );
  }
  return false;
}

function getInvokableEndpoint(
  card: AgentDiscoveryCard,
  capability?: string,
): VerifiedAgentProvider["endpoint"] | null {
  const httpEndpoints = card.endpoints.filter(
    (endpoint) => endpoint.kind === "https" || endpoint.kind === "http",
  );
  if (capability === "gateway.relay") {
    return (
      card.endpoints.find((endpoint) => endpoint.role === "provider_relay") ??
      card.endpoints.find((endpoint) => endpoint.kind === "ws") ??
      null
    );
  }
  const hintedEndpoint =
    httpEndpoints.find((endpoint) => endpoint.kind === "https" && endpointMatchesCapability(endpoint.url, capability)) ??
    httpEndpoints.find((endpoint) => endpoint.kind === "http" && endpointMatchesCapability(endpoint.url, capability)) ??
    card.endpoints.find((endpoint) => endpoint.kind === "ws" && endpointMatchesCapability(endpoint.url, capability));
  if (hintedEndpoint) {
    return hintedEndpoint;
  }
  if (capability?.endsWith(".quote")) {
    return (
      httpEndpoints.find((endpoint) => endpoint.url.endsWith("/quote")) ??
      httpEndpoints[0] ??
      card.endpoints.find((endpoint) => endpoint.kind === "ws") ??
      null
    );
  }
  if (capability?.endsWith(".submit")) {
    return (
      httpEndpoints.find((endpoint) => endpoint.url.endsWith("/submit")) ??
      httpEndpoints[0] ??
      card.endpoints.find((endpoint) => endpoint.kind === "ws") ??
      null
    );
  }
  if (capability?.endsWith(".status")) {
    return (
      httpEndpoints.find((endpoint) => endpoint.url.endsWith("/status")) ??
      httpEndpoints[0] ??
      card.endpoints.find((endpoint) => endpoint.kind === "ws") ??
      null
    );
  }
  if (capability?.endsWith(".receipt")) {
    return (
      httpEndpoints.find((endpoint) => endpoint.url.endsWith("/receipt")) ??
      httpEndpoints[0] ??
      card.endpoints.find((endpoint) => endpoint.kind === "ws") ??
      null
    );
  }
  return (
    httpEndpoints.find((endpoint) => endpoint.kind === "https") ??
    httpEndpoints.find((endpoint) => endpoint.kind === "http") ??
    card.endpoints.find((endpoint) => endpoint.kind === "ws") ??
    null
  );
}

function parseCardJson(cardJson: string): AgentDiscoveryCard {
  return JSON.parse(cardJson) as AgentDiscoveryCard;
}

function parseBigIntAmount(value: string | undefined): bigint {
  if (!value || !/^\d+$/.test(value.trim())) {
    return 0n;
  }
  return BigInt(value.trim());
}

function parseSignedBigInt(value: string | undefined): bigint {
  if (!value || !/^-?\d+$/.test(value.trim())) {
    return 0n;
  }
  return BigInt(value.trim());
}

function connectionModesToNames(mask: number | undefined): Set<string> {
  const out = new Set<string>();
  if (!mask) {
    return out;
  }
  if ((mask & 0x01) === 0x01) out.add("talkreq");
  if ((mask & 0x02) === 0x02) out.add("https");
  if ((mask & 0x04) === 0x04) out.add("stream");
  return out;
}

function buildRequestExpiry(ttlSeconds = 300): number {
  return Math.floor(Date.now() / 1000) + Math.max(30, ttlSeconds);
}

function capabilityFamily(
  capability: string,
): "sponsor" | "observation" | "oracle" | "news" | "proof" | "storage" | "gateway" | null {
  if (capability.startsWith("sponsor.")) return "sponsor";
  if (capability.startsWith("observation.")) return "observation";
  if (capability.startsWith("oracle.")) return "oracle";
  if (capability.startsWith("news.")) return "news";
  if (capability.startsWith("proof.")) return "proof";
  if (capability.startsWith("storage.")) return "storage";
  if (capability.startsWith("gateway.")) return "gateway";
  return null;
}

interface ResolvedExecutionPolicy extends AgentDiscoveryExecutionPolicy {
  selectionPolicy: AgentDiscoverySelectionPolicy;
}

function resolveSelectionPolicy(
  config: OpenFoxConfig,
  capability: string,
  override?: Partial<AgentDiscoverySelectionPolicy>,
): AgentDiscoverySelectionPolicy {
  const family = capabilityFamily(capability);
  const profile =
    family && config.agentDiscovery?.policyProfiles
      ? config.agentDiscovery.policyProfiles[family]
      : undefined;
  return {
    requireRegistered: true,
    excludeSuspended: true,
    onchainCapabilityMode: "off",
    minimumStakeTomi: "0",
    minimumReputation: "0",
    preferHigherStake: true,
    preferHigherReputation: true,
    requiredConnectionModes: [],
    packagePrefix: undefined,
    serviceKind: undefined,
    capabilityKind: undefined,
    privacyMode: undefined,
    receiptMode: undefined,
    requireDisclosureReady: false,
    minimumTrustScore: 0,
    ...(config.agentDiscovery?.selectionPolicy ?? {}),
    ...(profile ?? {}),
    ...(override ?? {}),
  };
}

function resolveExecutionPolicy(
  config: OpenFoxConfig,
  capability: string,
  selectionOverride?: Partial<AgentDiscoverySelectionPolicy>,
  executionOverride?: Partial<AgentDiscoveryExecutionPolicy>,
): ResolvedExecutionPolicy {
  const family = capabilityFamily(capability);
  const profile =
    family && config.agentDiscovery?.executionPolicyProfiles
      ? config.agentDiscovery.executionPolicyProfiles[family]
      : undefined;
  return {
    ...DEFAULT_AGENT_DISCOVERY_EXECUTION_POLICY,
    ...(config.agentDiscovery?.executionPolicy ?? {}),
    ...(profile ?? {}),
    ...(executionOverride ?? {}),
    selectionPolicy: resolveSelectionPolicy(config, capability, selectionOverride),
  };
}

function feedbackKey(nodeId: string, capability: string): string {
  return `agent_discovery:provider_feedback:${nodeId}:${capability.toLowerCase()}`;
}

function loadLocalFeedback(
  db: OpenFoxDatabase | undefined,
  provider: VerifiedAgentProvider,
  capability: string,
): AgentDiscoveryLocalFeedback {
  if (!db) {
    return {
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      malformedCount: 0,
      localScore: 0,
    };
  }
  const raw = db.getKV(feedbackKey(provider.search.nodeId, capability));
  if (!raw) {
    return {
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      malformedCount: 0,
      localScore: 0,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AgentDiscoveryLocalFeedback>;
    const successCount = Number(parsed.successCount || 0);
    const failureCount = Number(parsed.failureCount || 0);
    const timeoutCount = Number(parsed.timeoutCount || 0);
    const malformedCount = Number(parsed.malformedCount || 0);
    return {
      successCount,
      failureCount,
      timeoutCount,
      malformedCount,
      lastOutcomeAt: parsed.lastOutcomeAt,
      localScore:
        successCount * 20 -
        failureCount * 10 -
        timeoutCount * 15 -
        malformedCount * 12,
    };
  } catch {
    return {
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      malformedCount: 0,
      localScore: 0,
    };
  }
}

function recordProviderFeedback(params: {
  db?: OpenFoxDatabase;
  config: OpenFoxConfig;
  provider: VerifiedAgentProvider;
  capability: string;
  outcome: "success" | "failure" | "timeout" | "malformed";
  requestNonce?: string;
  skipReputationUpdate?: boolean;
}): void {
  let current: AgentDiscoveryLocalFeedback = {
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    malformedCount: 0,
    localScore: 0,
  };
  if (params.db) {
    current = loadLocalFeedback(params.db, params.provider, params.capability);
  }
  switch (params.outcome) {
    case "success":
      current.successCount += 1;
      break;
    case "failure":
      current.failureCount += 1;
      break;
    case "timeout":
      current.timeoutCount += 1;
      break;
    case "malformed":
      current.malformedCount += 1;
      break;
  }
  current.lastOutcomeAt = new Date().toISOString();
  current.localScore =
    current.successCount * 20 -
    current.failureCount * 10 -
    current.timeoutCount * 15 -
    current.malformedCount * 12;
  if (params.db) {
    params.db.setKV(
      feedbackKey(params.provider.search.nodeId, params.capability),
      JSON.stringify(current),
    );
  }
  if (!params.skipReputationUpdate) {
    submitReputationUpdate(params).catch(() => undefined);
  }
}

export function recordAgentDiscoveryProviderFeedback(params: {
  db?: OpenFoxDatabase;
  config: OpenFoxConfig;
  provider: VerifiedAgentProvider;
  capability: string;
  outcome: "success" | "failure" | "timeout" | "malformed";
  requestNonce?: string;
  skipReputationUpdate?: boolean;
}): void {
  recordProviderFeedback(params);
}

function classifyInvocationError(
  error: unknown,
): "failure" | "timeout" | "malformed" {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  if (message.includes("timeout")) {
    return "timeout";
  }
  if (
    message.includes("invalid") ||
    message.includes("malformed") ||
    message.includes("unsupported capability") ||
    message.includes("duplicate request nonce")
  ) {
    return "malformed";
  }
  return "failure";
}

async function submitReputationUpdate(params: {
  config: OpenFoxConfig;
  provider: VerifiedAgentProvider;
  capability: string;
  outcome: "success" | "failure" | "timeout" | "malformed";
  requestNonce?: string;
}): Promise<void> {
  const updates = params.config.agentDiscovery?.reputationUpdates;
  if (!updates?.enabled) {
    return;
  }
  const privateKey = loadWalletPrivateKey();
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  const who = params.provider.search.primaryIdentity;
  if (!privateKey || !rpcUrl || !who) {
    return;
  }

  const delta =
    params.outcome === "success"
      ? updates.successDelta
      : params.outcome === "timeout"
        ? updates.timeoutDelta
        : params.outcome === "malformed"
          ? updates.malformedDelta
          : updates.failureDelta;

  await recordReputationScore({
    rpcUrl,
    privateKey,
    who,
    delta,
    reason: `${updates.reasonPrefix}:${params.outcome}:${params.capability}`,
    refId: [
      "agent-discovery",
      params.capability,
      params.provider.search.nodeId,
      params.requestNonce || "no-nonce",
    ].join(":"),
    gas: BigInt(updates.gas),
    waitForReceipt: false,
  });
}

function providerMatchesSelectionPolicy(
  provider: VerifiedAgentProvider,
  policy: AgentDiscoverySelectionPolicy,
  requestedAmount: bigint,
): boolean {
  return (
    getTrustFailures(provider, policy).length === 0 &&
    getSelectionFailures(provider, policy, requestedAmount).length === 0
  );
}

function getTrustFailures(
  provider: VerifiedAgentProvider,
  policy: AgentDiscoverySelectionPolicy,
): string[] {
  const failures: string[] = [];
  const trust = provider.search.trust;
  if (!trust) {
    return failures;
  }
  if (policy.requireRegistered && !trust.registered) {
    failures.push("provider not registered");
  }
  if (policy.excludeSuspended && trust.suspended) {
    failures.push("provider suspended");
  }
  if (
    policy.onchainCapabilityMode === "require_onchain" &&
    (!trust.capabilityRegistered || !trust.hasOnchainCapability)
  ) {
    failures.push("capability missing on-chain");
  }
  if (
    parseBigIntAmount(policy.minimumStakeTomi) > parseBigIntAmount(trust.stake)
  ) {
    failures.push("stake below minimum");
  }
  if (
    parseSignedBigInt(policy.minimumReputation) >
    parseSignedBigInt(trust.reputation)
  ) {
    failures.push("reputation below minimum");
  }
  if (
    typeof policy.minimumTrustScore === "number" &&
    (trust.localRankScore ?? 0) < policy.minimumTrustScore
  ) {
    failures.push("trust score below minimum");
  }
  return failures;
}

function getSelectionFailures(
  provider: VerifiedAgentProvider,
  policy: AgentDiscoverySelectionPolicy,
  requestedAmount: bigint,
): string[] {
  const failures: string[] = [];
  const maxAmount = parseBigIntAmount(provider.matchedCapability.max_amount);
  if (maxAmount !== 0n && requestedAmount > maxAmount) {
    failures.push("requested amount exceeds provider max");
  }

  if (policy.requiredConnectionModes?.length) {
    const supportedModes = connectionModesToNames(provider.search.connectionModes);
    for (const mode of policy.requiredConnectionModes) {
      if (!supportedModes.has(mode)) {
        failures.push(`missing required connection mode: ${mode}`);
      }
    }
  }

  if (
    policy.packagePrefix &&
    !provider.card.package_name?.startsWith(policy.packagePrefix)
  ) {
    failures.push("package prefix mismatch");
  }

  const requiresRouting =
    Boolean(policy.serviceKind) ||
    Boolean(policy.capabilityKind) ||
    Boolean(policy.privacyMode) ||
    Boolean(policy.receiptMode) ||
    policy.requireDisclosureReady === true;
  if (requiresRouting) {
    const routing = provider.card.routing_profile;
    if (!routing) {
      failures.push("routing profile missing");
      return failures;
    }
    if (policy.serviceKind) {
      const serviceKinds = routing.serviceKinds ?? [];
      if (
        routing.serviceKind !== policy.serviceKind &&
        !serviceKinds.includes(policy.serviceKind)
      ) {
        failures.push("service kind mismatch");
      }
    }
    if (
      policy.capabilityKind &&
      routing.capabilityKind !== policy.capabilityKind
    ) {
      failures.push("capability kind mismatch");
    }
    if (policy.privacyMode && routing.privacyMode !== policy.privacyMode) {
      failures.push("privacy mode mismatch");
    }
    if (policy.receiptMode && routing.receiptMode !== policy.receiptMode) {
      failures.push("receipt mode mismatch");
    }
    if (
      policy.requireDisclosureReady === true &&
      routing.disclosureReady !== true
    ) {
      failures.push("disclosure-ready requirement not met");
    }
  }
  return failures;
}

function buildProviderDiagnostics(
  provider: VerifiedAgentProvider,
  policy: AgentDiscoverySelectionPolicy,
  requestedAmount: bigint,
  selected: boolean,
): AgentDiscoveryProviderDiagnostics {
  return {
    provider,
    trustScore: provider.search.trust?.localRankScore ?? 0,
    trustFailures: getTrustFailures(provider, policy),
    selectionFailures: getSelectionFailures(provider, policy, requestedAmount),
    selected,
  };
}

function attachLocalFeedback(
  providers: VerifiedAgentProvider[],
  db: OpenFoxDatabase | undefined,
  capability: string,
): VerifiedAgentProvider[] {
  return providers.map((provider) => ({
    ...provider,
    localFeedback: loadLocalFeedback(db, provider, capability),
  }));
}

function providerAdvertisedFee(provider: VerifiedAgentProvider): bigint | null {
  const policy =
    provider.matchedCapability.policy &&
    typeof provider.matchedCapability.policy === "object"
      ? provider.matchedCapability.policy
      : undefined;
  const perRequest =
    typeof policy?.per_request_fee_tos === "string"
      ? parseBigIntAmount(policy.per_request_fee_tos)
      : 0n;
  if (perRequest > 0n) {
    return perRequest;
  }
  const sessionFee =
    typeof policy?.session_fee_tos === "string"
      ? parseBigIntAmount(policy.session_fee_tos)
      : 0n;
  if (sessionFee > 0n) {
    return sessionFee;
  }
  return null;
}

function sortProviders(
  providers: VerifiedAgentProvider[],
  requestedAmount: bigint,
  executionPolicy: ResolvedExecutionPolicy,
  db: OpenFoxDatabase | undefined,
  capability: string,
): VerifiedAgentProvider[] {
  const selectionPolicy = executionPolicy.selectionPolicy;
  const scoreMode = (mode: string): number => {
    const idx = executionPolicy.preferredModes.findIndex((item) => item === mode);
    if (idx === -1) {
      return 0;
    }
    return executionPolicy.preferredModes.length - idx;
  };

  return attachLocalFeedback(providers, db, capability)
    .filter((provider) =>
      providerMatchesSelectionPolicy(
        provider,
        selectionPolicy,
        requestedAmount,
      ),
    )
    .sort((left, right) => {
      const leftMode = scoreMode(left.matchedCapability.mode);
      const rightMode = scoreMode(right.matchedCapability.mode);
      if (leftMode !== rightMode) {
        return rightMode - leftMode;
      }
      const leftTrust = left.search.trust;
      const rightTrust = right.search.trust;
      if (
        (leftTrust?.registered ?? false) !== (rightTrust?.registered ?? false)
      ) {
        return rightTrust?.registered ? 1 : -1;
      }
      if (
        (leftTrust?.hasOnchainCapability ?? false) !==
        (rightTrust?.hasOnchainCapability ?? false)
      ) {
        return rightTrust?.hasOnchainCapability ? 1 : -1;
      }
      if (selectionPolicy.onchainCapabilityMode === "prefer_onchain") {
        if (
          (leftTrust?.capabilityRegistered ?? false) !==
          (rightTrust?.capabilityRegistered ?? false)
        ) {
          return rightTrust?.capabilityRegistered ? 1 : -1;
        }
      }
      const leftLocalScore = left.localFeedback?.localScore ?? 0;
      const rightLocalScore = right.localFeedback?.localScore ?? 0;
      if (leftLocalScore !== rightLocalScore) {
        return rightLocalScore - leftLocalScore;
      }
      if (executionPolicy.preferLowerAdvertisedFee) {
        const leftFee = providerAdvertisedFee(left);
        const rightFee = providerAdvertisedFee(right);
        if (leftFee !== null || rightFee !== null) {
          if (leftFee === null) return 1;
          if (rightFee === null) return -1;
          if (leftFee !== rightFee) {
            return leftFee < rightFee ? -1 : 1;
          }
        }
      }
      if (selectionPolicy.preferHigherReputation) {
        const leftRep = parseSignedBigInt(leftTrust?.reputation);
        const rightRep = parseSignedBigInt(rightTrust?.reputation);
        if (leftRep !== rightRep) {
          return rightRep > leftRep ? 1 : -1;
        }
      }
      if (selectionPolicy.preferHigherStake) {
        const leftStake = parseBigIntAmount(leftTrust?.stake);
        const rightStake = parseBigIntAmount(rightTrust?.stake);
        if (leftStake !== rightStake) {
          return rightStake > leftStake ? 1 : -1;
        }
      }
      const leftRatings = parseBigIntAmount(leftTrust?.ratingCount);
      const rightRatings = parseBigIntAmount(rightTrust?.ratingCount);
      if (leftRatings !== rightRatings) {
        return rightRatings > leftRatings ? 1 : -1;
      }
      const leftAmount = parseBigIntAmount(left.matchedCapability.max_amount);
      const rightAmount = parseBigIntAmount(right.matchedCapability.max_amount);
      if (leftAmount !== rightAmount) {
        return rightAmount > leftAmount ? 1 : -1;
      }
      return (right.card.card_seq || 0) - (left.card.card_seq || 0);
    });
}

async function collectVerifiedCapabilityProviders(params: {
  config: OpenFoxConfig;
  capability: string;
  limit: number;
}): Promise<VerifiedAgentProvider[]> {
  const rpc = requireDiscoveryRpc(params.config);
  const searchResults = await collectSearchResults(
    rpc,
    params.config,
    params.capability,
    params.limit,
  );
  const providers: VerifiedAgentProvider[] = [];

  for (const search of searchResults) {
    try {
      const cardResponse = await rpc.getCard(search.nodeRecord);
      const card = parseCardJson(cardResponse.cardJson);
      const valid = await verifyAgentDiscoveryCard(card, search.nodeId);
      if (!valid) {
        continue;
      }
      const matchedCapability = card.capabilities.find(
        (capability) => capability.name === params.capability,
      );
      const endpoint = getInvokableEndpoint(card, params.capability);
      if (!matchedCapability || !endpoint) {
        continue;
      }
      const provider: VerifiedAgentProvider = {
        search,
        card,
        matchedCapability,
        endpoint,
      };
      if (!(await endpointSupportsDeclaredMode(provider))) {
        continue;
      }
      providers.push(provider);
    } catch {
      continue;
    }
  }

  return providers;
}

async function collectSearchResults(
  rpc: AgentDiscoveryRpcClient,
  config: OpenFoxConfig,
  capability: string,
  limit: number,
): Promise<AgentDiscoverySearchResult[]> {
  const merged = new Map<string, AgentDiscoverySearchResult>();
  for (const result of await rpc.search(capability, limit)) {
    merged.set(result.nodeId, result);
  }

  const directoryRecords = config.agentDiscovery?.directoryNodeRecords ?? [];
  for (const nodeRecord of directoryRecords) {
    try {
      for (const result of await rpc.directorySearch(
        nodeRecord,
        capability,
        limit,
      )) {
        if (!merged.has(result.nodeId)) {
          merged.set(result.nodeId, result);
        }
      }
    } catch {
      continue;
    }
  }

  return [...merged.values()].slice(0, limit);
}

async function endpointSupportsDeclaredMode(
  provider: VerifiedAgentProvider,
): Promise<boolean> {
  if (provider.endpoint.kind === "ws") {
    return (
      provider.endpoint.url.startsWith("ws://") ||
      provider.endpoint.url.startsWith("wss://")
    );
  }
  if (provider.matchedCapability.mode === "paid") {
    return (await checkX402(provider.endpoint.url)) !== null;
  }
  return (
    (provider.endpoint.kind === "https" &&
      provider.endpoint.url.startsWith("https://")) ||
    (provider.endpoint.kind === "http" &&
      provider.endpoint.url.startsWith("http://"))
  );
}

async function invokeProviderCapability(params: {
  provider: VerifiedAgentProvider;
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  requestBody: string;
  maxPaymentCents?: number;
}): Promise<{ success: boolean; response?: unknown; error?: string; status?: number }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body = params.requestBody;
  let responsePrivateKey: `0x${string}` | undefined;
  const wantsGatewayE2E =
    params.config.agentDiscovery?.gatewayClient?.enableE2E &&
    Boolean(params.provider.endpoint.via_gateway) &&
    Boolean(params.provider.card.relay_encryption_pubkey);

  if (wantsGatewayE2E && params.provider.card.relay_encryption_pubkey) {
    const prepared = prepareAgentGatewayEncryptedRequest({
      plaintext: Buffer.from(body, "utf8"),
      recipientPublicKey: params.provider.card.relay_encryption_pubkey,
    });
    body = JSON.stringify(prepared.envelope);
    headers[AGENT_GATEWAY_E2E_HEADER] = AGENT_GATEWAY_E2E_SCHEME;
    responsePrivateKey = prepared.responsePrivateKey;
  }

  const result = await x402Fetch(
    params.provider.endpoint.url,
    params.identity.account,
    "POST",
    body,
    headers,
    params.maxPaymentCents,
  );
  if (!result.success) {
    return result;
  }
  return {
    ...result,
    response: maybeDecryptAgentGatewayResponse({
      value: result.response,
      responsePrivateKey,
    }),
  };
}

export async function publishLocalAgentDiscoveryCard(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db?: OpenFoxDatabase;
  agentDiscoveryOverride?: AgentDiscoveryConfig;
  overrideIsNormalized?: boolean;
}): Promise<{ info: AgentDiscoveryInfo; card: AgentDiscoveryCard } | null> {
  const agentDiscovery = params.overrideIsNormalized
    ? params.agentDiscoveryOverride || null
    : normalizeAgentDiscoveryConfig(
        params.agentDiscoveryOverride ?? params.config.agentDiscovery,
      );
  if (!agentDiscovery) {
    return null;
  }

  const rpc = requireDiscoveryRpc(params.config);
  const info = await rpc.getInfo();
  if (!info.enabled || !info.nodeRecord) {
    throw new Error(
      "Agent Discovery is not enabled on the connected GTOS node",
    );
  }
  if (!info.nodeId) {
    throw new Error("GTOS node did not return a discovery node ID");
  }

  const card = await buildSignedAgentDiscoveryCard({
    identity: params.identity,
    config: params.config,
    agentDiscovery,
    address: params.address,
    discoveryNodeId: info.nodeId,
  });

  const published = await rpc.publish({
    primaryIdentity: params.address,
    capabilities: card.capabilities.map((capability) => capability.name),
    connectionModes: deriveConnectionModes(agentDiscovery),
    cardJson: JSON.stringify(card),
    cardSequence: card.card_seq,
  });

  params.db?.setKV("agent_discovery:last_published_card", JSON.stringify(card));
  params.db?.setKV(
    "agent_discovery:last_published_at",
    new Date().toISOString(),
  );

  return { info: published, card };
}

export async function clearLocalAgentDiscoveryCard(params: {
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
}): Promise<AgentDiscoveryInfo> {
  const rpc = requireDiscoveryRpc(params.config);
  const cleared = await rpc.clear();
  params.db?.setKV(
    "agent_discovery:last_cleared_at",
    new Date().toISOString(),
  );
  return cleared;
}

export async function discoverCapabilityProviders(params: {
  config: OpenFoxConfig;
  capability: string;
  limit?: number;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
  db?: OpenFoxDatabase;
}): Promise<VerifiedAgentProvider[]> {
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    params.capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await collectVerifiedCapabilityProviders({
    config: params.config,
    capability: params.capability,
    limit: params.limit ?? executionPolicy.searchLimit,
  });

  return sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    params.capability,
  );
}

export async function resolveCapabilityProvider(params: {
  config: OpenFoxConfig;
  capability: string;
  requestedAmountTomi?: bigint;
  limit?: number;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
  db?: OpenFoxDatabase;
}): Promise<VerifiedAgentProvider | null> {
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    params.capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await collectVerifiedCapabilityProviders({
    config: params.config,
    capability: params.capability,
    limit: params.limit ?? executionPolicy.searchLimit,
  });
  const ranked = sortProviders(
    providers,
    params.requestedAmountTomi ?? 0n,
    executionPolicy,
    params.db,
    params.capability,
  );
  return ranked[0] ?? null;
}

export async function diagnoseCapabilityProviders(params: {
  config: OpenFoxConfig;
  capability: string;
  requestedAmountTomi?: bigint;
  limit?: number;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
  db?: OpenFoxDatabase;
}): Promise<AgentDiscoveryProviderDiagnostics[]> {
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    params.capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const requestedAmount = params.requestedAmountTomi ?? 0n;
  const providers = attachLocalFeedback(
    await collectVerifiedCapabilityProviders({
      config: params.config,
      capability: params.capability,
      limit: params.limit ?? executionPolicy.searchLimit,
    }),
    params.db,
    params.capability,
  );
  const selected = sortProviders(
    [...providers],
    requestedAmount,
    executionPolicy,
    params.db,
    params.capability,
  )[0];
  return providers
    .map((provider) =>
      buildProviderDiagnostics(
        provider,
        executionPolicy.selectionPolicy,
        requestedAmount,
        provider.search.nodeId === selected?.search.nodeId,
      ),
    )
    .sort((left, right) => {
      if (left.selected !== right.selected) {
        return left.selected ? -1 : 1;
      }
      if (left.trustScore !== right.trustScore) {
        return right.trustScore - left.trustScore;
      }
      return left.provider.search.nodeId.localeCompare(right.provider.search.nodeId);
    });
}

export async function resolveCapabilityProviderWithDiagnostics(params: {
  config: OpenFoxConfig;
  capability: string;
  requestedAmountTomi?: bigint;
  limit?: number;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
  db?: OpenFoxDatabase;
}): Promise<ResolveCapabilityProviderResult> {
  const diagnostics = await diagnoseCapabilityProviders(params);
  const selected =
    diagnostics.find((item) => item.selected)?.provider ?? null;
  return { provider: selected, diagnostics };
}

export function summarizeProviderDiagnostics(
  diagnostics: readonly AgentDiscoveryProviderDiagnostics[],
): string {
  if (diagnostics.length === 0) {
    return "no verified providers advertised a callable endpoint for this capability";
  }
  return diagnostics
    .slice(0, 3)
    .map((item) => {
      const failures = [...item.trustFailures, ...item.selectionFailures];
      return `${item.provider.search.nodeId}: ${
        failures.length > 0 ? failures.join("; ") : "no matching provider selected"
      }`;
    })
    .join(" | ");
}

async function throwNoProviderFound(params: {
  config: OpenFoxConfig;
  capability: string;
  requestedAmountTomi?: bigint;
  limit?: number;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
  db?: OpenFoxDatabase;
}): Promise<never> {
  const diagnostics = await diagnoseCapabilityProviders({
    config: params.config,
    capability: params.capability,
    requestedAmountTomi: params.requestedAmountTomi,
    limit: params.limit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  throw new Error(
    `No provider found for capability ${params.capability}: ${summarizeProviderDiagnostics(
      diagnostics,
    )}`,
  );
}

async function invokeCapabilityWithFallback<
  TRequest extends { request_nonce: string },
  TResponse,
>(params: {
  rankedProviders: VerifiedAgentProvider[];
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
  capability: string;
  maxFallbackProviders?: number;
  request: TRequest;
  eventKey: string;
  parseResponse: (value: unknown) => TResponse;
  isValidResponse: (response: TResponse) => boolean;
  invalidResponseMessage: string;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: TRequest;
  response: TResponse;
}> {
  const failures: string[] = [];

  const rankedProviders =
    params.maxFallbackProviders && params.maxFallbackProviders > 0
      ? params.rankedProviders.slice(0, params.maxFallbackProviders)
      : params.rankedProviders;

  for (const provider of rankedProviders) {
    try {
      const result = await invokeProviderCapability({
        provider,
        identity: params.identity,
        config: params.config,
        requestBody: JSON.stringify(params.request),
      });
      if (!result.success) {
        throw new Error(
          result.error || `Provider request failed with status ${result.status}`,
        );
      }

      const response = params.parseResponse(result.response);
      if (!params.isValidResponse(response)) {
        throw new Error(params.invalidResponseMessage);
      }

      params.db?.setKV(
        params.eventKey,
        JSON.stringify({
          at: new Date().toISOString(),
          providerNodeId: provider.search.nodeId,
          capability: params.capability,
          request: params.request,
          response,
          attemptedProviders: failures.length
            ? failures.map((summary) => ({ summary }))
            : [],
        }),
      );
      recordProviderFeedback({
        db: params.db,
        config: params.config,
        provider,
        capability: params.capability,
        outcome: "success",
        requestNonce: params.request.request_nonce,
      });
      return { provider, request: params.request, response };
    } catch (error) {
      recordProviderFeedback({
        db: params.db,
        config: params.config,
        provider,
        capability: params.capability,
        outcome: classifyInvocationError(error),
        requestNonce: params.request.request_nonce,
      });
      failures.push(
        `${provider.search.nodeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  throw new Error(
    `All providers failed for capability ${params.capability}: ${failures.join(" | ")}`,
  );
}

export async function requestTestnetFaucet(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  requestedAmountTomi: bigint;
  capability?: string;
  reason?: string;
  limit?: number;
  waitForReceipt?: boolean;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: FaucetInvocationRequest;
  response: FaucetInvocationResponse;
  receipt?: Record<string, unknown> | null;
}> {
  const capability = params.capability ?? "sponsor.topup.testnet";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    params.requestedAmountTomi,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      requestedAmountTomi: params.requestedAmountTomi,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: FaucetInvocationRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    requested_amount: params.requestedAmountTomi.toString(),
    reason: params.reason || "bootstrap openfox wallet",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_faucet_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as FaucetInvocationResponse,
    isValidResponse: (response) =>
      Boolean(response) && typeof response.status === "string",
    invalidResponseMessage: "Provider returned an invalid faucet response",
  });
  const provider = invoked.provider;
  const response = invoked.response;

  let receipt: Record<string, unknown> | null | undefined;
  const receiptRpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (
    params.waitForReceipt &&
    response.status === "approved" &&
    response.tx_hash &&
    receiptRpcUrl
  ) {
    const client = new RpcClient({ rpcUrl: receiptRpcUrl });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      receipt = await client.getTransactionReceipt(
        response.tx_hash as `0x${string}`,
      );
      if (receipt) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  params.db?.setKV(
    "agent_discovery:last_faucet_event",
    JSON.stringify({
      at: new Date().toISOString(),
      providerNodeId: provider.search.nodeId,
      capability,
      request,
      response,
      receipt,
    }),
  );

  return { provider, request, response, receipt };
}

export async function requestObservationOnce(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  targetUrl: string;
  capability?: string;
  reason?: string;
  limit?: number;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: ObservationInvocationRequest;
  response: ObservationInvocationResponse;
}> {
  const capability = params.capability ?? "observation.once";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: ObservationInvocationRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    target_url: params.targetUrl,
    reason: params.reason || "one-shot paid observation",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_observation_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as ObservationInvocationResponse,
    isValidResponse: (response) => Boolean(response) && response.status === "ok",
    invalidResponseMessage: "Provider returned an invalid observation response",
  });
  const provider = invoked.provider;
  const response = invoked.response;
  return { provider, request, response };
}

export async function requestOracleResolution(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  query: string;
  queryKind: OracleResolutionRequest["query_kind"];
  options?: string[];
  context?: string;
  capability?: string;
  reason?: string;
  limit?: number;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: OracleResolutionRequest;
  response: OracleResolutionResponse;
}> {
  const capability = params.capability ?? "oracle.resolve";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: OracleResolutionRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    query: params.query,
    query_kind: params.queryKind,
    ...(params.options?.length ? { options: params.options } : {}),
    ...(params.context ? { context: params.context } : {}),
    reason: params.reason || "paid oracle resolution",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_oracle_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as OracleResolutionResponse,
    isValidResponse: (response) => Boolean(response) && response.status === "ok",
    invalidResponseMessage: "Provider returned an invalid oracle response",
  });
  const provider = invoked.provider;
  const response = invoked.response;
  return { provider, request, response };
}

export async function requestNewsFetch(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  sourceUrl: string;
  sourcePolicyId?: string;
  publisherHint?: string;
  headlineHint?: string;
  capability?: string;
  reason?: string;
  limit?: number;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: NewsFetchInvocationRequest;
  response: NewsFetchInvocationResponse;
}> {
  const capability = params.capability ?? "news.fetch";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: NewsFetchInvocationRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    source_url: params.sourceUrl,
    ...(params.sourcePolicyId ? { source_policy_id: params.sourcePolicyId } : {}),
    ...(params.publisherHint ? { publisher_hint: params.publisherHint } : {}),
    ...(params.headlineHint ? { headline_hint: params.headlineHint } : {}),
    reason: params.reason || "paid news fetch",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_news_fetch_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as NewsFetchInvocationResponse,
    isValidResponse: (response) =>
      Boolean(response) &&
      (response.status === "ok" || response.status === "integration_required"),
    invalidResponseMessage: "Provider returned an invalid news.fetch response",
  });
  const provider = invoked.provider;
  const response = invoked.response;
  return { provider, request, response };
}

export async function requestProofVerify(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  subjectUrl?: string;
  subjectSha256?: string;
  proofBundleUrl?: string;
  proofBundleSha256?: string;
  verifierProfile?: string;
  capability?: string;
  reason?: string;
  limit?: number;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: ProofVerifyInvocationRequest;
  response: ProofVerifyInvocationResponse;
}> {
  const capability = params.capability ?? "proof.verify";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: ProofVerifyInvocationRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    ...(params.subjectUrl ? { subject_url: params.subjectUrl } : {}),
    ...(params.subjectSha256 ? { subject_sha256: params.subjectSha256 } : {}),
    ...(params.proofBundleUrl ? { proof_bundle_url: params.proofBundleUrl } : {}),
    ...(params.proofBundleSha256
      ? { proof_bundle_sha256: params.proofBundleSha256 }
      : {}),
    ...(params.verifierProfile ? { verifier_profile: params.verifierProfile } : {}),
    reason: params.reason || "paid proof verification",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_proof_verify_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as ProofVerifyInvocationResponse,
    isValidResponse: (response) =>
      Boolean(response) &&
      (response.status === "ok" || response.status === "integration_required"),
    invalidResponseMessage:
      "Provider returned an invalid proof.verify response",
  });
  const provider = invoked.provider;
  const response = invoked.response;
  return { provider, request, response };
}

export async function requestStoragePut(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  objectKey?: string;
  contentType?: string;
  contentText?: string;
  contentBase64?: string;
  metadata?: Record<string, unknown>;
  capability?: string;
  reason?: string;
  limit?: number;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: StoragePutInvocationRequest;
  response: StoragePutInvocationResponse;
}> {
  const capability = params.capability ?? "storage.put";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: StoragePutInvocationRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    ...(params.objectKey ? { object_key: params.objectKey } : {}),
    ...(params.contentType ? { content_type: params.contentType } : {}),
    ...(params.contentText !== undefined ? { content_text: params.contentText } : {}),
    ...(params.contentBase64 !== undefined
      ? { content_base64: params.contentBase64 }
      : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    reason: params.reason || "paid storage put",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_storage_put_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as StoragePutInvocationResponse,
    isValidResponse: (response) => Boolean(response) && response.status === "ok",
    invalidResponseMessage: "Provider returned an invalid storage.put response",
  });
  const provider = invoked.provider;
  const response = invoked.response;
  return { provider, request, response };
}

export async function requestStorageGet(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  objectId?: string;
  contentSha256?: string;
  inlineBase64?: boolean;
  maxBytes?: number;
  capability?: string;
  reason?: string;
  limit?: number;
  db?: OpenFoxDatabase;
  selectionPolicy?: Partial<AgentDiscoverySelectionPolicy>;
  executionPolicy?: Partial<AgentDiscoveryExecutionPolicy>;
}): Promise<{
  provider: VerifiedAgentProvider;
  request: StorageGetInvocationRequest;
  response: StorageGetInvocationResponse;
}> {
  const capability = params.capability ?? "storage.get";
  const executionPolicy = resolveExecutionPolicy(
    params.config,
    capability,
    params.selectionPolicy,
    params.executionPolicy,
  );
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability,
    limit: params.limit ?? executionPolicy.searchLimit,
    selectionPolicy: params.selectionPolicy,
    executionPolicy: params.executionPolicy,
    db: params.db,
  });
  const ranked = sortProviders(
    providers,
    0n,
    executionPolicy,
    params.db,
    capability,
  );
  if (!ranked.length) {
    await throwNoProviderFound({
      config: params.config,
      capability,
      limit: params.limit ?? executionPolicy.searchLimit,
      selectionPolicy: params.selectionPolicy,
      executionPolicy: params.executionPolicy,
      db: params.db,
    });
  }
  const request: StorageGetInvocationRequest = {
    capability,
    requester: {
      agent_id: params.config.agentId || params.identity.address.toLowerCase(),
      identity: {
        kind: "tos",
        value: params.address.toLowerCase(),
      },
    },
    request_nonce: randomBytes(16).toString("hex"),
    request_expires_at: buildRequestExpiry(),
    ...(params.objectId ? { object_id: params.objectId } : {}),
    ...(params.contentSha256 ? { content_sha256: params.contentSha256 } : {}),
    ...(params.inlineBase64 !== undefined
      ? { inline_base64: params.inlineBase64 }
      : {}),
    ...(params.maxBytes !== undefined ? { max_bytes: params.maxBytes } : {}),
    reason: params.reason || "paid storage get",
  };
  const invoked = await invokeCapabilityWithFallback({
    rankedProviders: ranked,
    identity: params.identity,
    config: params.config,
    db: params.db,
    capability,
    maxFallbackProviders: executionPolicy.maxFallbackProviders,
    request,
    eventKey: "agent_discovery:last_storage_get_event",
    parseResponse: (value) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as StorageGetInvocationResponse,
    isValidResponse: (response) => Boolean(response) && response.status === "ok",
    invalidResponseMessage: "Provider returned an invalid storage.get response",
  });
  const provider = invoked.provider;
  const response = invoked.response;
  return { provider, request, response };
}
