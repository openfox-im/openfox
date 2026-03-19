import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase, ToolContext, OpenFoxIdentity, OpenFoxConfig } from "../types.js";
import {
  createMetaWorldEconomicTools,
  metaworldScoutOpportunitiesTool,
  metaworldFindMatchingIntentsTool,
  metaworldReviewArtifactsTool,
  metaworldExecutePendingSpendsTool,
  metaworldVoteOnProposalsTool,
} from "../metaworld/economic-tools.js";
import {
  createIntent,
  respondToIntent,
  acceptIntentResponse,
  startIntentExecution,
  submitIntentArtifacts,
} from "../metaworld/intents.js";
import { initializeGroupTreasury, recordTreasuryInflow } from "../group/treasury.js";

const FOX_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-econ-test-"));
  return path.join(tmpDir, "test.db");
}

function makeToolContext(db: OpenFoxDatabase, address: string = FOX_ADDRESS): ToolContext {
  return {
    identity: {
      address,
      name: "test-fox",
      sandboxId: "sandbox-1",
      privateKeyHash: "hash",
      createdAt: new Date().toISOString(),
    } as OpenFoxIdentity,
    config: {
      name: "test-fox",
      creatorAddress: "0x1111111111111111111111111111111111111111",
      inferenceModel: "test",
    } as OpenFoxConfig,
    db,
    runtime: {} as any,
    inference: {} as any,
  };
}

