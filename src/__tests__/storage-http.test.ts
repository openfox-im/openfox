import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { hashStorageReceipt } from "tosdk";
import { startStorageProviderServer } from "../storage/http.js";
import { buildBundleFromInput, writeBundleToPath } from "../storage/bundle.js";
import { createTestConfig, createTestDb, createTestIdentity } from "./mocks.js";
import {
  DEFAULT_STORAGE_MARKET_CONFIG,
  type StorageLeaseRecord,
} from "../types.js";

const tempPaths: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  while (tempPaths.length) {
    const target = tempPaths.pop();
    if (!target) continue;
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("storage provider server", () => {
  it("serves quote, head, get, audit, and renew endpoints for stored bundles", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const storageDir = makeTempDir("openfox-storage-provider-");
    const inputPath = path.join(storageDir, "artifact.json");
    fs.writeFileSync(inputPath, JSON.stringify({ result: "ok" }));

    const built = await buildBundleFromInput({
      inputPath,
      bundleKind: "artifact.bundle",
      createdBy: identity.address,
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    const storagePath = path.join(storageDir, `${built.cid}.json`);
    await writeBundleToPath(storagePath, built.bytes);

    const issuedAt = "2026-03-09T00:00:00.000Z";
    const expiresAt = "2026-03-10T00:00:00.000Z";
    const receipt = {
      version: 1 as const,
      receiptId: "storage:lease-1",
      leaseId: "lease-1",
      cid: built.cid,
      bundleHash: built.bundle.manifest.bundle_hash,
      bundleKind: "artifact.bundle",
      providerAddress: identity.address,
      requesterAddress:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      sizeBytes: built.bytes.byteLength,
      ttlSeconds: 86400,
      amountWei: "1000",
      status: "active" as const,
      issuedAt,
      expiresAt,
      artifactUrl: null,
      paymentTxHash: null,
    };
    const lease: StorageLeaseRecord = {
      leaseId: "lease-1",
      quoteId: null,
      cid: built.cid,
      bundleHash: built.bundle.manifest.bundle_hash,
      bundleKind: "artifact.bundle",
      requesterAddress: receipt.requesterAddress,
      providerAddress: identity.address,
      providerBaseUrl: "http://127.0.0.1/storage",
      sizeBytes: built.bytes.byteLength,
      ttlSeconds: 86400,
      amountWei: "1000",
      status: "active",
      storagePath,
      requestKey: "storage:test:key",
      paymentId: null,
      receipt,
      receiptHash: hashStorageReceipt(receipt),
      anchorTxHash: null,
      anchorReceipt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    };
    db.upsertStorageLease(lease);

    const server = await startStorageProviderServer({
      identity,
      address: identity.address,
      privateKey:
        "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c",
      config: createTestConfig({
        x402Server: { enabled: false },
      }),
      db,
      storageConfig: {
        ...DEFAULT_STORAGE_MARKET_CONFIG,
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        storageDir,
        allowAnonymousGet: true,
        anchor: {
          ...DEFAULT_STORAGE_MARKET_CONFIG.anchor,
          enabled: false,
        },
      },
    });

    try {
      const quoteResponse = await fetch(`${server.url}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cid: built.cid,
          bundle_kind: "artifact.bundle",
          size_bytes: built.bytes.byteLength,
          ttl_seconds: 86400,
          requester_address: receipt.requesterAddress,
        }),
      });
      expect(quoteResponse.status).toBe(200);
      const quote = (await quoteResponse.json()) as { quote_id: string; cid: string };
      expect(quote.cid).toBe(built.cid);
      expect(quote.quote_id).toBeTruthy();

      const headResponse = await fetch(
        `${server.url}/head/${encodeURIComponent(built.cid)}`,
      );
      expect(headResponse.status).toBe(200);
      const head = (await headResponse.json()) as { lease_id: string; cid: string };
      expect(head.lease_id).toBe("lease-1");
      expect(head.cid).toBe(built.cid);

      const getResponse = await fetch(
        `${server.url}/get/${encodeURIComponent(built.cid)}`,
      );
      expect(getResponse.status).toBe(200);
      const fetched = (await getResponse.json()) as {
        lease: { lease_id: string };
        bundle: { manifest: { bundle_hash: string } };
      };
      expect(fetched.lease.lease_id).toBe("lease-1");
      expect(fetched.bundle.manifest.bundle_hash).toBe(
        built.bundle.manifest.bundle_hash,
      );

      const auditResponse = await fetch(`${server.url}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lease_id: "lease-1",
          challenge_nonce: "auditnonce123",
        }),
      });
      expect(auditResponse.status).toBe(200);
      const audit = (await auditResponse.json()) as { lease_id: string; status: string };
      expect(audit.lease_id).toBe("lease-1");
      expect(audit.status).toBe("verified");

      const renewResponse = await fetch(`${server.url}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester: {
            identity: {
              kind: "tos",
              value: receipt.requesterAddress,
            },
          },
          request_nonce: "renewnonce123",
          request_expires_at: Math.floor(Date.now() / 1000) + 300,
          lease_id: "lease-1",
          ttl_seconds: 3600,
        }),
      });
      expect(renewResponse.status).toBe(400);
      const renewBody = (await renewResponse.json()) as { reason: string };
      expect(renewBody.reason).toContain("x402 payment manager is unavailable");
    } finally {
      await server.close();
      db.close();
    }
  });
});
