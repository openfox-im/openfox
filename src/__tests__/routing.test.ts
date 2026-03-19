/**
 * Financial Router & Quote Comparison Tests
 *
 * Tests for FinancialRouter (provider registration, routing strategies,
 * filtering) and compareQuotes (best-by rankings).
 */

import { describe, it, expect } from "vitest";
import { FinancialRouter, compareQuotes } from "../routing/index.js";
import type { ProviderProfile, RouteCandidate } from "../routing/index.js";
import { inspectContract, type ContractMetadata } from "../intent/metadata-consumer.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeProvider(overrides?: Partial<ProviderProfile>): ProviderProfile {
  return {
    address: "0xProvider" + Math.random().toString(16).slice(2, 10),
    serviceKinds: ["signer"],
    capabilities: ["sign"],
    trustTier: 3,
    reputationScore: 80,
    latencyMs: 500,
    feeSchedule: {
      baseFee: "1000000000000000", // 0.001 TOS
      perGasFee: "100",
      percentFee: 1,
      currency: "ETH",
    },
    sponsorSupport: false,
    gatewayRequired: false,
    lastSeen: Date.now(),
    ...overrides,
  };
}

function makeCheapProvider(): ProviderProfile {
  return makeProvider({
    address: "0xCheapProvider000000000000000000000000000001",
    name: "CheapProvider",
    feeSchedule: {
      baseFee: "100000000000000", // 0.0001 TOS
      perGasFee: "10",
      percentFee: 0.5,
      currency: "ETH",
    },
    latencyMs: 2000,
    trustTier: 2,
    reputationScore: 60,
  });
}

function makeFastProvider(): ProviderProfile {
  return makeProvider({
    address: "0xFastProvider0000000000000000000000000000001",
    name: "FastProvider",
    feeSchedule: {
      baseFee: "5000000000000000", // 0.005 ETH
      perGasFee: "500",
      percentFee: 3,
      currency: "ETH",
    },
    latencyMs: 100,
    trustTier: 2,
    reputationScore: 70,
  });
}

function makeTrustedProvider(): ProviderProfile {
  return makeProvider({
    address: "0xTrustedProvider00000000000000000000000000001",
    name: "TrustedProvider",
    feeSchedule: {
      baseFee: "3000000000000000", // 0.003 ETH
      perGasFee: "300",
      percentFee: 2,
      currency: "ETH",
    },
    latencyMs: 800,
    trustTier: 4,
    reputationScore: 95,
  });
}

function makeHighRiskContractMetadata(): ContractMetadata {
  return {
    schema_version: "0.1.0",
    artifact_ref: {
      package_hash: "0x" + "1".repeat(64),
      bytecode_hash: "0x" + "2".repeat(64),
      abi_hash: "0x" + "3".repeat(64),
    },
    contract: {
      name: "GuardianVault",
      is_account: true,
      storage_slots: 12,
    },
    functions: [
      {
        name: "executeTransfer",
        selector: "0xdeadbeef",
        visibility: "external",
        mutability: "payable",
        params: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
        ],
        returns: [],
        requires_capability: ["guardian-approval"],
        effects: {
          writes: ["owner_balance", "guardian_nonce"],
          calls: [{ interface: "IERC20", selector: "0xa9059cbb", max_gas: 50000 }],
        },
        gas_upper: 90000,
        verifiable: true,
        delegated: true,
        non_composable: false,
        risk_level: "high",
      },
    ],
    events: [],
    gas_model: {
      version: "istanbul",
      sload: 2100,
      sstore: 20000,
      log_base: 375,
    },
    is_account: true,
    policy_profile: {
      has_spend_caps: true,
      has_allowlist: true,
      has_terminal_policy: true,
      has_guardian: true,
      has_recovery: true,
      has_delegation: true,
      has_suspension: false,
    },
  };
}

// ─── Router Tests ────────────────────────────────────────────────

