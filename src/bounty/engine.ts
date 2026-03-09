import { ulid } from "ulid";
import type {
  BountyConfig,
  BountyCreateInput,
  BountyPolicy,
  BountyRecord,
  BountyResultRecord,
  BountySubmissionInput,
  BountySubmissionRecord,
  InferenceClient,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { DEFAULT_BOUNTY_POLICY } from "../types.js";
import { evaluateBountySubmission } from "./evaluate.js";
import type { BountyPayoutSender } from "./payout.js";

export interface BountyEngine {
  openBounty(input: BountyCreateInput): BountyRecord;
  openQuestionBounty(input: {
    question: string;
    referenceAnswer: string;
    rewardWei: string;
    submissionDeadline: string;
    skillName?: string | null;
  }): BountyRecord;
  listBounties(): BountyRecord[];
  getBountyDetails(bountyId: string): {
    bounty: BountyRecord;
    submissions: BountySubmissionRecord[];
    result?: BountyResultRecord;
  } | null;
  submitSubmission(
    input: BountySubmissionInput,
  ): Promise<{
    bounty: BountyRecord;
    submission: BountySubmissionRecord;
    result: BountyResultRecord;
  }>;
  submitAnswer(
    input: {
      bountyId: string;
      solverAgentId?: string | null;
      solverAddress: BountySubmissionInput["solverAddress"];
      answer: string;
      proofUrl?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{
    bounty: BountyRecord;
    submission: BountySubmissionRecord;
    result: BountyResultRecord;
  }>;
}

function mergeBountyPolicy(
  configPolicy: BountyPolicy,
  bountyPolicy?: Partial<BountyPolicy>,
): BountyPolicy {
  return {
    ...DEFAULT_BOUNTY_POLICY,
    ...configPolicy,
    ...(bountyPolicy ?? {}),
  };
}

function isTrustedProofUrl(policy: BountyPolicy, proofUrl: string | null | undefined): boolean {
  if (!proofUrl) return false;
  if (!policy.trustedProofUrlPrefixes.length) return true;
  return policy.trustedProofUrlPrefixes.some((prefix) => proofUrl.startsWith(prefix));
}

function requiresProofUrl(kind: BountyRecord["kind"]): boolean {
  return kind === "social_proof";
}

function collectSolverPayoutStats(params: {
  db: OpenFoxDatabase;
  solverAddress: string;
  now: Date;
}): {
  paidWeiLast24h: bigint;
  mostRecentPaidAt?: string;
} {
  const cutoffMs = params.now.getTime() - 24 * 60 * 60 * 1000;
  let paidWeiLast24h = 0n;
  let mostRecentPaidAt: string | undefined;

  for (const bounty of params.db.listBounties()) {
    const result = params.db.getBountyResult(bounty.bountyId);
    if (!result?.winningSubmissionId || !result.payoutTxHash) continue;
    const submission = params.db.getBountySubmission(result.winningSubmissionId);
    if (!submission || submission.solverAddress !== params.solverAddress) continue;
    const updatedAtMs = new Date(result.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) continue;
    if (!mostRecentPaidAt || updatedAtMs > new Date(mostRecentPaidAt).getTime()) {
      mostRecentPaidAt = result.updatedAt;
    }
    if (updatedAtMs >= cutoffMs) {
      paidWeiLast24h += BigInt(bounty.rewardWei);
    }
  }

  return { paidWeiLast24h, mostRecentPaidAt };
}

export function createBountyEngine(params: {
  identity: OpenFoxIdentity;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  bountyConfig: BountyConfig;
  skillInstructions?: string;
  payoutSender?: BountyPayoutSender;
  now?: () => Date;
}): BountyEngine {
  const now = params.now ?? (() => new Date());

  function openBounty(input: BountyCreateInput): BountyRecord {
    const openBounties = params.db
      .listBounties("open")
      .filter((row) => row.hostAddress === params.identity.address);
    if (openBounties.length >= params.bountyConfig.maxOpenBounties) {
      throw new Error("maximum open bounty count reached");
    }

    const taskPrompt = input.taskPrompt.trim();
    const referenceOutput = input.referenceOutput.trim();
    if (!taskPrompt) {
      throw new Error("taskPrompt is required");
    }
    if (!referenceOutput) {
      throw new Error("referenceOutput is required");
    }

    const timestamp = now().toISOString();
    const bounty: BountyRecord = {
      bountyId: ulid(),
      hostAgentId: params.identity.sandboxId || params.identity.address,
      hostAddress: params.identity.address,
      kind: input.kind,
      title: input.title.trim() || taskPrompt.slice(0, 160),
      taskPrompt,
      referenceOutput,
      skillName: input.skillName ?? null,
      metadata: input.metadata ?? {},
      policy: mergeBountyPolicy(params.bountyConfig.policy, input.policy),
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

  function openQuestionBounty(input: {
    question: string;
    referenceAnswer: string;
    rewardWei: string;
    submissionDeadline: string;
    skillName?: string | null;
  }): BountyRecord {
    return openBounty({
      kind: "question",
      title: input.question,
      taskPrompt: input.question,
      referenceOutput: input.referenceAnswer,
      rewardWei: input.rewardWei,
      submissionDeadline: input.submissionDeadline,
      skillName: input.skillName,
    });
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

  async function submitSubmission(input: BountySubmissionInput) {
    const bounty = params.db.getBountyById(input.bountyId);
    if (!bounty) {
      throw new Error(`bounty not found: ${input.bountyId}`);
    }
    if (bounty.status === "paid" || bounty.status === "approved" || bounty.status === "expired") {
      throw new Error(`bounty is not open: ${bounty.status}`);
    }
    if (new Date(bounty.submissionDeadline).getTime() < now().getTime()) {
      params.db.updateBountyStatus(bounty.bountyId, "expired");
      throw new Error("bounty deadline has already passed");
    }

    const policy = mergeBountyPolicy(params.bountyConfig.policy, bounty.policy);
    const existingSubmissions = params.db.listBountySubmissions(bounty.bountyId);
    const solverAttempts = existingSubmissions.filter(
      (submission) => submission.solverAddress === input.solverAddress,
    ).length;
    if (solverAttempts >= policy.maxSubmissionsPerSolver) {
      throw new Error("solver has already reached the submission limit for this bounty");
    }
    if (requiresProofUrl(bounty.kind) && !input.proofUrl) {
      throw new Error("this bounty requires a proofUrl");
    }
    if (input.proofUrl && !isTrustedProofUrl(policy, input.proofUrl)) {
      throw new Error("proofUrl is not within the trusted proof URL allowlist");
    }

    const payoutStats = collectSolverPayoutStats({
      db: params.db,
      solverAddress: input.solverAddress,
      now: now(),
    });
    if (payoutStats.mostRecentPaidAt) {
      const lastPaidMs = new Date(payoutStats.mostRecentPaidAt).getTime();
      if (
        Number.isFinite(lastPaidMs) &&
        now().getTime() - lastPaidMs < policy.solverCooldownSeconds * 1000
      ) {
        throw new Error("solver is within the payout cooldown window");
      }
    }

    const timestamp = now().toISOString();
    const submission: BountySubmissionRecord = {
      submissionId: ulid(),
      bountyId: bounty.bountyId,
      solverAgentId: input.solverAgentId ?? null,
      solverAddress: input.solverAddress,
      submissionText: input.submissionText.trim(),
      proofUrl: input.proofUrl ?? null,
      metadata: input.metadata ?? {},
      status: "submitted",
      submittedAt: timestamp,
      updatedAt: timestamp,
    };
    params.db.insertBountySubmission(submission);
    params.db.updateBountyStatus(bounty.bountyId, "under_review");

    const judge = await evaluateBountySubmission({
      inference: params.inference,
      bounty,
      submission,
      skillInstructions: params.skillInstructions,
    });

    const accepted = judge.decision === "accepted";
    params.db.updateBountySubmissionStatus(
      submission.submissionId,
      accepted ? "accepted" : "rejected",
    );

    let payoutTxHash: string | null = null;
    let bountyStatus: BountyRecord["status"] = accepted ? "approved" : "open";
    if (accepted) {
      const projectedDailyPayout = payoutStats.paidWeiLast24h + BigInt(bounty.rewardWei);
      const withinDailyBudget =
        projectedDailyPayout <= BigInt(policy.maxAutoPayPerSolverPerDayWei);
      if (
        judge.confidence >= params.bountyConfig.autoPayConfidenceThreshold &&
        params.payoutSender &&
        withinDailyBudget
      ) {
        const payout = await params.payoutSender.send({
          to: submission.solverAddress,
          amountWei: BigInt(bounty.rewardWei),
        });
        payoutTxHash = payout.txHash;
        bountyStatus = "paid";
      }
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

  async function submitAnswer(input: {
    bountyId: string;
    solverAgentId?: string | null;
    solverAddress: BountySubmissionInput["solverAddress"];
    answer: string;
    proofUrl?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return submitSubmission({
      bountyId: input.bountyId,
      solverAgentId: input.solverAgentId,
      solverAddress: input.solverAddress,
      submissionText: input.answer,
      proofUrl: input.proofUrl,
      metadata: input.metadata,
    });
  }

  return {
    openBounty,
    openQuestionBounty,
    listBounties,
    getBountyDetails,
    submitSubmission,
    submitAnswer,
  };
}
