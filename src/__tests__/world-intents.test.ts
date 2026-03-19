import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  createIntent,
  getIntent,
  listIntents,
  respondToIntent,
  listIntentResponses,
  acceptIntentResponse,
  startIntentExecution,
  submitIntentArtifacts,
  approveIntentCompletion,
  requestIntentRevision,
  cancelIntent,
  expireStaleIntents,
  type IntentKind,
} from "../metaworld/intents.js";

const PUBLISHER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOLVER_A = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SOLVER_B = "0xcccccccccccccccccccccccccccccccccccccccc";
const OTHER = "0xdddddddddddddddddddddddddddddddddddddddd";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-intents-test-"));
  return path.join(tmpDir, "test.db");
}

describe("world intents", () => {
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

  it("create intent returns record with status open", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Build a widget",
      description: "We need a fancy widget built.",
    });

    expect(intent.intentId).toBeTruthy();
    expect(intent.status).toBe("open");
    expect(intent.publisherAddress).toBe(PUBLISHER);
    expect(intent.kind).toBe("work");
    expect(intent.title).toBe("Build a widget");
    expect(intent.description).toBe("We need a fancy widget built.");
    expect(intent.groupId).toBeNull();
    expect(intent.budgetToken).toBe("TOS");
    expect(intent.expiresAt).toBeTruthy();
    expect(intent.createdAt).toBeTruthy();
  });

  it("create intent with group sets groupId", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      groupId: "group-123",
      kind: "collaboration",
      title: "Group project",
    });

    expect(intent.groupId).toBe("group-123");
  });

  it("list intents by kind filters correctly", () => {
    createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Work intent",
    });
    createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "opportunity",
      title: "Opp intent",
    });
    createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Another work",
    });

    const workIntents = listIntents(db, { kind: "work" });
    expect(workIntents).toHaveLength(2);
    expect(workIntents.every((i) => i.kind === "work")).toBe(true);

    const oppIntents = listIntents(db, { kind: "opportunity" });
    expect(oppIntents).toHaveLength(1);
    expect(oppIntents[0].title).toBe("Opp intent");

    const allIntents = listIntents(db);
    expect(allIntents).toHaveLength(3);
  });

  it("respond to intent creates response", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Need help",
    });

    const response = respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "I can help!",
      proposedAmountTomi: "5000",
    });

    expect(response.responseId).toBeTruthy();
    expect(response.intentId).toBe(intent.intentId);
    expect(response.solverAddress).toBe(SOLVER_A);
    expect(response.proposalText).toBe("I can help!");
    expect(response.proposedAmountTomi).toBe("5000");
    expect(response.status).toBe("pending");
  });

  it("respond to non-open intent throws", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "To be cancelled",
    });

    cancelIntent(db, { intentId: intent.intentId, actorAddress: PUBLISHER });

    expect(() =>
      respondToIntent(db, {
        intentId: intent.intentId,
        solverAddress: SOLVER_A,
        proposalText: "Too late",
      }),
    ).toThrow("Cannot respond to intent with status: cancelled");
  });

  it("duplicate response from same solver throws", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "One response only",
    });

    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "First try",
    });

    expect(() =>
      respondToIntent(db, {
        intentId: intent.intentId,
        solverAddress: SOLVER_A,
        proposalText: "Second try",
      }),
    ).toThrow("already responded");
  });

  it("accept response sets matched solver and rejects others", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Choose a solver",
    });

    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "Solver A",
    });
    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_B,
      proposalText: "Solver B",
    });

    const matched = acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      actorAddress: PUBLISHER,
    });

    expect(matched.status).toBe("matched");
    expect(matched.matchedSolverAddress).toBe(SOLVER_A);
    expect(matched.matchedAt).toBeTruthy();

    const responses = listIntentResponses(db, intent.intentId);
    const solverAResponse = responses.find((r) => r.solverAddress === SOLVER_A);
    const solverBResponse = responses.find((r) => r.solverAddress === SOLVER_B);
    expect(solverAResponse?.status).toBe("accepted");
    expect(solverBResponse?.status).toBe("rejected");
  });

  it("start execution transitions to in_progress", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Execute me",
    });
    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "On it",
    });
    acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      actorAddress: PUBLISHER,
    });

    const started = startIntentExecution(db, intent.intentId, SOLVER_A);
    expect(started.status).toBe("in_progress");
  });

  it("submit artifacts transitions to review", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Submit artifacts",
    });
    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "Will deliver",
    });
    acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      actorAddress: PUBLISHER,
    });
    startIntentExecution(db, intent.intentId, SOLVER_A);

    const reviewed = submitIntentArtifacts(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      artifactIds: ["artifact-1", "artifact-2"],
    });

    expect(reviewed.status).toBe("review");

    const responses = listIntentResponses(db, intent.intentId);
    const response = responses.find((r) => r.solverAddress === SOLVER_A)!;
    expect(response.artifactIds).toEqual(["artifact-1", "artifact-2"]);
    expect(response.reviewStatus).toBe("pending");
  });

  it("approve completion transitions to completed", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Complete me",
      budgetTomi: "10000",
    });
    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "Done",
    });
    acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      actorAddress: PUBLISHER,
    });
    startIntentExecution(db, intent.intentId, SOLVER_A);
    submitIntentArtifacts(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      artifactIds: ["a1"],
    });

    const result = approveIntentCompletion(db, {
      intentId: intent.intentId,
      actorAddress: PUBLISHER,
    });

    expect(result.intent.status).toBe("completed");
    expect(result.intent.completedAt).toBeTruthy();
    expect(result.settlementProposalId).toBeTruthy();
  });

  it("request revision transitions back to in_progress", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Revise this",
    });
    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "First draft",
    });
    acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      actorAddress: PUBLISHER,
    });
    startIntentExecution(db, intent.intentId, SOLVER_A);
    submitIntentArtifacts(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      artifactIds: ["draft-1"],
    });

    const revised = requestIntentRevision(db, {
      intentId: intent.intentId,
      actorAddress: PUBLISHER,
      note: "Please fix section 3",
    });

    expect(revised.status).toBe("in_progress");

    const responses = listIntentResponses(db, intent.intentId);
    const response = responses.find((r) => r.solverAddress === SOLVER_A)!;
    expect(response.reviewStatus).toBe("revision_requested");
    expect(response.reviewNote).toBe("Please fix section 3");
  });

  it("cancel intent transitions to cancelled", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "procurement",
      title: "Cancel me",
    });

    const cancelled = cancelIntent(db, {
      intentId: intent.intentId,
      actorAddress: PUBLISHER,
    });

    expect(cancelled.status).toBe("cancelled");
  });

  it("cancel by non-publisher throws", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Not yours to cancel",
    });

    expect(() =>
      cancelIntent(db, {
        intentId: intent.intentId,
        actorAddress: OTHER,
      }),
    ).toThrow("Only the intent publisher can cancel");
  });

  it("expire stale intents sweeps correctly", () => {
    // Create an intent that expired in the past
    const past = new Date(Date.now() - 1000).toISOString();
    db.raw
      .prepare(
        `INSERT INTO world_intents
          (intent_id, publisher_address, kind, title, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run("expired-intent-1", PUBLISHER, "work", "Old intent", past, past, past);

    // Create a response for it
    db.raw
      .prepare(
        `INSERT INTO world_intent_responses
          (response_id, intent_id, solver_address, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run("resp-1", "expired-intent-1", SOLVER_A, past, past);

    // Create a non-expired intent
    createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Still active",
    });

    const expired = expireStaleIntents(db);
    expect(expired).toBe(1);

    const expiredIntent = getIntent(db, "expired-intent-1");
    expect(expiredIntent?.status).toBe("expired");

    const activeIntents = listIntents(db, { status: "open" });
    expect(activeIntents).toHaveLength(1);
    expect(activeIntents[0].title).toBe("Still active");
  });

  it("full lifecycle: create -> respond -> accept -> start -> submit -> approve", () => {
    // 1. Create intent
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Full lifecycle test",
      description: "End-to-end intent lifecycle",
      budgetTomi: "50000",
      requirements: [
        { kind: "capability", capability_name: "coding" },
      ],
    });
    expect(intent.status).toBe("open");
    expect(intent.requirements).toHaveLength(1);

    // 2. Respond
    const response = respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      proposalText: "I'll do it for 40000",
      proposedAmountTomi: "40000",
      capabilityRefs: ["coding", "testing"],
    });
    expect(response.status).toBe("pending");
    expect(response.capabilityRefs).toEqual(["coding", "testing"]);

    // 3. Accept
    const matched = acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      actorAddress: PUBLISHER,
    });
    expect(matched.status).toBe("matched");
    expect(matched.matchedSolverAddress).toBe(SOLVER_A);

    // 4. Start execution
    const started = startIntentExecution(db, intent.intentId, SOLVER_A);
    expect(started.status).toBe("in_progress");

    // 5. Submit artifacts
    const submitted = submitIntentArtifacts(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER_A,
      artifactIds: ["final-artifact"],
    });
    expect(submitted.status).toBe("review");

    // 6. Approve completion
    const result = approveIntentCompletion(db, {
      intentId: intent.intentId,
      actorAddress: PUBLISHER,
    });
    expect(result.intent.status).toBe("completed");
    expect(result.intent.completedAt).toBeTruthy();
    expect(result.settlementProposalId).toBeTruthy();

    // Verify final response state
    const finalResponses = listIntentResponses(db, intent.intentId);
    expect(finalResponses).toHaveLength(1);
    expect(finalResponses[0].status).toBe("accepted");
    expect(finalResponses[0].reviewStatus).toBe("approved");
    expect(finalResponses[0].artifactIds).toEqual(["final-artifact"]);
  });
});
