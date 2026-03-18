/**
 * Sponsor Module - Types
 *
 * GTOS 2046 Phase 5: Gasless Default and Sponsor Convergence.
 * Defines sponsor quotes, selection policies, and attribution records.
 */

export interface SponsorQuote {
  sponsorAddress: string;
  sponsorName?: string;
  feeAmount: string;          // wei - what sponsor charges
  feeCurrency: string;        // "TOS" or token address
  gasLimit: number;
  expiresAt: number;          // unix timestamp
  policyHash: string;
  trustTier: number;          // 0-4
  latencyMs?: number;
  reputationScore?: number;
}

export interface SponsorSelection {
  selected: SponsorQuote;
  alternatives: SponsorQuote[];
  reason: string;              // "cheapest", "highest_trust", "fastest", "preferred"
  totalCostDisplay: string;    // human-readable e.g. "0.05 TOS (sponsored)"
}

export interface SponsorPolicy {
  preferredSponsors: string[];       // preferred sponsor addresses
  maxFeePercent: number;             // max fee as % of tx value (e.g. 1.0 = 1%)
  maxFeeAbsolute: string;            // max absolute fee in wei
  minTrustTier: number;              // minimum trust tier required
  strategy: "cheapest" | "fastest" | "highest_trust" | "preferred_first";
  fallbackEnabled: boolean;
  autoSelectEnabled: boolean;
}

export interface SponsorAttribution {
  intentId: string;
  planId: string;
  sponsorAddress: string;
  sponsorName?: string;
  feeCharged: string;
  feeDisplay: string;
  policyHash: string;
  selectedAt: number;
  settledAt?: number;
  status: "selected" | "submitted" | "settled" | "failed";
}
