import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  buildWorldBoardSnapshot,
  listWorldBoardItems,
  type WorldBoardKind,
} from "../metaworld/boards.js";
import type {
  ArtifactRecord,
  BountyRecord,
  OpenFoxDatabase,
  OwnerOpportunityAlertRecord,
  SettlementRecord,
} from "../types.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-boards-test-"));
  return path.join(tmpDir, "test.db");
}

describe("metaWorld boards", () => {
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

  it("builds work, opportunity, artifact, and settlement board projections", () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);

    db.insertBounty({
      bountyId: "bounty-board-1",
      hostAgentId: "host-1",
      hostAddress: account.address.toLowerCase() as `0x${string}`,
      kind: "question",
      title: "Research a hard question",
      taskPrompt: "What changed?",
      referenceOutput: "canonical",
      rewardTomi: "1000",
      submissionDeadline: "2030-01-02T00:00:00.000Z",
      judgeMode: "local_model",
      status: "open",
      createdAt: "2030-01-01T00:00:01.000Z",
      updatedAt: "2030-01-01T00:00:01.000Z",
    } satisfies BountyRecord);

    db.upsertOwnerOpportunityAlert({
      alertId: "alert-board-1",
      opportunityHash:
        "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d111111111111111111111111",
      kind: "provider",
      providerClass: "oracle",
      trustTier: "org_trusted",
      title: "Cheap oracle execution",
      summary: "An oracle provider is underpriced.",
      suggestedAction: "delegate",
      capability: "oracle.answer",
      baseUrl: "https://oracle.example.com",
      rewardTomi: "2000",
      estimatedCostTomi: "500",
      marginTomi: "1500",
      marginBps: 3000,
      strategyScore: 0.92,
      strategyMatched: true,
      strategyReasons: ["high-margin"],
      payload: { provider: "oracle.example.com" },
      status: "unread",
      createdAt: "2030-01-01T00:00:02.000Z",
      updatedAt: "2030-01-01T00:00:02.000Z",
    } satisfies OwnerOpportunityAlertRecord);

    db.upsertArtifact({
      artifactId: "artifact-board-1",
      kind: "public_news.capture",
      title: "Stored evidence bundle",
      leaseId: "lease-board-1",
      cid: "bafyboardartifact",
      bundleHash:
        "0x473302ca547d5f9877e272cffe58d4def43198b66ba35cff4b2e584be19efa05222222222222222222222222",
      providerBaseUrl: "https://artifacts.example.com",
      providerAddress:
        "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626daaaaaaaaaaaaaaaaaaaaaaaa",
      requesterAddress: account.address.toLowerCase() as `0x${string}`,
      status: "stored",
      createdAt: "2030-01-01T00:00:03.000Z",
      updatedAt: "2030-01-01T00:00:03.000Z",
    } satisfies ArtifactRecord);

    db.upsertSettlementReceipt({
      receiptId: "receipt-board-1",
      kind: "bounty",
      subjectId: "bounty-board-1",
      receipt: {} as any,
      receiptHash:
        "0xdf96edbc954f43d46dc80e0180291bb781ac0a8a3a69c785631d4193e9a9d5e7333333333333333333333333",
      createdAt: "2030-01-01T00:00:04.000Z",
      updatedAt: "2030-01-01T00:00:04.000Z",
    } satisfies SettlementRecord);

    const kinds: WorldBoardKind[] = ["work", "opportunity", "artifact", "settlement"];
    for (const kind of kinds) {
      const items = listWorldBoardItems(db, { boardKind: kind, limit: 10 });
      expect(items).toHaveLength(1);
      expect(items[0].boardKind).toBe(kind);

      const snapshot = buildWorldBoardSnapshot(db, { boardKind: kind, limit: 10 });
      expect(snapshot.boardKind).toBe(kind);
      expect(snapshot.summary).toContain("board");
      expect(snapshot.items).toHaveLength(1);
    }
  });
});
