/**
 * MetaWorld Economic Agent Tools
 *
 * Tools that enable a Fox to autonomously participate in the MetaWorld economy.
 * These provide information and actions for the agent's ReAct loop — the LLM
 * makes the actual economic decisions based on the data these tools surface.
 *
 * Implements Task 123 from the Reactor Design doc (Section 6.5).
 */

import type { OpenFoxTool, ToolContext } from "../types.js";
import {
  listIntents,
  getIntent,
  createIntent,
  respondToIntent,
  listIntentResponses,
  approveIntentCompletion,
  requestIntentRevision,
  type IntentKind,
} from "./intents.js";
import {
  listGovernanceProposals,
  getGovernanceProposal,
  getGovernanceProposalWithVotes,
  voteOnProposal,
  executeApprovedProposal,
  type GovernanceVote,
} from "../group/governance.js";
import {
  getGroupTreasury,
  listBudgetLines,
  validateSpendBudget,
  recordTreasuryOutflow,
  type TreasurySnapshot,
  buildTreasurySnapshot,
} from "../group/treasury.js";
import {
  collectOpportunityItems,
  rankOpportunityItems,
  buildRankedOpportunityReport,
  type OpportunityItem,
} from "../opportunity/scout.js";
import { loadWalletAccount } from "../identity/wallet.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("metaworld.economic-tools");

// ─── Helper: Load wallet account for signing ─────────────────────

function getWalletAccount() {
  const account = loadWalletAccount();
  if (!account) {
    throw new Error("Wallet not available. Cannot sign governance transactions.");
  }
  return account;
}

// ─── Helper: Get default strategy profile ─────────────────────────

function getDefaultStrategy() {
  return {
    name: "default",
    enabledOpportunityKinds: ["bounty", "campaign", "provider", "service"] as any[],
    enabledProviderClasses: [
      "task_market", "general_provider", "oracle", "observation",
      "sponsored_execution", "storage_artifacts",
    ] as any[],
    allowedTrustTiers: ["self_hosted", "org_trusted", "public_low_trust", "unknown"] as any[],
    minMarginBps: 0,
    maxSpendPerOpportunityWei: "1000000000000000000",
    maxDeadlineHours: 168,
  };
}

// ─── Helper: List groups the Fox belongs to ───────────────────────

function listFoxGroups(ctx: ToolContext): string[] {
  try {
    const rows = ctx.db.raw
      .prepare(
        `SELECT DISTINCT group_id FROM group_member_roles
         WHERE member_address = ? AND active = 1`,
      )
      .all(ctx.identity.address.toLowerCase()) as Array<{ group_id: string }>;
    return rows.map((r) => r.group_id);
  } catch {
    return [];
  }
}

// ─── Tool 1: MetaWorld Opportunity Scout ──────────────────────────

