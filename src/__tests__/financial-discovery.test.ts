import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent-discovery/client.js", () => ({
  discoverCapabilityProviders: vi.fn(),
}));

vi.mock("../signer/client.js", () => ({
  fetchSignerQuote: vi.fn(),
}));

vi.mock("../paymaster/client.js", () => ({
  fetchPaymasterQuote: vi.fn(),
}));

import { discoverIntentRouteProviders, discoverIntentSponsorQuotes } from "../agent-discovery/financial-discovery.js";
import { discoverCapabilityProviders } from "../agent-discovery/client.js";
import { fetchSignerQuote } from "../signer/client.js";
import { fetchPaymasterQuote } from "../paymaster/client.js";

const discoverCapabilityProvidersMock = vi.mocked(discoverCapabilityProviders);
const fetchSignerQuoteMock = vi.mocked(fetchSignerQuote);
const fetchPaymasterQuoteMock = vi.mocked(fetchPaymasterQuote);

function makeProvider(capability: string) {
  return {
    search: {
      nodeId: "node-1",
      nodeRecord: "node-record-1",
      primaryIdentity: "0x" + "a".repeat(64),
      trust: {
        registered: true,
        suspended: false,
        stake: "1",
        reputation: "81",
        ratingCount: "3",
        capabilityRegistered: true,
        hasOnchainCapability: true,
        localRankScore: 82,
      },
    },
    card: {
      version: 1,
      agent_id: "agent-1",
      primary_identity: {
        kind: "tos",
        value: "0x" + "a".repeat(64),
      },
      discovery_node_id: "node-1",
      card_seq: 1,
      issued_at: 1,
      expires_at: 2,
      display_name: "Provider One",
      endpoints: [
        {
          kind: "https",
          url: "https://provider.example/quote",
          role: "requester_invocation",
        },
      ],
      capabilities: [],
      reputation_refs: [],
      metadata_signer: {
        kind: "eip191",
        address: "0x" + "1".repeat(40),
      },
      signature: "0x" + "2".repeat(130),
    },
    matchedCapability: {
      name: capability,
      mode: "sponsored",
      policy: {
        trust_tier: "org_trusted",
        sponsor_address: "0x" + "f".repeat(64),
      },
    },
    endpoint: {
      kind: "https",
      url: "https://provider.example/quote",
      role: "requester_invocation",
    },
  };
}

describe("financial discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds signer route providers from live discovery quotes", async () => {
    discoverCapabilityProvidersMock.mockResolvedValue([makeProvider("signer.quote")] as any);
    fetchSignerQuoteMock.mockResolvedValue({
      provider_address: "0x" + "b".repeat(64),
      trust_tier: "org_trusted",
      amount_wei: "17",
    } as any);

    const providers = await discoverIntentRouteProviders({
      config: {
        agentDiscovery: { enabled: true },
        signerProvider: { capabilityPrefix: "signer" },
      } as any,
      execution: {
        action: "transfer",
        requester: "0x" + "c".repeat(64),
        target: "0x" + "d".repeat(64),
        value: "1000",
      },
    });

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      address: "0x" + "b".repeat(64),
      name: "Provider One",
      serviceKinds: ["signer"],
      trustTier: 3,
      reputationScore: 82,
      sponsorSupport: false,
      endpoint: "https://provider.example",
    });
    expect(providers[0]?.feeSchedule?.baseFee).toBe("17");
    expect(fetchSignerQuoteMock).toHaveBeenCalledOnce();
  });

  it("builds sponsor quotes from live paymaster quote surfaces", async () => {
    discoverCapabilityProvidersMock.mockResolvedValue([makeProvider("paymaster.quote")] as any);
    fetchPaymasterQuoteMock.mockResolvedValue({
      sponsor_address: "0x" + "e".repeat(64),
      amount_wei: "23",
      gas: "70000",
      expires_at: 123456,
      policy_hash: "0x" + "9".repeat(64),
      trust_tier: "self_hosted",
    } as any);

    const quotes = await discoverIntentSponsorQuotes({
      config: {
        agentDiscovery: { enabled: true },
        paymasterProvider: { capabilityPrefix: "paymaster" },
      } as any,
      execution: {
        action: "transfer",
        requester: "0x" + "c".repeat(64),
        recipient: "0x" + "d".repeat(64),
        value: "1000",
      },
    });

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      sponsorAddress: "0x" + "e".repeat(64),
      sponsorName: "Provider One",
      feeAmount: "23",
      feeCurrency: "TOS",
      gasLimit: 70000,
      expiresAt: 123456,
      trustTier: 4,
      policyHash: "0x" + "9".repeat(64),
      reputationScore: 82,
    });
    expect(fetchPaymasterQuoteMock).toHaveBeenCalledOnce();
  });

  it("returns no discovery results when agent discovery is disabled", async () => {
    const routeProviders = await discoverIntentRouteProviders({
      config: { agentDiscovery: { enabled: false } } as any,
      execution: {
        action: "transfer",
        requester: "0x" + "c".repeat(64),
        target: "0x" + "d".repeat(64),
        value: "1000",
      },
    });
    const sponsorQuotes = await discoverIntentSponsorQuotes({
      config: { agentDiscovery: { enabled: false } } as any,
      execution: {
        action: "transfer",
        requester: "0x" + "c".repeat(64),
        recipient: "0x" + "d".repeat(64),
        value: "1000",
      },
    });

    expect(routeProviders).toEqual([]);
    expect(sponsorQuotes).toEqual([]);
    expect(discoverCapabilityProvidersMock).not.toHaveBeenCalled();
  });
});