describe("FinancialRouter", () => {
  describe("registerProvider", () => {
    it("registers providers", () => {
      const router = new FinancialRouter();
      const provider = makeProvider();
      router.registerProvider(provider);

      const providers = router.getProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].address).toBe(provider.address);
    });

    it("overwrites provider with same address", () => {
      const router = new FinancialRouter();
      const provider = makeProvider({ address: "0xSame" });
      router.registerProvider(provider);
      router.registerProvider({ ...provider, reputationScore: 99 });

      const providers = router.getProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].reputationScore).toBe(99);
    });
  });

  describe("route()", () => {
    it("returns null with no providers", async () => {
      const router = new FinancialRouter();
      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });
      expect(result).toBeNull();
    });

    it("returns null when no providers match service kind", async () => {
      const router = new FinancialRouter();
      router.registerProvider(makeProvider({ serviceKinds: ["oracle"] }));

      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });
      expect(result).toBeNull();
    });

    it("filters by trust tier", async () => {
      const router = new FinancialRouter({ minTrustTier: 3 });
      router.registerProvider(makeProvider({ trustTier: 1, address: "0xLowTrust" }));
      router.registerProvider(makeProvider({ trustTier: 4, address: "0xHighTrust" }));

      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });

      expect(result).not.toBeNull();
      expect(result!.selected.provider.address).toBe("0xHighTrust");
      expect(result!.alternatives).toHaveLength(0);
    });

    it("filters by excluded providers", async () => {
      const router = new FinancialRouter({
        excludedProviders: ["0xExcluded"],
      });
      router.registerProvider(makeProvider({ address: "0xExcluded" }));
      router.registerProvider(makeProvider({ address: "0xAllowed" }));

      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });

      expect(result).not.toBeNull();
      expect(result!.selected.provider.address).toBe("0xAllowed");
      // The excluded one should not appear at all
      const allAddresses = [
        result!.selected.provider.address,
        ...result!.alternatives.map((a) => a.provider.address),
      ];
      expect(allAddresses).not.toContain("0xExcluded");
    });

    it("ranks by cheapest strategy", async () => {
      const router = new FinancialRouter({ strategy: "cheapest" });
      const cheap = makeCheapProvider();
      const fast = makeFastProvider();
      const trusted = makeTrustedProvider();

      router.registerProvider(fast);
      router.registerProvider(trusted);
      router.registerProvider(cheap);

      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });

      expect(result).not.toBeNull();
      expect(result!.selected.provider.address).toBe(cheap.address);
    });

    it("ranks by fastest strategy", async () => {
      const router = new FinancialRouter({ strategy: "fastest" });
      const cheap = makeCheapProvider();
      const fast = makeFastProvider();
      const trusted = makeTrustedProvider();

      router.registerProvider(cheap);
      router.registerProvider(trusted);
      router.registerProvider(fast);

      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });

      expect(result).not.toBeNull();
      expect(result!.selected.provider.address).toBe(fast.address);
    });

    it("ranks by most_trusted strategy", async () => {
      const router = new FinancialRouter({ strategy: "most_trusted" });
      const cheap = makeCheapProvider();
      const fast = makeFastProvider();
      const trusted = makeTrustedProvider();

      router.registerProvider(cheap);
      router.registerProvider(fast);
      router.registerProvider(trusted);

      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
      });

      expect(result).not.toBeNull();
      expect(result!.selected.provider.address).toBe(trusted.address);
    });

    it("supports policy overrides per route call", async () => {
      const router = new FinancialRouter({ minTrustTier: 1 });
      router.registerProvider(makeProvider({ trustTier: 1, address: "0xLow" }));
      router.registerProvider(makeProvider({ trustTier: 4, address: "0xHigh" }));

      // Override to require high trust
      const result = await router.route({
        intentId: "intent-001",
        serviceKind: "signer",
        policyOverride: { minTrustTier: 4 },
      });

      expect(result).not.toBeNull();
      expect(result!.selected.provider.address).toBe("0xHigh");
      expect(result!.alternatives).toHaveLength(0);
    });

    it("prefers a higher-trust provider for high-risk contract metadata", async () => {
      const router = new FinancialRouter({ strategy: "balanced" });
      const cheapLowTrust = makeProvider({
        address: "0xCheapLowTrust",
        name: "CheapLowTrust",
        trustTier: 1,
        reputationScore: 40,
        latencyMs: 2000,
        feeSchedule: {
          baseFee: "100000000000000",
          perGasFee: "10",
          percentFee: 0.1,
          currency: "ETH",
        },
      });
      const expensiveTrusted = makeProvider({
        address: "0xTrustedHighRisk",
        name: "TrustedHighRisk",
        trustTier: 4,
        reputationScore: 90,
        latencyMs: 9000,
        feeSchedule: {
          baseFee: "900000000000000000",
          perGasFee: "500",
          percentFee: 5,
          currency: "ETH",
        },
      });

      router.registerProvider(cheapLowTrust);
      router.registerProvider(expensiveTrusted);

      const withoutMetadata = await router.route({
        intentId: "intent-no-metadata",
        serviceKind: "signer",
      });
      expect(withoutMetadata).not.toBeNull();
      expect(withoutMetadata!.selected.provider.address).toBe(cheapLowTrust.address);

      const withMetadata = await router.route({
        intentId: "intent-with-metadata",
        serviceKind: "signer",
        contractInspection: inspectContract(makeHighRiskContractMetadata()),
      });
      expect(withMetadata).not.toBeNull();
      expect(withMetadata!.selected.provider.address).toBe(expensiveTrusted.address);
    });

    it("emits routing events", async () => {
      const router = new FinancialRouter();
      router.registerProvider(makeProvider());

      await router.route({
        intentId: "intent-events",
        serviceKind: "signer",
      });

      const events = router.getEvents("intent-events");
      expect(events.length).toBeGreaterThanOrEqual(3); // discovery_started, providers_found, route_selected
      expect(events.some((e) => e.kind === "discovery_started")).toBe(true);
      expect(events.some((e) => e.kind === "route_selected")).toBe(true);
    });
  });
});

