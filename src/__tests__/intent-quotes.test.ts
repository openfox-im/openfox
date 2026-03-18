import { describe, expect, it, vi } from "vitest";
import type { OpenFoxConfig } from "../types.js";
import type { ProviderProfile } from "../routing/index.js";
import type { SponsorQuote } from "../sponsor/types.js";
import {
  buildIntentQuotePreview,
  formatIntentQuotePreview,
} from "../routing/index.js";

const TEST_REQUESTER = "0x" + "a".repeat(40);
const TEST_RECIPIENT = "0x" + "b".repeat(40);

function makeConfig(): OpenFoxConfig {
  return {
    name: "test-openfox",
    creatorAddress: TEST_REQUESTER,
    inferenceModel: "test",
    agentDiscovery: {
      enabled: true,
    },
  } as OpenFoxConfig;
}

function makeProvider(
  address: string,
  fee: string,
  latencyMs: number,
  trustTier: number,
): ProviderProfile {
  return {
    address,
    name: address,
    serviceKinds: ["signer"],
    capabilities: ["signer.quote"],
    trustTier,
    reputationScore: 80,
    latencyMs,
    feeSchedule: {
      baseFee: fee,
      perGasFee: "0",
      percentFee: 0,
      currency: "TOS",
    },
    sponsorSupport: false,
    gatewayRequired: false,
    lastSeen: Date.now(),
  };
}

function makeSponsor(
  sponsorAddress: string,
  feeAmount: string,
  overrides?: Partial<SponsorQuote>,
): SponsorQuote {
  return {
    sponsorAddress,
    sponsorName: sponsorAddress,
    feeAmount,
    feeCurrency: "TOS",
    gasLimit: 50_000,
    expiresAt: Math.floor(Date.now() / 1000) + 120,
    policyHash: "0x" + "1".repeat(64),
    trustTier: 3,
    latencyMs: 120,
    ...overrides,
  };
}

describe("intent quote preview", () => {
  it("builds provider and sponsor comparisons for an intent preview", async () => {
    const discoverRouteProviders = vi.fn().mockResolvedValue([
      makeProvider("0xprovider-fast", "2000000000000000", 100, 2),
      makeProvider("0xprovider-cheap", "1000000000000000", 250, 3),
    ]);
    const discoverSponsorQuotes = vi.fn().mockResolvedValue([
      makeSponsor("0xsponsor-cheap", "100000000000000"),
      makeSponsor("0xsponsor-trusted", "200000000000000", {
        trustTier: 4,
      }),
    ]);

    const preview = await buildIntentQuotePreview(
      {
        action: "transfer",
        value: "1000000000000000000",
        requester: TEST_REQUESTER,
        recipient: TEST_RECIPIENT,
        config: makeConfig(),
        sponsorPolicy: {
          preferredSponsors: [],
          maxFeePercent: 5.0,
          maxFeeAbsolute: "0",
          minTrustTier: 0,
          strategy: "cheapest",
          fallbackEnabled: true,
          autoSelectEnabled: true,
        },
      },
      {
        discoverRouteProviders,
        discoverSponsorQuotes,
      },
    );

    expect(preview.routeComparison.quotes).toHaveLength(2);
    expect(preview.routeComparison.bestByFee?.provider).toBe("0xprovider-cheap");
    expect(preview.sponsorQuotes).toHaveLength(2);
    expect(preview.sponsorSelection?.selected.sponsorAddress).toBe("0xsponsor-cheap");
    expect(preview.sponsorSelection?.alternatives).toHaveLength(1);
  });

  it("formats provider tables and sponsor fallback order for user-facing surfaces", async () => {
    const preview = await buildIntentQuotePreview(
      {
        action: "transfer",
        value: "1000000000000000000",
        requester: TEST_REQUESTER,
        recipient: TEST_RECIPIENT,
        config: makeConfig(),
        sponsorPolicy: {
          preferredSponsors: [],
          maxFeePercent: 5.0,
          maxFeeAbsolute: "0",
          minTrustTier: 0,
          strategy: "cheapest",
          fallbackEnabled: true,
          autoSelectEnabled: true,
        },
      },
      {
        discoverRouteProviders: vi.fn().mockResolvedValue([
          makeProvider("0xprovider-fast", "2000000000000000", 100, 2),
        ]),
        discoverSponsorQuotes: vi.fn().mockResolvedValue([
          makeSponsor("0xsponsor-primary", "100000000000000"),
          makeSponsor("0xsponsor-backup", "150000000000000"),
        ]),
      },
    );

    const output = formatIntentQuotePreview(preview);
    expect(output).toContain("Provider route quotes:");
    expect(output).toContain("Quote Comparison: transfer");
    expect(output).toContain("Sponsor quotes:");
    expect(output).toContain("Recommended sponsor:");
    expect(output).toContain("Fallback order:");
    expect(output).toContain("self-pay");
    expect(output).toContain("TOS");
  });
});