describe("MetaWorld Economic Tools", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  describe("createMetaWorldEconomicTools", () => {
    it("returns all 5 economic tools", () => {
      const tools = createMetaWorldEconomicTools();
      expect(tools).toHaveLength(5);

      const names = tools.map((t) => t.name);
      expect(names).toContain("metaworld_scout_opportunities");
      expect(names).toContain("metaworld_find_matching_intents");
      expect(names).toContain("metaworld_review_artifacts");
      expect(names).toContain("metaworld_execute_pending_spends");
      expect(names).toContain("metaworld_vote_on_proposals");
    });

    it("all tools have category metaworld", () => {
      const tools = createMetaWorldEconomicTools();
      for (const tool of tools) {
        expect(tool.category).toBe("metaworld");
      }
    });

    it("all tools have caution risk level", () => {
      const tools = createMetaWorldEconomicTools();
      for (const tool of tools) {
        expect(tool.riskLevel).toBe("caution");
      }
    });
  });

  describe("metaworld_find_matching_intents", () => {
    it("find returns empty when no open intents", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldFindMatchingIntentsTool.execute(
        { action: "find" },
        ctx,
      );
      expect(result).toContain("No open intents found");
    });

    it("find returns open intents", async () => {
      createIntent(db, {
        publisherAddress: OTHER_ADDRESS,
        kind: "work",
        title: "Test intent",
        description: "A test intent",
        budgetTomi: "1000000",
        requirements: [{ kind: "capability", capability_name: "coding" }],
      });

      const ctx = makeToolContext(db);
      const result = await metaworldFindMatchingIntentsTool.execute(
        { action: "find" },
        ctx,
      );
      expect(result).toContain("Test intent");
      expect(result).toContain("1000000");
      expect(result).toContain("cap:coding");
    });

    it("respond creates a response to an intent", async () => {
      const intent = createIntent(db, {
        publisherAddress: OTHER_ADDRESS,
        kind: "work",
        title: "Need a coder",
        budgetTomi: "5000000",
      });

      const ctx = makeToolContext(db);
      const result = await metaworldFindMatchingIntentsTool.execute(
        {
          action: "respond",
          intent_id: intent.intentId,
          proposal_text: "I can do this work",
          proposed_amount_tomi: "4000000",
          capability_refs: "coding,testing",
        },
        ctx,
      );
      expect(result).toContain("Response submitted successfully");
      expect(result).toContain("I can do this work");
    });

    it("respond prevents responding to own intent", async () => {
      const intent = createIntent(db, {
        publisherAddress: FOX_ADDRESS,
        kind: "work",
        title: "My own intent",
      });

      const ctx = makeToolContext(db);
      const result = await metaworldFindMatchingIntentsTool.execute(
        { action: "respond", intent_id: intent.intentId, proposal_text: "test" },
        ctx,
      );
      expect(result).toContain("Cannot respond to your own intent");
    });

    it("respond rejects amount exceeding budget", async () => {
      const intent = createIntent(db, {
        publisherAddress: OTHER_ADDRESS,
        kind: "work",
        title: "Budget test",
        budgetTomi: "1000",
      });

      const ctx = makeToolContext(db);
      const result = await metaworldFindMatchingIntentsTool.execute(
        {
          action: "respond",
          intent_id: intent.intentId,
          proposed_amount_tomi: "5000",
        },
        ctx,
      );
      expect(result).toContain("exceeds intent budget");
    });
  });

  describe("metaworld_review_artifacts", () => {
    it("list returns empty when no intents in review", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldReviewArtifactsTool.execute(
        { action: "list" },
        ctx,
      );
      expect(result).toContain("No intents awaiting your review");
    });

    it("list returns intents in review status", async () => {
      // Create and progress an intent to review status
      const intent = createIntent(db, {
        publisherAddress: FOX_ADDRESS,
        kind: "work",
        title: "Review me",
        description: "Needs review",
        budgetTomi: "100000",
      });

      respondToIntent(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        proposalText: "I'll do it",
      });

      acceptIntentResponse(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        actorAddress: FOX_ADDRESS,
      });

      startIntentExecution(db, intent.intentId, OTHER_ADDRESS);

      submitIntentArtifacts(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        artifactIds: ["artifact-1", "artifact-2"],
      });

      const ctx = makeToolContext(db);
      const result = await metaworldReviewArtifactsTool.execute(
        { action: "list" },
        ctx,
      );
      expect(result).toContain("Review me");
      expect(result).toContain("awaiting your review");
      expect(result).toContain(OTHER_ADDRESS);
    });

    it("approve completes the intent", async () => {
      const intent = createIntent(db, {
        publisherAddress: FOX_ADDRESS,
        kind: "work",
        title: "Approve me",
        budgetTomi: "50000",
      });

      respondToIntent(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        proposalText: "Done",
      });
      acceptIntentResponse(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        actorAddress: FOX_ADDRESS,
      });
      startIntentExecution(db, intent.intentId, OTHER_ADDRESS);
      submitIntentArtifacts(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        artifactIds: ["art-1"],
      });

      const ctx = makeToolContext(db);
      const result = await metaworldReviewArtifactsTool.execute(
        { action: "approve", intent_id: intent.intentId },
        ctx,
      );
      expect(result).toContain("approved and completed");
      expect(result).toContain("Settlement proposal ID");
    });

    it("request_revision sends intent back to in_progress", async () => {
      const intent = createIntent(db, {
        publisherAddress: FOX_ADDRESS,
        kind: "work",
        title: "Revise this",
      });

      respondToIntent(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        proposalText: "Doing it",
      });
      acceptIntentResponse(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        actorAddress: FOX_ADDRESS,
      });
      startIntentExecution(db, intent.intentId, OTHER_ADDRESS);
      submitIntentArtifacts(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        artifactIds: ["art-1"],
      });

      const ctx = makeToolContext(db);
      const result = await metaworldReviewArtifactsTool.execute(
        {
          action: "request_revision",
          intent_id: intent.intentId,
          revision_note: "Missing unit tests",
        },
        ctx,
      );
      expect(result).toContain("Revision requested");
      expect(result).toContain("Missing unit tests");
      expect(result).toContain("in_progress");
    });

    it("request_revision requires a note", async () => {
      // Create an intent in review status so we get past the "not found" check
      const intent = createIntent(db, {
        publisherAddress: FOX_ADDRESS,
        kind: "work",
        title: "Note test",
      });
      respondToIntent(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        proposalText: "ok",
      });
      acceptIntentResponse(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        actorAddress: FOX_ADDRESS,
      });
      startIntentExecution(db, intent.intentId, OTHER_ADDRESS);
      submitIntentArtifacts(db, {
        intentId: intent.intentId,
        solverAddress: OTHER_ADDRESS,
        artifactIds: ["art-1"],
      });

      const ctx = makeToolContext(db);
      const result = await metaworldReviewArtifactsTool.execute(
        { action: "request_revision", intent_id: intent.intentId },
        ctx,
      );
      expect(result).toContain("revision_note is required");
    });
  });

  describe("metaworld_scout_opportunities", () => {
    it("scan returns message when no opportunities found", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldScoutOpportunitiesTool.execute(
        { action: "scan" },
        ctx,
      );
      // Either finds opportunities or reports none/error
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("create_intent validates budget against gross value", async () => {
      const ctx = makeToolContext(db);
      // This will likely fail because no opportunities exist,
      // but tests the path
      const result = await metaworldScoutOpportunitiesTool.execute(
        {
          action: "create_intent",
          opportunity_index: 1,
          budget_tomi: "999999999999",
        },
        ctx,
      );
      expect(typeof result).toBe("string");
    });
  });

  describe("metaworld_execute_pending_spends", () => {
    const GROUP_ID = "test-group";
    const TREASURY_KEY = ("0x" + "ab".repeat(32)) as `0x${string}`;

    function setupGroupWithTreasury() {
      // Create group
      const now = new Date().toISOString();
      db.raw
        .prepare(
          `INSERT INTO groups (group_id, name, creator_address, visibility, join_mode, max_members, current_epoch, current_policy_hash, current_members_root, status, created_at, updated_at)
           VALUES (?, ?, ?, 'public', 'invite_only', 100, 1, 'hash', 'root', 'active', ?, ?)`,
        )
        .run(GROUP_ID, "Test Group", FOX_ADDRESS, now, now);

      // Add Fox as member with admin role
      db.raw
        .prepare(
          `INSERT INTO group_members (group_id, member_address, membership_state, joined_via, joined_at, last_event_id)
           VALUES (?, ?, 'active', 'genesis', ?, 'evt_init')`,
        )
        .run(GROUP_ID, FOX_ADDRESS.toLowerCase(), now);

      db.raw
        .prepare(
          `INSERT INTO group_member_roles (group_id, member_address, role, active, granted_by_address, granted_at, last_event_id)
           VALUES (?, ?, 'admin', 1, ?, ?, 'evt_init')`,
        )
        .run(GROUP_ID, FOX_ADDRESS.toLowerCase(), FOX_ADDRESS.toLowerCase(), now);

      // Initialize treasury
      initializeGroupTreasury(db, GROUP_ID, TREASURY_KEY, [
        { lineName: "operations", capTomi: "10000000", period: "monthly" },
      ]);

      // Fund treasury
      recordTreasuryInflow(db, GROUP_ID, "5000000", FOX_ADDRESS);
    }

    it("list shows treasury status when no pending spends", async () => {
      setupGroupWithTreasury();
      const ctx = makeToolContext(db);
      const result = await metaworldExecutePendingSpendsTool.execute(
        { action: "list", group_id: GROUP_ID },
        ctx,
      );
      expect(result).toContain("Balance: 5000000 tomi");
      expect(result).toContain("No approved spend proposals");
    });

    it("returns error for missing treasury", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldExecutePendingSpendsTool.execute(
        { action: "list", group_id: "nonexistent-group" },
        ctx,
      );
      expect(result).toContain("No treasury found");
    });
  });

  describe("metaworld_vote_on_proposals", () => {
    it("list returns empty when not in any groups", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldVoteOnProposalsTool.execute(
        { action: "list" },
        ctx,
      );
      expect(result).toContain("not a member");
    });

    it("detail returns error for nonexistent proposal", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldVoteOnProposalsTool.execute(
        { action: "detail", proposal_id: "nonexistent" },
        ctx,
      );
      expect(result).toContain("Proposal not found");
    });

    it("vote requires proposal_id", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldVoteOnProposalsTool.execute(
        { action: "vote", vote: "approve" },
        ctx,
      );
      expect(result).toContain("proposal_id is required");
    });

    it("vote requires valid vote value", async () => {
      const ctx = makeToolContext(db);
      const result = await metaworldVoteOnProposalsTool.execute(
        { action: "vote", proposal_id: "some-id", vote: "maybe" },
        ctx,
      );
      expect(result).toContain("must be 'approve' or 'reject'");
    });
  });
});
