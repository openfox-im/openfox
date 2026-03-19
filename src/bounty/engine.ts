import { ulid } from "ulid";
import type {
  BountyConfig,
  BountyCreateInput,
  CampaignCreateInput,
  CampaignProgress,
  CampaignRecord,
  BountyPolicy,
  BountyRecord,
  BountyResultRecord,
  BountySubmissionInput,
  BountySubmissionRecord,
  InferenceClient,
  OpenFoxDatabase,
  OpenFoxIdentity,
  SettlementRecord,
} from "../types.js";
import { DEFAULT_BOUNTY_POLICY } from "../types.js";
import { evaluateBountySubmission } from "./evaluate.js";
import type { BountyPayoutSender } from "./payout.js";
import type { SettlementPublisher } from "../settlement/publisher.js";
import type { SettlementCallbackDispatcher } from "../settlement/callbacks.js";
import type { MarketBindingPublisher } from "../market/publisher.js";
import type { MarketContractDispatcher } from "../market/contracts.js";
import type { ArtifactManager } from "../artifacts/manager.js";

export interface BountyEngine {
  createCampaign(input: CampaignCreateInput): CampaignRecord;
  listCampaigns(): Array<CampaignRecord & { progress: CampaignProgress }>;
  getCampaignDetails(campaignId: string): {
    campaign: CampaignRecord;
    progress: CampaignProgress;
    bounties: BountyRecord[];
  } | null;
  openBounty(input: BountyCreateInput): BountyRecord;
  openQuestionBounty(input: {
    question: string;
    referenceAnswer: string;
    rewardTomi: string;
    submissionDeadline: string;
    skillName?: string | null;
  }): BountyRecord;
  listBounties(): BountyRecord[];
  getBountyDetails(bountyId: string): {
    bounty: BountyRecord;
    submissions: BountySubmissionRecord[];
    result?: BountyResultRecord;
    settlement?: SettlementRecord;
  } | null;
  submitSubmission(
    input: BountySubmissionInput,
  ): Promise<{
    bounty: BountyRecord;
    submission: BountySubmissionRecord;
    result: BountyResultRecord;
    settlement?: SettlementRecord | null;
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
    settlement?: SettlementRecord | null;
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
  return (
    kind === "social_proof" ||
    kind === "public_news_capture" ||
    kind === "oracle_evidence_capture"
  );
}

function collectSolverPayoutStats(params: {
  db: OpenFoxDatabase;
  solverAddress: string;
  now: Date;
}): {
  paidTomiLast24h: bigint;
  mostRecentPaidAt?: string;
} {
  const cutoffMs = params.now.getTime() - 24 * 60 * 60 * 1000;
  let paidTomiLast24h = 0n;
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
      paidTomiLast24h += BigInt(bounty.rewardTomi);
    }
  }

  return { paidTomiLast24h, mostRecentPaidAt };
}

function collectCampaignProgress(params: {
  db: OpenFoxDatabase;
  campaign: CampaignRecord;
}): CampaignProgress {
  const bounties = params.db.listBountiesByCampaign(params.campaign.campaignId);
  const allocatedTomi = bounties.reduce((sum, bounty) => sum + BigInt(bounty.rewardTomi), 0n);
  const submissionCount = bounties.reduce(
    (sum, bounty) => sum + params.db.listBountySubmissions(bounty.bountyId).length,
    0,
  );
  const openBountyCount = bounties.filter((bounty) => bounty.status === "open").length;
  const paidBountyCount = bounties.filter((bounty) => bounty.status === "paid").length;
  const totalBudgetTomi = BigInt(params.campaign.budgetTomi);
  const remainingTomi = totalBudgetTomi > allocatedTomi ? totalBudgetTomi - allocatedTomi : 0n;
  return {
    totalBudgetTomi: totalBudgetTomi.toString(),
    allocatedTomi: allocatedTomi.toString(),
    remainingTomi: remainingTomi.toString(),
    bountyCount: bounties.length,
    openBountyCount,
    paidBountyCount,
    submissionCount,
  };
}

