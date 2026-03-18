import type {
  ProofVerifyInvocationResponse,
  StorageGetInvocationResponse,
} from "./types.js";

export interface NewsFetchCaptureSkillResult {
  canonicalUrl: string;
  httpStatus: number;
  contentType: string;
  articleSha256: `0x${string}`;
  articleText?: string;
  headline?: string;
  publisher?: string;
}

export interface ZkTlsBundleSkillResult {
  format: string;
  bundleSha256: `0x${string}`;
  bundle: Record<string, unknown>;
  originClaims?: Record<string, unknown>;
  verifierMaterialReferences?: Array<Record<string, unknown>>;
  integrity?: Record<string, unknown>;
}

export interface ZkTlsProveSkillResult {
  attestation: string;
  attestationSha256: `0x${string}`;
  serverName: string;
  sentLen: number;
  recvLen: number;
}

export interface ProofVerifySkillResult {
  verdict: ProofVerifyInvocationResponse["verdict"];
  summary: string;
  metadata: Record<string, unknown>;
  verifierReceiptSha256: `0x${string}`;
  verdictReason?: string;
  verifierMaterialReference?: Record<string, unknown>;
  boundSubjectHashes?: Record<string, unknown>;
}

export interface StoragePutSkillResult {
  objectId: string;
  objectKey?: string;
  contentType: string;
  contentSha256: string;
  sizeBytes: number;
  ttlSeconds: number;
  expiresAt: number;
  bufferBase64: string;
}

export type StorageGetSkillResult =
  | {
      status: "ok";
      response: Omit<StorageGetInvocationResponse, "payment_tx_hash" | "fetched_at">;
    }
  | {
      status: "rejected";
      httpStatus: number;
      reason: string;
      pruneExpired?: boolean;
    };

export function parseNewsFetchCaptureSkillResult(
  value: unknown,
): NewsFetchCaptureSkillResult {
  const record = asRecord(value, "newsfetch.capture result");
  return {
    canonicalUrl: requireString(record.canonicalUrl, "canonicalUrl"),
    httpStatus: requireNumber(record.httpStatus, "httpStatus"),
    contentType: requireString(record.contentType, "contentType"),
    articleSha256: requireHex64(record.articleSha256, "articleSha256"),
    articleText: optionalString(record.articleText, "articleText"),
    headline: optionalString(record.headline, "headline"),
    publisher: optionalString(record.publisher, "publisher"),
  };
}

export function parseZkTlsBundleSkillResult(
  value: unknown,
): ZkTlsBundleSkillResult {
  const record = asRecord(value, "zktls.bundle result");
  return {
    format: requireString(record.format, "format"),
    bundleSha256: requireHex64(record.bundleSha256, "bundleSha256"),
    bundle: asRecord(record.bundle, "bundle"),
    originClaims:
      record.originClaims && typeof record.originClaims === "object" && !Array.isArray(record.originClaims)
        ? (record.originClaims as Record<string, unknown>)
        : undefined,
    verifierMaterialReferences: Array.isArray(record.verifierMaterialReferences)
      ? record.verifierMaterialReferences.map((entry, index) =>
          asRecord(entry, `verifierMaterialReferences[${index}]`),
        )
      : undefined,
    integrity:
      record.integrity && typeof record.integrity === "object" && !Array.isArray(record.integrity)
        ? (record.integrity as Record<string, unknown>)
        : undefined,
  };
}

export function parseZkTlsProveSkillResult(
  value: unknown,
): ZkTlsProveSkillResult {
  const record = asRecord(value, "zktls.prove result");
  return {
    attestation: requireString(record.attestation, "attestation"),
    attestationSha256: requireHex64(
      record.attestationSha256,
      "attestationSha256",
    ),
    serverName: requireString(record.serverName, "serverName"),
    sentLen: requireNumber(
      record.sentLen ?? record.sentBytes,
      "sentLen",
    ),
    recvLen: requireNumber(
      record.recvLen ?? record.receivedBytes,
      "recvLen",
    ),
  };
}

