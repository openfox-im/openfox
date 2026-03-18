/**
 * End-to-end tests for Task 82 work surfaces:
 * - data_labeling bounty/task surface
 * - sentiment.analyze provider service surface
 * - opportunity loop integration for new surfaces
 */

import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import {
  ensureAutoQuestionBountyOpen,
  runSolverBountyPass,
} from "../bounty/automation.js";
import {
  buildTaskBountyDraftPrompt,
  buildTaskBountyJudgePrompt,
  parseTaskBountyDraft,
  parseTaskBountyJudgeResult,
} from "../bounty/skills/task-host.js";
import { buildTaskBountySolverPrompt } from "../bounty/skills/task-solver.js";
import {
  rankOpportunityItems,
} from "../opportunity/scout.js";
import type { OpportunityItem } from "../opportunity/scout.js";
import {
  upsertStrategyProfile,
  createDefaultStrategyProfile,
} from "../opportunity/strategy.js";
import {
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  noToolResponse,
} from "./mocks.js";
import type { BountyConfig, OpenFoxIdentity } from "../types.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";
import { startAgentDiscoverySentimentAnalysisServer } from "../agent-discovery/sentiment-analysis-server.js";
import { DEFAULT_AGENT_DISCOVERY_SENTIMENT_ANALYSIS_SERVER_CONFIG } from "../types.js";

const HOST_ADDRESS =
  "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02";
const SOLVER_ADDRESS =
  "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6";

function createIdentity(
  name: string,
  address: `0x${string}`,
  sandboxId: string,
): OpenFoxIdentity {
  return {
    name,
    address,
    account: {} as any,
    creatorAddress: address,
    sandboxId,
    apiKey: "",
    createdAt: "2027-03-11T00:00:00.000Z",
  };
}

// ─── Bounty/Task: data_labeling surface ──────────────────────────

describe("data_labeling bounty surface", () => {
  const db = createTestDb();

  afterEach(() => {
    db.raw.exec("DELETE FROM bounty_results");
    db.raw.exec("DELETE FROM bounty_submissions");
    db.raw.exec("DELETE FROM bounties");
    db.raw.exec("DELETE FROM kv");
  });

  it("opens a data_labeling bounty and judges submission against reference labels", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"accepted","confidence":0.92,"reason":"Labels match the reference."}',
      ),
    ]);
    const bountyConfig: BountyConfig = {
      ...DEFAULT_BOUNTY_CONFIG,
      enabled: true,
      role: "host",
      defaultKind: "data_labeling",
      skill: "data-labeling-bounty-host",
    };
    const payouts: Array<{ to: string; amountWei: bigint }> = [];
    const engine = createBountyEngine({
      identity: createIdentity("host", HOST_ADDRESS, "host-agent"),
      db,
      inference,
      bountyConfig,
      payoutSender: {
        async send({ to, amountWei }) {
          payouts.push({ to, amountWei });
          return { txHash: "0xpaid" };
        },
      },
      now: () => new Date("2027-03-11T00:00:00.000Z"),
    });

    const bounty = engine.openBounty({
      kind: "data_labeling",
      title: "Label sentiment of 3 sentences",
      taskPrompt:
        'Label each sentence as positive, negative, or neutral:\n1. "I love this product"\n2. "It broke on day one"\n3. "The box is brown"',
      referenceOutput: "1. positive\n2. negative\n3. neutral",
      rewardWei: "1000",
      submissionDeadline: "2027-03-11T01:00:00.000Z",
      skillName: "data-labeling-bounty-host",
    });

    expect(bounty.kind).toBe("data_labeling");
    expect(bounty.status).toBe("open");

    const submission = await engine.submitAnswer({
      bountyId: bounty.bountyId,
      solverAddress: SOLVER_ADDRESS,
      answer: "1. positive\n2. negative\n3. neutral",
      solverAgentId: "solver-agent",
    });

    expect(submission.result.decision).toBe("accepted");
    expect(submission.result.payoutTxHash).toBe("0xpaid");
    expect(submission.bounty.status).toBe("paid");
    expect(payouts).toEqual([{ to: SOLVER_ADDRESS, amountWei: 1000n }]);
  });

  it("rejects a data_labeling submission with incorrect labels", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"rejected","confidence":0.88,"reason":"Label for item 2 is wrong."}',
      ),
    ]);
    const engine = createBountyEngine({
      identity: createIdentity("host", HOST_ADDRESS, "host-agent"),
      db,
      inference,
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        defaultKind: "data_labeling",
      },
      payoutSender: {
        async send() {
          throw new Error("should not be called");
        },
      },
      now: () => new Date("2027-03-11T00:00:00.000Z"),
    });

    const bounty = engine.openBounty({
      kind: "data_labeling",
      title: "Label 2 items",
      taskPrompt: 'Label: 1. "Great" 2. "Terrible"',
      referenceOutput: "1. positive\n2. negative",
      rewardWei: "500",
      submissionDeadline: "2027-03-11T01:00:00.000Z",
    });

    const submission = await engine.submitAnswer({
      bountyId: bounty.bountyId,
      solverAddress: SOLVER_ADDRESS,
      answer: "1. positive\n2. positive",
      solverAgentId: "solver-agent",
    });

    expect(submission.result.decision).toBe("rejected");
    expect(submission.bounty.status).toBe("open");
  });

  it("auto-opens a data_labeling bounty through automation", async () => {
    const hostIdentity = createIdentity("host", HOST_ADDRESS, "host-agent");
    const bountyConfig: BountyConfig = {
      ...DEFAULT_BOUNTY_CONFIG,
      enabled: true,
      role: "host",
      defaultKind: "data_labeling",
      skill: "data-labeling-bounty-host",
      autoOpenOnStartup: true,
      autoOpenWhenIdle: true,
    };
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"title":"Label 3 product reviews","task_prompt":"Label each review as positive, negative, or neutral: 1. Great quality 2. Broke immediately 3. Average product","reference_output":"1. positive\\n2. negative\\n3. neutral","submission_ttl_seconds":1800}',
      ),
    ]);
    db.upsertSkill({
      name: "data-labeling-bounty-host",
      description: "data labeling host skill",
      autoActivate: false,
      instructions:
        "Create small bounded labeling tasks with 1-5 items and categorical labels.",
      source: "bundled",
      path: "/tmp/data-labeling-bounty-host/SKILL.md",
      enabled: true,
      installedAt: "2027-03-11T00:00:00.000Z",
    });
    const engine = createBountyEngine({
      identity: hostIdentity,
      db,
      inference,
      bountyConfig,
      now: () => new Date("2027-03-11T00:00:00.000Z"),
    });

    const opened = await ensureAutoQuestionBountyOpen({
      identity: hostIdentity,
      db,
      inference,
      bountyConfig,
      engine,
    });

    expect(opened).not.toBeNull();
    expect(opened!.kind).toBe("data_labeling");
    expect(opened!.title).toBe("Label 3 product reviews");
    expect(db.listBounties().length).toBe(1);
  });
});