export function createBountyEngine(params: {
  identity: OpenFoxIdentity;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  bountyConfig: BountyConfig;
  skillInstructions?: string;
  payoutSender?: BountyPayoutSender;
  artifactManager?: ArtifactManager;
  settlementPublisher?: SettlementPublisher;
  settlementCallbacks?: SettlementCallbackDispatcher;
  marketBindingPublisher?: MarketBindingPublisher;
  marketContractDispatcher?: MarketContractDispatcher;
  now?: () => Date;
}): BountyEngine {
  const now = params.now ?? (() => new Date());

  function createCampaign(input: CampaignCreateInput): CampaignRecord {
    const timestamp = now().toISOString();
    const campaign: CampaignRecord = {
      campaignId: ulid(),
      hostAgentId: params.identity.sandboxId || params.identity.address,
      hostAddress: params.identity.address,
      title: input.title.trim(),
      description: input.description.trim(),
      budgetTomi: input.budgetTomi,
      maxOpenBounties: input.maxOpenBounties ?? params.bountyConfig.maxOpenBounties,
      allowedKinds: input.allowedKinds?.length
        ? [...input.allowedKinds]
        : [
            "question",
            "translation",
            "social_proof",
            "problem_solving",
            "public_news_capture",
            "oracle_evidence_capture",
          ],
      metadata: input.metadata ?? {},
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!campaign.title) {
      throw new Error("campaign title is required");
    }
    if (!campaign.description) {
      throw new Error("campaign description is required");
    }
    if (BigInt(campaign.budgetTomi) <= 0n) {
      throw new Error("campaign budgetTomi must be greater than zero");
    }
    params.db.insertCampaign(campaign);
    return campaign;
  }

  function listCampaigns(): Array<CampaignRecord & { progress: CampaignProgress }> {
    return params.db.listCampaigns().map((campaign) => ({
      ...campaign,
      progress: collectCampaignProgress({ db: params.db, campaign }),
    }));
  }

  function getCampaignDetails(campaignId: string) {
    const campaign = params.db.getCampaignById(campaignId);
    if (!campaign) return null;
    return {
      campaign,
      progress: collectCampaignProgress({ db: params.db, campaign }),
      bounties: params.db.listBountiesByCampaign(campaignId),
    };
  }

  function openBounty(input: BountyCreateInput): BountyRecord {
    let campaign: CampaignRecord | undefined;
    if (input.campaignId) {
      campaign = params.db.getCampaignById(input.campaignId);
      if (!campaign) {
        throw new Error(`campaign not found: ${input.campaignId}`);
      }
      if (campaign.status !== "open") {
        throw new Error(`campaign is not open: ${campaign.status}`);
      }
      if (!campaign.allowedKinds.includes(input.kind)) {
        throw new Error(`campaign does not allow bounty kind: ${input.kind}`);
      }
      const progress = collectCampaignProgress({ db: params.db, campaign });
      if (progress.openBountyCount >= campaign.maxOpenBounties) {
        throw new Error("campaign has reached the maximum open bounty count");
      }
      const nextAllocatedTomi = BigInt(progress.allocatedTomi) + BigInt(input.rewardTomi);
      if (nextAllocatedTomi > BigInt(campaign.budgetTomi)) {
        throw new Error("campaign budget is exhausted");
      }
    }

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
    if (
      (input.kind === "public_news_capture" || input.kind === "oracle_evidence_capture") &&
      !params.artifactManager
    ) {
      throw new Error("artifact pipeline is required for public evidence capture bounties");
    }

    const timestamp = now().toISOString();
    const bounty: BountyRecord = {
      bountyId: ulid(),
      campaignId: input.campaignId ?? null,
      hostAgentId: params.identity.sandboxId || params.identity.address,
      hostAddress: params.identity.address,
      kind: input.kind,
      title: input.title.trim() || taskPrompt.slice(0, 160),
      taskPrompt,
      referenceOutput,
      skillName: input.skillName ?? null,
      metadata: input.metadata ?? {},
      policy: mergeBountyPolicy(params.bountyConfig.policy, input.policy),
      rewardTomi: input.rewardTomi,
      submissionDeadline: input.submissionDeadline,
      judgeMode: params.bountyConfig.judgeMode,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    params.db.insertBounty(bounty);
    if (campaign) {
      const progress = collectCampaignProgress({ db: params.db, campaign });
      if (BigInt(progress.remainingTomi) === 0n) {
        params.db.updateCampaignStatus(campaign.campaignId, "exhausted");
      }
    }
    if (params.marketBindingPublisher) {
      const binding = params.marketBindingPublisher.publish({
        kind: "bounty",
        subjectId: bounty.bountyId,
        publisherAddress: params.identity.address,
        capability: "task.submit",
        artifactUrl: `${params.bountyConfig.pathPrefix.replace(/\/+$/, "")}/bounties/${bounty.bountyId}`,
        metadata: {
          title: bounty.title,
          kind: bounty.kind,
          reward_tomi: bounty.rewardTomi,
          judge_mode: bounty.judgeMode,
        },
      });
      if (params.marketContractDispatcher) {
        void params.marketContractDispatcher.dispatch(binding);
      }
    }
    return bounty;
  }

  function openQuestionBounty(input: {
    question: string;
    referenceAnswer: string;
    rewardTomi: string;
    submissionDeadline: string;
    skillName?: string | null;
  }): BountyRecord {
    return openBounty({
      kind: "question",
      title: input.question,
      taskPrompt: input.question,
      referenceOutput: input.referenceAnswer,
      rewardTomi: input.rewardTomi,
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
      settlement: params.db.getSettlementReceipt("bounty", bountyId),
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
    let artifactUrl: string | null = null;
    if (accepted) {
      if (params.artifactManager && bounty.kind === "public_news_capture") {
        const captured = await params.artifactManager.capturePublicNews({
          title: bounty.title,
          sourceUrl:
            submission.proofUrl ||
            (typeof submission.metadata?.source_url === "string"
              ? submission.metadata.source_url
              : ""),
          headline:
            (typeof submission.metadata?.headline === "string" &&
            submission.metadata.headline.trim()
              ? submission.metadata.headline.trim()
              : bounty.title) || bounty.title,
          bodyText: submission.submissionText,
        });
        artifactUrl = captured.lease.get_url;
      } else if (params.artifactManager && bounty.kind === "oracle_evidence_capture") {
        const captured = await params.artifactManager.createOracleEvidence({
          title: bounty.title,
          question: bounty.taskPrompt,
          evidenceText: submission.submissionText,
          sourceUrl:
            submission.proofUrl ||
            (typeof submission.metadata?.source_url === "string"
              ? submission.metadata.source_url
              : undefined),
          relatedArtifactIds: Array.isArray(submission.metadata?.related_artifact_ids)
            ? submission.metadata?.related_artifact_ids.filter(
                (value): value is string => typeof value === "string" && value.trim().length > 0,
              )
            : undefined,
        });
        artifactUrl = captured.lease.get_url;
      }
      const projectedDailyPayout = payoutStats.paidTomiLast24h + BigInt(bounty.rewardTomi);
      const withinDailyBudget =
        projectedDailyPayout <= BigInt(policy.maxAutoPayPerSolverPerDayTomi);
      if (
        judge.confidence >= params.bountyConfig.autoPayConfidenceThreshold &&
        params.payoutSender &&
        withinDailyBudget
      ) {
        const payout = await params.payoutSender.send({
          to: submission.solverAddress,
          amountTomi: BigInt(bounty.rewardTomi),
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

    let settlement: SettlementRecord | null = null;
    if (params.settlementPublisher) {
      settlement = await params.settlementPublisher.publish({
        kind: "bounty",
        subjectId: bounty.bountyId,
        publisherAddress: params.identity.address,
        capability: "task.result",
        solverAddress: submission.solverAddress,
        artifactUrl:
          artifactUrl ||
          `${params.bountyConfig.pathPrefix.replace(/\/+$/, "")}/bounties/${bounty.bountyId}/result`,
        payoutTxHash: (payoutTxHash as `0x${string}` | null) ?? undefined,
        result: {
          bounty_id: bounty.bountyId,
          decision: result.decision,
          confidence: result.confidence,
          judge_reason: result.judgeReason,
          winning_submission_id: result.winningSubmissionId,
          payout_tx_hash: result.payoutTxHash,
        },
        metadata: {
          bounty_kind: bounty.kind,
          host_agent_id: bounty.hostAgentId,
          solver_agent_id: submission.solverAgentId,
          artifact_url: artifactUrl,
        },
      });
      if (settlement && params.settlementCallbacks) {
        await params.settlementCallbacks.dispatch(settlement);
      }
    }

    const updatedBounty = params.db.getBountyById(bounty.bountyId)!;
    const updatedSubmission = params.db.getBountySubmission(submission.submissionId)!;
    const updatedResult = params.db.getBountyResult(bounty.bountyId)!;
    return {
      bounty: updatedBounty,
      submission: updatedSubmission,
      result: updatedResult,
      settlement,
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
    createCampaign,
    listCampaigns,
    getCampaignDetails,
    openBounty,
    openQuestionBounty,
    listBounties,
    getBountyDetails,
    submitSubmission,
    submitAnswer,
  };
}
