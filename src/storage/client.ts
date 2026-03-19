import fs from "fs/promises";
import path from "path";
import type { PrivateKeyAccount } from "@tosnetwork/tosdk";
import type {
  StorageAuditResponse,
  StorageLeaseResponse,
  StoragePutRequest,
  StorageQuoteResponse,
  StorageRenewRequest,
  StorageRenewalResponse,
} from "./http.js";
import { buildBundleFromInput } from "./bundle.js";
import type { StorageBundle } from "./bundle.js";
import { x402Fetch } from "../runtime/x402.js";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function randomNonce(): string {
  return `storage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function requestStorageQuote(params: {
  providerBaseUrl: string;
  inputPath: string;
  bundleKind: string;
  requesterAddress: string;
  ttlSeconds: number;
}): Promise<StorageQuoteResponse> {
  const built = await buildBundleFromInput({
    inputPath: params.inputPath,
    bundleKind: params.bundleKind,
    createdBy: params.requesterAddress,
  });
  const response = await fetch(`${trimTrailingSlash(params.providerBaseUrl)}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cid: built.cid,
      bundle_kind: params.bundleKind,
      size_bytes: built.bytes.byteLength,
      ttl_seconds: params.ttlSeconds,
      requester_address: params.requesterAddress,
    }),
  });
  if (!response.ok) {
    throw new Error(`storage quote failed (${response.status}): ${await response.text()}`);
  }
  return readJsonResponse<StorageQuoteResponse>(response);
}

export async function storeBundleWithProvider(params: {
  providerBaseUrl: string;
  inputPath: string;
  bundleKind: string;
  requesterAccount: PrivateKeyAccount;
  requesterAddress: string;
  ttlSeconds: number;
  quoteId?: string;
}): Promise<StorageLeaseResponse> {
  const built = await buildBundleFromInput({
    inputPath: params.inputPath,
    bundleKind: params.bundleKind,
    createdBy: params.requesterAddress,
  });
  const payload: StoragePutRequest = {
    requester: {
      identity: {
        kind: "tos",
        value: params.requesterAddress as any,
      },
    },
    request_nonce: randomNonce(),
    request_expires_at: Math.floor(Date.now() / 1000) + 300,
    quote_id: params.quoteId,
    bundle_kind: params.bundleKind,
    ttl_seconds: params.ttlSeconds,
    cid: built.cid,
    bundle: built.bundle,
  };
  const result = await x402Fetch(
    `${trimTrailingSlash(params.providerBaseUrl)}/put`,
    params.requesterAccount,
    "POST",
    JSON.stringify(payload),
  );
  if (!result.success) {
    throw new Error(result.error || `storage put failed (${result.status ?? 0})`);
  }
  return result.response as StorageLeaseResponse;
}

export async function storePreparedBundleWithProvider(params: {
  providerBaseUrl: string;
  bundleKind: string;
  bundle: StorageBundle;
  cid: string;
  requesterAccount: PrivateKeyAccount;
  requesterAddress: string;
  ttlSeconds: number;
  quoteId?: string;
}): Promise<StorageLeaseResponse> {
  const payload: StoragePutRequest = {
    requester: {
      identity: {
        kind: "tos",
        value: params.requesterAddress as any,
      },
    },
    request_nonce: randomNonce(),
    request_expires_at: Math.floor(Date.now() / 1000) + 300,
    quote_id: params.quoteId,
    bundle_kind: params.bundleKind,
    ttl_seconds: params.ttlSeconds,
    cid: params.cid,
    bundle: params.bundle,
  };
  const result = await x402Fetch(
    `${trimTrailingSlash(params.providerBaseUrl)}/put`,
    params.requesterAccount,
    "POST",
    JSON.stringify(payload),
  );
  if (!result.success) {
    throw new Error(result.error || `storage put failed (${result.status ?? 0})`);
  }
  return result.response as StorageLeaseResponse;
}

export async function getStorageHead(params: {
  providerBaseUrl: string;
  cid: string;
}): Promise<StorageLeaseResponse> {
  const response = await fetch(`${trimTrailingSlash(params.providerBaseUrl)}/head/${encodeURIComponent(params.cid)}`);
  if (!response.ok) {
    throw new Error(`storage head failed (${response.status}): ${await response.text()}`);
  }
  return readJsonResponse<StorageLeaseResponse>(response);
}

export async function getStoredBundle(params: {
  providerBaseUrl: string;
  cid: string;
  outputPath?: string;
}): Promise<{ lease: StorageLeaseResponse; bundle: unknown }> {
  const response = await fetch(`${trimTrailingSlash(params.providerBaseUrl)}/get/${encodeURIComponent(params.cid)}`);
  if (!response.ok) {
    throw new Error(`storage get failed (${response.status}): ${await response.text()}`);
  }
  const result = (await response.json()) as { lease: StorageLeaseResponse; bundle: unknown };
  if (params.outputPath) {
    await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
    await fs.writeFile(params.outputPath, JSON.stringify(result.bundle, null, 2));
  }
  return result;
}

export async function auditStoredBundle(params: {
  providerBaseUrl: string;
  leaseId: string;
}): Promise<StorageAuditResponse> {
  const response = await fetch(`${trimTrailingSlash(params.providerBaseUrl)}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lease_id: params.leaseId,
      challenge_nonce: randomNonce(),
    }),
  });
  if (!response.ok) {
    throw new Error(`storage audit failed (${response.status}): ${await response.text()}`);
  }
  return readJsonResponse<StorageAuditResponse>(response);
}

export async function renewStoredLease(params: {
  providerBaseUrl: string;
  leaseId: string;
  requesterAccount: PrivateKeyAccount;
  requesterAddress: string;
  ttlSeconds?: number;
}): Promise<StorageRenewalResponse> {
  const payload: StorageRenewRequest = {
    requester: {
      identity: {
        kind: "tos",
        value: params.requesterAddress as any,
      },
    },
    request_nonce: randomNonce(),
    request_expires_at: Math.floor(Date.now() / 1000) + 300,
    lease_id: params.leaseId,
    ttl_seconds: params.ttlSeconds,
  };
  const result = await x402Fetch(
    `${trimTrailingSlash(params.providerBaseUrl)}/renew`,
    params.requesterAccount,
    "POST",
    JSON.stringify(payload),
  );
  if (!result.success) {
    throw new Error(result.error || `storage renew failed (${result.status ?? 0})`);
  }
  return result.response as StorageRenewalResponse;
}
