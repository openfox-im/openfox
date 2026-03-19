import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  buildArtifactPageHtml,
  buildArtifactPageSnapshot,
} from "../metaworld/artifact-page.js";
import {
  buildSettlementPageHtml,
  buildSettlementPageSnapshot,
} from "../metaworld/settlement-page.js";
import type { OpenFoxDatabase } from "../types.js";

const REQUESTER_PRIVATE_KEY =
  "0x6666666666666666666666666666666666666666666666666666666666666666" as const;
const PROVIDER_PRIVATE_KEY =
  "0x7777777777777777777777777777777777777777777777777777777777777777" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-trail-pages-test-"));
  return path.join(tmpDir, "test.db");
}

function makeHex(seed: string): `0x${string}` {
  return (`0x${seed.repeat(64)}`.slice(0, 66)) as `0x${string}`;
}

describe("metaWorld artifact and settlement pages", () => {
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

  it("builds artifact and settlement page snapshots from real local state", () => {
    const requester = privateKeyToAccount(REQUESTER_PRIVATE_KEY);
    const provider = privateKeyToAccount(PROVIDER_PRIVATE_KEY);
    const now = "2026-03-14T13:00:00.000Z";
    const later = "2026-03-14T13:10:00.000Z";

    db.insertBounty({
      bountyId: "bnt_trail_subject",
      hostAgentId: "trail-host",
      hostAddress: requester.address,
      kind: "question",
      title: "Trail Subject Bounty",
      taskPrompt: "Collect evidence.",
      referenceOutput: "Evidence bundle",
      rewardTomi: "1000000000000000000",
      submissionDeadline: "2026-03-15T00:00:00.000Z",
      judgeMode: "local_model",
      status: "paid",
      createdAt: now,
      updatedAt: later,
    });

    db.upsertArtifact({
      artifactId: "art_trail_1",
      kind: "oracle.evidence",
      title: "Trail Artifact",
      leaseId: "lease_trail_1",
      cid: "bafytrailartifactcid",
      bundleHash: makeHex("1"),
      providerBaseUrl: "https://provider.example",
      providerAddress: provider.address,
      requesterAddress: requester.address,
      subjectId: "bnt_trail_subject",
      summaryText: "Evidence bundle for the trail subject.",
      status: "anchored",
      createdAt: now,
      updatedAt: later,
    });
    db.upsertArtifactVerification({
      verificationId: "verify_trail_1",
      artifactId: "art_trail_1",
      receipt: {} as any,
      receiptHash: makeHex("2"),
      createdAt: later,
      updatedAt: later,
    });
    db.upsertArtifactAnchor({
      anchorId: "anchor_trail_1",
      artifactId: "art_trail_1",
      summary: {} as any,
      summaryHash: makeHex("3"),
      anchorTxHash: makeHex("4"),
      createdAt: later,
      updatedAt: later,
    });
    db.upsertExecutionTrail({
      trailId: "trail_artifact_1",
      subjectKind: "artifact",
      subjectId: "art_trail_1",
      executionKind: "signer_execution",
      executionRecordId: "sign_exec_1",
      executionTxHash: makeHex("5"),
      executionReceiptHash: makeHex("6"),
      linkMode: "direct",
      createdAt: later,
      updatedAt: later,
    });
    db.upsertExecutionTrail({
      trailId: "trail_verify_1",
      subjectKind: "artifact_verification",
      subjectId: "verify_trail_1",
      executionKind: "paymaster_authorization",
      executionRecordId: "pay_auth_1",
      executionTxHash: makeHex("7"),
      executionReceiptHash: makeHex("8"),
      linkMode: "derived",
      sourceSubjectKind: "artifact",
      sourceSubjectId: "art_trail_1",
      createdAt: later,
      updatedAt: later,
    });
    db.upsertSettlementReceipt({
      receiptId: "rcpt_trail_1",
      kind: "bounty",
      subjectId: "bnt_trail_subject",
      receipt: {} as any,
      receiptHash: makeHex("9"),
      payoutTxHash: makeHex("a"),
      settlementTxHash: makeHex("b"),
      createdAt: later,
      updatedAt: later,
    });
    db.upsertSettlementCallback({
      callbackId: "cb_trail_1",
      receiptId: "rcpt_trail_1",
      kind: "bounty",
      subjectId: "bnt_trail_subject",
      contractAddress: requester.address,
      payloadMode: "receipt_hash",
      payloadHex: makeHex("c"),
      payloadHash: makeHex("d"),
      status: "confirmed",
      attemptCount: 1,
      maxAttempts: 3,
      callbackTxHash: makeHex("e"),
      createdAt: later,
      updatedAt: later,
    });

    const artifactPage = buildArtifactPageSnapshot(db, {
      artifactId: "art_trail_1",
    });
    const artifactHtml = buildArtifactPageHtml(artifactPage);
    expect(artifactPage.artifact.title).toBe("Trail Artifact");
    expect(artifactPage.verification?.verificationId).toBe("verify_trail_1");
    expect(artifactPage.anchor?.anchorId).toBe("anchor_trail_1");
    expect(artifactPage.relatedSettlements).toHaveLength(1);
    expect(artifactHtml).toContain("Artifact Overview");
    expect(artifactHtml).toContain("Execution Trails");
    expect(artifactHtml).toContain("Related Settlements");

    const settlementPage = buildSettlementPageSnapshot(db, {
      receiptId: "rcpt_trail_1",
    });
    const settlementHtml = buildSettlementPageHtml(settlementPage);
    expect(settlementPage.settlement.subjectId).toBe("bnt_trail_subject");
    expect(settlementPage.callback?.callbackId).toBe("cb_trail_1");
    expect(settlementPage.bounty?.title).toBe("Trail Subject Bounty");
    expect(settlementPage.relatedArtifacts).toHaveLength(1);
    expect(settlementHtml).toContain("Settlement Overview");
    expect(settlementHtml).toContain("Callback State");
    expect(settlementHtml).toContain("Related Artifacts");
  });
});
