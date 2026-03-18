import type {
  ServiceKind,
  ProviderProfile,
  RouteCandidate,
  RoutingPolicy,
  RoutingDecision,
  RoutingEvent,
} from "./types.js";
import { scoreProviderByMetadata, type ContractInspection } from "../intent/metadata-consumer.js";

const DEFAULT_POLICY: RoutingPolicy = {
  strategy: "balanced",
  minTrustTier: 1,
  maxFeePercent: 5,
  maxLatencyMs: 10000,
  preferredProviders: [],
  excludedProviders: [],
  requireSponsor: false,
  allowGateway: true,
  maxHops: 2,
};

export class FinancialRouter {
  private providers: Map<string, ProviderProfile> = new Map();
  private policy: RoutingPolicy;
  private eventLog: RoutingEvent[] = [];

  constructor(policy?: Partial<RoutingPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /** Register a discovered provider. */
  registerProvider(profile: ProviderProfile): void {
    this.providers.set(profile.address, profile);
  }

  /** Remove providers not seen within maxAgeMs. Returns the count removed. */
  pruneStale(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [address, provider] of this.providers) {
      if (provider.lastSeen < cutoff) {
        this.providers.delete(address);
        removed++;
      }
    }
    return removed;
  }

  /** Find the best route for a service kind given an intent. */
  async route(params: {
    intentId: string;
    serviceKind: ServiceKind;
    value?: string;
    gasEstimate?: number;
    policyOverride?: Partial<RoutingPolicy>;
    /** Optional contract inspection from TOL metadata. When present,
     *  provider scoring factors in contract risk level. */
    contractInspection?: ContractInspection;
  }): Promise<RoutingDecision | null> {
    const policy = { ...this.policy, ...params.policyOverride };

    this.emitEvent({
      kind: "discovery_started",
      intentId: params.intentId,
      serviceKind: params.serviceKind,
      timestamp: Date.now(),
      details: {},
    });

    // Find eligible providers
    const candidates = this.findCandidates(params.serviceKind, policy);

    this.emitEvent({
      kind: "providers_found",
      intentId: params.intentId,
      serviceKind: params.serviceKind,
      timestamp: Date.now(),
      details: { count: candidates.length },
    });

    if (candidates.length === 0) {
      this.emitEvent({
        kind: "route_failed",
        intentId: params.intentId,
        serviceKind: params.serviceKind,
        timestamp: Date.now(),
        details: { reason: "no_eligible_providers" },
      });
      return null;
    }

    // Score and rank — factor in contract metadata when available
    const ranked = this.rankCandidates(candidates, policy, params.value, params.contractInspection);

    const selected = ranked[0];

    this.emitEvent({
      kind: "route_selected",
      intentId: params.intentId,
      serviceKind: params.serviceKind,
      timestamp: Date.now(),
      details: {
        provider: selected.provider.address,
        trustScore: selected.trustScore,
        estimatedFee: selected.estimatedFee,
      },
    });

    return {
      intentId: params.intentId,
      serviceKind: params.serviceKind,
      selected,
      alternatives: ranked.slice(1),
      policy,
      reason: policy.strategy,
      decidedAt: Date.now(),
    };
  }

  private findCandidates(serviceKind: ServiceKind, policy: RoutingPolicy): RouteCandidate[] {
    const candidates: RouteCandidate[] = [];
    for (const provider of this.providers.values()) {
      if (!provider.serviceKinds.includes(serviceKind)) continue;
      if (provider.trustTier < policy.minTrustTier) continue;
      if (policy.excludedProviders.includes(provider.address)) continue;
      if (provider.gatewayRequired && !policy.allowGateway) continue;
      if (policy.requireSponsor && !provider.sponsorSupport) continue;

      const route = provider.gatewayRequired
        ? ["gateway", provider.address]
        : [provider.address];

      if (route.length > policy.maxHops) continue;

      candidates.push({
        provider,
        serviceKind,
        estimatedFee: this.estimateFee(provider),
        estimatedLatency: provider.latencyMs ?? 1000,
        trustScore: this.computeTrustScore(provider),
        route,
      });
    }
    return candidates;
  }

  private rankCandidates(
    candidates: RouteCandidate[],
    policy: RoutingPolicy,
    _value?: string,
    contractInspection?: ContractInspection,
  ): RouteCandidate[] {
    // Boost preferred providers
    const withPreference = candidates.map((c) => ({
      candidate: c,
      preferred: policy.preferredProviders.includes(c.provider.address),
      metadataScore: contractInspection
        ? scoreProviderByMetadata(c.provider, contractInspection)
        : 0,
    }));

    return withPreference
      .sort((a, b) => {
        // Preferred providers always rank first
        if (a.preferred && !b.preferred) return -1;
        if (!a.preferred && b.preferred) return 1;

        switch (policy.strategy) {
          case "cheapest":
            return BigInt(a.candidate.estimatedFee) < BigInt(b.candidate.estimatedFee) ? -1 : 1;
          case "fastest":
            return a.candidate.estimatedLatency - b.candidate.estimatedLatency;
          case "most_trusted":
            return b.candidate.trustScore - a.candidate.trustScore;
          case "balanced":
          default: {
            let scoreA = this.compositeScore(a.candidate);
            let scoreB = this.compositeScore(b.candidate);
            // When contract metadata is available, blend in the metadata score
            if (contractInspection) {
              scoreA = scoreA * 0.7 + (a.metadataScore / 100) * 0.3;
              scoreB = scoreB * 0.7 + (b.metadataScore / 100) * 0.3;
            }
            return scoreB - scoreA;
          }
        }
      })
      .map((w) => w.candidate);
  }

  private compositeScore(c: RouteCandidate): number {
    const trustNorm = c.trustScore / 100;
    const feeNorm = 1 - Math.min(Number(BigInt(c.estimatedFee || "0")) / 1e18, 1);
    const latencyNorm = 1 - Math.min(c.estimatedLatency / 10000, 1);
    return trustNorm * 0.4 + feeNorm * 0.3 + latencyNorm * 0.3;
  }

  private estimateFee(provider: ProviderProfile): string {
    if (!provider.feeSchedule) return "0";
    return provider.feeSchedule.baseFee;
  }

  private computeTrustScore(provider: ProviderProfile): number {
    return Math.min(100, provider.trustTier * 20 + provider.reputationScore * 0.2);
  }

  private emitEvent(event: RoutingEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > 1000) this.eventLog.shift();
  }

  /** Get routing events for a specific intent. */
  getEvents(intentId: string): RoutingEvent[] {
    return this.eventLog.filter((e) => e.intentId === intentId);
  }

  /** Get all registered providers, optionally filtered by service kind. */
  getProviders(serviceKind?: ServiceKind): ProviderProfile[] {
    const all = [...this.providers.values()];
    if (serviceKind) return all.filter((p) => p.serviceKinds.includes(serviceKind));
    return all;
  }

  /** Update the routing policy. */
  setPolicy(policy: Partial<RoutingPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }
}
