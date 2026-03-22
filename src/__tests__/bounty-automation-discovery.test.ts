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

import { runSolverBountyPass } from "../bounty/automation.js";
import { MockInferenceClient, createTestConfig, createTestDb } from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";

const SOLVER_ADDRESS =
  "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6";

describe("bounty automation discovery diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records explainable diagnostics when solver discovery finds no task providers", async () => {
    discoverCapabilityProvidersMock.mockResolvedValue([]);
    diagnoseCapabilityProvidersMock.mockResolvedValue([]);

    const db = createTestDb();
    const capability = "task.submit";
    const result = await runSolverBountyPass({
      identity: {
        name: "solver",
        address: SOLVER_ADDRESS,
        account: {} as any,
        creatorAddress: SOLVER_ADDRESS,
        sandboxId: "solver-agent",
        apiKey: "",
        createdAt: "2027-03-09T00:00:00.000Z",
      },
      config: createTestConfig({
        walletAddress: SOLVER_ADDRESS,
        agentDiscovery: { enabled: true } as any,
        bounty: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "solver",
          discoveryCapability: capability,
          autoSolveOnStartup: true,
        },
      }),
      db,
      inference: new MockInferenceClient(),
    });

    expect(result).toBeNull();
    const raw = db.getKV(`bounty:last_discovery_diagnostics:${capability}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "{}") as { summary?: string };
    expect(parsed.summary).toBe(
      "no verified providers advertised a callable endpoint for this capability",
    );
  });
});
