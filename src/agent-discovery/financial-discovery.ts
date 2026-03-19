import type { Address } from "@tosnetwork/tosdk";
import type { OpenFoxConfig, OpenFoxDatabase, SignerProviderTrustTier } from "../types.js";
import type { ProviderProfile } from "../routing/types.js";
import type { SponsorQuote } from "../sponsor/types.js";
import type { VerifiedAgentProvider } from "./types.js";
import { discoverCapabilityProviders } from "./client.js";
import { fetchSignerQuote } from "../signer/client.js";
import { fetchPaymasterQuote } from "../paymaster/client.js";

const DEFAULT_GAS_ESTIMATE = 50_000;
const DEFAULT_PROVIDER_LIMIT = 5;
const ZERO_POLICY_HASH = "0x" + "0".repeat(64);

export interface ExecutionDiscoveryParams {
  action: string;
  requester: string;
  target?: string;
  recipient?: string;
  value: string;
  gasEstimate?: number;
  data?: `0x${string}`;
}

export async function discoverIntentRouteProviders(params: {
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
  execution: ExecutionDiscoveryParams;
}): Promise<ProviderProfile[]> {
  if (!params.config.agentDiscovery?.enabled) {
    return [];
  }

  const target = resolveExecutionTarget(params.execution);
  if (!target) {
    return [];
  }

  const capabilityPrefix = params.config.signerProvider?.capabilityPrefix || "signer";
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability: `${capabilityPrefix}.quote`,
    limit: DEFAULT_PROVIDER_LIMIT,
    db: params.db,
  });

  const discovered = await Promise.all(
    providers.map(async (provider) => buildSignerRouteProvider(provider, params.execution)),
  );
  return discovered.filter((provider): provider is ProviderProfile => provider !== null);
}

export async function discoverIntentSponsorQuotes(params: {
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
  execution: ExecutionDiscoveryParams;
}): Promise<SponsorQuote[]> {
  if (!params.config.agentDiscovery?.enabled) {
    return [];
  }

  const target = resolveExecutionTarget(params.execution);
  if (!target) {
    return [];
  }

  const capabilityPrefix = params.config.paymasterProvider?.capabilityPrefix || "paymaster";
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability: `${capabilityPrefix}.quote`,
    limit: DEFAULT_PROVIDER_LIMIT,
    db: params.db,
  });

  const discovered = await Promise.all(
    providers.map(async (provider) => buildSponsorQuote(provider, params.execution)),
  );
  return discovered.filter((quote): quote is SponsorQuote => quote !== null);
}

async function buildSignerRouteProvider(
  provider: VerifiedAgentProvider,
  execution: ExecutionDiscoveryParams,
): Promise<ProviderProfile | null> {
  const target = resolveExecutionTarget(execution);
  if (!target) {
    return null;
  }

  const providerBaseUrl = toProviderBaseUrl(provider.endpoint.url);
  const startedAt = Date.now();

  try {
    const quote = await fetchSignerQuote({
      providerBaseUrl,
      requesterAddress: execution.requester as Address,
      target: target as Address,
      valueTomi: execution.value,
      gas: String(execution.gasEstimate ?? DEFAULT_GAS_ESTIMATE),
      ...(execution.data ? { data: execution.data } : {}),
      reason: `intent:${execution.action}`,
    });

    return {
      address: asNonEmptyString(quote["provider_address"])
        ?? provider.search.primaryIdentity
        ?? provider.card.primary_identity.value,
      name: provider.card.display_name,
      serviceKinds: ["signer"],
      capabilities: [provider.matchedCapability.name],
      trustTier: parseTrustTier(quote["trust_tier"], provider),
      reputationScore: computeReputationScore(provider),
      latencyMs: Date.now() - startedAt,
      feeSchedule: {
        baseFee: asNumericString(quote["amount_tomi"]) ?? "0",
        perGasFee: "0",
        percentFee: 0,
        currency: "TOS",
      },
      sponsorSupport: false,
      gatewayRequired: Boolean(provider.endpoint.via_gateway),
      endpoint: providerBaseUrl,
      lastSeen: Date.now(),
    };
  } catch {
    return null;
  }
}

