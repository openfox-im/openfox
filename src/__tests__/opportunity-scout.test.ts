import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import {
  buildOpportunityReport,
  buildRankedOpportunityReport,
  collectOpportunityItems,
  rankOpportunityItems,
} from "../opportunity/scout.js";
import { upsertStrategyProfile } from "../opportunity/strategy.js";
import { MockInferenceClient, createTestConfig, createTestDb } from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";
import type { OpenFoxIdentity } from "../types.js";

const HOST_ADDRESS =
  "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143";

function createIdentity(): OpenFoxIdentity {
  return {
    name: "host-openfox",
    address: HOST_ADDRESS,
    account: {} as any,
    creatorAddress: HOST_ADDRESS,
    sandboxId: "host-agent",
    apiKey: "",
    createdAt: "2027-03-09T00:00:00.000Z",
  };
}

describe("opportunity scout", () => {
  const db = createTestDb();

  afterEach(() => {
    db.raw.exec("DELETE FROM bounty_results");
    db.raw.exec("DELETE FROM bounty_submissions");
    db.raw.exec("DELETE FROM bounties");
    db.raw.exec("DELETE FROM campaigns");
  });

  it("collects open remote campaigns and bounties as earning opportunities", async () => {
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
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    engine.createCampaign({
      title: "Problem Solving Sprint",
      description: "A sponsor campaign for summarization tasks.",
      budgetTomi: "10000",
      maxOpenBounties: 2,
      allowedKinds: ["problem_solving"],
    });

    engine.openBounty({
      campaignId: db.listCampaigns()[0]!.campaignId,
      kind: "problem_solving",
      title: "Summarize one paragraph",
      taskPrompt: "Summarize the given paragraph in one sentence.",
      referenceOutput: "One concise sentence.",
      rewardTomi: "5000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
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
            minRewardTomi: "1",
          },
        }),
        db,
      });

      expect(items).toHaveLength(2);
      expect(items.some((item) => item.kind === "campaign")).toBe(true);
      expect(items.some((item) => item.kind === "bounty")).toBe(true);
      expect(items.every((item) => item.providerClass === "task_market")).toBe(
        true,
      );
      expect(buildOpportunityReport(items)).toContain("Summarize one paragraph");
      expect(buildOpportunityReport(items)).toContain("Problem Solving Sprint");
    } finally {
      await server.close();
    }
  });

  it("ranks opportunities against the stored strategy profile", async () => {
    const strategy = upsertStrategyProfile(db, {
      name: "Fast task revenue",
      minMarginBps: 1000,
      enabledOpportunityKinds: ["bounty"],
      enabledProviderClasses: ["task_market"],
      allowedTrustTiers: ["unknown", "org_trusted"],
      maxDeadlineHours: 12,
    });

    const items = rankOpportunityItems({
      strategy,
      items: [
        {
          kind: "bounty",
          providerClass: "task_market",
          trustTier: "unknown",
          title: "Short bounty",
          description: "Quick task",
          grossValueTomi: "5000",
          estimatedCostTomi: "0",
          marginTomi: "5000",
          marginBps: 10000,
          rawScore: 10,
          deadlineAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
        },
        {
          kind: "provider",
          providerClass: "oracle",
          trustTier: "public_low_trust",
          title: "Paid oracle provider",
          description: "Would cost money",
          grossValueTomi: "0",
          estimatedCostTomi: "9000",
          marginTomi: "-9000",
          marginBps: -10000,
          rawScore: 1,
        },
      ],
    });

    expect(items[0]?.title).toBe("Short bounty");
    expect(items[0]?.strategyMatched).toBe(true);
    expect(items[1]?.strategyMatched).toBe(false);
    expect(items[1]?.strategyReasons).toContain(
      "kind provider is disabled",
    );
    expect(buildRankedOpportunityReport(items, strategy)).toContain(
      "[matched] Short bounty",
    );
  });
});