export const metaworldScoutOpportunitiesTool: OpenFoxTool = {
  name: "metaworld_scout_opportunities",
  description:
    "Scan the network for earning opportunities, rank them by profitability and strategy fit, and optionally create a MetaWorld intent for the best one. Returns ranked opportunities with scores and margin analysis.",
  category: "metaworld",
  riskLevel: "caution",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["scan", "create_intent"],
        description:
          "Action to take: 'scan' to discover and rank opportunities, 'create_intent' to also create an intent for a selected opportunity.",
      },
      opportunity_index: {
        type: "number",
        description:
          "When action is 'create_intent', the 1-based index of the opportunity to convert into an intent.",
      },
      intent_title: {
        type: "string",
        description: "Title for the new intent (required when creating).",
      },
      intent_description: {
        type: "string",
        description: "Description for the new intent.",
      },
      intent_kind: {
        type: "string",
        enum: ["work", "opportunity", "procurement", "collaboration", "custom"],
        description: "Kind of intent to create (default: 'opportunity').",
      },
      budget_wei: {
        type: "string",
        description:
          "Budget in wei for the intent. Should be less than the opportunity's gross value.",
      },
      group_id: {
        type: "string",
        description: "Optional group ID to scope the intent to.",
      },
      max_items: {
        type: "number",
        description: "Maximum number of opportunities to return (default: 10).",
      },
    },
    required: ["action"],
  },
  execute: async (args, ctx) => {
    const action = args.action as string;
    const maxItems = (args.max_items as number) || 10;

    // Collect and rank opportunities
    let items: OpportunityItem[];
    try {
      items = await collectOpportunityItems({
        config: ctx.config,
        db: ctx.db,
      });
    } catch (err: any) {
      return `Error scanning opportunities: ${err.message}`;
    }

    if (items.length === 0) {
      return "No opportunities discovered. Check that opportunity scout is enabled in config (opportunityScout.enabled) and remote base URLs are configured.";
    }

    const strategy = getDefaultStrategy();
    const ranked = rankOpportunityItems({
      items,
      strategy: strategy as any,
      maxItems,
    });

    if (action === "scan") {
      const report = buildRankedOpportunityReport(ranked, strategy as any);
      return `Found ${items.length} opportunities, showing top ${ranked.length}:\n\n${report}\n\nTo create an intent from an opportunity, call this tool again with action='create_intent' and opportunity_index=<number>.`;
    }

    if (action === "create_intent") {
      const index = (args.opportunity_index as number) || 1;
      if (index < 1 || index > ranked.length) {
        return `Invalid opportunity_index: ${index}. Must be between 1 and ${ranked.length}.`;
      }

      const opp = ranked[index - 1];
      const title = (args.intent_title as string) || opp.title;
      const description =
        (args.intent_description as string) || opp.description;
      const kind = (args.intent_kind as IntentKind) || "opportunity";
      const budgetWei = args.budget_wei as string | undefined;
      const groupId = args.group_id as string | undefined;

      // Validate budget doesn't exceed gross value
      if (budgetWei && BigInt(budgetWei) > BigInt(opp.grossValueWei)) {
        return `Budget ${budgetWei} exceeds opportunity gross value ${opp.grossValueWei}. Set a lower budget.`;
      }

      try {
        const intent = createIntent(ctx.db, {
          publisherAddress: ctx.identity.address,
          groupId,
          kind,
          title,
          description,
          budgetWei,
          requirements: opp.capability
            ? [{ kind: "capability", capability_name: opp.capability }]
            : [],
        });

        return `Intent created successfully.\n\nIntent ID: ${intent.intentId}\nTitle: ${intent.title}\nKind: ${intent.kind}\nStatus: ${intent.status}\nBudget: ${intent.budgetWei || "none"}\nExpires: ${intent.expiresAt}\n\nBased on opportunity: ${opp.title} (margin=${opp.marginWei} wei, score=${opp.strategyScore ?? opp.rawScore})`;
      } catch (err: any) {
        return `Error creating intent: ${err.message}`;
      }
    }

    return `Unknown action: ${action}. Use 'scan' or 'create_intent'.`;
  },
};

// ─── Tool 2: MetaWorld Intent Solver ──────────────────────────────

