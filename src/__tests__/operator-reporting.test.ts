import { describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import {
  buildProviderReputationSnapshot,
} from "../operator/provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "../operator/storage-health.js";
import type {
  ArtifactRecord,
  SignerExecutionRecord,
  PaymasterAuthorizationRecord,
  StorageLeaseRecord,
  StorageAuditRecord,
} from "../types.js";

describe("operator reporting", () => {
  it("builds provider reputation snapshots across storage, artifacts, signer, and paymaster flows", () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    const providerAddress =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const otherProvider =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

    db.upsertStorageLease({
      leaseId: "lease-1",
      cid: "cid-1",
      bundleHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      bundleKind: "artifact.bundle",
      requesterAddress:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      providerAddress,
      providerBaseUrl: "https://storage-1.example.com/storage",
      sizeBytes: 100,
      ttlSeconds: 3600,
      amountWei: "1",
      status: "active",
      storagePath: "/tmp/cid-1",
      requestKey: "req-1",
      receipt: {
        leaseId: "lease-1",
        cid: "cid-1",
        bundleHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        bundleKind: "artifact.bundle",
        requesterAddress:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        providerAddress,
        sizeBytes: 100,
        ttlSeconds: 3600,
        amountWei: "1",
        createdAt: now,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        providerSignature:
          "0x01",
      },
      receiptHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      createdAt: now,
      updatedAt: now,
    } satisfies StorageLeaseRecord);
    db.upsertStorageAudit({
      auditId: "audit-1",
      leaseId: "lease-1",
      cid: "cid-1",
      status: "failed",
      challengeNonce: "n1",
      responseHash:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      checkedAt: now,
      createdAt: now,
      updatedAt: now,
    } satisfies StorageAuditRecord);

    db.upsertArtifact({
      artifactId: "artifact-1",
      kind: "public_news.capture",
      title: "artifact",
      leaseId: "lease-1",
      cid: "cid-1",
      bundleHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      providerBaseUrl: "https://artifacts.example.com",
      providerAddress: otherProvider,
      requesterAddress:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      status: "failed",
      createdAt: now,
      updatedAt: now,
    } satisfies ArtifactRecord);

    db.upsertSignerExecution({
      executionId: "signer-1",
      quoteId: "quote-1",
      requestKey: "signer:req:1",
      requestHash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
      providerAddress,
      walletAddress:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      requesterAddress:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      targetAddress:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      valueWei: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-1",
      policyHash:
        "0x5555555555555555555555555555555555555555555555555555555555555555",
      scopeHash:
        "0x6666666666666666666666666666666666666666666666666666666666666666",
      trustTier: "self_hosted",
      requestNonce: "1",
      requestExpiresAt: Date.now() + 60_000,
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    } satisfies SignerExecutionRecord);

    db.upsertPaymasterAuthorization({
      authorizationId: "paymaster-1",
      quoteId: "quote-2",
      chainId: "1666",
      requestKey: "paymaster:req:1",
      requestHash:
        "0x7777777777777777777777777777777777777777777777777777777777777777",
      providerAddress: otherProvider,
      sponsorAddress:
        "0xabababababababababababababababababababababababababababababababab",
      sponsorSignerType: "secp256k1",
      walletAddress:
        "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
      requesterAddress:
        "0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef",
      requesterSignerType: "secp256k1",
      targetAddress:
        "0x9898989898989898989898989898989898989898989898989898989898989898",
      valueWei: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-2",
      policyHash:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      scopeHash:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      trustTier: "self_hosted",
      requestNonce: "1",
      requestExpiresAt: Date.now() + 60_000,
      executionNonce: "1",
      sponsorNonce: "1",
      sponsorExpiry: Date.now() + 60_000,
      status: "failed",
      createdAt: now,
      updatedAt: now,
    } satisfies PaymasterAuthorizationRecord);

    const snapshot = buildProviderReputationSnapshot({ db });
    expect(snapshot.totalProviders).toBeGreaterThanOrEqual(2);
    expect(snapshot.entries.some((entry) => entry.kind === "storage")).toBe(true);
    expect(snapshot.entries.some((entry) => entry.kind === "artifacts")).toBe(true);
    expect(snapshot.entries.some((entry) => entry.kind === "signer")).toBe(true);
    expect(snapshot.entries.some((entry) => entry.kind === "paymaster")).toBe(true);
    expect(snapshot.summary).toContain("provider");

    db.close();
  });

  it("builds storage lease-health snapshots with renewal, audit, and replication flags", () => {
    const db = createTestDb();
    const config = createTestConfig({
      storage: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4905,
        pathPrefix: "/storage",
        capabilityPrefix: "storage.ipfs",
        storageDir: "/tmp/openfox-storage",
        quoteValiditySeconds: 300,
        defaultTtlSeconds: 86400,
        maxTtlSeconds: 2592000,
        maxBundleBytes: 8 * 1024 * 1024,
        minimumPriceWei: "1000",
        pricePerMiBWei: "1000",
        publishToDiscovery: true,
        allowAnonymousGet: true,
        leaseHealth: {
          autoAudit: true,
          auditIntervalSeconds: 60,
          autoRenew: true,
          renewalLeadSeconds: 3600,
          autoReplicate: true,
        },
        replication: {
          enabled: true,
          targetCopies: 2,
          providerBaseUrls: ["https://replica.example.com/storage"],
        },
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
      },
    });
    const now = new Date().toISOString();

    db.upsertStorageLease({
      leaseId: "lease-health-1",
      cid: "cid-health-1",
      bundleHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bundleKind: "artifact.bundle",
      requesterAddress:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      providerAddress:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      providerBaseUrl: "https://storage.example.com/storage",
      sizeBytes: 200,
      ttlSeconds: 3600,
      amountWei: "1",
      status: "active",
      storagePath: "/tmp/cid-health-1",
      requestKey: "lease-health-1",
      receipt: {
        leaseId: "lease-health-1",
        cid: "cid-health-1",
        bundleHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bundleKind: "artifact.bundle",
        requesterAddress:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        providerAddress:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        sizeBytes: 200,
        ttlSeconds: 3600,
        amountWei: "1",
        createdAt: now,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        providerSignature: "0x01",
      },
      receiptHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      createdAt: now,
      updatedAt: now,
    } satisfies StorageLeaseRecord);

    const snapshot = buildStorageLeaseHealthSnapshot({
      config,
      db,
      limit: 10,
    });
    expect(snapshot.totalLeases).toBe(1);
    expect(snapshot.entries[0]?.renewalDue).toBe(true);
    expect(snapshot.entries[0]?.auditDue).toBe(true);
    expect(snapshot.entries[0]?.replicationGap).toBeGreaterThan(0);
    expect(snapshot.entries[0]?.level).toBe("critical");

    db.close();
  });
});
