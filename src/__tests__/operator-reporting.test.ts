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
      "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143" as const;
    const otherProvider =
      "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2" as const;

    db.upsertStorageLease({
      leaseId: "lease-1",
      cid: "cid-1",
      bundleHash:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      bundleKind: "artifact.bundle",
      requesterAddress:
        "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
      providerAddress,
      providerBaseUrl: "https://storage-1.example.com/storage",
      sizeBytes: 100,
      ttlSeconds: 3600,
      amountTomi: "1",
      status: "active",
      storagePath: "/tmp/cid-1",
      requestKey: "req-1",
      receipt: {
        leaseId: "lease-1",
        cid: "cid-1",
        bundleHash:
          "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
        bundleKind: "artifact.bundle",
        requesterAddress:
          "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
        providerAddress,
        sizeBytes: 100,
        ttlSeconds: 3600,
        amountTomi: "1",
        createdAt: now,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        providerSignature:
          "0x01",
      },
      receiptHash:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
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
        "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
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
        "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
      providerBaseUrl: "https://artifacts.example.com",
      providerAddress: otherProvider,
      requesterAddress:
        "0x3a8fac52fb6c36430b80655354e5aa4f5e1a3533dddddddddddddddddddddddd",
      status: "failed",
      createdAt: now,
      updatedAt: now,
    } satisfies ArtifactRecord);

    db.upsertSignerExecution({
      executionId: "signer-1",
      quoteId: "quote-1",
      requestKey: "signer:req:1",
      requestHash:
        "0xb20d45fcf230c1d4053087f6df71ef5a43960ff5f61d976acb1fcfb4c40d9a10",
      providerAddress,
      walletAddress:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      requesterAddress:
        "0xa65c6a8098b54b791cf3a2582b3e07b704d087d56f8f8fbdba35995dae0b8241",
      targetAddress:
        "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
      valueTomi: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-1",
      policyHash:
        "0xffd5a4c82ff6c618d999d2315b4ffa704f7689e5b9f02d3597591aa4ef4b6b09",
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
      valueTomi: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-2",
      policyHash:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      scopeHash:
        "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
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
        minimumPriceTomi: "1000",
        pricePerMiBTomi: "1000",
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
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
      bundleKind: "artifact.bundle",
      requesterAddress:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      providerAddress:
        "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
      providerBaseUrl: "https://storage.example.com/storage",
      sizeBytes: 200,
      ttlSeconds: 3600,
      amountTomi: "1",
      status: "active",
      storagePath: "/tmp/cid-health-1",
      requestKey: "lease-health-1",
      receipt: {
        leaseId: "lease-health-1",
        cid: "cid-health-1",
        bundleHash:
          "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        bundleKind: "artifact.bundle",
        requesterAddress:
          "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
        providerAddress:
          "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
        sizeBytes: 200,
        ttlSeconds: 3600,
        amountTomi: "1",
        createdAt: now,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        providerSignature: "0x01",
      },
      receiptHash:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
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