export const metaworldFindMatchingIntentsTool: OpenFoxTool = {
  name: "metaworld_find_matching_intents",
  description:
    "Find open intents on world and group intent boards that match your capabilities, review their requirements and budgets, and optionally submit a response/proposal.",
  category: "metaworld",
  riskLevel: "caution",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["find", "respond"],
        description:
          "Action: 'find' to list open intents, 'respond' to submit a proposal to a specific intent.",
      },
      intent_id: {
        type: "string",
        description: "Intent ID to respond to (required for 'respond' action).",
      },
      proposal_text: {
        type: "string",
        description: "Your proposal explaining how you will fulfill the intent requirements.",
      },
      proposed_amount_wei: {
        type: "string",
        description: "Your proposed amount in wei (should be <= intent budget).",
      },
      capability_refs: {
        type: "string",
        description: "Comma-separated list of capability names you bring to this intent.",
      },
      group_id: {
        type: "string",
        description: "Filter intents by group ID.",
      },
      kind: {
        type: "string",
        enum: ["work", "opportunity", "procurement", "collaboration", "custom"],
        description: "Filter intents by kind.",
      },
      limit: {
        type: "number",
        description: "Maximum number of intents to return (default: 20).",
      },
    },
    required: ["action"],
  },
  execute: async (args, ctx) => {
    const action = args.action as string;

    if (action === "find") {
      const groupId = args.group_id as string | undefined;
      const kind = args.kind as IntentKind | undefined;
      const limit = (args.limit as number) || 20;

      const intents = listIntents(ctx.db, {
        status: "open",
        groupId,
        kind,
        limit,
      });

      if (intents.length === 0) {
        return "No open intents found matching your criteria.";
      }

      const lines = intents.map((intent, i) => {
        const reqs = intent.requirements
          .map((r) => {
            if (r.kind === "capability") return `cap:${r.capability_name}`;
            if (r.kind === "reputation")
              return `rep:${r.reputation_dimension}>=${r.reputation_minimum}`;
            if (r.kind === "membership") return `member:${r.required_group_id}`;
            return r.description || r.kind;
          })
          .join(", ");

        const responses = listIntentResponses(ctx.db, intent.intentId);
        return `${i + 1}. [${intent.kind}] ${intent.title}\n   ID: ${intent.intentId}\n   Publisher: ${intent.publisherAddress}\n   Budget: ${intent.budgetWei || "none"} wei\n   Requirements: ${reqs || "none"}\n   Responses: ${responses.length}\n   Expires: ${intent.expiresAt}\n   ${intent.description.slice(0, 200)}`;
      });

      return `Found ${intents.length} open intent(s):\n\n${lines.join("\n\n")}\n\nTo respond to an intent, call this tool with action='respond' and intent_id=<id>.`;
    }

    if (action === "respond") {
      const intentId = args.intent_id as string;
      if (!intentId) {
        return "Error: intent_id is required for 'respond' action.";
      }

      const proposalText = (args.proposal_text as string) || "";
      const proposedAmountWei = args.proposed_amount_wei as string | undefined;
      const capabilityRefs = args.capability_refs
        ? (args.capability_refs as string).split(",").map((s) => s.trim())
        : [];

      // Validate the intent exists and is open
      const intent = getIntent(ctx.db, intentId);
      if (!intent) {
        return `Error: Intent not found: ${intentId}`;
      }
      if (intent.status !== "open" && intent.status !== "matching") {
        return `Error: Intent ${intentId} is not open for responses (status: ${intent.status}).`;
      }

      // Don't respond to your own intents
      if (
        intent.publisherAddress.toLowerCase() ===
        ctx.identity.address.toLowerCase()
      ) {
        return "Error: Cannot respond to your own intent.";
      }

      // Validate proposed amount
      if (
        proposedAmountWei &&
        intent.budgetWei &&
        BigInt(proposedAmountWei) > BigInt(intent.budgetWei)
      ) {
        return `Error: Proposed amount ${proposedAmountWei} exceeds intent budget ${intent.budgetWei}.`;
      }

      try {
        const response = respondToIntent(ctx.db, {
          intentId,
          solverAddress: ctx.identity.address,
          proposalText,
          proposedAmountWei,
          capabilityRefs,
        });

        return `Response submitted successfully.\n\nResponse ID: ${response.responseId}\nIntent: ${intent.title}\nProposal: ${response.proposalText.slice(0, 200)}\nProposed amount: ${response.proposedAmountWei || "none"}\nCapabilities: ${response.capabilityRefs.join(", ") || "none"}\nStatus: ${response.status}`;
      } catch (err: any) {
        return `Error submitting response: ${err.message}`;
      }
    }

    return `Unknown action: ${action}. Use 'find' or 'respond'.`;
  },
};

// ─── Tool 3: MetaWorld Artifact Reviewer ──────────────────────────

