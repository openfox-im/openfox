import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { MockInferenceClient, createTestDb, noToolResponse } from "./mocks.js";
import type { BountyConfig, OpenFoxIdentity } from "../types.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";

const HOST_ADDRESS =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SOLVER_ADDRESS =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

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
    const payouts: Array<{ to: string; amountWei: bigint }> = [];
    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference,
      bountyConfig,
      payoutSender: {
        async send({ to, amountWei }) {
          payouts.push({ to, amountWei });
          return { txHash: "0xpaid" };
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const bounty = engine.openQuestionBounty({
      question: "What color is the sky on a clear day?",
      referenceAnswer: "blue",
      rewardWei: "1000",
      submissionDeadline: "2026-03-09T01:00:00.000Z",
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
    expect(payouts).toEqual([{ to: SOLVER_ADDRESS, amountWei: 1000n }]);
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
      },
      payoutSender: {
        async send() {
          throw new Error("should not be called");
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const bounty = engine.openQuestionBounty({
      question: "2 + 2 = ?",
      referenceAnswer: "4",
      rewardWei: "1000",
      submissionDeadline: "2026-03-09T01:00:00.000Z",
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
      },
      payoutSender: {
        async send() {
          return { txHash: "0xtranslation" };
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const translation = engine.openBounty({
      kind: "translation",
      title: "Translate hello",
      taskPrompt: "Translate 'hello' into Chinese.",
      referenceOutput: "你好",
      rewardWei: "1000",
      submissionDeadline: "2026-03-09T01:00:00.000Z",
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
      rewardWei: "1000",
      submissionDeadline: "2026-03-09T01:00:00.000Z",
    });

    await expect(
      engine.submitSubmission({
        bountyId: social.bountyId,
        solverAddress: SOLVER_ADDRESS,
        submissionText: "openfox test",
      }),
    ).rejects.toThrow("requires a proofUrl");
  });
});