async function buildSponsorQuote(
  provider: VerifiedAgentProvider,
  execution: ExecutionDiscoveryParams,
): Promise<SponsorQuote | null> {
  const target = resolveExecutionTarget(execution);
  if (!target) {
    return null;
  }

  const providerBaseUrl = toProviderBaseUrl(provider.endpoint.url);
  const startedAt = Date.now();

  try {
    const quote = await fetchPaymasterQuote({
      providerBaseUrl,
      requesterAddress: execution.requester as Address,
      walletAddress: execution.requester as Address,
      target: target as Address,
      valueTomi: execution.value,
      gas: String(execution.gasEstimate ?? DEFAULT_GAS_ESTIMATE),
      ...(execution.data ? { data: execution.data } : {}),
      reason: `intent:${execution.action}`,
    });

    return {
      sponsorAddress: asNonEmptyString(quote["sponsor_address"])
        ?? parseSponsorAddress(provider)
        ?? provider.search.primaryIdentity
        ?? provider.card.primary_identity.value,
      sponsorName: provider.card.display_name,
      feeAmount: asNumericString(quote["amount_tomi"]) ?? "0",
      feeCurrency: "TOS",
      gasLimit: parseNumber(quote["gas"]) ?? execution.gasEstimate ?? DEFAULT_GAS_ESTIMATE,
      expiresAt:
        parseNumber(quote["expires_at"])
        ?? Math.floor(Date.now() / 1000) + 120,
      policyHash: asNonEmptyString(quote["policy_hash"]) ?? ZERO_POLICY_HASH,
      trustTier: parseTrustTier(quote["trust_tier"], provider),
      latencyMs: Date.now() - startedAt,
      reputationScore: computeReputationScore(provider),
    };
  } catch {
    return null;
  }
}

function resolveExecutionTarget(execution: ExecutionDiscoveryParams): string | null {
  const target = execution.target?.trim() || execution.recipient?.trim() || execution.requester.trim();
  return target ? target : null;
}

function toProviderBaseUrl(url: string): string {
  return url.replace(/\/(quote|submit|authorize|status|receipt)$/, "").replace(/\/+$/, "");
}

function computeReputationScore(provider: VerifiedAgentProvider): number {
  const localScore = provider.search.trust?.localRankScore;
  if (typeof localScore === "number" && Number.isFinite(localScore)) {
    return Math.max(0, Math.min(100, Math.round(localScore)));
  }
  const reputation = parseNumber(provider.search.trust?.reputation);
  if (reputation !== null) {
    return Math.max(0, Math.min(100, reputation));
  }
  return 50;
}

function parseTrustTier(
  raw: unknown,
  provider: VerifiedAgentProvider,
): number {
  const declared = normalizeTrustTier(raw)
    ?? normalizeTrustTier(provider.matchedCapability.policy?.["trust_tier"])
    ?? inferTrustTier(provider);
  switch (declared) {
    case "self_hosted":
      return 4;
    case "org_trusted":
      return 3;
    case "public_low_trust":
      return 1;
    default:
      return 2;
  }
}

function inferTrustTier(provider: VerifiedAgentProvider): SignerProviderTrustTier | null {
  if (provider.search.trust?.registered && provider.search.trust.hasOnchainCapability) {
    return "org_trusted";
  }
  if (provider.search.trust?.registered) {
    return "public_low_trust";
  }
  return null;
}

function normalizeTrustTier(value: unknown): SignerProviderTrustTier | null {
  return value === "self_hosted" || value === "org_trusted" || value === "public_low_trust"
    ? value
    : null;
}

function parseSponsorAddress(provider: VerifiedAgentProvider): string | null {
  return asNonEmptyString(provider.matchedCapability.policy?.["sponsor_address"]);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumericString(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  try {
    return BigInt(normalized).toString();
  } catch {
    return null;
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