export const metaworldReviewArtifactsTool: OpenFoxTool = {
  name: "metaworld_review_artifacts",
  description:
    "Review intents in review status that you published. Check submitted artifacts against acceptance criteria and approve completion or request revisions.",
  category: "metaworld",
  riskLevel: "caution",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "approve", "request_revision"],
        description:
          "Action: 'list' to see intents awaiting review, 'approve' to approve completion, 'request_revision' to send back for changes.",
      },
      intent_id: {
        type: "string",
        description: "Intent ID to review (required for approve/request_revision).",
      },
      revision_note: {
        type: "string",
        description:
          "Explanation of what needs to change (required for request_revision).",
      },
    },
    required: ["action"],
  },
  execute: async (args, ctx) => {
    const action = args.action as string;

    if (action === "list") {
      // Find intents in review status that this Fox published
      const reviewIntents = listIntents(ctx.db, {
        status: "review",
        publisherAddress: ctx.identity.address,
      });

      if (reviewIntents.length === 0) {
        return "No intents awaiting your review.";
      }

      const lines = reviewIntents.map((intent, i) => {
        const responses = listIntentResponses(ctx.db, intent.intentId);
        const acceptedResponse = responses.find((r) => r.status === "accepted");
        const artifactInfo = acceptedResponse
          ? `Artifacts: ${acceptedResponse.artifactIds.length > 0 ? acceptedResponse.artifactIds.join(", ") : "none submitted"}\n   Review status: ${acceptedResponse.reviewStatus}`
          : "No accepted response found";

        return `${i + 1}. ${intent.title}\n   ID: ${intent.intentId}\n   Solver: ${intent.matchedSolverAddress}\n   Budget: ${intent.budgetWei || "none"} wei\n   ${artifactInfo}\n   Description: ${intent.description.slice(0, 200)}`;
      });

      return `${reviewIntents.length} intent(s) awaiting your review:\n\n${lines.join("\n\n")}\n\nUse action='approve' or action='request_revision' with intent_id to take action.`;
    }

    const intentId = args.intent_id as string;
    if (!intentId) {
      return "Error: intent_id is required for approve/request_revision.";
    }

    const intent = getIntent(ctx.db, intentId);
    if (!intent) {
      return `Error: Intent not found: ${intentId}`;
    }
    if (intent.status !== "review") {
      return `Error: Intent ${intentId} is not in review status (current: ${intent.status}).`;
    }
    if (
      intent.publisherAddress.toLowerCase() !==
      ctx.identity.address.toLowerCase()
    ) {
      return "Error: Only the intent publisher can review artifacts.";
    }

    if (action === "approve") {
      try {
        const result = approveIntentCompletion(ctx.db, {
          intentId,
          actorAddress: ctx.identity.address,
        });

        let msg = `Intent ${intentId} approved and completed.\n\nIntent: ${result.intent.title}\nSolver: ${result.intent.matchedSolverAddress}\nCompleted at: ${result.intent.completedAt}`;
        if (result.settlementProposalId) {
          msg += `\nSettlement proposal ID: ${result.settlementProposalId} (will require governance approval for treasury spend)`;
        }
        return msg;
      } catch (err: any) {
        return `Error approving intent: ${err.message}`;
      }
    }

    if (action === "request_revision") {
      const note = args.revision_note as string;
      if (!note) {
        return "Error: revision_note is required when requesting a revision.";
      }

      try {
        const result = requestIntentRevision(ctx.db, {
          intentId,
          actorAddress: ctx.identity.address,
          note,
        });

        return `Revision requested for intent ${intentId}.\n\nIntent: ${result.title}\nSolver: ${result.matchedSolverAddress}\nNew status: ${result.status}\nRevision note: ${note}`;
      } catch (err: any) {
        return `Error requesting revision: ${err.message}`;
      }
    }

    return `Unknown action: ${action}. Use 'list', 'approve', or 'request_revision'.`;
  },
};

// ─── Tool 4: MetaWorld Treasury Executor ──────────────────────────

