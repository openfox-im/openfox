import { ulid } from "ulid";
import type { OpenFoxDatabase, VerificationSurfaceMode } from "../types.js";

export type CommitteeKind = "evidence" | "oracle";
export type CommitteeDecision = "accept" | "reject" | "inconclusive";
export type CommitteeRunStatus = "open" | "quorum_met" | "quorum_failed" | "paid";
export type CommitteeMemberStatus = "assigned" | "voted" | "failed";

export interface CommitteeMemberRecord {
  memberId: string;
  payoutAddress?: string | null;
  signerType?: string | null;
  modelFamily?: string | null;
  region?: string | null;
  asn?: string | null;
  status: CommitteeMemberStatus;
  voteId?: string | null;
  failureReason?: string | null;
  updatedAt: string;
}

export interface CommitteeVoteRecord {
  voteId: string;
  runId: string;
  memberId: string;
  decision: CommitteeDecision;
  verificationMode?: VerificationSurfaceMode | null;
  resultHash?: `0x${string}` | null;
  reasonCode?: string | null;
  signature?: `0x${string}` | null;
  payoutAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommitteePayoutAllocation {
  memberId: string;
  payoutAddress: string;
  amountWei: string;
  reason: string;
}

export interface CommitteeTallySnapshot {
  tallyId: string;
  runId: string;
  verificationMode: VerificationSurfaceMode;
  acceptedCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
  quorumReached: boolean;
  disagreement: boolean;
  winningResultHash?: `0x${string}` | null;
  payoutAllocations: CommitteePayoutAllocation[];
  createdAt: string;
}

export interface CommitteeRunRecord {
  runId: string;
  kind: CommitteeKind;
  title: string;
  question: string;
  subjectRef?: string | null;
  artifactIds: string[];
  committeeSize: number;
  thresholdM: number;
  payoutTotalWei: string;
  status: CommitteeRunStatus;
  maxReruns: number;
  rerunCount: number;
  members: CommitteeMemberRecord[];
  tally?: CommitteeTallySnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommitteeSummarySnapshot {
  totalRuns: number;
  quorumMet: number;
  quorumFailed: number;
  paid: number;
  disagreements: number;
  verificationModes: Record<string, number>;
  totalPayoutWei: string;
  latestRunId: string | null;
  latestUpdatedAt: string | null;
  items: CommitteeRunRecord[];
  summary: string;
}

const RUN_PREFIX = "committee:run";
const VOTE_PREFIX = "committee:vote";

function runKey(runId: string): string {
  return `${RUN_PREFIX}:${runId}`;
}

function runIndexKey(createdAt: string, runId: string): string {
  return `${RUN_PREFIX}:index:${createdAt}:${runId}`;
}

function voteKey(voteId: string): string {
  return `${VOTE_PREFIX}:${voteId}`;
}

function voteIndexKey(createdAt: string, voteId: string): string {
  return `${VOTE_PREFIX}:index:${createdAt}:${voteId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function listIndexedRecords<T>(
  db: OpenFoxDatabase,
  prefix: string,
  getKey: (id: string) => string,
  limit: number,
): T[] {
  const rows = db.raw
    .prepare("SELECT value FROM kv WHERE key LIKE ? ORDER BY key DESC LIMIT ?")
    .all(`${prefix}:index:%`, Math.max(1, limit)) as Array<{ value: string }>;
  return rows
    .map((row) => db.getKV(row.value.startsWith(`${prefix}:`) ? row.value : getKey(row.value)))
    .filter((raw): raw is string => typeof raw === "string" && raw.length > 0)
    .map((raw) => JSON.parse(raw) as T);
}

function storeRun(db: OpenFoxDatabase, run: CommitteeRunRecord): void {
  db.setKV(runKey(run.runId), JSON.stringify(run));
  db.setKV(runIndexKey(run.createdAt, run.runId), run.runId);
}

function storeVote(db: OpenFoxDatabase, vote: CommitteeVoteRecord): void {
  db.setKV(voteKey(vote.voteId), JSON.stringify(vote));
  db.setKV(voteIndexKey(vote.createdAt, vote.voteId), vote.voteId);
}

function chooseWinningResultHash(
  votes: CommitteeVoteRecord[],
): `0x${string}` | null {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (vote.decision !== "accept" || !vote.resultHash) continue;
    counts.set(vote.resultHash, (counts.get(vote.resultHash) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return (ranked[0]?.[0] as `0x${string}` | undefined) ?? null;
}

function distributePayouts(params: {
  totalWei: string;
  members: CommitteeMemberRecord[];
  votes: CommitteeVoteRecord[];
  winningResultHash?: `0x${string}` | null;
}): CommitteePayoutAllocation[] {
  if (!/^[0-9]+$/.test(params.totalWei)) return [];
  const eligible = params.votes
    .filter(
      (vote) =>
        vote.decision === "accept" &&
        vote.payoutAddress &&
        (params.winningResultHash ? vote.resultHash === params.winningResultHash : true),
    )
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
  if (eligible.length === 0) return [];
  const total = BigInt(params.totalWei);
  const each = total / BigInt(eligible.length);
  let remainder = total % BigInt(eligible.length);
  return eligible.map((vote) => {
    let amount = each;
    if (remainder > 0n) {
      amount += 1n;
      remainder -= 1n;
    }
    return {
      memberId: vote.memberId,
      payoutAddress: vote.payoutAddress!,
      amountWei: amount.toString(),
      reason: params.winningResultHash
        ? `accepted:${params.winningResultHash}`
        : "accepted",
    };
  });
}

function buildTally(run: CommitteeRunRecord, votes: CommitteeVoteRecord[]): CommitteeTallySnapshot {
  const acceptedVotes = votes.filter((vote) => vote.decision === "accept");
  const rejectedVotes = votes.filter((vote) => vote.decision === "reject");
  const inconclusiveVotes = votes.filter((vote) => vote.decision === "inconclusive");
  const winningResultHash = chooseWinningResultHash(votes);
  const winningAcceptCount = acceptedVotes.filter((vote) =>
    winningResultHash ? vote.resultHash === winningResultHash : true,
  ).length;
  const distinctAcceptedHashes = new Set(
    acceptedVotes.map((vote) => vote.resultHash).filter(Boolean),
  ).size;
  const quorumReached = winningAcceptCount >= run.thresholdM;
  const disagreement =
    distinctAcceptedHashes > 1 || rejectedVotes.length > 0 || inconclusiveVotes.length > 0;
  const hasNativeAttestation = votes.some(
    (vote) =>
      vote.verificationMode === "native_attestation" ||
      vote.verificationMode === "committee_verified",
  );
  return {
    tallyId: `committee-tally:${run.runId}:${votes.length}:${run.rerunCount}`,
    runId: run.runId,
    verificationMode: quorumReached
      ? "committee_verified"
      : hasNativeAttestation
        ? "native_attestation"
        : "fallback_integrity",
    acceptedCount: acceptedVotes.length,
    rejectedCount: rejectedVotes.length,
    inconclusiveCount: inconclusiveVotes.length,
    quorumReached,
    disagreement,
    winningResultHash,
    payoutAllocations: distributePayouts({
      totalWei: run.payoutTotalWei,
      members: run.members,
      votes,
      winningResultHash,
    }),
    createdAt: nowIso(),
  };
}

export interface CommitteeManager {
  createRun(input: {
    kind: CommitteeKind;
    title: string;
    question: string;
    subjectRef?: string | null;
    artifactIds?: string[];
    committeeSize: number;
    thresholdM: number;
    payoutTotalWei?: string;
    maxReruns?: number;
    members: Array<{
      memberId: string;
      payoutAddress?: string | null;
      signerType?: string | null;
      modelFamily?: string | null;
      region?: string | null;
      asn?: string | null;
    }>;
  }): CommitteeRunRecord;
  recordVote(input: {
    runId: string;
    memberId: string;
    decision: CommitteeDecision;
    resultHash?: `0x${string}` | null;
    reasonCode?: string | null;
    signature?: `0x${string}` | null;
    payoutAddress?: string | null;
    metadata?: Record<string, unknown> | null;
  }): CommitteeVoteRecord;
  markMemberFailed(input: {
    runId: string;
    memberId: string;
    reason: string;
  }): CommitteeRunRecord;
  rerun(runId: string): CommitteeRunRecord;
  tally(runId: string): CommitteeRunRecord;
  markPaid(runId: string): CommitteeRunRecord;
  list(limit?: number): CommitteeRunRecord[];
  get(runId: string): CommitteeRunRecord | null;
  getVote(voteId: string): CommitteeVoteRecord | null;
  listVotes(runId: string): CommitteeVoteRecord[];
  buildSummary(limit?: number, kind?: CommitteeKind): CommitteeSummarySnapshot;
}

export function createCommitteeManager(db: OpenFoxDatabase): CommitteeManager {
  const get = (runId: string): CommitteeRunRecord | null => {
    const raw = db.getKV(runKey(runId));
    return raw ? (JSON.parse(raw) as CommitteeRunRecord) : null;
  };

  const getVote = (voteId: string): CommitteeVoteRecord | null => {
    const raw = db.getKV(voteKey(voteId));
    return raw ? (JSON.parse(raw) as CommitteeVoteRecord) : null;
  };

  const listVotes = (runId: string): CommitteeVoteRecord[] => {
    const rows = db.raw
      .prepare("SELECT value FROM kv WHERE key LIKE ? ORDER BY key ASC")
      .all(`${VOTE_PREFIX}:index:%`) as Array<{ value: string }>;
    return rows
      .map((row) => getVote(row.value))
      .filter(
        (vote): vote is CommitteeVoteRecord =>
          vote !== null && vote.runId === runId,
      );
  };

  return {
    createRun(input) {
      if (input.committeeSize <= 0 || input.thresholdM <= 0) {
        throw new Error("committeeSize and thresholdM must be positive");
      }
      if (input.members.length !== input.committeeSize) {
        throw new Error("members length must equal committeeSize");
      }
      if (input.thresholdM > input.committeeSize) {
        throw new Error("thresholdM must be <= committeeSize");
      }
      const createdAt = nowIso();
      const run: CommitteeRunRecord = {
        runId: ulid(),
        kind: input.kind,
        title: input.title,
        question: input.question,
        subjectRef: input.subjectRef ?? null,
        artifactIds: input.artifactIds ?? [],
        committeeSize: input.committeeSize,
        thresholdM: input.thresholdM,
        payoutTotalWei: input.payoutTotalWei ?? "0",
        status: "open",
        maxReruns: input.maxReruns ?? 1,
        rerunCount: 0,
        members: input.members.map((member) => ({
          memberId: member.memberId,
          payoutAddress: member.payoutAddress ?? null,
          signerType: member.signerType ?? null,
          modelFamily: member.modelFamily ?? null,
          region: member.region ?? null,
          asn: member.asn ?? null,
          status: "assigned",
          updatedAt: createdAt,
        })),
        tally: null,
        createdAt,
        updatedAt: createdAt,
      };
      storeRun(db, run);
      return run;
    },

    recordVote(input) {
      const run = get(input.runId);
      if (!run) throw new Error(`committee run not found: ${input.runId}`);
      if (run.status === "paid") {
        throw new Error("cannot record votes for a paid committee run");
      }
      const member = run.members.find((entry) => entry.memberId === input.memberId);
      if (!member) throw new Error(`committee member not found: ${input.memberId}`);
      if (member.status === "voted") {
        throw new Error(`committee member has already voted: ${input.memberId}`);
      }
      const createdAt = nowIso();
      const vote: CommitteeVoteRecord = {
        voteId: ulid(),
        runId: input.runId,
        memberId: input.memberId,
        decision: input.decision,
        verificationMode:
          input.metadata &&
          typeof input.metadata.verificationMode === "string" &&
          (input.metadata.verificationMode === "fallback_integrity" ||
            input.metadata.verificationMode === "native_attestation" ||
            input.metadata.verificationMode === "committee_verified")
            ? (input.metadata.verificationMode as VerificationSurfaceMode)
            : null,
        resultHash: input.resultHash ?? null,
        reasonCode: input.reasonCode ?? null,
        signature: input.signature ?? null,
        payoutAddress: input.payoutAddress ?? member.payoutAddress ?? null,
        metadata: input.metadata ?? null,
        createdAt,
        updatedAt: createdAt,
      };
      storeVote(db, vote);
      member.status = "voted";
      member.voteId = vote.voteId;
      member.failureReason = null;
      member.updatedAt = createdAt;
      run.updatedAt = createdAt;
      storeRun(db, run);
      return vote;
    },

    markMemberFailed(input) {
      const run = get(input.runId);
      if (!run) throw new Error(`committee run not found: ${input.runId}`);
      const member = run.members.find((entry) => entry.memberId === input.memberId);
      if (!member) throw new Error(`committee member not found: ${input.memberId}`);
      member.status = "failed";
      member.failureReason = input.reason;
      member.updatedAt = nowIso();
      run.updatedAt = member.updatedAt;
      storeRun(db, run);
      return run;
    },

    rerun(runId) {
      const run = get(runId);
      if (!run) throw new Error(`committee run not found: ${runId}`);
      if (run.rerunCount >= run.maxReruns) {
        throw new Error(`committee run has exhausted reruns (${run.maxReruns})`);
      }
      const failedMembers = run.members.filter((entry) => entry.status === "failed");
      if (failedMembers.length === 0) {
        throw new Error("committee run has no failed members to rerun");
      }
      const updatedAt = nowIso();
      for (const member of failedMembers) {
        member.status = "assigned";
        member.failureReason = null;
        member.updatedAt = updatedAt;
      }
      run.rerunCount += 1;
      run.status = "open";
      run.tally = null;
      run.updatedAt = updatedAt;
      storeRun(db, run);
      return run;
    },

    tally(runId) {
      const run = get(runId);
      if (!run) throw new Error(`committee run not found: ${runId}`);
      const votes = listVotes(runId);
      const tally = buildTally(run, votes);
      run.tally = tally;
      run.status = tally.quorumReached ? "quorum_met" : "quorum_failed";
      run.updatedAt = tally.createdAt;
      storeRun(db, run);
      return run;
    },

    markPaid(runId) {
      const run = get(runId);
      if (!run) throw new Error(`committee run not found: ${runId}`);
      if (!run.tally?.quorumReached) {
        throw new Error("committee run cannot be marked paid before quorum is met");
      }
      run.status = "paid";
      run.updatedAt = nowIso();
      storeRun(db, run);
      return run;
    },

    list(limit = 20) {
      return listIndexedRecords<CommitteeRunRecord>(db, RUN_PREFIX, runKey, limit);
    },

    get,
    getVote,
    listVotes,

    buildSummary(limit = 20, kind) {
      const items = this.list(limit).filter((item) => !kind || item.kind === kind);
      const latest = items[0] ?? null;
      const quorumMet = items.filter((item) => item.status === "quorum_met" || item.status === "paid").length;
      const quorumFailed = items.filter((item) => item.status === "quorum_failed").length;
      const paid = items.filter((item) => item.status === "paid").length;
      const disagreements = items.filter((item) => item.tally?.disagreement === true).length;
      const verificationModes = items.reduce<Record<string, number>>((acc, item) => {
        const mode = item.tally?.verificationMode;
        if (mode) acc[mode] = (acc[mode] || 0) + 1;
        return acc;
      }, {});
      const totalPayoutWei = items
        .reduce((acc, item) => {
          const allocations = item.tally?.payoutAllocations ?? [];
          const subtotal = allocations.reduce((inner, allocation) => inner + BigInt(allocation.amountWei), 0n);
          return acc + subtotal;
        }, 0n)
        .toString();
      return {
        totalRuns: items.length,
        quorumMet,
        quorumFailed,
        paid,
        disagreements,
        verificationModes,
        totalPayoutWei,
        latestRunId: latest?.runId ?? null,
        latestUpdatedAt: latest?.updatedAt ?? null,
        items,
        summary:
          items.length === 0
            ? "No committee runs recorded."
            : `${items.length} committee run(s), quorum_met=${quorumMet}, quorum_failed=${quorumFailed}, paid=${paid}, disagreements=${disagreements}, modes=${Object.entries(verificationModes)
                .map(([mode, count]) => `${mode}=${count}`)
                .join(", ") || "none"}.`,
      };
    },
  };
}

export function buildCommitteeSummaryReport(
  snapshot: CommitteeSummarySnapshot,
): string {
  return [
    "=== OPENFOX COMMITTEE SUMMARY ===",
    `Runs:            ${snapshot.totalRuns}`,
    `Quorum met:      ${snapshot.quorumMet}`,
    `Quorum failed:   ${snapshot.quorumFailed}`,
    `Paid:            ${snapshot.paid}`,
    `Disagreements:   ${snapshot.disagreements}`,
    `Modes:           ${
      Object.keys(snapshot.verificationModes).length === 0
        ? "(none)"
        : Object.entries(snapshot.verificationModes)
            .map(([mode, count]) => `${mode}=${count}`)
            .join(", ")
    }`,
    `Total payout:    ${snapshot.totalPayoutWei} wei`,
    `Latest run:      ${snapshot.latestRunId || "(none)"}`,
    `Latest updated:  ${snapshot.latestUpdatedAt || "(none)"}`,
    "",
    `Summary: ${snapshot.summary}`,
  ].join("\n");
}
