export type ServiceKind = "signer" | "paymaster" | "gateway" | "oracle" | "solver" | "storage";

export interface ProviderProfile {
  address: string;
  name?: string;
  serviceKinds: ServiceKind[];
  capabilities: string[];
  trustTier: number;          // 0-4
  reputationScore: number;    // 0-100
  latencyMs?: number;
  feeSchedule?: FeeSchedule;
  sponsorSupport: boolean;
  gatewayRequired: boolean;
  endpoint?: string;
  lastSeen: number;
}

export interface FeeSchedule {
  baseFee: string;            // wei
  perGasFee: string;          // wei per gas unit
  percentFee: number;         // percentage of value (0-100)
  currency: string;
}

export interface RouteCandidate {
  provider: ProviderProfile;
  serviceKind: ServiceKind;
  estimatedFee: string;
  estimatedLatency: number;
  trustScore: number;         // composite score 0-100
  route: string[];            // hop addresses if via gateway
}

export interface RoutingPolicy {
  strategy: "cheapest" | "fastest" | "most_trusted" | "balanced";
  minTrustTier: number;
  maxFeePercent: number;
  maxLatencyMs: number;
  preferredProviders: string[];
  excludedProviders: string[];
  requireSponsor: boolean;
  allowGateway: boolean;
  maxHops: number;
}

export interface RoutingDecision {
  intentId: string;
  serviceKind: ServiceKind;
  selected: RouteCandidate;
  alternatives: RouteCandidate[];
  policy: RoutingPolicy;
  reason: string;
  decidedAt: number;
}

export type RoutingEventKind =
  | "discovery_started"
  | "providers_found"
  | "quotes_received"
  | "route_selected"
  | "route_failed"
  | "fallback_triggered";

export interface RoutingEvent {
  kind: RoutingEventKind;
  intentId: string;
  serviceKind: ServiceKind;
  timestamp: number;
  details: Record<string, unknown>;
}
