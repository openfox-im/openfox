/**
 * Quote Comparison Surfaces
 *
 * GTOS 2046: Generate and display quote comparisons tied to intents.
 * Presents candidates from routing with fee, speed, and trust rankings.
 */

import type { RouteCandidate } from "./types.js";

// ── Types ────────────────────────────────────────────────────────

export interface QuoteEntry {
  provider: string;
  providerName?: string;
  serviceKind: string;
  fee: string;
  feeDisplay: string;
  estimatedLatencyMs: number;
  trustTier: number;
  reputationScore: number;
  sponsorSupport: boolean;
  route: string[];
  expiresAt: number;
}

export interface QuoteComparison {
  intentId: string;
  action: string;
  value: string;
  quotes: QuoteEntry[];
  bestByFee: QuoteEntry | null;
  bestBySpeed: QuoteEntry | null;
  bestByTrust: QuoteEntry | null;
  recommended: QuoteEntry | null;
  generatedAt: number;
}

// ── Functions ────────────────────────────────────────────────────

/** Convert a RouteCandidate into a QuoteEntry. */
function candidateToQuote(candidate: RouteCandidate): QuoteEntry {
  const fee = BigInt(candidate.estimatedFee);
  return {
    provider: candidate.provider.address,
    providerName: candidate.provider.name,
    serviceKind: candidate.serviceKind,
    fee: candidate.estimatedFee,
    feeDisplay: formatWei(fee),
    estimatedLatencyMs: candidate.estimatedLatency,
    trustTier: candidate.provider.trustTier,
    reputationScore: candidate.provider.reputationScore,
    sponsorSupport: candidate.provider.sponsorSupport,
    route: candidate.route,
    expiresAt: Math.floor(Date.now() / 1000) + 300, // 5-minute quote validity
  };
}

