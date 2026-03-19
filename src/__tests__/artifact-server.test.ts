import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "tosdk/accounts";
import { createArtifactManager } from "../artifacts/manager.js";
import { startArtifactCaptureServer } from "../artifacts/server.js";
import { DEFAULT_ARTIFACT_PIPELINE_CONFIG } from "../types.js";
import { createTestDb, createTestIdentity } from "./mocks.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

describe("artifact capture server", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length) {
      await closers.pop()?.();
    }
  });

  it("captures public news idempotently and exposes stored artifacts", async () => {
    const db = createTestDb();
    closers.push(async () => db.close());
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const identity = {
      ...createTestIdentity(),
      account,
      address: account.address,
      creatorAddress: account.address,
    };
    const manager = createArtifactManager({
      identity,
      requesterAccount: account,
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
              "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
            requester_address: identity.address,
            cid: input.cid,
            bundle_kind: input.bundleKind,
            size_bytes: input.sizeBytes,
            ttl_seconds: input.ttlSeconds,
            amount_tomi: "1000",
            expires_at: "2026-03-10T01:00:00.000Z",
          };
        },
        async put(input) {
          return {
            lease_id: `lease-${input.cid}`,
            cid: input.cid,
            bundle_hash: "0x11",
            bundle_kind: input.bundleKind,
            size_bytes: 128,
            ttl_seconds: input.ttlSeconds,
            amount_tomi: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: `storage:lease-${input.cid}`,
            receipt_hash: "0x22",
            payment_tx_hash: "0x33",
            get_url: `http://provider.test/storage/get/${input.cid}`,
            head_url: `http://provider.test/storage/head/${input.cid}`,
          };
        },
        async head(input) {
          return {
            lease_id: `lease-${input.cid}`,
            cid: input.cid,
            bundle_hash: "0x11",
            bundle_kind: "public_news.capture",
            size_bytes: 128,
            ttl_seconds: 3600,
            amount_tomi: "1000",
            issued_at: "2026-03-10T00:00:00.000Z",
            expires_at: "2026-03-10T01:00:00.000Z",
            receipt_id: `storage:lease-${input.cid}`,
            receipt_hash: "0x22",
            payment_tx_hash: "0x33",
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
            response_hash: "0x44",
            checked_at: "2026-03-10T00:02:00.000Z",
          };
        },
      },
    });

    const server = await startArtifactCaptureServer({
      identity,
      db,
      manager,
      config: {
        ...DEFAULT_ARTIFACT_PIPELINE_CONFIG.service,
        enabled: true,
        port: 0,
        pathPrefix: "/artifacts",
      },
      captureCapability: "public_news.capture",
      evidenceCapability: "oracle.evidence",
    });
    closers.push(() => server.close());

    const payload = {
      capability: "public_news.capture",
      requester: {
        identity: {
          kind: "tos",
          value: identity.address,
        },
      },
      request_nonce: "nonce-001",
      request_expires_at: Math.floor(Date.now() / 1000) + 300,
      title: "Breaking News",
      source_url: "https://example.com/news/1",
      headline: "Breaking headline",
      body_text: "Breaking body",
    };

    const firstResponse = await fetch(`${server.url}/capture-news`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(firstResponse.status).toBe(200);
    const firstJson = (await firstResponse.json()) as {
      artifact: { artifactId: string };
      artifact_url: string;
    };
    expect(firstJson.artifact_url).toContain("/artifacts/item/");

    const secondResponse = await fetch(`${server.url}/capture-news`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(secondResponse.status).toBe(200);
    const secondJson = (await secondResponse.json()) as {
      artifact: { artifactId: string };
    };
    expect(secondJson.artifact.artifactId).toBe(firstJson.artifact.artifactId);

    const itemResponse = await fetch(firstJson.artifact_url);
    expect(itemResponse.status).toBe(200);
    const itemJson = (await itemResponse.json()) as {
      artifact: { title: string; sourceUrl: string | null };
    };
    expect(itemJson.artifact.title).toBe("Breaking News");
    expect(itemJson.artifact.sourceUrl).toBe("https://example.com/news/1");
  });
});
