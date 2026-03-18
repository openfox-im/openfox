/**
 * Sponsor Module - Discovery and Ranking
 *
 * GTOS 2046 Phase 5: Discovers available sponsors for a given action
 * and selects the best one based on policy constraints.
 */

import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import type { SponsorQuote, SponsorPolicy, SponsorSelection } from "./types.js";
import { discoverIntentSponsorQuotes } from "../agent-discovery/financial-discovery.js";

export interface SponsorDiscoveryOptions {
  action: string;
  value: string;
  gasEstimate: number;
  requester: string;
  recipient?: string;
  config?: OpenFoxConfig;
  db?: OpenFoxDatabase;
  data?: `0x${string}`;
}

export function rankSponsors(
  quotes: SponsorQuote[],
  policy: SponsorPolicy,
  txValue: string,
): SponsorQuote[] {
  if (quotes.length === 0) return [];

  // Filter by trust tier
  let eligible = quotes.filter((q) => q.trustTier >= policy.minTrustTier);

  // Filter by max fee
  eligible = eligible.filter((q) => {
    const fee = BigInt(q.feeAmount);
    const maxAbs = BigInt(policy.maxFeeAbsolute || "0");
    if (maxAbs > 0n && fee > maxAbs) return false;
    if (policy.maxFeePercent > 0 && txValue !== "0") {
      const val = BigInt(txValue);
      const maxFee =
        (val * BigInt(Math.floor(policy.maxFeePercent * 100))) / 10000n;
      if (fee > maxFee) return false;
    }
    return true;
  });

  if (eligible.length === 0) return [];

  return sortSponsors(eligible, policy);
}

/**
 * Discover available sponsors for a given action.
 * When Agent Discovery is configured, this queries paymaster providers
 * and fetches live quote surfaces for sponsor ranking.
 */
export async function discoverSponsors(
  options: SponsorDiscoveryOptions,
): Promise<SponsorQuote[]> {
  if (!options.config?.agentDiscovery?.enabled) {
    return [];
  }
  return discoverIntentSponsorQuotes({
    config: options.config,
    db: options.db,
    execution: {
      action: options.action,
      requester: options.requester,
      recipient: options.recipient,
      value: options.value,
      gasEstimate: options.gasEstimate,
      ...(options.data ? { data: options.data } : {}),
    },
  });
}

/**
 * Rank and select the best sponsor based on policy constraints.
 * Filters by trust tier and fee limits, then sorts by the chosen strategy.
 */
export function selectSponsor(
  quotes: SponsorQuote[],
  policy: SponsorPolicy,
  txValue: string,
): SponsorSelection | null {
  const ranked = rankSponsors(quotes, policy, txValue);
  if (ranked.length === 0) return null;

  const preferredSet = new Set(policy.preferredSponsors);
  const selectionPool = !policy.autoSelectEnabled
    ? ranked.filter((quote) => preferredSet.has(quote.sponsorAddress))
    : ranked;

  if (selectionPool.length === 0) return null;

  const selected = selectionPool[0];
  return {
    selected,
    alternatives: policy.fallbackEnabled ? selectionPool.slice(1) : [],
    reason: !policy.autoSelectEnabled ? "preferred_first" : policy.strategy,
    totalCostDisplay: formatTotalCost(selected.feeAmount, txValue),
  };
}

function sortSponsors(
  quotes: SponsorQuote[],
  policy: SponsorPolicy,
): SponsorQuote[] {
  const eligible = [...quotes];
  switch (policy.strategy) {
    case "cheapest":
      eligible.sort((a, b) => {
        const diff = BigInt(a.feeAmount) - BigInt(b.feeAmount);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      });
      break;
    case "fastest":
      eligible.sort(
        (a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity),
      );
      break;
    case "highest_trust":
      eligible.sort((a, b) => {
        if (a.trustTier !== b.trustTier) {
          return b.trustTier - a.trustTier;
        }
        const repDiff = (b.reputationScore ?? 0) - (a.reputationScore ?? 0);
        if (repDiff !== 0) return repDiff;
        const feeDiff = BigInt(a.feeAmount) - BigInt(b.feeAmount);
        return feeDiff < 0n ? -1 : feeDiff > 0n ? 1 : 0;
      });
      break;
    case "preferred_first": {
      const preferredSet = new Set(policy.preferredSponsors);
      eligible.sort((a, b) => {
        const aPreferred = preferredSet.has(a.sponsorAddress) ? 0 : 1;
        const bPreferred = preferredSet.has(b.sponsorAddress) ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
        const diff = BigInt(a.feeAmount) - BigInt(b.feeAmount);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      });
      break;
    }
  }
  return eligible;
}

function formatTotalCost(fee: string, value: string): string {
  const feeEth = Number(BigInt(fee)) / 1e18;
  const valueEth = Number(BigInt(value)) / 1e18;
  if (feeEth === 0) return `${valueEth.toFixed(4)} TOS (gasless)`;
  return `${valueEth.toFixed(4)} TOS (+ ${feeEth.toFixed(6)} fee)`;
}
