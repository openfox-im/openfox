import { afterEach, describe, expect, it } from "vitest";
import { createArtifactManager } from "../artifacts/manager.js";
import { DEFAULT_ARTIFACT_PIPELINE_CONFIG } from "../types.js";
import { createTestDb, createTestIdentity } from "./mocks.js";

describe("artifact manager", () => {
  const dbs: Array<ReturnType<typeof createTestDb>> = [];

  afterEach(() => {
    while (dbs.length) {
      dbs.pop()?.close();
    }
  });

  it("stores public news artifacts alongside storage quote and lease records", async () => {
    const db = createTestDb();
    dbs.push(db);
    const identity = createTestIdentity();
    const manager = createArtifactManager({
      identity,
      requesterAccount: identity.account,
      db,
      config: {
        ...DEFAULT_ARTIFACT_PIPELINE_CONFIG,
        enabled: true,
        defaultProviderBaseUrl: "http://provider.test/storage",
      },
      now: () => new Date("2026-03-10T00:00:00.000Z"),
      storageDriver: {
        async quote() {
          return {
            quote_id: "quote-1",
            provider_address:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            requester_address: identity.address,
            cid: "bafynews",
            bundle_kind: "public_news.capture",
            size_bytes: 256,
            ttl_seconds: 3600,
            amount_wei: "1000",
            expires_at: "2026-03-10T01:00:00.000Z",
          };
        },
        async put() {
          return {
            lease_id: "lease-1",
            cid: "bafynews",
            bundle_hash: "0x11",
            bundle_kind: "public_news.capture",
            size_bytes: 256,
            ttl_seconds: 3600,
            amount_wei: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: "storage:lease-1",
            receipt_hash: "0x22",
            payment_tx_hash: "0x33",
            get_url: "http://provider.test/storage/get/bafynews",
            head_url: "http://provider.test/storage/head/bafynews",
          };
        },
        async head() {
          return {
            lease_id: "lease-1",
            cid: "bafynews",
            bundle_hash: "0x11",
            bundle_kind: "public_news.capture",
            size_bytes: 256,
            ttl_seconds: 3600,
            amount_wei: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: "storage:lease-1",
            receipt_hash: "0x22",
            payment_tx_hash: "0x33",
            get_url: "http://provider.test/storage/get/bafynews",
            head_url: "http://provider.test/storage/head/bafynews",
          };
        },
        async audit() {
          return {
            audit_id: "audit-1",
            lease_id: "lease-1",
            cid: "bafynews",
            status: "verified" as const,
            response_hash: "0x44",
            checked_at: "2026-03-10T00:02:00.000Z",
          };
        },
      },
    });

    const stored = await manager.capturePublicNews({
      title: "Example News",
      sourceUrl: "https://example.com/news/1",
      headline: "Example headline",
      bodyText: "Example body",
    });

    expect(stored.artifact.kind).toBe("public_news.capture");
    expect(stored.artifact.status).toBe("stored");
    expect(db.getStorageQuote("quote-1")?.status).toBe("used");
    expect(db.getStorageLease("lease-1")?.cid).toBe("bafynews");

    const verified = await manager.verifyArtifact({
      artifactId: stored.artifact.artifactId,
    });

    expect(verified.verification.receipt.status).toBe("verified");
    expect(db.getArtifactVerificationByArtifactId(stored.artifact.artifactId)?.verificationId).toBe(
      verified.verification.verificationId,
    );
    expect(db.getArtifact(stored.artifact.artifactId)?.status).toBe("verified");
  });

  it("builds committee vote artifacts as a distinct bundle kind", async () => {
    const db = createTestDb();
    dbs.push(db);
    const identity = createTestIdentity();
    const manager = createArtifactManager({
      identity,
      requesterAccount: identity.account,
      db,
      config: {
        ...DEFAULT_ARTIFACT_PIPELINE_CONFIG,
        enabled: true,
        defaultProviderBaseUrl: "http://provider.test/storage",
      },
      storageDriver: {
        async quote() {
          return {
            quote_id: "quote-vote",
            provider_address:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            requester_address: identity.address,
            cid: "bafyvote",
            bundle_kind: "committee.vote",
            size_bytes: 128,
            ttl_seconds: 3600,
            amount_wei: "1000",
            expires_at: "2026-03-10T01:00:00.000Z",
          };
        },
        async put() {
          return {
            lease_id: "lease-vote",
            cid: "bafyvote",
            bundle_hash: "0x55",
            bundle_kind: "committee.vote",
            size_bytes: 128,
            ttl_seconds: 3600,
            amount_wei: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: "storage:lease-vote",
            receipt_hash: "0x66",
            payment_tx_hash: "0x77",
            get_url: "http://provider.test/storage/get/bafyvote",
            head_url: "http://provider.test/storage/head/bafyvote",
          };
        },
        async head() {
          return {
            lease_id: "lease-vote",
            cid: "bafyvote",
            bundle_hash: "0x55",
            bundle_kind: "committee.vote",
            size_bytes: 128,
            ttl_seconds: 3600,
            amount_wei: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: "storage:lease-vote",
            receipt_hash: "0x66",
            payment_tx_hash: "0x77",
            get_url: "http://provider.test/storage/get/bafyvote",
            head_url: "http://provider.test/storage/head/bafyvote",
          };
        },
        async audit() {
          return {
            audit_id: "audit-vote",
            lease_id: "lease-vote",
            cid: "bafyvote",
            status: "verified" as const,
            response_hash: "0x88",
            checked_at: "2026-03-10T00:02:00.000Z",
          };
        },
      },
    });

    const stored = await manager.createCommitteeVote({
      title: "Committee vote",
      question: "Will event X happen?",
      voterId: "agent-1",
      voteText: "yes",
      evidenceArtifactIds: ["artifact-1", "artifact-2"],
    });

    expect(stored.artifact.kind).toBe("committee.vote");
    expect(stored.artifact.subjectId).toBe("Will event X happen?");
    expect(stored.artifact.summaryText).toBe("yes");
  });

  it("supports artifact indexing filters for source, subject, and anchored state", async () => {
    const db = createTestDb();
    dbs.push(db);
    const identity = createTestIdentity();
    const manager = createArtifactManager({
      identity,
      requesterAccount: identity.account,
      db,
      config: {
        ...DEFAULT_ARTIFACT_PIPELINE_CONFIG,
        enabled: true,
        defaultProviderBaseUrl: "http://provider.test/storage",
      },
      storageDriver: {
        async quote(input) {
          return {
            quote_id: `quote-${input.cid}`,
            provider_address:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            requester_address: identity.address,
            cid: input.cid,
            bundle_kind: input.bundleKind,
            size_bytes: input.sizeBytes,
            ttl_seconds: input.ttlSeconds,
            amount_wei: "1000",
            expires_at: "2026-03-10T01:00:00.000Z",
          };
        },
        async put(input) {
          return {
            lease_id: `lease-${input.cid}`,
            cid: input.cid,
            bundle_hash: "0x99",
            bundle_kind: input.bundleKind,
            size_bytes: 256,
            ttl_seconds: input.ttlSeconds,
            amount_wei: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: `storage:lease-${input.cid}`,
            receipt_hash: "0xaa",
            payment_tx_hash: "0xbb",
            get_url: `http://provider.test/storage/get/${input.cid}`,
            head_url: `http://provider.test/storage/head/${input.cid}`,
          };
        },
        async head(input) {
          return {
            lease_id: `lease-${input.cid}`,
            cid: input.cid,
            bundle_hash: "0x99",
            bundle_kind: "public_news.capture",
            size_bytes: 256,
            ttl_seconds: 3600,
            amount_wei: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: `storage:lease-${input.cid}`,
            receipt_hash: "0xaa",
            payment_tx_hash: "0xbb",
            get_url: `http://provider.test/storage/get/${input.cid}`,
            head_url: `http://provider.test/storage/head/${input.cid}`,
          };
        },
        async audit(input) {
          return {
            audit_id: `audit-${input.leaseId}`,
            lease_id: input.leaseId,
            cid: input.leaseId.replace("lease-", ""),
            status: "verified" as const,
            response_hash: "0xcc",
            checked_at: "2026-03-10T00:02:00.000Z",
          };
        },
      },
      anchorPublisher: {
        async publish({ artifact, publisherAddress, metadata }) {
          const createdAt = "2026-03-10T00:03:00.000Z";
          const anchor = {
            anchorId: `anchor:${artifact.artifactId}`,
            artifactId: artifact.artifactId,
            summary: {
              version: 1,
              artifactId: artifact.artifactId,
              leaseId: artifact.leaseId,
              cid: artifact.cid,
              bundleHash: artifact.bundleHash,
              artifactKind: artifact.kind,
              publisherAddress,
              metadata: metadata ?? null,
              createdAt,
            },
            summaryHash:
              "0x1111111111111111111111111111111111111111111111111111111111111111",
            anchorTxHash:
              "0x2222222222222222222222222222222222222222222222222222222222222222",
            anchorReceipt: { status: "0x1" },
            createdAt,
            updatedAt: createdAt,
          };
          db.upsertArtifactAnchor(anchor);
          return anchor;
        },
      },
    });

    const first = await manager.capturePublicNews({
      title: "First capture",
      sourceUrl: "https://example.com/news/alpha",
      headline: "Alpha headline",
      bodyText: "Alpha body",
    });
    const second = await manager.createOracleEvidence({
      title: "Second capture",
      question: "Question Beta",
      evidenceText: "Beta body",
      sourceUrl: "https://elsewhere.test/news/beta",
    });
    await manager.verifyArtifact({ artifactId: first.artifact.artifactId });
    await manager.anchorArtifact({ artifactId: first.artifact.artifactId });

    expect(
      manager.listArtifacts(10, { sourceUrlPrefix: "https://example.com/news" }).map((item) => item.artifactId),
    ).toEqual([first.artifact.artifactId]);
    expect(
      manager.listArtifacts(10, { subjectContains: "Question" }).map((item) => item.artifactId),
    ).toEqual([second.artifact.artifactId]);
    expect(
      manager.listArtifacts(10, { query: "beta" }).map((item) => item.artifactId),
    ).toEqual([second.artifact.artifactId]);
    expect(
      manager.listArtifacts(10, { anchoredOnly: true }).map((item) => item.artifactId),
    ).toEqual([first.artifact.artifactId]);
    expect(
      manager.listArtifacts(10, { verifiedOnly: true }).map((item) => item.artifactId),
    ).toEqual([first.artifact.artifactId]);
  });
});
