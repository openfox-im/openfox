import { createHash } from "crypto";
import {
  hashStorageReceipt,
  type Address,
  type StorageReceipt,
} from "@tosnetwork/tosdk";
import type {
  OpenFoxDatabase,
  StorageAuditRecord,
  StorageLeaseRecord,
  StorageRenewalRecord,
} from "../types.js";
import type {
  StorageLeaseResponse,
  StorageRenewalResponse,
} from "./http.js";
import {
  renewStoredLease,
  storePreparedBundleWithProvider,
  getStoredBundle,
} from "./client.js";
import { readBundleFromPath, type StorageBundle } from "./bundle.js";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function deriveStorageProviderBaseUrl(
  lease: Pick<StorageLeaseRecord, "providerBaseUrl" | "storagePath" | "receipt">,
): string | null {
  const explicit = lease.providerBaseUrl?.trim();
  if (explicit) return trimTrailingSlash(explicit);
  const candidates = [lease.receipt.artifactUrl, lease.storagePath].filter(
    (value): value is string => Boolean(value && /^https?:\/\//i.test(value)),
  );
  for (const candidate of candidates) {
    const normalized = trimTrailingSlash(candidate);
    const match = normalized.match(/^(https?:\/\/.+?)(?:\/(?:get|head)\/[^/]+)?$/i);
    if (match?.[1]) {
      return trimTrailingSlash(match[1]);
    }
  }
  return null;
}

export async function loadStoredBundleFromLease(
  lease: Pick<StorageLeaseRecord, "storagePath">,
): Promise<StorageBundle> {
  if (/^https?:\/\//i.test(lease.storagePath)) {
    const response = await fetch(lease.storagePath);
    if (!response.ok) {
      throw new Error(`storage get failed (${response.status}): ${await response.text()}`);
    }
    const result = (await response.json()) as { bundle: StorageBundle };
    return result.bundle;
  }
  return readBundleFromPath(lease.storagePath);
}

function buildTrackedReceipt(input: {
  response: StorageLeaseResponse;
  requesterAddress: Address;
}): StorageReceipt {
  return {
    version: 1,
    receiptId: input.response.receipt_id,
    leaseId: input.response.lease_id,
    cid: input.response.cid,
    bundleHash: input.response.bundle_hash as `0x${string}`,
    bundleKind: input.response.bundle_kind,
    providerAddress: input.response.provider_address as Address,
    requesterAddress: input.requesterAddress,
    sizeBytes: input.response.size_bytes,
    ttlSeconds: input.response.ttl_seconds,
    amountTomi: input.response.amount_tomi,
    status: "active",
    issuedAt: input.response.issued_at,
    expiresAt: input.response.expires_at,
    artifactUrl: input.response.get_url,
    paymentTxHash:
      (input.response.payment_tx_hash as `0x${string}` | undefined) ?? null,
  };
}

export function createTrackedStorageLeaseRecord(input: {
  response: StorageLeaseResponse;
  requesterAddress: Address;
  providerBaseUrl: string;
  requestKey: string;
  createdAt?: string;
}): StorageLeaseRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const receipt = buildTrackedReceipt({
    response: input.response,
    requesterAddress: input.requesterAddress,
  });
  return {
    leaseId: input.response.lease_id,
    quoteId: null,
    cid: input.response.cid,
    bundleHash: input.response.bundle_hash as `0x${string}`,
    bundleKind: input.response.bundle_kind,
    requesterAddress: input.requesterAddress,
    providerAddress: input.response.provider_address as Address,
    providerBaseUrl: trimTrailingSlash(input.providerBaseUrl),
    sizeBytes: input.response.size_bytes,
    ttlSeconds: input.response.ttl_seconds,
    amountTomi: input.response.amount_tomi,
    status: "active",
    storagePath: input.response.get_url,
    requestKey: input.requestKey,
    paymentId: null,
    receipt,
    receiptHash: hashStorageReceipt(receipt),
    anchorTxHash:
      (input.response.anchor_tx_hash as `0x${string}` | undefined) ?? null,
    anchorReceipt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createTrackedStorageRenewalRecord(input: {
  response: StorageRenewalResponse;
  requesterAddress: Address;
  providerBaseUrl: string;
  createdAt?: string;
}): StorageRenewalRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const receipt = buildTrackedReceipt({
    response: input.response,
    requesterAddress: input.requesterAddress,
  });
  return {
    renewalId: input.response.renewal_id,
    leaseId: input.response.lease_id,
    cid: input.response.cid,
    requesterAddress: input.requesterAddress,
    providerAddress: input.response.provider_address as Address,
    providerBaseUrl: trimTrailingSlash(input.providerBaseUrl),
    previousExpiresAt: input.response.previous_expires_at,
    renewedExpiresAt: input.response.renewed_expires_at,
    addedTtlSeconds: input.response.added_ttl_seconds,
    amountTomi: input.response.amount_tomi,
    paymentId: null,
    receipt,
    receiptHash: hashStorageReceipt(receipt),
    createdAt,
    updatedAt: createdAt,
  };
}

export async function renewTrackedLease(params: {
  lease: StorageLeaseRecord;
  requesterAccount: { address: Address } & { signMessage?: unknown };
  requesterAddress: Address;
  ttlSeconds?: number;
  db?: OpenFoxDatabase;
}): Promise<{ response: StorageRenewalResponse; providerBaseUrl: string }> {
  const providerBaseUrl = deriveStorageProviderBaseUrl(params.lease);
  if (!providerBaseUrl) {
    throw new Error(`provider base URL is unavailable for lease ${params.lease.leaseId}`);
  }
  const response = await renewStoredLease({
    providerBaseUrl,
    leaseId: params.lease.leaseId,
    requesterAccount: params.requesterAccount as any,
    requesterAddress: params.requesterAddress,
    ttlSeconds: params.ttlSeconds,
  });
  if (params.db) {
    const updatedLease = createTrackedStorageLeaseRecord({
      response,
      requesterAddress: params.requesterAddress,
      providerBaseUrl,
      requestKey: params.lease.requestKey,
      createdAt: params.lease.createdAt,
    });
    params.db.upsertStorageLease({
      ...updatedLease,
      quoteId: params.lease.quoteId ?? null,
      paymentId: params.lease.paymentId ?? null,
    });
    params.db.upsertStorageRenewal(
      createTrackedStorageRenewalRecord({
        response,
        requesterAddress: params.requesterAddress,
        providerBaseUrl,
      }),
    );
  }
  return { response, providerBaseUrl };
}

export async function replicateTrackedLease(params: {
  sourceLease: StorageLeaseRecord;
  targetProviderBaseUrl: string;
  requesterAccount: { address: Address } & { signMessage?: unknown };
  requesterAddress: Address;
  ttlSeconds?: number;
  db?: OpenFoxDatabase;
}): Promise<StorageLeaseRecord> {
  const bundle = await loadStoredBundleFromLease(params.sourceLease);
  const response = await storePreparedBundleWithProvider({
    providerBaseUrl: trimTrailingSlash(params.targetProviderBaseUrl),
    bundleKind: params.sourceLease.bundleKind,
    bundle,
    cid: params.sourceLease.cid,
    requesterAccount: params.requesterAccount as any,
    requesterAddress: params.requesterAddress,
    ttlSeconds: params.ttlSeconds ?? params.sourceLease.ttlSeconds,
  });
  const record = createTrackedStorageLeaseRecord({
    response,
    requesterAddress: params.requesterAddress,
    providerBaseUrl: trimTrailingSlash(params.targetProviderBaseUrl),
    requestKey: `storage:replicate:${params.sourceLease.leaseId}:${trimTrailingSlash(params.targetProviderBaseUrl)}:${Date.now()}`,
  });
  if (params.db) {
    params.db.upsertStorageLease(record);
  }
  return record;
}

export async function auditLocalStorageLease(params: {
  lease: StorageLeaseRecord;
}): Promise<StorageAuditRecord> {
  const checkedAt = new Date().toISOString();
  try {
    const rawBundle = await loadStoredBundleFromLease(params.lease);
    const responseHash = hashStorageReceipt({
      ...params.lease.receipt,
      metadata: {
        ...(params.lease.receipt.metadata || {}),
        audit_mode: "local",
        content_sha256: createHash("sha256")
          .update(JSON.stringify(rawBundle))
          .digest("hex"),
      },
    });
    return {
      auditId: `${params.lease.leaseId}:local:${Date.now()}`,
      leaseId: params.lease.leaseId,
      cid: params.lease.cid,
      status: "verified",
      challengeNonce: `local-${Date.now().toString(36)}`,
      responseHash,
      details: {
        source: /^https?:\/\//i.test(params.lease.storagePath) ? "remote" : "local",
      },
      checkedAt,
      createdAt: checkedAt,
      updatedAt: checkedAt,
    };
  } catch (error) {
    return {
      auditId: `${params.lease.leaseId}:local:${Date.now()}`,
      leaseId: params.lease.leaseId,
      cid: params.lease.cid,
      status: "failed",
      challengeNonce: `local-${Date.now().toString(36)}`,
      responseHash: hashStorageReceipt({
        ...params.lease.receipt,
        metadata: {
          ...(params.lease.receipt.metadata || {}),
          audit_mode: "local",
          error: error instanceof Error ? error.message : String(error),
        },
      }),
      details: {
        source: /^https?:\/\//i.test(params.lease.storagePath) ? "remote" : "local",
        error: error instanceof Error ? error.message : String(error),
      },
      checkedAt,
      createdAt: checkedAt,
      updatedAt: checkedAt,
    };
  }
}

