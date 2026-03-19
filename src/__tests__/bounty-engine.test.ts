import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { MockInferenceClient, createTestDb, noToolResponse } from "./mocks.js";
import type { BountyConfig, OpenFoxIdentity } from "../types.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";

const HOST_ADDRESS =
  "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02";
const SOLVER_ADDRESS =
  "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6";

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

describe("bounty engine", () => {
  const db = createTestDb();

  afterEach(() => {
    db.raw.exec("DELETE FROM bounty_results");
    db.raw.exec("DELETE FROM bounty_submissions");
    db.raw.exec("DELETE FROM bounties");
  });

  it("opens a question bounty and auto-pays accepted submissions", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"accepted","confidence":0.95,"reason":"Answer matches the reference."}',
      ),
    ]);
    const bountyConfig: BountyConfig = {
      ...DEFAULT_BOUNTY_CONFIG,
      enabled: true,
      role: "host",
    };
    const payouts: Array<{ to: string; amountTomi: bigint }> = [];
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference,
      bountyConfig,
      payoutSender: {
        async send({ to, amountTomi }) {
          payouts.push({ to, amountTomi });
          return { txHash: "0xpaid" };
        },
      },
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    const bounty = engine.openQuestionBounty({
      question: "What color is the sky on a clear day?",
      referenceAnswer: "blue",
      rewardTomi: "1000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    const submission = await engine.submitAnswer({
      bountyId: bounty.bountyId,
      solverAddress: SOLVER_ADDRESS,
      answer: "blue",
      solverAgentId: "solver-agent",
    });

    expect(submission.result.decision).toBe("accepted");
    expect(submission.result.payoutTxHash).toBe("0xpaid");
    expect(submission.bounty.status).toBe("paid");
    expect(payouts).toEqual([{ to: SOLVER_ADDRESS, amountTomi: 1000n }]);
  });

  it("keeps the bounty open after a rejected submission", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"rejected","confidence":0.31,"reason":"Wrong answer."}',
      ),
    ]);
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference,
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        policy: {
          ...DEFAULT_BOUNTY_CONFIG.policy,
          trustedProofUrlPrefixes: ["https://example.com/"],
        },
      },
      payoutSender: {
        async send() {
          throw new Error("should not be called");
        },
      },
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    const bounty = engine.openQuestionBounty({
      question: "2 + 2 = ?",
      referenceAnswer: "4",
      rewardTomi: "1000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    const result = await engine.submitAnswer({
      bountyId: bounty.bountyId,
      solverAddress: SOLVER_ADDRESS,
      answer: "5",
    });

    expect(result.result.decision).toBe("rejected");
    expect(result.result.payoutTxHash).toBeNull();
    expect(result.bounty.status).toBe("open");
  });

  it("supports non-question task kinds and enforces proof rules", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"accepted","confidence":0.93,"reason":"Translation matches the reference."}',
      ),
    ]);
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference,
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        policy: {
          ...DEFAULT_BOUNTY_CONFIG.policy,
          trustedProofUrlPrefixes: ["https://example.com/"],
        },
      },
      payoutSender: {
        async send() {
          return { txHash: "0xtranslation" };
        },
      },
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    const translation = engine.openBounty({
      kind: "translation",
      title: "Translate hello",
      taskPrompt: "Translate 'hello' into Chinese.",
      referenceOutput: "你好",
      rewardTomi: "1000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    const translated = await engine.submitSubmission({
      bountyId: translation.bountyId,
      solverAddress: SOLVER_ADDRESS,
      submissionText: "你好",
    });
    expect(translated.bounty.kind).toBe("translation");
    expect(translated.result.payoutTxHash).toBe("0xtranslation");

    const social = engine.openBounty({
      kind: "social_proof",
      title: "Reply with the phrase",
      taskPrompt: "Reply to the post with the exact phrase 'openfox test' and submit the proof URL.",
      referenceOutput: "openfox test",
      rewardTomi: "1000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    await expect(
      engine.submitSubmission({
        bountyId: social.bountyId,
        solverAddress: SOLVER_ADDRESS,
        submissionText: "openfox test",
      }),
    ).rejects.toThrow("requires a proofUrl");
  });

  it("captures accepted public evidence tasks into artifact-backed settlements", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"accepted","confidence":0.97,"reason":"The captured article matches the requested evidence."}',
      ),
    ]);
    let publishedArtifactUrl: string | null = null;
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference,
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        policy: {
          ...DEFAULT_BOUNTY_CONFIG.policy,
          trustedProofUrlPrefixes: ["https://example.com/"],
        },
      },
      artifactManager: {
        async capturePublicNews() {
          return {
            artifact: {
              artifactId: "artifact-news-1",
            },
            lease: {
              get_url: "http://provider.test/storage/get/bafynews",
            },
            anchor: null,
          } as any;
        },
        async createOracleEvidence() {
          throw new Error("not expected");
        },
        async createOracleAggregate() {
          throw new Error("not expected");
        },
        async createCommitteeVote() {
          throw new Error("not expected");
        },
        async verifyArtifact() {
          throw new Error("not expected");
        },
        async anchorArtifact() {
          throw new Error("not expected");
        },
        listArtifacts() {
          return [];
        },
        getArtifact() {
          return undefined;
        },
      },
      settlementPublisher: {
        async publish(input) {
          publishedArtifactUrl = input.artifactUrl;
          return {
            receiptId: `bounty:${input.subjectId}`,
            kind: "bounty",
            subjectId: input.subjectId,
            receipt: {
              version: 1,
              receiptId: `bounty:${input.subjectId}`,
              kind: "bounty",
              subjectId: input.subjectId,
              publisherAddress: HOST_ADDRESS,
              resultHash:
                "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
              createdAt: "2027-03-09T00:00:00.000Z",
            },
            receiptHash:
              "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
            settlementTxHash:
              "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
            createdAt: "2027-03-09T00:00:00.000Z",
            updatedAt: "2027-03-09T00:00:00.000Z",
          };
        },
      },
      payoutSender: {
        async send() {
          return { txHash: "0xartifactpaid" };
        },
      },
      now: () => new Date("2027-03-09T00:00:00.000Z"),
    });

    const bounty = engine.openBounty({
      kind: "public_news_capture",
      title: "Capture this article",
      taskPrompt: "Submit the body text of the target article.",
      referenceOutput: "expected evidence",
      rewardTomi: "1000",
      submissionDeadline: "2027-03-09T01:00:00.000Z",
    });

    const result = await engine.submitSubmission({
      bountyId: bounty.bountyId,
      solverAddress: SOLVER_ADDRESS,
      submissionText: "Full article body",
      proofUrl: "https://example.com/news/1",
      metadata: {
        headline: "Captured headline",
      },
    });

    expect(result.result.decision).toBe("accepted");
    expect(result.settlement?.receiptId).toBe(`bounty:${bounty.bountyId}`);
    expect(publishedArtifactUrl).toBe("http://provider.test/storage/get/bafynews");
  });
});
