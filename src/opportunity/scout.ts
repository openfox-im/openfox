import { discoverCapabilityProviders } from "../agent-discovery/client.js";
import type { VerifiedAgentProvider } from "../agent-discovery/types.js";
import { fetchRemoteBounties, fetchRemoteCampaigns } from "../bounty/client.js";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpportunityKind,
  OpportunityProviderClass,
  OpportunityStrategyProfile,
  OpportunityTrustTier,
} from "../types.js";

export interface OpportunityScoreBreakdown {
  valueScore: number;
  costPenalty: number;
  trustScore: number;
  deadlineScore: number;
  policyBonus: number;
  total: number;
}

export interface OpportunityItem {
  kind: OpportunityKind;
  providerClass: OpportunityProviderClass;
  trustTier: OpportunityTrustTier;
  title: string;
  description: string;
  capability?: string;
  baseUrl?: string;
  bountyId?: string;
  campaignId?: string;
  providerAgentId?: string;
  providerAddress?: string;
  mode?: string;
  rewardWei?: string;
  grossValueWei: string;
  estimatedCostWei: string;
  marginWei: string;
  marginBps: number;
  deadlineAt?: string;
  rawScore: number;
  strategyScore?: number;
  strategyMatched?: boolean;
  strategyReasons?: string[];
  scoreBreakdown?: OpportunityScoreBreakdown;
}

function safeBigInt(value: string | undefined): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

function clampWeiScore(value: bigint): number {
  const capped = value > 1_000_000_000_000_000_000n
    ? 1_000_000_000_000_000_000n
    : value < -1_000_000_000_000_000_000n
      ? -1_000_000_000_000_000_000n
      : value;
  return Number(capped / 1_000_000_000_000n);
}

function parseTrustTierFromProvider(
  provider: VerifiedAgentProvider,
): OpportunityTrustTier {
  const declared = provider.matchedCapability.policy?.trust_tier;
  if (
    declared === "self_hosted" ||
    declared === "org_trusted" ||
    declared === "public_low_trust"
  ) {
    return declared;
  }
  if (provider.search.trust?.registered && provider.search.trust.hasOnchainCapability) {
    return "org_trusted";
  }
  if (provider.search.trust?.registered) {
    return "public_low_trust";
  }
  return "unknown";
}

function classifyProviderClass(capability: string): OpportunityProviderClass {
  if (
    capability.startsWith("task.") ||
    capability.startsWith("bounty.") ||
    capability.startsWith("campaign.")
  ) {
    return "task_market";
  }
  if (capability.startsWith("observation.")) return "observation";
  if (capability.startsWith("oracle.")) return "oracle";
  if (capability.startsWith("sentiment.")) return "general_provider";
  if (
    capability.startsWith("signer.") ||
    capability.startsWith("paymaster.") ||
    capability.startsWith("sponsor.")
  ) {
    return "sponsored_execution";
  }
  if (capability.startsWith("storage.") || capability.startsWith("artifact.")) {
    return "storage_artifacts";
  }
  return "general_provider";
}

function computeMarginBps(grossValueWei: bigint, estimatedCostWei: bigint): number {
  if (grossValueWei <= 0n) {
    return estimatedCostWei === 0n ? 0 : -10_000;
  }
  return Number(((grossValueWei - estimatedCostWei) * 10_000n) / grossValueWei);
}

function buildRawOpportunity(params: {
  kind: OpportunityKind;
  providerClass: OpportunityProviderClass;
  trustTier: OpportunityTrustTier;
  title: string;
  description: string;
  capability?: string;
  baseUrl?: string;
  bountyId?: string;
  campaignId?: string;
  providerAgentId?: string;
  providerAddress?: string;
  mode?: string;
  grossValueWei: bigint;
  estimatedCostWei: bigint;
  deadlineAt?: string;
}): OpportunityItem {
  const marginWei = params.grossValueWei - params.estimatedCostWei;
  const marginBps = computeMarginBps(params.grossValueWei, params.estimatedCostWei);
  const rawScore =
    clampWeiScore(marginWei > 0n ? marginWei : 0n) +
    (params.mode === "sponsored" ? 500 : 0);
  return {
    kind: params.kind,
    providerClass: params.providerClass,
    trustTier: params.trustTier,
    title: params.title,
    description: params.description,
    capability: params.capability,
    baseUrl: params.baseUrl,
    bountyId: params.bountyId,
    campaignId: params.campaignId,
    providerAgentId: params.providerAgentId,
    providerAddress: params.providerAddress,
    mode: params.mode,
    rewardWei: params.grossValueWei.toString(),
    grossValueWei: params.grossValueWei.toString(),
    estimatedCostWei: params.estimatedCostWei.toString(),
    marginWei: marginWei.toString(),
    marginBps,
    deadlineAt: params.deadlineAt,
    rawScore,
  };
}

