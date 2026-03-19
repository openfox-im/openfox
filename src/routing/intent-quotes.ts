import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import {
  discoverIntentRouteProviders,
  type ExecutionDiscoveryParams,
} from "../agent-discovery/financial-discovery.js";
import { discoverSponsors, selectSponsor } from "../sponsor/discovery.js";
import type {
  SponsorPolicy,
  SponsorQuote,
  SponsorSelection,
} from "../sponsor/types.js";
import { FinancialRouter } from "./router.js";
import type { RoutingPolicy } from "./types.js";
import type { QuoteComparison } from "./quotes.js";
import { compareQuotes, formatQuoteTable } from "./quotes.js";

const DEFAULT_GAS_ESTIMATE = 50_000;

export interface IntentQuotePreview {
  intentId: string;
  action: string;
  value: string;
  requester: string;
  recipient: string;
  routeComparison: QuoteComparison;
  sponsorQuotes: SponsorQuote[];
  sponsorSelection: SponsorSelection | null;
}

export interface IntentQuotePreviewDependencies {
  discoverRouteProviders?: (params: {
    config: OpenFoxConfig;
    db?: OpenFoxDatabase;
    execution: ExecutionDiscoveryParams;
  }) => Promise<Awaited<ReturnType<typeof discoverIntentRouteProviders>>>;
  discoverSponsorQuotes?: typeof discoverSponsors;
}

export async function buildIntentQuotePreview(params: {
  action: string;
  value: string;
  requester: string;
  recipient?: string;
  gasEstimate?: number;
  config: OpenFoxConfig;
  db?: OpenFoxDatabase;
  routingPolicy?: Partial<RoutingPolicy>;
  sponsorPolicy?: SponsorPolicy;
}, deps: IntentQuotePreviewDependencies = {}): Promise<IntentQuotePreview> {
  const intentId = `QUOTE_${Date.now().toString(36).toUpperCase()}`;
  const recipient = params.recipient ?? params.requester;
  const gasEstimate = params.gasEstimate ?? DEFAULT_GAS_ESTIMATE;
  const execution: ExecutionDiscoveryParams = {
    action: params.action,
    requester: params.requester,
    recipient,
    target: recipient,
    value: params.value,
    gasEstimate,
  };

  const discoverRouteProviders = deps.discoverRouteProviders ?? discoverIntentRouteProviders;
  const discoverSponsorQuotes = deps.discoverSponsorQuotes ?? discoverSponsors;

  const discoveredProviders = await discoverRouteProviders({
    config: params.config,
    db: params.db,
    execution,
  });

  const router = new FinancialRouter(params.routingPolicy);
  for (const provider of discoveredProviders) {
    router.registerProvider(provider);
  }

  const routingDecision = await router.route({
    intentId,
    serviceKind: "signer",
    value: params.value,
    gasEstimate,
  });

  const routeCandidates = routingDecision
    ? [routingDecision.selected, ...routingDecision.alternatives]
    : [];

  const sponsorQuotes = await discoverSponsorQuotes({
    action: params.action,
    value: params.value,
    gasEstimate,
    requester: params.requester,
    recipient,
    config: params.config,
    db: params.db,
  });

  const sponsorSelection = params.sponsorPolicy
    ? selectSponsor(sponsorQuotes, params.sponsorPolicy, params.value)
    : null;

  return {
    intentId,
    action: params.action,
    value: params.value,
    requester: params.requester,
    recipient,
    routeComparison: compareQuotes(intentId, params.action, params.value, routeCandidates),
    sponsorQuotes,
    sponsorSelection,
  };
}

export function formatIntentQuotePreview(preview: IntentQuotePreview): string {
  const sections: string[] = [];

  sections.push(`Intent quote preview: ${preview.action}`);
  sections.push(`Intent: ${preview.intentId}`);
  sections.push(`Requester: ${preview.requester}`);
  sections.push(`Recipient: ${preview.recipient}`);
  sections.push(`Value: ${formatNativeAmount(BigInt(preview.value))}`);

  if (preview.routeComparison.quotes.length > 0) {
    sections.push("");
    sections.push("Provider route quotes:");
    sections.push(formatQuoteTable(preview.routeComparison));
  } else {
    sections.push("");
    sections.push("Provider route quotes:");
    sections.push("No provider quotes discovered for this intent preview.");
  }

  sections.push("");
  sections.push("Sponsor quotes:");
  if (preview.sponsorQuotes.length === 0) {
    sections.push("No sponsor quotes available. Fallback is self-pay.");
  } else {
    for (let i = 0; i < preview.sponsorQuotes.length; i++) {
      const quote = preview.sponsorQuotes[i]!;
      const tags: string[] = [];
      if (preview.sponsorSelection?.selected.sponsorAddress === quote.sponsorAddress) {
        tags.push("recommended");
      } else if (
        preview.sponsorSelection?.alternatives.some(
          (candidate) => candidate.sponsorAddress === quote.sponsorAddress,
        )
      ) {
        tags.push("fallback");
      }
      sections.push(
        `${i + 1}. ${quote.sponsorName ?? quote.sponsorAddress} - fee:${formatNativeAmount(BigInt(quote.feeAmount))} trust:T${quote.trustTier}${quote.latencyMs !== undefined ? ` latency:${quote.latencyMs}ms` : ""}${tags.length > 0 ? ` [${tags.join(", ")}]` : ""}`,
      );
    }
    if (preview.sponsorSelection) {
      sections.push("");
      sections.push(
        `Recommended sponsor: ${preview.sponsorSelection.selected.sponsorName ?? preview.sponsorSelection.selected.sponsorAddress} (${preview.sponsorSelection.reason})`,
      );
      sections.push(`Total cost: ${preview.sponsorSelection.totalCostDisplay}`);
      if (preview.sponsorSelection.alternatives.length > 0) {
        sections.push(
          `Fallback order: ${preview.sponsorSelection.alternatives
            .map((quote) => quote.sponsorName ?? quote.sponsorAddress)
            .join(" -> ")} -> self-pay`,
        );
      } else {
        sections.push("Fallback order: self-pay");
      }
    } else {
      sections.push("");
      sections.push("No sponsor auto-selection matched the active policy.");
      sections.push("Fallback order: self-pay");
    }
  }

  return sections.join("\n");
}

function formatNativeAmount(amount: bigint): string {
  if (amount === 0n) return "0 TOS";
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 1_000_000_000_000_000_000n;
  const fraction = absolute % 1_000_000_000_000_000_000n;
  const fractionText = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fractionText ? `.${fractionText}` : ""} TOS`;
}
