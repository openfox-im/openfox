import { ulid } from "ulid";
import type {
  BountyConfig,
  BountyCreateInput,
  BountyRecord,
  BountyResultRecord,
  BountySubmissionInput,
  BountySubmissionRecord,
  InferenceClient,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { evaluateQuestionBountySubmission } from "./evaluate.js";
import type { BountyPayoutSender } from "./payout.js";

export interface BountyEngine {
  openQuestionBounty(input: BountyCreateInput): BountyRecord;
  listBounties(): BountyRecord[];
  getBountyDetails(bountyId: string): {
    bounty: BountyRecord;
    submissions: BountySubmissionRecord[];
    result?: BountyResultRecord;
  } | null;
  submitAnswer(
    input: BountySubmissionInput,
  ): Promise<{
    bounty: BountyRecord;
    submission: BountySubmissionRecord;
    result: BountyResultRecord;
  }>;
}

export function createBountyEngine(params: {
  identity: OpenFoxIdentity;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  bountyConfig: BountyConfig;
  payoutSender?: BountyPayoutSender;
  now?: () => Date;
}): BountyEngine {
  const now = params.now ?? (() => new Date());

  function openQuestionBounty(input: BountyCreateInput): BountyRecord {
    const openBounties = params.db
      .listBounties("open")
      .filter((row) => row.hostAddress === params.identity.address);
    if (openBounties.length >= params.bountyConfig.maxOpenBounties) {
      throw new Error("maximum open bounty count reached");
    }

    const timestamp = now().toISOString();
    const bounty: BountyRecord = {
      bountyId: ulid(),
      hostAgentId: params.identity.sandboxId || params.identity.address,
      hostAddress: params.identity.address,
      kind: "question",
      question: input.question.trim(),
      referenceAnswer: input.referenceAnswer.trim(),
      rewardWei: input.rewardWei,
      submissionDeadline: input.submissionDeadline,
      judgeMode: params.bountyConfig.judgeMode,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    params.db.insertBounty(bounty);
    return bounty;
  }

  function listBounties(): BountyRecord[] {
    return params.db.listBounties();
  }

  function getBountyDetails(bountyId: string) {
    const bounty = params.db.getBountyById(bountyId);
    if (!bounty) return null;
    return {
      bounty,
      submissions: params.db.listBountySubmissions(bountyId),
      result: params.db.getBountyResult(bountyId),
    };
  }

  async function submitAnswer(input: BountySubmissionInput) {
    const bounty = params.db.getBountyById(input.bountyId);
    if (!bounty) {
      throw new Error(`bounty not found: ${input.bountyId}`);
    }
    if (bounty.status !== "open") {
      throw new Error(`bounty is not open: ${bounty.status}`);
    }
    if (new Date(bounty.submissionDeadline).getTime() < now().getTime()) {
      params.db.updateBountyStatus(bounty.bountyId, "expired");
      throw new Error("bounty deadline has already passed");
    }
    const existingSubmissions = params.db.listBountySubmissions(bounty.bountyId);
    if (existingSubmissions.length > 0) {
      throw new Error("this MVP only accepts one submission per bounty");
    }

    const timestamp = now().toISOString();
    const submission: BountySubmissionRecord = {
      submissionId: ulid(),
      bountyId: bounty.bountyId,
      solverAgentId: input.solverAgentId ?? null,
      solverAddress: input.solverAddress,
      answer: input.answer.trim(),
      status: "submitted",
      submittedAt: timestamp,
      updatedAt: timestamp,
    };
    params.db.insertBountySubmission(submission);
    params.db.updateBountyStatus(bounty.bountyId, "under_review");

    const judge = await evaluateQuestionBountySubmission({
      inference: params.inference,
      bounty,
      submission,
    });

    const accepted = judge.decision === "accepted";
    params.db.updateBountySubmissionStatus(
      submission.submissionId,
      accepted ? "accepted" : "rejected",
    );

    let payoutTxHash: string | null = null;
    let bountyStatus: BountyRecord["status"] = accepted ? "approved" : "rejected";
    if (
      accepted &&
      judge.confidence >= params.bountyConfig.autoPayConfidenceThreshold &&
      params.payoutSender
    ) {
      const payout = await params.payoutSender.send({
        to: submission.solverAddress,
        amountWei: BigInt(bounty.rewardWei),
      });
      payoutTxHash = payout.txHash;
      bountyStatus = "paid";
    }

    params.db.updateBountyStatus(bounty.bountyId, bountyStatus);
    const result: BountyResultRecord = {
      bountyId: bounty.bountyId,
      winningSubmissionId: accepted ? submission.submissionId : null,
      decision: judge.decision,
      confidence: judge.confidence,
      judgeReason: judge.reason,
      payoutTxHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    params.db.upsertBountyResult(result);

    const updatedBounty = params.db.getBountyById(bounty.bountyId)!;
    const updatedSubmission = params.db.getBountySubmission(submission.submissionId)!;
    const updatedResult = params.db.getBountyResult(bounty.bountyId)!;
    return {
      bounty: updatedBounty,
      submission: updatedSubmission,
      result: updatedResult,
    };
  }

  return {
    openQuestionBounty,
    listBounties,
    getBountyDetails,
    submitAnswer,
  };
}
