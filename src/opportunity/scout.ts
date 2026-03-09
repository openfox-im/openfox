import { discoverCapabilityProviders } from "../agent-discovery/client.js";
import { fetchRemoteBounties } from "../bounty/client.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";

export interface OpportunityItem {
  kind: "bounty" | "provider";
  title: string;
  description: string;
  capability?: string;
  baseUrl?: string;
  bountyId?: string;
  rewardWei?: string;
  providerAgentId?: string;
  providerAddress?: string;
  mode?: string;
  score: number;
}

function safeBigInt(value: string | undefined): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

function toScore(value: bigint): number {
  const capped = value > 1_000_000_000_000_000_000n ? 1_000_000_000_000_000_000n : value;
  return Number(capped);
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
      const bounties = await fetchRemoteBounties(baseUrl);
      for (const bounty of bounties) {
        if (bounty.status !== "open") continue;
        const rewardWei = safeBigInt(bounty.rewardWei);
        if (rewardWei < minRewardWei) continue;
        items.push({
          kind: "bounty",
          title: bounty.title,
          description: bounty.taskPrompt,
          capability: "task.submit",
          baseUrl,
          bountyId: bounty.bountyId,
          rewardWei: bounty.rewardWei,
          providerAgentId: bounty.hostAgentId,
          providerAddress: bounty.hostAddress,
          score: toScore(rewardWei),
        });
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
          const rewardWei = safeBigInt(provider.matchedCapability.max_amount);
          const sponsoredBoost = provider.matchedCapability.mode === "sponsored" ? 10_000 : 0;
          items.push({
            kind: "provider",
            title:
              provider.card.display_name ||
              provider.search.primaryIdentity ||
              provider.card.agent_id,
            description:
              provider.matchedCapability.description ||
              `Provider for ${provider.matchedCapability.name}`,
            capability: provider.matchedCapability.name,
            baseUrl: provider.endpoint.url,
            rewardWei:
              provider.matchedCapability.max_amount ||
              provider.matchedCapability.rate_limit,
            providerAgentId: provider.card.agent_id,
            providerAddress: provider.search.primaryIdentity,
            mode: provider.matchedCapability.mode,
            score: toScore(rewardWei) + sponsoredBoost,
          });
        }
      } catch {
        continue;
      }
    }
  }

  return items
    .sort((left, right) => right.score - left.score)
    .slice(0, params.config.opportunityScout.maxItems);
}

export function buildOpportunityReport(items: OpportunityItem[]): string {
  if (!items.length) {
    return "No earning opportunities discovered.";
  }
  return items
    .map((item, index) => {
      const reward = item.rewardWei ? ` reward=${item.rewardWei}` : "";
      const capability = item.capability ? ` capability=${item.capability}` : "";
      const mode = item.mode ? ` mode=${item.mode}` : "";
      return `${index + 1}. [${item.kind}] ${item.title}${capability}${mode}${reward}\n   ${item.description}`;
    })
    .join("\n");
}
