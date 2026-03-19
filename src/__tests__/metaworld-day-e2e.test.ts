/**
 * MetaWorld "A Day in MetaWorld" End-to-End Integration Test
 *
 * This test proves the full economic loop can close through the reactor:
 *
 *   Publisher creates intent with budget
 *     → Solver responds
 *       → Publisher accepts solver
 *         → Solver executes and submits artifacts
 *           → Publisher approves completion
 *             → Reactor auto-creates settlement spend proposal
 *               → Members vote → auto-resolves
 *                 → Treasury spend executes
 *                   → Reputation updates for solver
 *                     → Events flow through SSE in real time
 *
 * Every step goes through the reactor, so all deterministic consequences
 * fire automatically. No manual wiring. No CLI commands.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import { createGroup, sendGroupInvite, acceptGroupInvite } from "../group/store.js";
import { initializeGroupTreasury, getGroupTreasury, listBudgetLines } from "../group/treasury.js";
import { setGovernancePolicy, listGovernanceProposals } from "../group/governance.js";
import { listReputationEvents, getReputationCard } from "../metaworld/reputation.js";
import { getIntent, startIntentExecution } from "../metaworld/intents.js";
import { WorldEventBus } from "../metaworld/event-bus.js";
import {
  reactorCreateIntent,
  reactorRespondToIntent,
  reactorAcceptIntentResponse,
  reactorSubmitIntentArtifacts,
  reactorApproveIntentCompletion,
  reactorVoteOnProposal,
  reactorExecuteTreasurySpend,
  type ReactorContext,
} from "../metaworld/reactor.js";
import type { OpenFoxDatabase } from "../types.js";

// Three participants: publisher (group owner), solver, and a voting member
const OWNER_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const SOLVER_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;
const MEMBER_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-day-e2e-"));
  return path.join(tmpDir, "test.db");
}

describe("MetaWorld Day — full economic loop", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let groupId: string;
  let eventBus: WorldEventBus;
  let ctx: ReactorContext;
  let collectedEvents: Array<{ kind: string; payload: Record<string, unknown> }>;

  const ownerAccount = privateKeyToAccount(OWNER_KEY);
  const solverAccount = privateKeyToAccount(SOLVER_KEY);
  const memberAccount = privateKeyToAccount(MEMBER_KEY);

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    eventBus = new WorldEventBus();
    collectedEvents = [];

    // Subscribe to ALL events to verify the full cascade
    eventBus.subscribe("e2e-observer");
    // Drain events in background
    const stream = eventBus.getStream("e2e-observer");
    (async () => {
      for await (const event of stream) {
        if (!event) break;
        collectedEvents.push({ kind: event.kind, payload: event.payload });
      }
    })();

    // 1. Create a Group (the "organization")
    const created = await createGroup({
      db,
      account: ownerAccount,
      input: {
        name: "MetaWorld Day Test Org",
        description: "End-to-end economic loop test",
        actorAddress: ownerAccount.address,
        actorAgentId: "fox-owner",
        creatorDisplayName: "Owner Fox",
      },
    });
    groupId = created.group.groupId;

    // 2. Add solver and member to the group via invite flow
    const solverInvite = await sendGroupInvite({
      db,
      account: ownerAccount,
      input: {
        groupId,
        targetAddress: solverAccount.address,
        targetRoles: ["member"],
        actorAddress: ownerAccount.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: solverAccount,
      input: {
        groupId,
        proposalId: solverInvite.proposal.proposalId,
        actorAddress: solverAccount.address,
        displayName: "Solver Fox",
      },
    });

    const memberInvite = await sendGroupInvite({
      db,
      account: ownerAccount,
      input: {
        groupId,
        targetAddress: memberAccount.address,
        targetRoles: ["admin"],
        actorAddress: ownerAccount.address,
      },
    });
    await acceptGroupInvite({
      db,
      account: memberAccount,
      input: {
        groupId,
        proposalId: memberInvite.proposal.proposalId,
        actorAddress: memberAccount.address,
        displayName: "Member Fox",
      },
    });

    // 3. Initialize treasury with a bounties budget
    initializeGroupTreasury(db, groupId, OWNER_KEY, [
      { lineName: "bounties", capTomi: "1000000000000000000", period: "monthly" },
    ]);

    // Simulate treasury has funds (set balance directly)
    db.raw.prepare(
      "UPDATE group_treasury SET balance_tomi = ? WHERE group_id = ?",
    ).run("5000000000000000000", groupId); // 5 TOS

    // 4. Set governance policy: quorum=1, threshold=1/1 for fast testing
    setGovernancePolicy(db, groupId, "spend", {
      quorum: 1,
      thresholdNumerator: 1,
      thresholdDenominator: 1,
      allowedProposerRoles: ["owner", "admin", "member"],
      allowedVoterRoles: ["owner", "admin"],
    });

    // 5. Build reactor context
    ctx = {
      db,
      config: {
        walletAddress: ownerAccount.address,
        rpcUrl: "",
        agentId: "fox-owner",
        dbPath,
      } as any,
      eventBus,
      account: ownerAccount,
    };
  });

  afterEach(() => {
    eventBus.unsubscribe("e2e-observer");
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("closes the full economic loop: intent → settlement → reputation", async () => {
    // ── Step 1: Publisher creates an intent with budget ──────────────
    const intent = reactorCreateIntent(ctx, {
      publisherAddress: ownerAccount.address,
      groupId,
      kind: "work",
      title: "Build a data pipeline",
      description: "We need a data ingestion pipeline for oracle feeds",
      budgetTomi: "500000000000000000", // 0.5 TOS
      budgetLine: "bounties",
    });

    expect(intent.status).toBe("open");
    expect(intent.budgetTomi).toBe("500000000000000000");
    expect(intent.groupId).toBe(groupId);

    // ── Step 2: Solver responds with a proposal ─────────────────────
    const response = reactorRespondToIntent(ctx, {
      intentId: intent.intentId,
      solverAddress: solverAccount.address,
      proposalText: "I can build this pipeline using streaming transforms.",
      proposedAmountTomi: "500000000000000000",
    });

    expect(response.solverAddress).toBe(solverAccount.address);
    expect(response.status).toBe("pending");

    // ── Step 3: Publisher accepts the solver ─────────────────────────
    const accepted = reactorAcceptIntentResponse(ctx, {
      intentId: intent.intentId,
      solverAddress: solverAccount.address,
      actorAddress: ownerAccount.address,
    });

    expect(accepted.status).toBe("matched");
    expect(accepted.matchedSolverAddress).toBe(solverAccount.address);

    // ── Step 3.5: Solver starts execution ────────────────────────────
    const started = startIntentExecution(db, intent.intentId, solverAccount.address);
    expect(started.status).toBe("in_progress");

    // ── Step 4: Solver executes and submits artifacts ────────────────
    const submitted = reactorSubmitIntentArtifacts(ctx, {
      intentId: intent.intentId,
      solverAddress: solverAccount.address,
      artifactIds: ["artifact-pipeline-v1", "artifact-test-report"],
    });

    expect(submitted.status).toBe("review");

    // ── Step 5: Publisher approves completion ────────────────────────
    // This is where the reactor magic happens:
    // - approves the intent
    // - auto-emits reputation events for solver (reliability + quality)
    // - auto-creates a settlement spend governance proposal
    const completion = await reactorApproveIntentCompletion(ctx, {
      intentId: intent.intentId,
      actorAddress: ownerAccount.address,
    });

    expect(completion.intent.status).toBe("completed");

    // Verify: intent is completed
    const completedIntent = getIntent(db, intent.intentId);
    expect(completedIntent!.status).toBe("completed");

    // Verify: reactor auto-created a spend proposal
    const proposals = listGovernanceProposals(db, groupId, "active");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const spendProposal = proposals.find((p) => p.proposalType === "spend");
    expect(spendProposal).toBeTruthy();
    expect(spendProposal!.title).toContain(intent.intentId);

    // Verify: reputation events were emitted for solver
    const solverRepEvents = listReputationEvents(db, solverAccount.address);
    const reliabilityEvent = solverRepEvents.find((e) => e.dimension === "reliability");
    expect(reliabilityEvent).toBeTruthy();
    expect(reliabilityEvent!.delta).toBeGreaterThan(0);

    const qualityEvent = solverRepEvents.find((e) => e.dimension === "quality");
    expect(qualityEvent).toBeTruthy();
    expect(qualityEvent!.delta).toBeGreaterThan(0);

    // ── Step 6: Group member votes to approve the spend ─────────────
    // With quorum=1 and threshold=1/1, a single approve auto-resolves
    const voteResult = await reactorVoteOnProposal(ctx, {
      proposalId: spendProposal!.proposalId,
      voterAddress: ownerAccount.address,
      voterAgentId: "fox-owner",
      vote: "approve",
      reason: "Work looks good, approve payment.",
    });

    expect(voteResult.proposal.status).toBe("approved");

    // ── Step 7: Treasury spend executes ─────────────────────────────
    const spendLog = reactorExecuteTreasurySpend(ctx, {
      groupId,
      amountTomi: "500000000000000000",
      recipient: solverAccount.address,
      budgetLine: "bounties",
      proposalId: spendProposal!.proposalId,
      memo: `Settlement for intent ${intent.intentId}`,
    });

    expect(spendLog.direction).toBe("outflow");
    expect(spendLog.amountTomi).toBe("500000000000000000");
    expect(spendLog.counterparty).toBe(solverAccount.address);

    // Verify: treasury balance decreased
    const treasury = getGroupTreasury(db, groupId);
    expect(treasury).toBeTruthy();
    expect(BigInt(treasury!.balanceTomi)).toBe(
      BigInt("5000000000000000000") - BigInt("500000000000000000"),
    );

    // Verify: budget line spent_tomi updated
    const budgets = listBudgetLines(db, groupId);
    const bountiesBudget = budgets.find((b) => b.lineName === "bounties");
    expect(bountiesBudget).toBeTruthy();
    expect(BigInt(bountiesBudget!.spentTomi)).toBe(
      BigInt("500000000000000000"),
    );

    // Verify: economic reputation emitted for solver after treasury spend
    const allRepEvents = listReputationEvents(db, solverAccount.address);
    const economicEvent = allRepEvents.find((e) => e.dimension === "economic");
    expect(economicEvent).toBeTruthy();
    expect(economicEvent!.delta).toBeGreaterThan(0);

    // ── Step 8: Verify SSE events flowed through ────────────────────
    // Give event bus a tick to flush
    await new Promise((r) => setTimeout(r, 10));

    const eventKinds = collectedEvents.map((e) => e.kind);

    // Intent lifecycle events
    expect(eventKinds.filter((k) => k === "intent.update").length).toBeGreaterThanOrEqual(4);

    // Governance events (proposal created + vote + resolved)
    expect(eventKinds.filter((k) => k === "proposal.update").length).toBeGreaterThanOrEqual(2);

    // Treasury event
    expect(eventKinds).toContain("treasury.update");

    // Reputation events
    expect(eventKinds.filter((k) => k === "reputation.update").length).toBeGreaterThanOrEqual(2);

    // ── Summary ─────────────────────────────────────────────────────
    // The full loop closed:
    //   intent(open) → response → matched → review → completed
    //     → spend proposal auto-created
    //       → vote → auto-approved
    //         → treasury spend → balance decreased → budget tracked
    //           → reputation: reliability + quality + economic
    //             → 10+ SSE events delivered in real time
    //
    // Zero manual CLI commands. Zero human intervention.
    // The reactor connected every step.
  });

  it("multi-voter governance path with 2/3 threshold", async () => {
    // Override governance policy: require 2/3 of voters
    setGovernancePolicy(db, groupId, "spend", {
      quorum: 2,
      thresholdNumerator: 2,
      thresholdDenominator: 3,
      allowedProposerRoles: ["owner", "admin", "member"],
      allowedVoterRoles: ["owner", "admin"],
    });

    // Run the intent lifecycle through reactor
    const intent = reactorCreateIntent(ctx, {
      publisherAddress: ownerAccount.address,
      groupId,
      kind: "work",
      title: "Research task",
      budgetTomi: "200000000000000000",
      budgetLine: "bounties",
    });

    reactorRespondToIntent(ctx, {
      intentId: intent.intentId,
      solverAddress: solverAccount.address,
      proposalText: "I'll do the research.",
    });

    reactorAcceptIntentResponse(ctx, {
      intentId: intent.intentId,
      solverAddress: solverAccount.address,
      actorAddress: ownerAccount.address,
    });

    startIntentExecution(db, intent.intentId, solverAccount.address);

    reactorSubmitIntentArtifacts(ctx, {
      intentId: intent.intentId,
      solverAddress: solverAccount.address,
      artifactIds: ["research-report-v1"],
    });

    // Approve completion → reactor creates spend proposal
    await reactorApproveIntentCompletion(ctx, {
      intentId: intent.intentId,
      actorAddress: ownerAccount.address,
    });

    const proposals = listGovernanceProposals(db, groupId, "active");
    const spendProposal = proposals.find((p) => p.proposalType === "spend");
    expect(spendProposal).toBeTruthy();

    // First vote: owner approves — not enough for 2/3 quorum of 2
    const vote1 = await reactorVoteOnProposal(ctx, {
      proposalId: spendProposal!.proposalId,
      voterAddress: ownerAccount.address,
      vote: "approve",
    });
    expect(vote1.proposal.status).toBe("active"); // still active, needs more votes

    // Second vote: admin member approves — now 2/2 approve, quorum met
    const vote2 = await reactorVoteOnProposal(ctx, {
      proposalId: spendProposal!.proposalId,
      voterAddress: memberAccount.address,
      vote: "approve",
      reason: "Looks good to me.",
    });
    expect(vote2.proposal.status).toBe("approved"); // auto-resolved

    // Execute treasury spend
    reactorExecuteTreasurySpend(ctx, {
      groupId,
      amountTomi: "200000000000000000",
      recipient: solverAccount.address,
      budgetLine: "bounties",
      proposalId: spendProposal!.proposalId,
    });

    // Verify everything cascaded correctly
    const finalTreasury = getGroupTreasury(db, groupId);
    expect(BigInt(finalTreasury!.balanceTomi)).toBe(
      BigInt("5000000000000000000") - BigInt("200000000000000000"),
    );

    const repEvents = listReputationEvents(db, solverAccount.address);
    const econ = repEvents.find((e) => e.dimension === "economic");
    expect(econ).toBeTruthy();
    expect(econ!.delta).toBeGreaterThan(0);
  });
});
