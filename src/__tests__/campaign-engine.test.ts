import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { MockInferenceClient, createTestDb } from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";
import type { OpenFoxIdentity } from "../types.js";

const HOST_ADDRESS =
  "0x1212121212121212121212121212121212121212121212121212121212121212";

function createIdentity(): OpenFoxIdentity {
  return {
    name: "campaign-host",
    address: HOST_ADDRESS,
    account: {} as any,
    creatorAddress: HOST_ADDRESS,
    sandboxId: "campaign-host-agent",
    apiKey: "",
    createdAt: "2027-03-09T00:00:00.000Z",
  };
}

describe("campaign engine", () => {
  const db = createTestDb();

  afterEach(() => {
    db.raw.exec("DELETE FROM bounty_results");
    db.raw.exec("DELETE FROM bounty_submissions");
    db.raw.exec("DELETE FROM bounties");
    db.raw.exec("DELETE FROM campaigns");
  });

  it("creates campaigns and tracks progress across bounties", () => {
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference: new MockInferenceClient(),
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
      },
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    const campaign = engine.createCampaign({
      title: "March Growth Push",
      description: "Run a translation and social proof campaign.",
      budgetTomi: "5000",
      maxOpenBounties: 2,
      allowedKinds: ["translation", "social_proof"],
    });

    const first = engine.openBounty({
      campaignId: campaign.campaignId,
      kind: "translation",
      title: "Translate one sentence",
      taskPrompt: "Translate 'hello world' into Chinese.",
      referenceOutput: "你好，世界",
      rewardTomi: "2000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    const second = engine.openBounty({
      campaignId: campaign.campaignId,
      kind: "social_proof",
      title: "Reply on X",
      taskPrompt: "Reply with the exact phrase.",
      referenceOutput: "openfox rocks",
      rewardTomi: "3000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    const details = engine.getCampaignDetails(campaign.campaignId);
    expect(details?.campaign.campaignId).toBe(campaign.campaignId);
    expect(details?.bounties.map((item) => item.bountyId)).toEqual([
      second.bountyId,
      first.bountyId,
    ]);
    expect(details?.progress.allocatedTomi).toBe("5000");
    expect(details?.progress.remainingTomi).toBe("0");
    expect(details?.campaign.status).toBe("exhausted");
  });

  it("enforces campaign budget and allowed kinds", () => {
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference: new MockInferenceClient(),
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
      },
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    const campaign = engine.createCampaign({
      title: "Small Budget",
      description: "One translation only.",
      budgetTomi: "1000",
      maxOpenBounties: 1,
      allowedKinds: ["translation"],
    });

    expect(() =>
      engine.openBounty({
        campaignId: campaign.campaignId,
        kind: "question",
        title: "Wrong kind",
        taskPrompt: "2+2=?",
        referenceOutput: "4",
        rewardTomi: "1000",
        submissionDeadline: "2027-03-09T01:00:00.000Z",
      }),
    ).toThrow("campaign does not allow bounty kind");

    engine.openBounty({
      campaignId: campaign.campaignId,
      kind: "translation",
      title: "Translate one word",
      taskPrompt: "Translate 'fox' into Chinese.",
      referenceOutput: "狐狸",
      rewardTomi: "1000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    expect(() =>
      engine.openBounty({
        campaignId: campaign.campaignId,
        kind: "translation",
        title: "Second translation",
        taskPrompt: "Translate 'wolf' into Chinese.",
        referenceOutput: "狼",
        rewardTomi: "1",
        submissionDeadline: "2027-03-09T01:00:00.000Z",
      }),
    ).toThrow(/maximum open bounty count|budget is exhausted|campaign is not open: exhausted/);
  });
});