// ─── Bounty/Task skill prompt generation ─────────────────────────

describe("data_labeling skill prompts", () => {
  it("builds a draft prompt for data_labeling kind", () => {
    const prompt = buildTaskBountyDraftPrompt({
      kind: "data_labeling",
      defaultSubmissionTtlSeconds: 3600,
    });
    expect(prompt).toContain("data labeling");
    expect(prompt).toContain("labeling instructions");
  });

  it("builds a judge prompt for data_labeling kind", () => {
    const prompt = buildTaskBountyJudgePrompt({
      kind: "data_labeling",
      title: "Label items",
      taskPrompt: "Label as A or B",
      referenceOutput: "1. A\n2. B",
      candidateSubmission: "1. A\n2. A",
    });
    expect(prompt).toContain("data labeling");
    expect(prompt).toContain("labels exactly match");
  });

  it("builds a solver prompt for data_labeling kind", () => {
    const prompt = buildTaskBountySolverPrompt({
      kind: "data_labeling",
      title: "Label items",
      taskPrompt: "Label as A or B",
    });
    expect(prompt).toContain("data labeling");
    expect(prompt).toContain("structured labels");
  });

  it("parses a valid data_labeling draft response", () => {
    const raw = JSON.stringify({
      title: "Label 3 reviews",
      task_prompt: "Label each as positive or negative",
      reference_output: "1. positive\n2. negative\n3. positive",
      submission_ttl_seconds: 1800,
    });
    const draft = parseTaskBountyDraft(raw);
    expect(draft.title).toBe("Label 3 reviews");
    expect(draft.taskPrompt).toBe("Label each as positive or negative");
    expect(draft.referenceOutput).toBe(
      "1. positive\n2. negative\n3. positive",
    );
    expect(draft.submissionTtlSeconds).toBe(1800);
  });
});

// ─── Provider service: sentiment.analyze surface ─────────────────