export function parseProofVerifySkillResult(
  value: unknown,
): ProofVerifySkillResult {
  const record = asRecord(value, "proofverify result");
  const verdict = requireString(record.verdict, "verdict");
  if (verdict !== "valid" && verdict !== "invalid" && verdict !== "inconclusive") {
    throw new Error(`proofverify result.verdict is invalid: ${verdict}`);
  }
  return {
    verdict,
    summary: requireString(record.summary, "summary"),
    metadata: asRecord(record.metadata, "metadata"),
    verifierReceiptSha256: requireHex64(
      record.verifierReceiptSha256,
      "verifierReceiptSha256",
    ),
    verdictReason: optionalString(record.verdictReason, "verdictReason"),
    verifierMaterialReference:
      record.verifierMaterialReference &&
      typeof record.verifierMaterialReference === "object" &&
      !Array.isArray(record.verifierMaterialReference)
        ? (record.verifierMaterialReference as Record<string, unknown>)
        : undefined,
    boundSubjectHashes:
      record.boundSubjectHashes &&
      typeof record.boundSubjectHashes === "object" &&
      !Array.isArray(record.boundSubjectHashes)
        ? (record.boundSubjectHashes as Record<string, unknown>)
        : undefined,
  };
}

export function parseStoragePutSkillResult(
  value: unknown,
): StoragePutSkillResult {
  const record = asRecord(value, "storage-object.put result");
  return {
    objectId: requireString(record.objectId, "objectId"),
    objectKey: optionalString(record.objectKey, "objectKey"),
    contentType: requireString(record.contentType, "contentType"),
    contentSha256: requireString(record.contentSha256, "contentSha256"),
    sizeBytes: requireNumber(record.sizeBytes, "sizeBytes"),
    ttlSeconds: requireNumber(record.ttlSeconds, "ttlSeconds"),
    expiresAt: requireNumber(record.expiresAt, "expiresAt"),
    bufferBase64: requireString(record.bufferBase64, "bufferBase64"),
  };
}

export function parseStorageGetSkillResult(
  value: unknown,
): StorageGetSkillResult {
  const record = asRecord(value, "storage-object.get result");
  const status = requireString(record.status, "status");
  if (status === "ok") {
    const response = asRecord(record.response, "response");
    return {
      status,
      response: {
        status: "ok",
        object_id: requireString(response.object_id, "response.object_id"),
        expires_at: optionalNumber(response.expires_at, "response.expires_at"),
        content_type: requireString(
          response.content_type,
          "response.content_type",
        ),
        content_sha256: requireString(
          response.content_sha256,
          "response.content_sha256",
        ),
        size_bytes: requireNumber(response.size_bytes, "response.size_bytes"),
        content_text: optionalString(response.content_text, "response.content_text"),
        content_base64: optionalString(
          response.content_base64,
          "response.content_base64",
        ),
        metadata:
          response.metadata && typeof response.metadata === "object" && !Array.isArray(response.metadata)
            ? (response.metadata as Record<string, unknown>)
            : undefined,
      },
    };
  }
  if (status === "rejected") {
    return {
      status,
      httpStatus: requireNumber(record.httpStatus, "httpStatus"),
      reason: requireString(record.reason, "reason"),
      ...(typeof record.pruneExpired === "boolean"
        ? { pruneExpired: record.pruneExpired }
        : {}),
    };
  }
  throw new Error(`storage-object.get result.status is invalid: ${status}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when present`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNumber(value, field);
}

function requireHex64(value: unknown, field: string): `0x${string}` {
  const normalized = requireString(value, field);
  if (!/^0x[0-9a-f]{64}$/i.test(normalized)) {
    throw new Error(`${field} must be a 32-byte 0x-prefixed hex string`);
  }
  return normalized as `0x${string}`;
}
