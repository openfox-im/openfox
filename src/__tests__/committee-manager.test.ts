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
      payoutTotalWei: "9",
      members: [
        { memberId: "agent-a", payoutAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { memberId: "agent-b", payoutAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        { memberId: "agent-c", payoutAddress: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
      ],
    });

    manager.recordVote({
      runId: run.runId,
      memberId: "agent-a",
      decision: "accept",
      resultHash: `0x${"1".repeat(64)}`,
      payoutAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    manager.recordVote({
      runId: run.runId,
      memberId: "agent-b",
      decision: "accept",
      resultHash: `0x${"1".repeat(64)}`,
      payoutAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    manager.markMemberFailed({
      runId: run.runId,
      memberId: "agent-c",
      reason: "timeout",
    });

    const tallied = manager.tally(run.runId);
    expect(tallied.status).toBe("quorum_met");
    expect(tallied.tally?.quorumReached).toBe(true);
    expect(tallied.tally?.winningResultHash).toBe(`0x${"1".repeat(64)}`);
    expect(tallied.tally?.payoutAllocations).toEqual([
      {
        memberId: "agent-a",
        payoutAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        amountWei: "5",
        reason: `accepted:${`0x${"1".repeat(64)}`}`,
      },
      {
        memberId: "agent-b",
        payoutAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        amountWei: "4",
        reason: `accepted:${`0x${"1".repeat(64)}`}`,
      },
    ]);

    const paid = manager.markPaid(run.runId);
    expect(paid.status).toBe("paid");
    const summary = manager.buildSummary(10, "evidence");
    expect(summary.totalRuns).toBe(1);
    expect(summary.quorumMet).toBe(1);
    expect(summary.paid).toBe(1);
    expect(summary.totalPayoutWei).toBe("9");
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

    const rerun = manager.rerun(run.runId);
    expect(rerun.rerunCount).toBe(1);
    expect(rerun.status).toBe("open");
    expect(rerun.members.find((entry) => entry.memberId === "c")?.status).toBe("assigned");

    expect(() => manager.rerun(run.runId)).toThrow(/no failed members|exhausted reruns/);
    db.close();
  });
});
