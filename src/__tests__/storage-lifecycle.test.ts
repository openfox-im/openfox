import { describe, expect, it } from "vitest";
import {
  createTrackedStorageLeaseRecord,
  createTrackedStorageRenewalRecord,
  deriveStorageProviderBaseUrl,
} from "../storage/lifecycle.js";

describe("storage lifecycle helpers", () => {
  it("derives the provider base URL from tracked lease data", () => {
    const explicit = deriveStorageProviderBaseUrl({
      providerBaseUrl: "http://provider.test/storage/",
      storagePath: "/tmp/local-bundle.json",
      receipt: {
        version: 1,
        receiptId: "storage:lease-1",
        leaseId: "lease-1",
        cid: "bafytest",
        bundleHash: "0xabc",
        bundleKind: "artifact.bundle",
        providerAddress:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        requesterAddress:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        sizeBytes: 10,
        ttlSeconds: 60,
        amountWei: "1",
        status: "active",
        issuedAt: "2026-03-10T00:00:00.000Z",
        expiresAt: "2026-03-10T01:00:00.000Z",
        artifactUrl: "http://provider.test/storage/get/bafytest",
      },
    });
    expect(explicit).toBe("http://provider.test/storage");

    const inferred = deriveStorageProviderBaseUrl({
      providerBaseUrl: null,
      storagePath: "http://provider.test/storage/get/bafytest",
      receipt: {
        version: 1,
        receiptId: "storage:lease-1",
        leaseId: "lease-1",
        cid: "bafytest",
        bundleHash: "0xabc",
        bundleKind: "artifact.bundle",
        providerAddress:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        requesterAddress:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        sizeBytes: 10,
        ttlSeconds: 60,
        amountWei: "1",
        status: "active",
        issuedAt: "2026-03-10T00:00:00.000Z",
        expiresAt: "2026-03-10T01:00:00.000Z",
        artifactUrl: "http://provider.test/storage/get/bafytest",
      },
    });
    expect(inferred).toBe("http://provider.test/storage");
  });

  it("creates tracked lease and renewal records from provider responses", () => {
    const lease = createTrackedStorageLeaseRecord({
      response: {
        lease_id: "lease-1",
        cid: "bafytest",
        bundle_hash: "0xabc",
        bundle_kind: "artifact.bundle",
        size_bytes: 10,
        ttl_seconds: 60,
        amount_wei: "100",
        issued_at: "2026-03-10T00:00:00.000Z",
        expires_at: "2026-03-10T01:00:00.000Z",
        receipt_id: "storage:lease-1",
        receipt_hash: "0xhash",
        get_url: "http://provider.test/storage/get/bafytest",
        head_url: "http://provider.test/storage/head/bafytest",
        provider_address:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        payment_status: "confirmed",
      },
      requesterAddress:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      providerBaseUrl: "http://provider.test/storage",
      requestKey: "storage:test:key",
    });
    expect(lease.providerBaseUrl).toBe("http://provider.test/storage");
    expect(lease.storagePath).toBe("http://provider.test/storage/get/bafytest");

    const renewal = createTrackedStorageRenewalRecord({
      response: {
        renewal_id: "lease-1:renew:abc",
        lease_id: "lease-1",
        cid: "bafytest",
        bundle_hash: "0xabc",
        bundle_kind: "artifact.bundle",
        size_bytes: 10,
        ttl_seconds: 120,
        amount_wei: "150",
        issued_at: "2026-03-10T00:30:00.000Z",
        expires_at: "2026-03-10T02:00:00.000Z",
        previous_expires_at: "2026-03-10T01:00:00.000Z",
        renewed_expires_at: "2026-03-10T02:00:00.000Z",
        added_ttl_seconds: 3600,
        receipt_id: "storage:lease-1",
        receipt_hash: "0xhash",
        get_url: "http://provider.test/storage/get/bafytest",
        head_url: "http://provider.test/storage/head/bafytest",
        provider_address:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      requesterAddress:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      providerBaseUrl: "http://provider.test/storage",
    });
    expect(renewal.providerBaseUrl).toBe("http://provider.test/storage");
    expect(renewal.addedTtlSeconds).toBe(3600);
  });
});
