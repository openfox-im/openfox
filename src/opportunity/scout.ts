import {
  diagnoseCapabilityProviders,
  discoverCapabilityProviders,
  summarizeProviderDiagnostics,
} from "../agent-discovery/client.js";
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
  rewardTomi?: string;
  grossValueTomi: string;
  estimatedCostTomi: string;
  marginTomi: string;
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

function clampTomiScore(value: bigint): number {
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

function recordDiscoveryDiagnostics(
  db: OpenFoxDatabase,
  capability: string,
  summary: string,
): void {
  db.setKV(
    `opportunity_scout:last_discovery_diagnostics:${capability}`,
    JSON.stringify({
      at: new Date().toISOString(),
      capability,
      summary,
    }),
  );
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

function computeMarginBps(grossValueTomi: bigint, estimatedCostTomi: bigint): number {
  if (grossValueTomi <= 0n) {
    return estimatedCostTomi === 0n ? 0 : -10_000;
  }
  return Number(((grossValueTomi - estimatedCostTomi) * 10_000n) / grossValueTomi);
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
  grossValueTomi: bigint;
  estimatedCostTomi: bigint;
  deadlineAt?: string;
}): OpportunityItem {
  const marginTomi = params.grossValueTomi - params.estimatedCostTomi;
  const marginBps = computeMarginBps(params.grossValueTomi, params.estimatedCostTomi);
  const rawScore =
    clampTomiScore(marginTomi > 0n ? marginTomi : 0n) +
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
    rewardTomi: params.grossValueTomi.toString(),
    grossValueTomi: params.grossValueTomi.toString(),
    estimatedCostTomi: params.estimatedCostTomi.toString(),
    marginTomi: marginTomi.toString(),
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
  const costTomi = safeBigInt(item.estimatedCostTomi);
  if (!strategy.enabledOpportunityKinds.includes(item.kind)) {
    reasons.push(`kind ${item.kind} is disabled`);
  }
  if (!strategy.enabledProviderClasses.includes(item.providerClass)) {
    reasons.push(`provider class ${item.providerClass} is disabled`);
  }
  if (!strategy.allowedTrustTiers.includes(item.trustTier)) {
    reasons.push(`trust tier ${item.trustTier} is not allowed`);
  }
  if (costTomi > safeBigInt(strategy.maxSpendPerOpportunityTomi)) {
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
    const grossValueTomi = safeBigInt(item.grossValueTomi);
    const estimatedCostTomi = safeBigInt(item.estimatedCostTomi);
    const marginTomi = grossValueTomi - estimatedCostTomi;
    const valueScore = clampTomiScore(marginTomi > 0n ? marginTomi : 0n);
    const costPenalty = clampTomiScore(estimatedCostTomi);
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
  const minRewardTomi = safeBigInt(params.config.opportunityScout.minRewardTomi);

  for (const baseUrl of remoteBaseUrls) {
    try {
      const campaigns = await fetchRemoteCampaigns(baseUrl);
      for (const campaign of campaigns) {
        if (campaign.status !== "open" && campaign.status !== "exhausted") continue;
        const remainingTomi = safeBigInt(campaign.progress.remainingTomi);
        const allocatedTomi = safeBigInt(campaign.progress.allocatedTomi);
        const scoreBase = remainingTomi > 0n ? remainingTomi : allocatedTomi;
        if (scoreBase < minRewardTomi) continue;
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
            grossValueTomi: remainingTomi > 0n ? remainingTomi : allocatedTomi,
            estimatedCostTomi: 0n,
          }),
        );
      }

      const bounties = await fetchRemoteBounties(baseUrl);
      for (const bounty of bounties) {
        if (bounty.status !== "open") continue;
        const rewardTomi = safeBigInt(bounty.rewardTomi);
        if (rewardTomi < minRewardTomi) continue;
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
            grossValueTomi: rewardTomi,
            estimatedCostTomi: 0n,
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
        if (!providers.length) {
          const diagnostics = await diagnoseCapabilityProviders({
            config: params.config,
            db: params.db,
            capability,
            limit: params.config.opportunityScout.maxItems,
          });
          recordDiscoveryDiagnostics(
            params.db,
            capability,
            summarizeProviderDiagnostics(diagnostics),
          );
        }
        for (const provider of providers) {
          const providerClass = classifyProviderClass(provider.matchedCapability.name);
          const trustTier = parseTrustTierFromProvider(provider);
          const amountTomi = safeBigInt(provider.matchedCapability.max_amount);
          let grossValueTomi = amountTomi;
          let estimatedCostTomi = 0n;
          if (provider.matchedCapability.mode === "paid") {
            grossValueTomi = 0n;
            estimatedCostTomi = amountTomi;
          } else if (provider.matchedCapability.mode === "hybrid") {
            estimatedCostTomi = amountTomi;
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
                [
                  provider.matchedCapability.description ||
                    `Provider for ${provider.matchedCapability.name}`,
                  provider.card.package_name
                    ? `package=${provider.card.package_name}`
                    : undefined,
                  provider.card.routing_profile?.serviceKind
                    ? `routing=${provider.card.routing_profile.serviceKind}/${provider.card.routing_profile.capabilityKind || "unknown"}`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" | "),
              capability: provider.matchedCapability.name,
              baseUrl: provider.endpoint.url,
              providerAgentId: provider.card.agent_id,
              providerAddress: provider.search.primaryIdentity,
              mode: provider.matchedCapability.mode,
              grossValueTomi,
              estimatedCostTomi,
            }),
          );
        }
      } catch (error) {
        recordDiscoveryDiagnostics(
          params.db,
          capability,
          error instanceof Error ? error.message : String(error),
        );
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
      const gross = ` gross=${item.grossValueTomi}`;
      const cost = ` cost=${item.estimatedCostTomi}`;
      const margin = ` margin=${item.marginTomi}`;
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