function calculateDeadlineScore(
  deadlineAt: string | undefined,
  strategy: OpportunityStrategyProfile,
): { score: number; reason?: string } {
  if (!deadlineAt) {
    return { score: 100 };
  }
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return { score: 0, reason: "invalid deadline" };
  }
  const hoursRemaining = (deadlineMs - Date.now()) / 3_600_000;
  if (hoursRemaining < 0) {
    return { score: -500, reason: "deadline already passed" };
  }
  if (hoursRemaining > strategy.maxDeadlineHours) {
    return { score: -250, reason: "deadline exceeds strategy window" };
  }
  if (hoursRemaining <= 6) return { score: 300 };
  if (hoursRemaining <= 24) return { score: 220 };
  if (hoursRemaining <= 72) return { score: 140 };
  return { score: 80 };
}

function trustTierScore(trustTier: OpportunityTrustTier): number {
  switch (trustTier) {
    case "self_hosted":
      return 300;
    case "org_trusted":
      return 220;
    case "public_low_trust":
      return 100;
    default:
      return 10;
  }
}

function evaluatePolicyFit(
  item: OpportunityItem,
  strategy: OpportunityStrategyProfile,
): { matched: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const costWei = safeBigInt(item.estimatedCostWei);
  if (!strategy.enabledOpportunityKinds.includes(item.kind)) {
    reasons.push(`kind ${item.kind} is disabled`);
  }
  if (!strategy.enabledProviderClasses.includes(item.providerClass)) {
    reasons.push(`provider class ${item.providerClass} is disabled`);
  }
  if (!strategy.allowedTrustTiers.includes(item.trustTier)) {
    reasons.push(`trust tier ${item.trustTier} is not allowed`);
  }
  if (costWei > safeBigInt(strategy.maxSpendPerOpportunityWei)) {
    reasons.push("estimated cost exceeds strategy max spend");
  }
  if (item.marginBps < strategy.minMarginBps) {
    reasons.push("margin is below the strategy threshold");
  }
  if (item.deadlineAt) {
    const deadlineMs = Date.parse(item.deadlineAt);
    if (Number.isFinite(deadlineMs)) {
      const hoursRemaining = (deadlineMs - Date.now()) / 3_600_000;
      if (hoursRemaining > strategy.maxDeadlineHours) {
        reasons.push("deadline exceeds the strategy horizon");
      }
    }
  }
  return {
    matched: reasons.length === 0,
    reasons,
  };
}

export function rankOpportunityItems(params: {
  items: OpportunityItem[];
  strategy: OpportunityStrategyProfile;
  maxItems?: number;
}): OpportunityItem[] {
  const ranked = params.items.map((item) => {
    const grossValueWei = safeBigInt(item.grossValueWei);
    const estimatedCostWei = safeBigInt(item.estimatedCostWei);
    const marginWei = grossValueWei - estimatedCostWei;
    const valueScore = clampWeiScore(marginWei > 0n ? marginWei : 0n);
    const costPenalty = clampWeiScore(estimatedCostWei);
    const trustScore = trustTierScore(item.trustTier);
    const deadline = calculateDeadlineScore(item.deadlineAt, params.strategy);
    const fit = evaluatePolicyFit(item, params.strategy);
    const policyBonus = fit.matched ? 1_000 : -250;
    const total =
      valueScore -
      costPenalty +
      trustScore +
      deadline.score +
      policyBonus;
    return {
      ...item,
      strategyScore: total,
      strategyMatched: fit.matched,
      strategyReasons: fit.reasons,
      scoreBreakdown: {
        valueScore,
        costPenalty,
        trustScore,
        deadlineScore: deadline.score,
        policyBonus,
        total,
      },
    };
  });
  return ranked
    .sort((left, right) => {
      if ((right.strategyScore ?? 0) !== (left.strategyScore ?? 0)) {
        return (right.strategyScore ?? 0) - (left.strategyScore ?? 0);
      }
      return right.rawScore - left.rawScore;
    })
    .slice(0, params.maxItems ?? ranked.length);
}

