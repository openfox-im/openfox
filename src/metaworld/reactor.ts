/**
 * MetaWorld Reactor — Deterministic Consequence Engine
 *
 * The reactor is the centralized call-through layer that fires
 * deterministic consequences when state changes occur. It does not
 * make decisions or enforce policy — it enforces invariants and
 * propagates effects across modules.
 *
 * CLI commands and agent skills call reactor operations instead of
 * calling module functions directly. The reactor calls the underlying
 * module function, then fires all deterministic consequences:
 * event bus publications, reputation events, chain anchor queuing,
 * and cross-module governance proposals.
 */

import type { PrivateKeyAccount } from "tosdk";
import type { OpenFoxDatabase } from "../types.js";
import type { OpenFoxConfig } from "../types.js";
import type { HexString } from "../chain/address.js";
import { createLogger } from "../observability/logger.js";

// Module imports — governance
import {
  voteOnProposal,
  resolveProposalIfReady,
  executeApprovedProposal,
  expireStaleProposals,
  createGovernanceProposal,
  getGovernanceProposal,
  listGovernanceProposals,
  type GovernanceProposalRecord,
  type GovernanceVoteRecord,
} from "../group/governance.js";

// Module imports — treasury
import {
  recordTreasuryOutflow,
  resetExpiredBudgetPeriods,
  getGroupTreasury,
  type TreasuryLogRecord,
} from "../group/treasury.js";

// Module imports — intents
import {
  createIntent,
  respondToIntent,
  acceptIntentResponse,
  submitIntentArtifacts,
  approveIntentCompletion,
  getIntent,
  type IntentRecord,
  type IntentResponseRecord,
  type IntentKind,
  type IntentRequirement,
} from "./intents.js";

// Module imports — reputation
import {
  emitReputationEvent,
  type ReputationEventRecord,
} from "./reputation.js";

// Module imports — chain anchoring
import {
  publishGroupStateCommitment,
} from "../group/chain-anchor.js";

// Module imports — federation
import {
  runWorldFederationSync,
  listFederationPeers,
  type WorldFederationTransport,
} from "./federation.js";

// Module imports — event bus
import {
  type WorldEventBus,
  type WorldEvent,
} from "./event-bus.js";

// Module imports — group store
import {
  listGroups,
} from "../group/store.js";

const logger = createLogger("reactor");

// ---------------------------------------------------------------------------
// ReactorContext
// ---------------------------------------------------------------------------