describe("sentiment.analyze provider service", () => {
  it("starts and handles a sentiment analysis request", async () => {
    const db = createTestDb();
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"sentiment":"positive","confidence":0.95,"summary":"The text expresses clear satisfaction."}',
      ),
    ]);
    const config = createTestConfig({ x402Server: { ...createTestConfig().x402Server!, enabled: false } as any });
    const identity = createIdentity("provider", HOST_ADDRESS, "provider-agent");
    const sentimentConfig = {
      ...DEFAULT_AGENT_DISCOVERY_SENTIMENT_ANALYSIS_SERVER_CONFIG,
      enabled: true,
      port: 14884 + Math.floor(Math.random() * 1000),
    };

    let server: Awaited<
      ReturnType<typeof startAgentDiscoverySentimentAnalysisServer>
    > | null = null;
    try {
      server = await startAgentDiscoverySentimentAnalysisServer({
        identity,
        config,
        address: HOST_ADDRESS,
        db,
        inference,
        sentimentConfig,
      });

      expect(server.url).toContain("sentiment-analyze");

      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "sentiment.analyze",
          requester: {
            agent_id: "test-requester",
            identity: { kind: "tos", value: SOLVER_ADDRESS },
          },
          request_nonce: "nonce-sentiment-test-00000001",
          request_expires_at: Math.floor(Date.now() / 1000) + 60,
          text: "I absolutely love this new feature, it works perfectly!",
          reason: "test",
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        sentiment: string;
        confidence: number;
        summary: string;
        text_preview: string;
      };
      expect(body.status).toBe("ok");
      expect(body.sentiment).toBe("positive");
      expect(body.confidence).toBeGreaterThan(0);
      expect(body.summary).toBeTruthy();
      expect(body.text_preview).toContain("love");
    } finally {
      if (server) await server.close();
      db.close();
    }
  });

  it("returns idempotent response for duplicate nonce", async () => {
    const db = createTestDb();
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"sentiment":"negative","confidence":0.9,"summary":"Negative sentiment detected."}',
      ),
    ]);
    const config = createTestConfig({ x402Server: { ...createTestConfig().x402Server!, enabled: false } as any });
    const identity = createIdentity("provider", HOST_ADDRESS, "provider-agent");
    const sentimentConfig = {
      ...DEFAULT_AGENT_DISCOVERY_SENTIMENT_ANALYSIS_SERVER_CONFIG,
      enabled: true,
      port: 15884 + Math.floor(Math.random() * 1000),
    };

    let server: Awaited<
      ReturnType<typeof startAgentDiscoverySentimentAnalysisServer>
    > | null = null;
    try {
      server = await startAgentDiscoverySentimentAnalysisServer({
        identity,
        config,
        address: HOST_ADDRESS,
        db,
        inference,
        sentimentConfig,
      });

      const requestBody = JSON.stringify({
        capability: "sentiment.analyze",
        requester: {
          agent_id: "test-requester",
          identity: { kind: "tos", value: SOLVER_ADDRESS },
        },
        request_nonce: "nonce-sentiment-idem-00000001",
        request_expires_at: Math.floor(Date.now() / 1000) + 60,
        text: "This is terrible and disappointing.",
        reason: "test",
      });

      const first = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { sentiment: string; idempotent?: boolean };

      const second = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { sentiment: string; idempotent?: boolean };
      expect(secondBody.idempotent).toBe(true);
      expect(secondBody.sentiment).toBe(firstBody.sentiment);
    } finally {
      if (server) await server.close();
      db.close();
    }
  });

  it("rejects requests exceeding max text length", async () => {
    const db = createTestDb();
    const inference = new MockInferenceClient([]);
    const config = createTestConfig({ x402Server: { ...createTestConfig().x402Server!, enabled: false } as any });
    const identity = createIdentity("provider", HOST_ADDRESS, "provider-agent");
    const sentimentConfig = {
      ...DEFAULT_AGENT_DISCOVERY_SENTIMENT_ANALYSIS_SERVER_CONFIG,
      enabled: true,
      port: 16884 + Math.floor(Math.random() * 1000),
      maxTextChars: 50,
    };

    let server: Awaited<
      ReturnType<typeof startAgentDiscoverySentimentAnalysisServer>
    > | null = null;
    try {
      server = await startAgentDiscoverySentimentAnalysisServer({
        identity,
        config,
        address: HOST_ADDRESS,
        db,
        inference,
        sentimentConfig,
      });

      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "sentiment.analyze",
          requester: {
            agent_id: "test-requester",
            identity: { kind: "tos", value: SOLVER_ADDRESS },
          },
          request_nonce: "nonce-sentiment-len-000000001",
          request_expires_at: Math.floor(Date.now() / 1000) + 60,
          text: "A".repeat(100),
          reason: "test",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("max length");
    } finally {
      if (server) await server.close();
      db.close();
    }
  });
});