export const metaworldExecutePendingSpendsTool: OpenFoxTool = {
  name: "metaworld_execute_pending_spends",
  description:
    "Find approved governance spend proposals awaiting execution, verify treasury balance and budget constraints, and execute the spend. Shows treasury status and pending proposals.",
  category: "metaworld",
  riskLevel: "caution",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "execute"],
        description:
          "Action: 'list' to show approved spend proposals and treasury status, 'execute' to execute a specific proposal.",
      },
      group_id: {
        type: "string",
        description: "Group ID to check (required).",
      },
      proposal_id: {
        type: "string",
        description: "Proposal ID to execute (required for 'execute' action).",
      },
    },
    required: ["action", "group_id"],
  },
  execute: async (args, ctx) => {
    const action = args.action as string;
    const groupId = args.group_id as string;

    // Get treasury status
    const treasury = getGroupTreasury(ctx.db, groupId);
    if (!treasury) {
      return `No treasury found for group: ${groupId}`;
    }

    if (action === "list") {
      const approvedProposals = listGovernanceProposals(
        ctx.db,
        groupId,
        "approved",
      );
      const spendProposals = approvedProposals.filter(
        (p) => p.proposalType === "spend",
      );

      const budgets = listBudgetLines(ctx.db, groupId);
      const budgetSummary = budgets
        .map(
          (b) =>
            `  ${b.lineName}: spent=${b.spentWei}/${b.capWei} wei (${b.period})`,
        )
        .join("\n");

      let msg = `Treasury status for group ${groupId}:\n`;
      msg += `  Balance: ${treasury.balanceWei} wei\n`;
      msg += `  Status: ${treasury.status}\n`;
      msg += `  Budget lines:\n${budgetSummary || "    (none)"}\n\n`;

      if (spendProposals.length === 0) {
        msg += "No approved spend proposals awaiting execution.";
        return msg;
      }

      const lines = spendProposals.map((p, i) => {
        const amount = (p.params.amountWei as string) || "unknown";
        const recipient = (p.params.recipient as string) || "unknown";
        const budgetLine = (p.params.budgetLine as string) || "default";
        return `${i + 1}. ${p.title}\n   Proposal ID: ${p.proposalId}\n   Amount: ${amount} wei\n   Recipient: ${recipient}\n   Budget line: ${budgetLine}\n   Votes: ${p.votesApprove} approve / ${p.votesReject} reject\n   Approved at: ${p.updatedAt}`;
      });

      msg += `${spendProposals.length} approved spend proposal(s):\n\n${lines.join("\n\n")}\n\nUse action='execute' with proposal_id to execute a spend.`;
      return msg;
    }

    if (action === "execute") {
      const proposalId = args.proposal_id as string;
      if (!proposalId) {
        return "Error: proposal_id is required for 'execute' action.";
      }

      if (treasury.status !== "active") {
        return `Error: Treasury is ${treasury.status}. Cannot execute spends on a non-active treasury.`;
      }

      const proposal = getGovernanceProposal(ctx.db, proposalId);
      if (!proposal) {
        return `Error: Proposal not found: ${proposalId}`;
      }
      if (proposal.status !== "approved") {
        return `Error: Proposal ${proposalId} is not approved (status: ${proposal.status}).`;
      }
      if (proposal.proposalType !== "spend") {
        return `Error: Proposal ${proposalId} is not a spend proposal (type: ${proposal.proposalType}).`;
      }

      const amountWei = (proposal.params.amountWei as string) || "0";
      const recipient = (proposal.params.recipient as string) || "";
      const budgetLine = (proposal.params.budgetLine as string) || "default";

      // Validate budget
      const validation = validateSpendBudget(
        ctx.db,
        groupId,
        budgetLine,
        amountWei,
      );
      if (!validation.valid) {
        return `Error: Spend validation failed: ${validation.reason}`;
      }

      try {
        // Record the treasury outflow
        const logEntry = recordTreasuryOutflow(
          ctx.db,
          groupId,
          amountWei,
          recipient,
          budgetLine,
          proposalId,
          undefined,
          `Governance proposal execution: ${proposal.title}`,
        );

        // Mark the proposal as executed
        const account = await getWalletAccount();
        const executedProposal = await executeApprovedProposal(ctx.db, {
          account,
          proposalId,
          actorAddress: ctx.identity.address,
        });

        return `Spend executed successfully.\n\nProposal: ${executedProposal.title}\nAmount: ${amountWei} wei\nRecipient: ${recipient}\nBudget line: ${budgetLine}\nTreasury log ID: ${logEntry.logId}\nNew treasury balance: ${(BigInt(treasury.balanceWei) - BigInt(amountWei)).toString()} wei`;
      } catch (err: any) {
        return `Error executing spend: ${err.message}`;
      }
    }

    return `Unknown action: ${action}. Use 'list' or 'execute'.`;
  },
};

