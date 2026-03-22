import { afterEach, describe, expect, it, vi } from "vitest";

const discoverCapabilityProvidersMock = vi.fn();
const diagnoseCapabilityProvidersMock = vi.fn();

vi.mock("../agent-discovery/client.js", () => ({
  discoverCapabilityProviders: (...args: unknown[]) =>
    discoverCapabilityProvidersMock(...args),
  diagnoseCapabilityProviders: (...args: unknown[]) =>
    diagnoseCapabilityProvidersMock(...args),
  summarizeProviderDiagnostics: (diagnostics: unknown[]) =>
    diagnostics.length > 0
      ? "diagnostics available"
      : "no verified providers advertised a callable endpoint for this capability",
}));

import { collectOpportunityItems } from "../opportunity/scout.js";
import { createTestConfig, createTestDb } from "./mocks.js";

describe("opportunity scout discovery diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records a default discovery explanation when no providers satisfy a capability", async () => {
    discoverCapabilityProvidersMock.mockResolvedValue([]);
    diagnoseCapabilityProvidersMock.mockResolvedValue([]);

    const db = createTestDb();
    const capability = "oracle.resolve";
    const items = await collectOpportunityItems({
      db,
      config: createTestConfig({
        agentDiscovery: { enabled: true } as any,
        opportunityScout: {
          enabled: true,
          remoteBaseUrls: [],
          discoveryCapabilities: [capability],
          maxItems: 10,
          minRewardTomi: "1",
        },
      }),
    });

    expect(items).toHaveLength(0);
    const raw = db.getKV(
      `opportunity_scout:last_discovery_diagnostics:${capability}`,
    );
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "{}") as { summary?: string };
    expect(parsed.summary).toBe(
      "no verified providers advertised a callable endpoint for this capability",
    );
  });
});
