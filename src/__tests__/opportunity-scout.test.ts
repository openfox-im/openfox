import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import { buildOpportunityReport, collectOpportunityItems } from "../opportunity/scout.js";
import { MockInferenceClient, createTestConfig, createTestDb } from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";
import type { OpenFoxIdentity } from "../types.js";

const HOST_ADDRESS =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function createIdentity(): OpenFoxIdentity {
  return {
    name: "host-openfox",
    address: HOST_ADDRESS,
    account: {} as any,
    creatorAddress: HOST_ADDRESS,
    sandboxId: "host-agent",
    apiKey: "",
    createdAt: "2026-03-09T00:00:00.000Z",
  };
}

describe("opportunity scout", () => {
  const db = createTestDb();

  afterEach(() => {
    db.raw.exec("DELETE FROM bounty_results");
    db.raw.exec("DELETE FROM bounty_submissions");
    db.raw.exec("DELETE FROM bounties");
  });

  it("collects open remote bounties as earning opportunities", async () => {
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference: new MockInferenceClient(),
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        bindHost: "127.0.0.1",
        port: 0,
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    engine.openBounty({
      kind: "problem_solving",
      title: "Summarize one paragraph",
      taskPrompt: "Summarize the given paragraph in one sentence.",
      referenceOutput: "One concise sentence.",
      rewardWei: "5000",
      submissionDeadline: "2026-03-09T01:00:00.000Z",
    });

    const server = await startBountyHttpServer({
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        bindHost: "127.0.0.1",
        port: 0,
      },
      engine,
    });

    try {
      const items = await collectOpportunityItems({
        config: createTestConfig({
          opportunityScout: {
            enabled: true,
            remoteBaseUrls: [server.url],
            discoveryCapabilities: [],
            maxItems: 10,
            minRewardWei: "1",
          },
        }),
        db,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.kind).toBe("bounty");
      expect(items[0]?.title).toBe("Summarize one paragraph");
      expect(buildOpportunityReport(items)).toContain("Summarize one paragraph");
    } finally {
      await server.close();
    }
  });
});