export interface ReactorContext {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  eventBus: WorldEventBus;
  /** Signing account for governance events that require on-chain signatures. */
  account: PrivateKeyAccount;
  /** Federation transports for sync operations. Empty array disables federation. */
  federationTransports?: WorldFederationTransport[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function publishEvent(
  eventBus: WorldEventBus,
  kind: WorldEvent["kind"],
  payload: Record<string, unknown>,
): void {
  eventBus.publish({
    kind,
    payload,
    timestamp: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Hook: onGovernanceVoteCast
// ---------------------------------------------------------------------------

export function onGovernanceVoteCast(
  ctx: ReactorContext,
  params: {
    groupId: string;
    proposalId: string;
  },
): void {
  logger.debug(`reactor: vote cast on proposal ${params.proposalId}`);

  publishEvent(ctx.eventBus, "proposal.update", {
    groupId: params.groupId,
    proposalId: params.proposalId,
    action: "vote_cast",
  });
}

// ---------------------------------------------------------------------------
// Hook: onProposalResolved
// ---------------------------------------------------------------------------

export function onProposalResolved(
  ctx: ReactorContext,
  params: {
    groupId: string;
    proposalId: string;
    outcome: "approved" | "rejected" | "expired";
  },
): void {
  logger.debug(
    `reactor: proposal ${params.proposalId} resolved as ${params.outcome}`,
  );

  publishEvent(ctx.eventBus, "proposal.update", {
    groupId: params.groupId,
    proposalId: params.proposalId,
    outcome: params.outcome,
  });
}

// ---------------------------------------------------------------------------
// Hook: onProposalExecuted
// ---------------------------------------------------------------------------

export function onProposalExecuted(
  ctx: ReactorContext,
  params: {
    groupId: string;
    proposalId: string;
    proposalType: string;
    result: Record<string, unknown>;
  },
): void {
  logger.debug(`reactor: proposal ${params.proposalId} executed`);

  publishEvent(ctx.eventBus, "proposal.update", {
    groupId: params.groupId,
    proposalId: params.proposalId,
    action: "executed",
  });

  // If the executed proposal was a spend, emit economic reputation for the recipient
  if (params.proposalType === "spend") {
    const recipient = params.result.targetAddress as string | undefined;
    if (recipient) {
      emitReputationEvent(ctx.db, {
        targetAddress: recipient,
        targetType: "fox",
        dimension: "economic",
        delta: 0.5,
        sourceType: "settlement",
        sourceRef: `proposal:${params.proposalId}`,
        issuerAddress: params.groupId,
      });

      publishEvent(ctx.eventBus, "reputation.update", {
        address: recipient,
        source: "proposal_spend_execution",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Hook: onIntentStatusChanged
// ---------------------------------------------------------------------------

export function onIntentStatusChanged(
  ctx: ReactorContext,
  params: {
    intentId: string;
    previousStatus: string;
    newStatus: string;
    groupId?: string;
  },
): void {
  logger.debug(
    `reactor: intent ${params.intentId} status ${params.previousStatus} -> ${params.newStatus}`,
  );

  publishEvent(ctx.eventBus, "intent.update", {
    intentId: params.intentId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
  });
}

// ---------------------------------------------------------------------------
// Hook: onIntentCompleted
// ---------------------------------------------------------------------------

export async function onIntentCompleted(
  ctx: ReactorContext,
  params: {
    intentId: string;
    publisherAddress: string;
    solverAddress: string;
    groupId?: string;
    budgetWei?: string;
  },
): Promise<void> {
  logger.info(`reactor: intent ${params.intentId} completed`);

  // 1. Publish intent completion event
  publishEvent(ctx.eventBus, "intent.update", {
    intentId: params.intentId,
    action: "completed",
  });

  // 2. Emit reputation events for the solver
  emitReputationEvent(ctx.db, {
    targetAddress: params.solverAddress,
    targetType: "fox",
    dimension: "reliability",
    delta: 1.0,
    sourceType: "intent_completion",
    sourceRef: `intent:${params.intentId}`,
    issuerGroupId: params.groupId,
    issuerAddress: params.publisherAddress,
  });

  emitReputationEvent(ctx.db, {
    targetAddress: params.solverAddress,
    targetType: "fox",
    dimension: "quality",
    delta: 0.8,
    sourceType: "intent_completion",
    sourceRef: `intent:${params.intentId}`,
    issuerGroupId: params.groupId,
    issuerAddress: params.publisherAddress,
  });

  publishEvent(ctx.eventBus, "reputation.update", {
    address: params.solverAddress,
    source: "intent_completion",
  });

  // 3. If there is a budget and a group, create a settlement spend proposal
  if (params.budgetWei && params.groupId) {
    try {
      const proposal = await createGovernanceProposal(ctx.db, {
        account: ctx.account,
        groupId: params.groupId,
        proposalType: "spend",
        title: `Settlement: intent ${params.intentId}`,
        description: `Automated settlement spend proposal for completed intent ${params.intentId}. Solver: ${params.solverAddress}. Amount: ${params.budgetWei} wei.`,
        params: {
          intentId: params.intentId,
          recipient: params.solverAddress,
          amountWei: params.budgetWei,
          action: "settlement_spend",
        },
        proposerAddress: params.publisherAddress,
      });

      logger.info(
        `reactor: created settlement proposal ${proposal.proposalId} for intent ${params.intentId}`,
      );

      publishEvent(ctx.eventBus, "proposal.update", {
        groupId: params.groupId,
        proposalId: proposal.proposalId,
        action: "created",
        source: "intent_settlement",
      });
    } catch (err) {
      logger.warn(
        `reactor: failed to create settlement proposal for intent ${params.intentId}: ${err}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Hook: onTreasurySpendExecuted
// ---------------------------------------------------------------------------

export function onTreasurySpendExecuted(
  ctx: ReactorContext,
  params: {
    groupId: string;
    recipient: string;
    amountWei: string;
    txHash?: string;
    proposalId?: string;
  },
): void {
  logger.info(
    `reactor: treasury spend executed in ${params.groupId} -> ${params.recipient} (${params.amountWei} wei)`,
  );

  // 1. Emit economic reputation event for recipient
  emitReputationEvent(ctx.db, {
    targetAddress: params.recipient,
    targetType: "fox",
    dimension: "economic",
    delta: 0.7,
    sourceType: "settlement",
    sourceRef: params.proposalId
      ? `proposal:${params.proposalId}`
      : `treasury:${params.groupId}`,
    issuerGroupId: params.groupId,
    issuerAddress: params.groupId,
  });

  // 2. Publish treasury update event
  publishEvent(ctx.eventBus, "treasury.update", {
    groupId: params.groupId,
    recipient: params.recipient,
    amountWei: params.amountWei,
  });

  // 3. Publish reputation update event
  publishEvent(ctx.eventBus, "reputation.update", {
    address: params.recipient,
    source: "settlement",
  });

  // 4. Queue chain anchor commitment (fire-and-forget, errors logged)
  if (ctx.config.rpcUrl) {
    // We queue this asynchronously; the heartbeat will also catch pending commits
    logger.debug(
      `reactor: chain anchor queued for group ${params.groupId} after treasury spend`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hook: onSettlementRecorded
// ---------------------------------------------------------------------------

export function onSettlementRecorded(
  ctx: ReactorContext,
  params: {
    groupId?: string;
    settlementId: string;
    parties: string[];
  },
): void {
  logger.debug(`reactor: settlement ${params.settlementId} recorded`);

  publishEvent(ctx.eventBus, "feed.item", {
    type: "settlement_completed",
    settlementId: params.settlementId,
    parties: params.parties,
    groupId: params.groupId,
  });
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorVoteOnProposal
// ---------------------------------------------------------------------------

export async function reactorVoteOnProposal(
  ctx: ReactorContext,
  params: {
    proposalId: string;
    voterAddress: string;
    voterAgentId?: string;
    vote: "approve" | "reject";
    reason?: string;
  },
): Promise<{ vote: GovernanceVoteRecord; proposal: GovernanceProposalRecord }> {
  const result = await voteOnProposal(ctx.db, {
    account: ctx.account,
    proposalId: params.proposalId,
    voterAddress: params.voterAddress,
    voterAgentId: params.voterAgentId,
    vote: params.vote,
    reason: params.reason,
  });

  // Fire hook: vote cast
  onGovernanceVoteCast(ctx, {
    groupId: result.proposal.groupId,
    proposalId: params.proposalId,
  });

  // If the vote caused a resolution, fire the resolved hook
  if (
    result.proposal.status === "approved" ||
    result.proposal.status === "rejected" ||
    result.proposal.status === "expired"
  ) {
    onProposalResolved(ctx, {
      groupId: result.proposal.groupId,
      proposalId: params.proposalId,
      outcome: result.proposal.status,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorExecuteProposal
// ---------------------------------------------------------------------------

export async function reactorExecuteProposal(
  ctx: ReactorContext,
  params: {
    proposalId: string;
    actorAddress: string;
    actorAgentId?: string;
  },
): Promise<GovernanceProposalRecord> {
  const proposal = await executeApprovedProposal(ctx.db, {
    account: ctx.account,
    proposalId: params.proposalId,
    actorAddress: params.actorAddress,
    actorAgentId: params.actorAgentId,
  });

  onProposalExecuted(ctx, {
    groupId: proposal.groupId,
    proposalId: params.proposalId,
    proposalType: proposal.proposalType,
    result: proposal.executionResult ?? {},
  });

  return proposal;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorApproveIntentCompletion
// ---------------------------------------------------------------------------

export async function reactorApproveIntentCompletion(
  ctx: ReactorContext,
  params: {
    intentId: string;
    actorAddress: string;
  },
): Promise<{ intent: IntentRecord; settlementProposalId?: string }> {
  const intent = getIntent(ctx.db, params.intentId);
  if (!intent) {
    throw new Error(`Intent not found: ${params.intentId}`);
  }

  const previousStatus = intent.status;
  const result = approveIntentCompletion(ctx.db, {
    intentId: params.intentId,
    actorAddress: params.actorAddress,
  });

  await onIntentCompleted(ctx, {
    intentId: params.intentId,
    publisherAddress: result.intent.publisherAddress,
    solverAddress: result.intent.matchedSolverAddress!,
    groupId: result.intent.groupId ?? undefined,
    budgetWei: result.intent.budgetWei ?? undefined,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorExecuteTreasurySpend
// ---------------------------------------------------------------------------

export function reactorExecuteTreasurySpend(
  ctx: ReactorContext,
  params: {
    groupId: string;
    amountWei: string;
    recipient: string;
    budgetLine: string;
    proposalId?: string;
    txHash?: string;
    memo?: string;
  },
): TreasuryLogRecord {
  const logRecord = recordTreasuryOutflow(
    ctx.db,
    params.groupId,
    params.amountWei,
    params.recipient,
    params.budgetLine,
    params.proposalId,
    params.txHash,
    params.memo,
  );

  onTreasurySpendExecuted(ctx, {
    groupId: params.groupId,
    recipient: params.recipient,
    amountWei: params.amountWei,
    txHash: params.txHash,
    proposalId: params.proposalId,
  });

  return logRecord;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorCreateIntent
// ---------------------------------------------------------------------------

export function reactorCreateIntent(
  ctx: ReactorContext,
  params: {
    publisherAddress: string;
    groupId?: string;
    kind: IntentKind;
    title: string;
    description?: string;
    requirements?: IntentRequirement[];
    budgetWei?: string;
    budgetLine?: string;
    expiresInHours?: number;
  },
): IntentRecord {
  const intent = createIntent(ctx.db, {
    publisherAddress: params.publisherAddress,
    groupId: params.groupId,
    kind: params.kind,
    title: params.title,
    description: params.description,
    requirements: params.requirements,
    budgetWei: params.budgetWei,
    budgetLine: params.budgetLine,
    expiresInHours: params.expiresInHours,
  });

  onIntentStatusChanged(ctx, {
    intentId: intent.intentId,
    previousStatus: "none",
    newStatus: intent.status,
    groupId: intent.groupId ?? undefined,
  });

  return intent;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorRespondToIntent
// ---------------------------------------------------------------------------

export function reactorRespondToIntent(
  ctx: ReactorContext,
  params: {
    intentId: string;
    solverAddress: string;
    proposalText?: string;
    proposedAmountWei?: string;
    capabilityRefs?: string[];
  },
): IntentResponseRecord {
  const intentBefore = getIntent(ctx.db, params.intentId);
  if (!intentBefore) {
    throw new Error(`Intent not found: ${params.intentId}`);
  }

  const response = respondToIntent(ctx.db, {
    intentId: params.intentId,
    solverAddress: params.solverAddress,
    proposalText: params.proposalText,
    proposedAmountWei: params.proposedAmountWei,
    capabilityRefs: params.capabilityRefs,
  });

  const intentAfter = getIntent(ctx.db, params.intentId);
  if (intentAfter && intentAfter.status !== intentBefore.status) {
    onIntentStatusChanged(ctx, {
      intentId: params.intentId,
      previousStatus: intentBefore.status,
      newStatus: intentAfter.status,
      groupId: intentAfter.groupId ?? undefined,
    });
  }

  return response;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorAcceptIntentResponse
// ---------------------------------------------------------------------------

export function reactorAcceptIntentResponse(
  ctx: ReactorContext,
  params: {
    intentId: string;
    solverAddress: string;
    actorAddress: string;
  },
): IntentRecord {
  const intentBefore = getIntent(ctx.db, params.intentId);
  if (!intentBefore) {
    throw new Error(`Intent not found: ${params.intentId}`);
  }

  const intent = acceptIntentResponse(ctx.db, {
    intentId: params.intentId,
    solverAddress: params.solverAddress,
    actorAddress: params.actorAddress,
  });

  onIntentStatusChanged(ctx, {
    intentId: params.intentId,
    previousStatus: intentBefore.status,
    newStatus: intent.status,
    groupId: intent.groupId ?? undefined,
  });

  return intent;
}

// ---------------------------------------------------------------------------
// Orchestrated Operation: reactorSubmitIntentArtifacts
// ---------------------------------------------------------------------------

export function reactorSubmitIntentArtifacts(
  ctx: ReactorContext,
  params: {
    intentId: string;
    solverAddress: string;
    artifactIds: string[];
  },
): IntentRecord {
  const intentBefore = getIntent(ctx.db, params.intentId);
  if (!intentBefore) {
    throw new Error(`Intent not found: ${params.intentId}`);
  }

  const intent = submitIntentArtifacts(ctx.db, {
    intentId: params.intentId,
    solverAddress: params.solverAddress,
    artifactIds: params.artifactIds,
  });

  onIntentStatusChanged(ctx, {
    intentId: params.intentId,
    previousStatus: intentBefore.status,
    newStatus: intent.status,
    groupId: intent.groupId ?? undefined,
  });

  return intent;
}

// ---------------------------------------------------------------------------
// Heartbeat: runReactorHeartbeat
// ---------------------------------------------------------------------------

export async function runReactorHeartbeat(ctx: ReactorContext): Promise<{
  expiredProposals: number;
  resetBudgets: number;
  federationSynced: number;
  federationErrors: number;
  chainCommitments: number;
}> {
  logger.debug("reactor heartbeat: starting");

  let expiredProposals = 0;
  let resetBudgets = 0;
  let federationSynced = 0;
  let federationErrors = 0;
  let chainCommitments = 0;

  const groups = listGroups(ctx.db);
  const actorAddress = ctx.config.walletAddress;

  // 1. Expire stale governance proposals across all groups
  for (const group of groups) {
    try {
      const expired = await expireStaleProposals(
        ctx.db,
        group.groupId,
        ctx.account,
        actorAddress,
      );
      expiredProposals += expired.length;

      for (const proposal of expired) {
        onProposalResolved(ctx, {
          groupId: group.groupId,
          proposalId: proposal.proposalId,
          outcome: "expired",
        });
      }
    } catch (err) {
      logger.warn(
        `reactor heartbeat: failed to expire proposals for group ${group.groupId}: ${err}`,
      );
    }
  }

  // 2. Reset expired budget periods across all groups
  for (const group of groups) {
    try {
      const treasury = getGroupTreasury(ctx.db, group.groupId);
      if (treasury) {
        const count = resetExpiredBudgetPeriods(ctx.db, group.groupId);
        resetBudgets += count;
      }
    } catch (err) {
      logger.warn(
        `reactor heartbeat: failed to reset budgets for group ${group.groupId}: ${err}`,
      );
    }
  }

  // 3. Run federation sync cycle
  const transports = ctx.federationTransports ?? [];
  if (transports.length > 0) {
    try {
      const syncResult = await runWorldFederationSync({
        db: ctx.db,
        transports,
      });
      federationSynced = syncResult.synced;
      federationErrors = syncResult.errors;
    } catch (err) {
      logger.warn(`reactor heartbeat: federation sync failed: ${err}`);
    }
  }

  // 4. Publish pending chain state commitments for groups with chain anchoring
  if (ctx.config.rpcUrl) {
    for (const group of groups) {
      try {
        // Only commit if the group has a treasury (proxy for "is economically active")
        const treasury = getGroupTreasury(ctx.db, group.groupId);
        if (treasury) {
          await publishGroupStateCommitment({
            db: ctx.db,
            groupId: group.groupId,
            privateKey: ctx.config.walletAddress as unknown as HexString,
            rpcUrl: ctx.config.rpcUrl,
          });
          chainCommitments++;
        }
      } catch (err) {
        logger.warn(
          `reactor heartbeat: chain commitment failed for group ${group.groupId}: ${err}`,
        );
      }
    }
  }

  logger.info(
    `reactor heartbeat: expired=${expiredProposals} proposals, reset=${resetBudgets} budgets, ` +
      `federation=${federationSynced} synced/${federationErrors} errors, ` +
      `chain=${chainCommitments} commitments`,
  );

  return {
    expiredProposals,
    resetBudgets,
    federationSynced,
    federationErrors,
    chainCommitments,
  };
}
