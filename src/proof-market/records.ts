import type { OpenFoxDatabase } from "../types.js";

export interface ZkTlsBundleOriginClaims {
  sourceUrl: string;
  canonicalUrl: string;
  sourcePolicyId?: string | null;
  sourcePolicyHost?: string | null;
  publisherHint?: string | null;
  headlineHint?: string | null;
  publisher?: string | null;
  headline?: string | null;
  fetchedAt: number;
  httpStatus: number;
  contentType: string;
}

export interface ProofMaterialReference {
  kind: string;
  ref: string;
  hash?: `0x${string}` | null;
  metadata?: Record<string, unknown> | null;
}

export interface ZkTlsBundleIntegrityRecord {
  bundleSha256: `0x${string}`;
  articleSha256?: `0x${string}` | null;
  sourceResponseSha256?: `0x${string}` | null;
}

export interface ZkTlsBundleRecord {
  recordId: string;
  jobId: string;
  requestKey: string;
  capability: string;
  requesterIdentity: string;
  providerBackend: {
    kind: "skills" | "builtin";
    stages: string[];
  };
  sourceUrl: string;
  resultUrl?: string | null;
  bundleUrl?: string | null;
  bundleFormat: string;
  originClaims: ZkTlsBundleOriginClaims;
  verifierMaterialReferences: ProofMaterialReference[];
  integrity: ZkTlsBundleIntegrityRecord;
  bundle: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZkTlsBundleSummarySnapshot {
  totalBundles: number;
  backendKinds: Record<string, number>;
  sourcePolicies: Record<string, number>;
  uniqueHosts: number;
  latestRecordId: string | null;
  latestCreatedAt: string | null;
  items: ZkTlsBundleRecord[];
  summary: string;
}

export type ProofVerificationMode =
  | "fallback"
  | "worker_backed"
  | "cryptographic";

export interface ProofVerificationRecord {
  recordId: string;
  resultId: string;
  requestKey: string;
  capability: string;
  requesterIdentity: string;
  providerBackend: {
    kind: "skills" | "builtin";
    stages: string[];
  };
  verifierClass: string;
  verificationMode: ProofVerificationMode;
  verdict: "valid" | "invalid" | "inconclusive";
  verdictReason: string;
  summary: string;
  verifierProfile?: string | null;
  verifierReceiptSha256: `0x${string}`;
  verifierMaterialReference?: ProofMaterialReference | null;
  boundSubjectHashes: {
    subjectSha256?: `0x${string}` | null;
    bundleSha256?: `0x${string}` | null;
    responseHash?: `0x${string}` | null;
  };
  request: {
    subjectUrl?: string | null;
    proofBundleUrl?: string | null;
  };
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProofVerificationSummarySnapshot {
  totalResults: number;
  verdicts: Record<string, number>;
  verifierClasses: Record<string, number>;
  verificationModes: Record<string, number>;
  realProofVerifications: number;
  fallbackVerifications: number;
  latestRecordId: string | null;
  latestCreatedAt: string | null;
  items: ProofVerificationRecord[];
  summary: string;
}

const ZKTLS_PREFIX = "proof_market:zktls";
const PROOF_PREFIX = "proof_market:verify";

function zktlsRecordKey(recordId: string): string {
  return `${ZKTLS_PREFIX}:record:${recordId}`;
}

function zktlsIndexKey(createdAt: string, recordId: string): string {
  return `${ZKTLS_PREFIX}:index:${createdAt}:${recordId}`;
}

function proofRecordKey(recordId: string): string {
  return `${PROOF_PREFIX}:record:${recordId}`;
}

function proofIndexKey(createdAt: string, recordId: string): string {
  return `${PROOF_PREFIX}:index:${createdAt}:${recordId}`;
}

function listIndexedRecords<T>(
  db: OpenFoxDatabase,
  indexPrefix: string,
  getKey: (recordId: string) => string,
  limit: number,
): T[] {
  const rows = db.raw
    .prepare("SELECT value FROM kv WHERE key LIKE ? ORDER BY key DESC LIMIT ?")
    .all(`${indexPrefix}:index:%`, Math.max(1, limit)) as Array<{ value: string }>;
  return rows
    .map((row) =>
      db.getKV(
        row.value.startsWith(`${indexPrefix}:record:`)
          ? row.value
          : getKey(row.value),
      ),
    )
    .filter((raw): raw is string => typeof raw === "string" && raw.length > 0)
    .map((raw) => JSON.parse(raw) as T);
}

function countBy<T>(
  items: T[],
  selector: (item: T) => string | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = selector(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function storeZkTlsBundleRecord(
  db: OpenFoxDatabase,
  record: ZkTlsBundleRecord,
): void {
  db.setKV(zktlsRecordKey(record.recordId), JSON.stringify(record));
  db.setKV(zktlsIndexKey(record.createdAt, record.recordId), record.recordId);
}

export function getZkTlsBundleRecord(
  db: OpenFoxDatabase,
  recordId: string,
): ZkTlsBundleRecord | null {
  const raw = db.getKV(zktlsRecordKey(recordId));
  return raw ? (JSON.parse(raw) as ZkTlsBundleRecord) : null;
}

export function listZkTlsBundleRecords(
  db: OpenFoxDatabase,
  limit = 20,
): ZkTlsBundleRecord[] {
  return listIndexedRecords<ZkTlsBundleRecord>(db, ZKTLS_PREFIX, zktlsRecordKey, limit);
}

export function buildZkTlsBundleSummary(
  db: OpenFoxDatabase,
  limit = 20,
): ZkTlsBundleSummarySnapshot {
  const items = listZkTlsBundleRecords(db, limit);
  const latest = items[0] ?? null;
  const hosts = new Set(
    items
      .map((item) => item.originClaims.sourcePolicyHost || new URL(item.originClaims.canonicalUrl).hostname)
      .filter(Boolean),
  );
  return {
    totalBundles: items.length,
    backendKinds: countBy(items, (item) => item.providerBackend.kind),
    sourcePolicies: countBy(items, (item) => item.originClaims.sourcePolicyId || "(unspecified)"),
    uniqueHosts: hosts.size,
    latestRecordId: latest?.recordId ?? null,
    latestCreatedAt: latest?.createdAt ?? null,
    items,
    summary:
      items.length === 0
        ? "No zkTLS bundle records stored."
        : `${items.length} zkTLS bundle record(s), ${hosts.size} unique host(s), policies=${Object.entries(
            countBy(items, (item) => item.originClaims.sourcePolicyId || "(unspecified)"),
          )
            .map(([policy, count]) => `${policy}=${count}`)
            .join(", ")}.`,
  };
}

export function buildZkTlsBundleSummaryReport(
  snapshot: ZkTlsBundleSummarySnapshot,
): string {
  return [
    "=== OPENFOX ZKTLS SUMMARY ===",
    `Bundles:         ${snapshot.totalBundles}`,
    `Unique hosts:    ${snapshot.uniqueHosts}`,
    `Latest record:   ${snapshot.latestRecordId || "(none)"}`,
    `Latest created:  ${snapshot.latestCreatedAt || "(none)"}`,
    `Backend kinds:   ${
      Object.keys(snapshot.backendKinds).length === 0
        ? "(none)"
        : Object.entries(snapshot.backendKinds)
            .map(([kind, count]) => `${kind}=${count}`)
            .join(", ")
    }`,
    `Source policies: ${
      Object.keys(snapshot.sourcePolicies).length === 0
        ? "(none)"
        : Object.entries(snapshot.sourcePolicies)
            .map(([policy, count]) => `${policy}=${count}`)
            .join(", ")
    }`,
    "",
    `Summary: ${snapshot.summary}`,
  ].join("\n");
}

export function storeProofVerificationRecord(
  db: OpenFoxDatabase,
  record: ProofVerificationRecord,
): void {
  db.setKV(proofRecordKey(record.recordId), JSON.stringify(record));
  db.setKV(proofIndexKey(record.createdAt, record.recordId), record.recordId);
}

export function getProofVerificationRecord(
  db: OpenFoxDatabase,
  recordId: string,
): ProofVerificationRecord | null {
  const raw = db.getKV(proofRecordKey(recordId));
  return raw ? (JSON.parse(raw) as ProofVerificationRecord) : null;
}

export function listProofVerificationRecords(
  db: OpenFoxDatabase,
  limit = 20,
): ProofVerificationRecord[] {
  return listIndexedRecords<ProofVerificationRecord>(
    db,
    PROOF_PREFIX,
    proofRecordKey,
    limit,
  );
}

export function buildProofVerificationSummary(
  db: OpenFoxDatabase,
  limit = 20,
): ProofVerificationSummarySnapshot {
  const items = listProofVerificationRecords(db, limit);
  const latest = items[0] ?? null;
  const verifierClasses = countBy(items, (item) => item.verifierClass);
  const verificationModes = countBy(items, (item) => item.verificationMode);
  const verdicts = countBy(items, (item) => item.verdict);
  const realProofVerifications = items.filter(
    (item) =>
      item.verificationMode !== "fallback" &&
      item.verifierClass === "cryptographic_proof_verification",
  ).length;
  const fallbackVerifications = items.filter(
    (item) => item.verificationMode === "fallback",
  ).length;
  return {
    totalResults: items.length,
    verdicts,
    verifierClasses,
    verificationModes,
    realProofVerifications,
    fallbackVerifications,
    latestRecordId: latest?.recordId ?? null,
    latestCreatedAt: latest?.createdAt ?? null,
    items,
    summary:
      items.length === 0
        ? "No proof verification records stored."
        : `${items.length} verification record(s), fallback=${fallbackVerifications}, proof_class=${realProofVerifications}, verdicts=${Object.entries(
            verdicts,
          )
            .map(([verdict, count]) => `${verdict}=${count}`)
            .join(", ")}.`,
  };
}

export function buildProofVerificationSummaryReport(
  snapshot: ProofVerificationSummarySnapshot,
): string {
  return [
    "=== OPENFOX PROOF VERIFICATION SUMMARY ===",
    `Results:         ${snapshot.totalResults}`,
    `Real proof:      ${snapshot.realProofVerifications}`,
    `Fallback:        ${snapshot.fallbackVerifications}`,
    `Latest record:   ${snapshot.latestRecordId || "(none)"}`,
    `Latest created:  ${snapshot.latestCreatedAt || "(none)"}`,
    `Verdicts:        ${
      Object.keys(snapshot.verdicts).length === 0
        ? "(none)"
        : Object.entries(snapshot.verdicts)
            .map(([verdict, count]) => `${verdict}=${count}`)
            .join(", ")
    }`,
    `Classes:         ${
      Object.keys(snapshot.verifierClasses).length === 0
        ? "(none)"
        : Object.entries(snapshot.verifierClasses)
            .map(([kind, count]) => `${kind}=${count}`)
            .join(", ")
    }`,
    `Modes:           ${
      Object.keys(snapshot.verificationModes).length === 0
        ? "(none)"
        : Object.entries(snapshot.verificationModes)
            .map(([mode, count]) => `${mode}=${count}`)
            .join(", ")
    }`,
    "",
    `Summary: ${snapshot.summary}`,
  ].join("\n");
}
