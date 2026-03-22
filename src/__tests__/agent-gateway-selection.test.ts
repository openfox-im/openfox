import { afterEach, describe, expect, it, vi } from "vitest";

const discoverCapabilityProvidersMock = vi.fn();
const diagnoseCapabilityProvidersMock = vi.fn();
const recordAgentDiscoveryProviderFeedbackMock = vi.fn();

vi.mock("../agent-discovery/client.js", () => ({
  discoverCapabilityProviders: (...args: unknown[]) =>
    discoverCapabilityProvidersMock(...args),
  diagnoseCapabilityProviders: (...args: unknown[]) =>
    diagnoseCapabilityProvidersMock(...args),
  summarizeProviderDiagnostics: (diagnostics: unknown[]) =>
    diagnostics.length > 0
      ? "diagnostics available"
      : "no verified providers advertised a callable endpoint for this capability",
  recordAgentDiscoveryProviderFeedback: (...args: unknown[]) =>
    recordAgentDiscoveryProviderFeedbackMock(...args),
}));

import { startAgentGatewayProviderSessions } from "../agent-gateway/client.js";
import { createTestConfig, createTestDb, createTestIdentity } from "./mocks.js";

describe("agent gateway discovery selection diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists explainable discovery diagnostics when no gateway target can be selected", async () => {
    discoverCapabilityProvidersMock.mockResolvedValue([]);
    diagnoseCapabilityProvidersMock.mockResolvedValue([]);

    const db = createTestDb();
    const identity = createTestIdentity();
    const config = createTestConfig({
      agentDiscovery: {
        enabled: true,
        gatewayClient: {
          enabled: true,
          gatewayBootnodes: [],
          sessionTtlSeconds: 3600,
          requestTimeoutMs: 1000,
          maxGatewaySessions: 1,
          feedback: {
            enabled: false,
            successDelta: "1",
            failureDelta: "-1",
            timeoutDelta: "-1",
            malformedDelta: "-1",
            gas: "120000",
            reasonPrefix: "agent-gateway",
          },
          routes: [],
        },
      } as any,
    });

    await expect(
      startAgentGatewayProviderSessions({
        identity,
        config,
        address: identity.address,
        db,
        routes: [
          {
            path: "/relay",
            capability: "gateway.relay",
            mode: "sponsored",
            targetUrl: "http://127.0.0.1:9/unused",
          },
        ],
      }),
    ).rejects.toThrow(
      "no gateway target configured: no verified providers advertised a callable endpoint for this capability",
    );

    const raw = db.getKV("agent_gateway:last_discovery_diagnostics");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "{}") as {
      capability?: string;
      summary?: string;
    };
    expect(parsed.capability).toBe("gateway.relay");
    expect(parsed.summary).toBe(
      "no verified providers advertised a callable endpoint for this capability",
    );
  });
});