/** Generate a quote comparison for an intent from route candidates. */
export function compareQuotes(
  intentId: string,
  action: string,
  value: string,
  candidates: RouteCandidate[],
): QuoteComparison {
  const quotes = candidates.map(candidateToQuote);

  const bestByFee = findBest(quotes, (a, b) => {
    const feeA = BigInt(a.fee);
    const feeB = BigInt(b.fee);
    return feeA < feeB ? -1 : feeA > feeB ? 1 : 0;
  });

  const bestBySpeed = findBest(quotes, (a, b) =>
    a.estimatedLatencyMs - b.estimatedLatencyMs,
  );

  const bestByTrust = findBest(quotes, (a, b) => {
    // Higher trust tier and reputation is better, so reverse comparison
    if (a.trustTier !== b.trustTier) return b.trustTier - a.trustTier;
    return b.reputationScore - a.reputationScore;
  });

  // Recommended: balanced score combining fee, speed, and trust
  const recommended = findBest(quotes, (a, b) => {
    const scoreA = computeBalancedScore(a, quotes);
    const scoreB = computeBalancedScore(b, quotes);
    return scoreB - scoreA; // higher score is better
  });

  return {
    intentId,
    action,
    value,
    quotes,
    bestByFee,
    bestBySpeed,
    bestByTrust,
    recommended,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

/** Format a comparison as human-readable text. */
export function formatQuoteComparison(comparison: QuoteComparison): string {
  const lines: string[] = [];

  lines.push(`=== Quote Comparison: ${comparison.action} ===`);
  lines.push(`Intent: ${comparison.intentId}`);
  lines.push(`Value: ${formatNativeAmount(BigInt(comparison.value))}`);
  lines.push(`Quotes: ${comparison.quotes.length}`);
  lines.push(`Generated: ${formatTimestamp(comparison.generatedAt)}`);
  lines.push("");

  if (comparison.recommended) {
    const r = comparison.recommended;
    lines.push("Recommended:");
    lines.push(`  Provider: ${r.providerName ?? r.provider}`);
    lines.push(`  Fee: ${r.feeDisplay}`);
    lines.push(`  Latency: ${r.estimatedLatencyMs}ms`);
    lines.push(`  Trust: tier ${r.trustTier} (rep: ${r.reputationScore})`);
    lines.push(`  Sponsor support: ${r.sponsorSupport ? "yes" : "no"}`);
    lines.push("");
  }

  if (comparison.bestByFee && comparison.bestByFee !== comparison.recommended) {
    lines.push(`Cheapest: ${comparison.bestByFee.providerName ?? comparison.bestByFee.provider} (${comparison.bestByFee.feeDisplay})`);
  }
  if (comparison.bestBySpeed && comparison.bestBySpeed !== comparison.recommended) {
    lines.push(`Fastest: ${comparison.bestBySpeed.providerName ?? comparison.bestBySpeed.provider} (${comparison.bestBySpeed.estimatedLatencyMs}ms)`);
  }
  if (comparison.bestByTrust && comparison.bestByTrust !== comparison.recommended) {
    lines.push(`Most trusted: ${comparison.bestByTrust.providerName ?? comparison.bestByTrust.provider} (tier ${comparison.bestByTrust.trustTier}, rep ${comparison.bestByTrust.reputationScore})`);
  }

  if (comparison.quotes.length > 0) {
    lines.push("");
    lines.push("All quotes:");
    for (let i = 0; i < comparison.quotes.length; i++) {
      const q = comparison.quotes[i];
      const tags: string[] = [];
      if (q === comparison.recommended) tags.push("recommended");
      if (q === comparison.bestByFee) tags.push("cheapest");
      if (q === comparison.bestBySpeed) tags.push("fastest");
      if (q === comparison.bestByTrust) tags.push("most-trusted");
      const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
      lines.push(
        `  ${i + 1}. ${q.providerName ?? q.provider} - fee:${q.feeDisplay} latency:${q.estimatedLatencyMs}ms trust:T${q.trustTier}(${q.reputationScore})${tagStr}`,
      );
    }
  }

  return lines.join("\n");
}

/** Format as a table for CLI display. */
export function formatQuoteTable(comparison: QuoteComparison): string {
  const lines: string[] = [];

  const header = [
    pad("#", 3),
    pad("Provider", 24),
    pad("Fee", 18),
    pad("Latency", 10),
    pad("Trust", 8),
    pad("Rep", 5),
    pad("Sponsor", 8),
    pad("Tags", 20),
  ];

  lines.push(`Quote Comparison: ${comparison.action} (${comparison.quotes.length} quotes)`);
  lines.push(`Intent: ${comparison.intentId}  Value: ${formatNativeAmount(BigInt(comparison.value))}`);
  lines.push("");
  lines.push(header.join(" | "));
  lines.push(header.map((h) => "-".repeat(h.length)).join("-+-"));

  for (let i = 0; i < comparison.quotes.length; i++) {
    const q = comparison.quotes[i];
    const tags: string[] = [];
    if (q === comparison.recommended) tags.push("*REC");
    if (q === comparison.bestByFee) tags.push("$FEE");
    if (q === comparison.bestBySpeed) tags.push(">SPD");
    if (q === comparison.bestByTrust) tags.push("!TRS");

    const row = [
      pad(String(i + 1), 3),
      pad(q.providerName ?? truncateAddress(q.provider), 24),
      pad(q.feeDisplay, 18),
      pad(`${q.estimatedLatencyMs}ms`, 10),
      pad(`T${q.trustTier}`, 8),
      pad(String(q.reputationScore), 5),
      pad(q.sponsorSupport ? "yes" : "no", 8),
      pad(tags.join(" "), 20),
    ];
    lines.push(row.join(" | "));
  }

  lines.push("");
  lines.push("Tags: *REC=recommended  $FEE=cheapest  >SPD=fastest  !TRS=most-trusted");

  return lines.join("\n");
}

// ── Private helpers ──────────────────────────────────────────────

/** Find the best entry according to a comparator (first by sort order). */
function findBest<T>(items: T[], compare: (a: T, b: T) => number): T | null {
  if (items.length === 0) return null;
  let best = items[0];
  for (let i = 1; i < items.length; i++) {
    if (compare(items[i], best) < 0) {
      best = items[i];
    }
  }
  return best;
}

/**
 * Compute a balanced score (0-100) for a quote, normalizing fee, latency,
 * and trust across the candidate set.
 */
function computeBalancedScore(quote: QuoteEntry, all: QuoteEntry[]): number {
  if (all.length <= 1) return 100;

  // Fee score: lower is better (0-100)
  const fees = all.map((q) => Number(BigInt(q.fee)));
  const minFee = Math.min(...fees);
  const maxFee = Math.max(...fees);
  const feeRange = maxFee - minFee;
  const feeScore =
    feeRange > 0 ? (1 - (Number(BigInt(quote.fee)) - minFee) / feeRange) * 100 : 100;

  // Latency score: lower is better (0-100)
  const latencies = all.map((q) => q.estimatedLatencyMs);
  const minLat = Math.min(...latencies);
  const maxLat = Math.max(...latencies);
  const latRange = maxLat - minLat;
  const latScore =
    latRange > 0
      ? (1 - (quote.estimatedLatencyMs - minLat) / latRange) * 100
      : 100;

  // Trust score: higher is better (0-100)
  const trustScore = (quote.trustTier / 4) * 50 + (quote.reputationScore / 100) * 50;

  // Weighted combination: 40% fee, 30% speed, 30% trust
  return feeScore * 0.4 + latScore * 0.3 + trustScore * 0.3;
}

/** Format wei as the native TOS unit with fixed precision. */
function formatWei(wei: bigint): string {
  return formatNativeAmount(wei);
}

function formatNativeAmount(wei: bigint): string {
  if (wei === 0n) return "0 TOS";
  const negative = wei < 0n;
  const absolute = negative ? -wei : wei;
  const whole = absolute / 1_000_000_000_000_000_000n;
  const fraction = absolute % 1_000_000_000_000_000_000n;
  const fractionText = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fractionText ? `.${fractionText}` : ""} TOS`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}
