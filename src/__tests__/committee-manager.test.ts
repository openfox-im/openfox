import { describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import { createCommitteeManager } from "../committee/manager.js";

describe("committee manager", () => {
  it("persists committee runs, tallies quorum, and allocates payouts deterministically", () => {
    const db = createTestDb();
    const manager = createCommitteeManager(db);
    const run = manager.createRun({
      kind: "evidence",
      title: "Verify Times headline",
      question: "Is the captured headline valid?",
      subjectRef: "artifact://capture/1",
      artifactIds: ["artifact://capture/1"],
      committeeSize: 3,
      thresholdM: 2,
      payoutTotalTomi: "9",
      members: [
        { memberId: "agent-a", payoutAddress: "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143" },
        { memberId: "agent-b", payoutAddress: "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2" },
        { memberId: "agent-c", payoutAddress: "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed" },
      ],
    });

    manager.recordVote({
      runId: run.runId,
      memberId: "agent-a",
      decision: "accept",
      metadata: { verificationMode: "native_attestation" },
      resultHash: `0x${"1".repeat(64)}`,
      payoutAddress: "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
    });
    manager.recordVote({
      runId: run.runId,
      memberId: "agent-b",
      decision: "accept",
      metadata: { verificationMode: "native_attestation" },
      resultHash: `0x${"1".repeat(64)}`,
      payoutAddress: "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
    });
    manager.markMemberFailed({
      runId: run.runId,
      memberId: "agent-c",
      reason: "timeout",
    });

    const tallied = manager.tally(run.runId);
    expect(tallied.status).toBe("quorum_met");
    expect(tallied.tally?.quorumReached).toBe(true);
    expect(tallied.tally?.verificationMode).toBe("committee_verified");
    expect(tallied.tally?.winningResultHash).toBe(`0x${"1".repeat(64)}`);
    expect(tallied.tally?.payoutAllocations).toEqual([
      {
        memberId: "agent-a",
        payoutAddress: "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        amountTomi: "5",
        reason: `accepted:${`0x${"1".repeat(64)}`}`,
      },
      {
        memberId: "agent-b",
        payoutAddress: "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
        amountTomi: "4",
        reason: `accepted:${`0x${"1".repeat(64)}`}`,
      },
    ]);

    const paid = manager.markPaid(run.runId);
    expect(paid.status).toBe("paid");
    const summary = manager.buildSummary(10, "evidence");
    expect(summary.totalRuns).toBe(1);
    expect(summary.quorumMet).toBe(1);
    expect(summary.paid).toBe(1);
    expect(summary.verificationModes).toEqual({ committee_verified: 1 });
    expect(summary.totalPayoutTomi).toBe("9");
    db.close();
  });

  it("supports disagreement and bounded reruns for failed members", () => {
    const db = createTestDb();
    const manager = createCommitteeManager(db);
    const run = manager.createRun({
      kind: "oracle",
      title: "Oracle committee",
      question: "Resolve query",
      committeeSize: 3,
      thresholdM: 2,
      maxReruns: 1,
      members: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }],
    });

    manager.recordVote({
      runId: run.runId,
      memberId: "a",
      decision: "accept",
      metadata: { verificationMode: "fallback_integrity" },
      resultHash: `0x${"2".repeat(64)}`,
    });
    manager.recordVote({
      runId: run.runId,
      memberId: "b",
      decision: "reject",
    });
    manager.markMemberFailed({ runId: run.runId, memberId: "c", reason: "unreachable" });

    const failed = manager.tally(run.runId);
    expect(failed.status).toBe("quorum_failed");
    expect(failed.tally?.disagreement).toBe(true);
    expect(failed.tally?.verificationMode).toBe("fallback_integrity");

    const rerun = manager.rerun(run.runId);
    expect(rerun.rerunCount).toBe(1);
    expect(rerun.status).toBe("open");
    expect(rerun.members.find((entry) => entry.memberId === "c")?.status).toBe("assigned");

    expect(() => manager.rerun(run.runId)).toThrow(/no failed members|exhausted reruns/);
    db.close();
  });
});