// ─── Tool 5: MetaWorld Governance Voter ───────────────────────────

export const metaworldVoteOnProposalsTool: OpenFoxTool = {
  name: "metaworld_vote_on_proposals",
  description:
    "Review active governance proposals in your groups, analyze their merit and budget impact, and cast an informed vote with reasoning.",
  category: "metaworld",
  riskLevel: "caution",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "detail", "vote"],
        description:
          "Action: 'list' to show active proposals, 'detail' to see full proposal with votes, 'vote' to cast your vote.",
      },
      group_id: {
        type: "string",
        description:
          "Group ID to check. If omitted for 'list', shows proposals across all your groups.",
      },
      proposal_id: {
        type: "string",
        description: "Proposal ID (required for 'detail' and 'vote').",
      },
      vote: {
        type: "string",
        enum: ["approve", "reject"],
        description: "Your vote (required for 'vote' action).",
      },
      reason: {
        type: "string",
        description:
          "Reasoning for your vote. Always provide a reason for audit trail.",
      },
    },
    required: ["action"],
  },
  execute: async (args, ctx) => {
    const action = args.action as string;

    if (action === "list") {
      const groupId = args.group_id as string | undefined;
      const groupIds = groupId ? [groupId] : listFoxGroups(ctx);

      if (groupIds.length === 0) {
        return "You are not a member of any groups.";
      }

      const allProposals: Array<{
        groupId: string;
        proposals: ReturnType<typeof listGovernanceProposals>;
      }> = [];

      for (const gid of groupIds) {
        const proposals = listGovernanceProposals(ctx.db, gid, "active");
        if (proposals.length > 0) {
          allProposals.push({ groupId: gid, proposals });
        }
      }

      if (allProposals.length === 0) {
        return `No active governance proposals found in ${groupIds.length} group(s).`;
      }

      const sections = allProposals.map((entry) => {
        const lines = entry.proposals.map((p, i) => {
          const treasury = getGroupTreasury(ctx.db, entry.groupId);
          let budgetImpact = "";
          if (p.proposalType === "spend" && p.params.amountWei && treasury) {
            const pct =
              (Number(BigInt(p.params.amountWei as string) * 100n) /
                Number(BigInt(treasury.balanceWei) || 1n));
            budgetImpact = ` (${pct.toFixed(1)}% of treasury)`;
          }

          return `  ${i + 1}. [${p.proposalType}] ${p.title}\n     ID: ${p.proposalId}\n     Proposer: ${p.proposerAddress}\n     Votes: ${p.votesApprove}/${p.votesTotal} approve (need ${p.thresholdNumerator}/${p.thresholdDenominator})${budgetImpact}\n     Expires: ${p.expiresAt}`;
        });

        return `Group ${entry.groupId}:\n${lines.join("\n")}`;
      });

      const totalCount = allProposals.reduce(
        (sum, e) => sum + e.proposals.length,
        0,
      );
      return `${totalCount} active proposal(s) across ${allProposals.length} group(s):\n\n${sections.join("\n\n")}\n\nUse action='detail' with proposal_id for full information, or action='vote' to cast your vote.`;
    }

    if (action === "detail") {
      const proposalId = args.proposal_id as string;
      if (!proposalId) {
        return "Error: proposal_id is required for 'detail' action.";
      }

      const result = getGovernanceProposalWithVotes(ctx.db, proposalId);
      if (!result) {
        return `Error: Proposal not found: ${proposalId}`;
      }

      const { proposal, votes } = result;
      const voteLines = votes.map(
        (v) =>
          `  ${v.voterAddress}: ${v.vote}${v.reason ? ` — "${v.reason}"` : ""}`,
      );

      let treasuryInfo = "";
      if (proposal.proposalType === "spend") {
        const treasury = getGroupTreasury(ctx.db, proposal.groupId);
        if (treasury) {
          treasuryInfo = `\nTreasury balance: ${treasury.balanceWei} wei\nSpend amount: ${(proposal.params.amountWei as string) || "unknown"} wei\nRecipient: ${(proposal.params.recipient as string) || "unknown"}`;
        }
      }

      // Check if this Fox has already voted
      const myVote = votes.find(
        (v) =>
          v.voterAddress.toLowerCase() === ctx.identity.address.toLowerCase(),
      );

      return `Proposal detail:\n\nID: ${proposal.proposalId}\nType: ${proposal.proposalType}\nTitle: ${proposal.title}\nDescription: ${proposal.description}\nProposer: ${proposal.proposerAddress}\nStatus: ${proposal.status}\nVotes: ${proposal.votesApprove} approve / ${proposal.votesReject} reject (${proposal.votesTotal} total)\nQuorum: ${proposal.quorum}\nThreshold: ${proposal.thresholdNumerator}/${proposal.thresholdDenominator}\nExpires: ${proposal.expiresAt}${treasuryInfo}\nParams: ${JSON.stringify(proposal.params)}\n\nVotes cast:\n${voteLines.length > 0 ? voteLines.join("\n") : "  (no votes yet)"}\n\nYour vote: ${myVote ? `${myVote.vote} — "${myVote.reason || ""}"` : "not yet voted"}`;
    }

    if (action === "vote") {
      const proposalId = args.proposal_id as string;
      const vote = args.vote as GovernanceVote;
      const reason = (args.reason as string) || "";

      if (!proposalId) {
        return "Error: proposal_id is required for 'vote' action.";
      }
      if (!vote || (vote !== "approve" && vote !== "reject")) {
        return "Error: vote must be 'approve' or 'reject'.";
      }

      try {
        const account = await getWalletAccount();
        const result = await voteOnProposal(ctx.db, {
          account,
          proposalId,
          voterAddress: ctx.identity.address,
          vote,
          reason,
        });

        let msg = `Vote cast successfully.\n\nProposal: ${result.proposal.title}\nYour vote: ${vote}\nReason: ${reason || "(none provided)"}\nVote tally: ${result.proposal.votesApprove} approve / ${result.proposal.votesReject} reject\nProposal status: ${result.proposal.status}`;

        if (result.proposal.status === "approved") {
          msg +=
            "\n\nThe proposal has been AUTO-APPROVED (quorum + threshold met).";
        } else if (result.proposal.status === "rejected") {
          msg +=
            "\n\nThe proposal has been AUTO-REJECTED (approval mathematically impossible).";
        }

        return msg;
      } catch (err: any) {
        return `Error casting vote: ${err.message}`;
      }
    }

    return `Unknown action: ${action}. Use 'list', 'detail', or 'vote'.`;
  },
};

// ─── Export all MetaWorld economic tools ───────────────────────────

export function createMetaWorldEconomicTools(): OpenFoxTool[] {
  return [
    metaworldScoutOpportunitiesTool,
    metaworldFindMatchingIntentsTool,
    metaworldReviewArtifactsTool,
    metaworldExecutePendingSpendsTool,
    metaworldVoteOnProposalsTool,
  ];
}