// ─── Quote Comparison Tests ──────────────────────────────────────

describe("compareQuotes", () => {
  function makeCandidate(
    address: string,
    fee: string,
    latency: number,
    trustTier: number,
    reputation: number,
  ): RouteCandidate {
    return {
      provider: {
        address,
        name: address,
        serviceKinds: ["signer"],
        capabilities: ["sign"],
        trustTier,
        reputationScore: reputation,
        sponsorSupport: false,
        gatewayRequired: false,
        lastSeen: Date.now(),
      },
      serviceKind: "signer",
      estimatedFee: fee,
      estimatedLatency: latency,
      trustScore: trustTier * 20 + reputation * 0.2,
      route: [address],
    };
  }

  it("produces correct bestByFee", () => {
    const candidates = [
      makeCandidate("expensive", "5000000000000000", 500, 3, 80),
      makeCandidate("cheap", "100000000000000", 1000, 2, 60),
      makeCandidate("mid", "2000000000000000", 700, 3, 70),
    ];

    const comparison = compareQuotes("intent-123", "transfer", "1000000000000000000", candidates);

    expect(comparison.bestByFee).not.toBeNull();
    expect(comparison.bestByFee!.provider).toBe("cheap");
  });

  it("produces correct bestBySpeed", () => {
    const candidates = [
      makeCandidate("slow", "1000000000000000", 2000, 3, 80),
      makeCandidate("fast", "3000000000000000", 100, 2, 60),
      makeCandidate("mid", "2000000000000000", 700, 3, 70),
    ];

    const comparison = compareQuotes("intent-123", "transfer", "1000000000000000000", candidates);

    expect(comparison.bestBySpeed).not.toBeNull();
    expect(comparison.bestBySpeed!.provider).toBe("fast");
  });

  it("produces correct bestByTrust", () => {
    const candidates = [
      makeCandidate("lowTrust", "1000000000000000", 500, 1, 50),
      makeCandidate("highTrust", "3000000000000000", 800, 4, 95),
      makeCandidate("midTrust", "2000000000000000", 700, 3, 70),
    ];

    const comparison = compareQuotes("intent-123", "transfer", "1000000000000000000", candidates);

    expect(comparison.bestByTrust).not.toBeNull();
    expect(comparison.bestByTrust!.provider).toBe("highTrust");
  });

  it("returns null best-by fields with no candidates", () => {
    const comparison = compareQuotes("intent-123", "transfer", "1000000000000000000", []);

    expect(comparison.bestByFee).toBeNull();
    expect(comparison.bestBySpeed).toBeNull();
    expect(comparison.bestByTrust).toBeNull();
    expect(comparison.recommended).toBeNull();
    expect(comparison.quotes).toHaveLength(0);
  });

  it("includes all quotes in output", () => {
    const candidates = [
      makeCandidate("a", "1000000000000000", 500, 3, 80),
      makeCandidate("b", "2000000000000000", 300, 2, 70),
    ];

    const comparison = compareQuotes("intent-123", "transfer", "1000000000000000000", candidates);

    expect(comparison.quotes).toHaveLength(2);
    expect(comparison.intentId).toBe("intent-123");
    expect(comparison.action).toBe("transfer");
    expect(comparison.value).toBe("1000000000000000000");
    expect(comparison.generatedAt).toBeGreaterThan(0);
  });

  it("produces a recommended quote", () => {
    const candidates = [
      makeCandidate("a", "1000000000000000", 500, 3, 80),
      makeCandidate("b", "2000000000000000", 300, 4, 90),
      makeCandidate("c", "500000000000000", 1000, 2, 60),
    ];

    const comparison = compareQuotes("intent-123", "transfer", "1000000000000000000", candidates);

    expect(comparison.recommended).not.toBeNull();
    // The recommended quote should be one of the candidates
    expect(comparison.quotes.map((q) => q.provider)).toContain(comparison.recommended!.provider);
  });
});