export async function collectOpportunityItems(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}): Promise<OpportunityItem[]> {
  if (!params.config.opportunityScout?.enabled) {
    return [];
  }

  const items: OpportunityItem[] = [];
  const remoteBaseUrls = new Set<string>(params.config.opportunityScout.remoteBaseUrls);
  if (params.config.bounty?.remoteBaseUrl) {
    remoteBaseUrls.add(params.config.bounty.remoteBaseUrl);
  }
  const minRewardWei = safeBigInt(params.config.opportunityScout.minRewardWei);

  for (const baseUrl of remoteBaseUrls) {
    try {
      const campaigns = await fetchRemoteCampaigns(baseUrl);
      for (const campaign of campaigns) {
        if (campaign.status !== "open" && campaign.status !== "exhausted") continue;
        const remainingWei = safeBigInt(campaign.progress.remainingWei);
        const allocatedWei = safeBigInt(campaign.progress.allocatedWei);
        const scoreBase = remainingWei > 0n ? remainingWei : allocatedWei;
        if (scoreBase < minRewardWei) continue;
        items.push(
          buildRawOpportunity({
            kind: "campaign",
            providerClass: "task_market",
            trustTier: "unknown",
            title: campaign.title,
            description: campaign.description,
            capability: "task.submit",
            baseUrl,
            campaignId: campaign.campaignId,
            providerAgentId: campaign.hostAgentId,
            providerAddress: campaign.hostAddress,
            grossValueWei: remainingWei > 0n ? remainingWei : allocatedWei,
            estimatedCostWei: 0n,
          }),
        );
      }

      const bounties = await fetchRemoteBounties(baseUrl);
      for (const bounty of bounties) {
        if (bounty.status !== "open") continue;
        const rewardWei = safeBigInt(bounty.rewardWei);
        if (rewardWei < minRewardWei) continue;
        items.push(
          buildRawOpportunity({
            kind: "bounty",
            providerClass: "task_market",
            trustTier: "unknown",
            title: bounty.title,
            description: bounty.taskPrompt,
            capability: "task.submit",
            baseUrl,
            bountyId: bounty.bountyId,
            providerAgentId: bounty.hostAgentId,
            providerAddress: bounty.hostAddress,
            grossValueWei: rewardWei,
            estimatedCostWei: 0n,
            deadlineAt: bounty.submissionDeadline,
          }),
        );
      }
    } catch {
      continue;
    }
  }

  if (params.config.agentDiscovery?.enabled) {
    for (const capability of params.config.opportunityScout.discoveryCapabilities) {
      try {
        const providers = await discoverCapabilityProviders({
          config: params.config,
          db: params.db,
          capability,
          limit: params.config.opportunityScout.maxItems,
        });
        for (const provider of providers) {
          const providerClass = classifyProviderClass(provider.matchedCapability.name);
          const trustTier = parseTrustTierFromProvider(provider);
          const amountWei = safeBigInt(provider.matchedCapability.max_amount);
          let grossValueWei = amountWei;
          let estimatedCostWei = 0n;
          if (provider.matchedCapability.mode === "paid") {
            grossValueWei = 0n;
            estimatedCostWei = amountWei;
          } else if (provider.matchedCapability.mode === "hybrid") {
            estimatedCostWei = amountWei;
          }
          items.push(
            buildRawOpportunity({
              kind: "provider",
              providerClass,
              trustTier,
              title:
                provider.card.display_name ||
                provider.search.primaryIdentity ||
                provider.card.agent_id,
              description:
                provider.matchedCapability.description ||
                `Provider for ${provider.matchedCapability.name}`,
              capability: provider.matchedCapability.name,
              baseUrl: provider.endpoint.url,
              providerAgentId: provider.card.agent_id,
              providerAddress: provider.search.primaryIdentity,
              mode: provider.matchedCapability.mode,
              grossValueWei,
              estimatedCostWei,
            }),
          );
        }
      } catch {
        continue;
      }
    }
  }

  return items
    .sort((left, right) => right.rawScore - left.rawScore)
    .slice(0, params.config.opportunityScout.maxItems);
}

export function buildOpportunityReport(items: OpportunityItem[]): string {
  if (!items.length) {
    return "No earning opportunities discovered.";
  }
  return items
    .map((item, index) => {
      const capability = item.capability ? ` capability=${item.capability}` : "";
      const mode = item.mode ? ` mode=${item.mode}` : "";
      const gross = ` gross=${item.grossValueWei}`;
      const cost = ` cost=${item.estimatedCostWei}`;
      const margin = ` margin=${item.marginWei}`;
      const trust = ` trust=${item.trustTier}`;
      const providerClass = ` class=${item.providerClass}`;
      return `${index + 1}. [${item.kind}] ${item.title}${capability}${mode}${gross}${cost}${margin}${trust}${providerClass}\n   ${item.description}`;
    })
    .join("\n");
}

export function buildRankedOpportunityReport(
  items: OpportunityItem[],
  strategy: OpportunityStrategyProfile,
): string {
  if (!items.length) {
    return `No opportunities matched strategy '${strategy.name}'.`;
  }
  return items
    .map((item, index) => {
      const fit = item.strategyMatched ? "matched" : "filtered";
      const reasons =
        item.strategyReasons && item.strategyReasons.length
          ? ` reasons=${item.strategyReasons.join("; ")}`
          : "";
      return `${index + 1}. [${fit}] ${item.title} score=${item.strategyScore ?? item.rawScore} margin_bps=${item.marginBps}${reasons}`;
    })
    .join("\n");
}