// ─── Owner opportunity: new surfaces in opportunity ranking ──────

describe("opportunity ranking for new work surfaces", () => {
  it("ranks data_labeling bounty opportunities alongside existing kinds", () => {
    const strategy = createDefaultStrategyProfile();
    strategy.enabledOpportunityKinds = ["bounty", "campaign", "provider"];
    strategy.enabledProviderClasses = [
      "task_market",
      "observation",
      "oracle",
      "general_provider",
      "sponsored_execution",
      "storage_artifacts",
    ];
    strategy.minMarginBps = 0;
    strategy.maxSpendPerOpportunityWei = "1000000000000000000";

    const items: OpportunityItem[] = [
      {
        kind: "bounty",
        providerClass: "task_market",
        trustTier: "org_trusted",
        title: "Label 5 product reviews",
        description: "Data labeling bounty: classify reviews as positive/negative/neutral",
        capability: "task.submit",
        baseUrl: "https://host.example.com",
        bountyId: "bounty-dl-1",
        grossValueWei: "50000000000000000",
        estimatedCostWei: "0",
        marginWei: "50000000000000000",
        marginBps: 10000,
        rawScore: 50,
      },
      {
        kind: "bounty",
        providerClass: "task_market",
        trustTier: "org_trusted",
        title: "Translate a paragraph",
        description: "Translation bounty",
        capability: "task.submit",
        baseUrl: "https://host.example.com",
        bountyId: "bounty-tr-1",
        grossValueWei: "30000000000000000",
        estimatedCostWei: "0",
        marginWei: "30000000000000000",
        marginBps: 10000,
        rawScore: 30,
      },
      {
        kind: "provider",
        providerClass: "general_provider",
        trustTier: "public_low_trust",
        title: "Sentiment Analysis Provider",
        description: "Paid sentiment.analyze service",
        capability: "sentiment.analyze",
        mode: "paid",
        grossValueWei: "0",
        estimatedCostWei: "1500000000000000",
        marginWei: "-1500000000000000",
        marginBps: -10000,
        rawScore: 0,
      },
    ];

    const ranked = rankOpportunityItems({ items, strategy });
    expect(ranked.length).toBe(3);
    // data_labeling bounty should rank first (highest gross value)
    expect(ranked[0].bountyId).toBe("bounty-dl-1");
    expect(ranked[0].strategyMatched).toBe(true);
    // sentiment provider should rank last (it costs money with no direct revenue)
    expect(ranked[2].capability).toBe("sentiment.analyze");
  });

  it("filters out data_labeling opportunities when task_market provider class is disabled", () => {
    const strategy = createDefaultStrategyProfile();
    strategy.enabledProviderClasses = ["observation", "oracle"];
    strategy.minMarginBps = 0;
    strategy.maxSpendPerOpportunityWei = "1000000000000000000";

    const items: OpportunityItem[] = [
      {
        kind: "bounty",
        providerClass: "task_market",
        trustTier: "org_trusted",
        title: "Label items",
        description: "Data labeling task",
        capability: "task.submit",
        grossValueWei: "50000000000000000",
        estimatedCostWei: "0",
        marginWei: "50000000000000000",
        marginBps: 10000,
        rawScore: 50,
      },
    ];

    const ranked = rankOpportunityItems({ items, strategy });
    expect(ranked[0].strategyMatched).toBe(false);
    expect(ranked[0].strategyReasons).toContain(
      "provider class task_market is disabled",
    );
  });

  it("persists strategy profiles that include new surface capabilities", () => {
    const db = createTestDb();
    try {
      const profile = upsertStrategyProfile(db, {
        profileId: "labeling-focused",
        name: "Data Labeling Focus",
        revenueTargetWei: "500000000000000000",
        maxSpendPerOpportunityWei: "50000000000000000",
        minMarginBps: 1000,
        enabledOpportunityKinds: ["bounty", "campaign", "provider"],
        enabledProviderClasses: ["task_market", "general_provider"],
        allowedTrustTiers: ["self_hosted", "org_trusted"],
        automationLevel: "bounded_auto",
        reportCadence: "daily",
        maxDeadlineHours: 48,
      });

      expect(profile.profileId).toBe("labeling-focused");
      expect(profile.enabledProviderClasses).toContain("general_provider");
    } finally {
      db.close();
    }
  });
});
