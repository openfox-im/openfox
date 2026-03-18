import { ulid } from "ulid";
import type { LocalAccount } from "tosdk/accounts";
import type { OpenFoxDatabase, OpenFoxIdentity, OpenFoxConfig } from "../types.js";
import { x402Fetch } from "../runtime/x402.js";
import type {
  NewsFetchInvocationResponse,
  ProofVerifyInvocationResponse,
  StoragePutInvocationResponse,
} from "../agent-discovery/types.js";

export interface EvidenceWorkflowPaymentRecord {
  role: "news_fetch" | "proof_verify" | "storage_put";
  providerBaseUrl: string;
  paymentTxHash: string;
  subjectRef: string;
}

export interface EvidenceWorkflowSourceRecord {
  sourceUrl: string;
  fetchResponse?: NewsFetchInvocationResponse;
  verifyResponse?: ProofVerifyInvocationResponse;
  status: "pending" | "verified" | "rejected";
  reason?: string;
}

export interface EvidenceWorkflowRunRecord {
  runId: string;
  title: string;
  question: string;
  quorumM: number;
  quorumN: number;
  status: "completed" | "failed";
  attemptedCount: number;
  validCount: number;
  aggregateObjectId?: string;
  aggregateResultUrl?: string;
  aggregateResponse?: StoragePutInvocationResponse;
  aggregateError?: string;
  sourceRecords: EvidenceWorkflowSourceRecord[];
  payments: EvidenceWorkflowPaymentRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceWorkflowCoordinator {
  run(input: {
    title: string;
    question: string;
    sourceUrls: string[];
    newsFetchBaseUrl: string;
    proofVerifyBaseUrl: string;
    storageBaseUrl?: string;
    quorumM: number;
    quorumN?: number;
    ttlSeconds?: number;
  }): Promise<EvidenceWorkflowRunRecord>;
  list(limit?: number): EvidenceWorkflowRunRecord[];
  get(runId: string): EvidenceWorkflowRunRecord | null;
}

function runKey(runId: string): string {
  return `evidence_workflow:run:${runId}`;
}

function runIndexKey(createdAt: string, runId: string): string {
  return `evidence_workflow:index:${createdAt}:${runId}`;
}

function storeRun(db: OpenFoxDatabase, record: EvidenceWorkflowRunRecord): void {
  db.setKV(runKey(record.runId), JSON.stringify(record));
  db.setKV(runIndexKey(record.createdAt, record.runId), record.runId);
}

function listRuns(db: OpenFoxDatabase, limit = 20): EvidenceWorkflowRunRecord[] {
  const rows = db.raw
    .prepare("SELECT key, value FROM kv WHERE key LIKE ? ORDER BY key DESC LIMIT ?")
    .all("evidence_workflow:index:%", limit) as Array<{ key: string; value: string }>;
  return rows
    .map((entry) =>
      entry.value.startsWith("evidence_workflow:run:") ? entry.value : runKey(entry.value),
    )
    .map((key) => db.getKV(key))
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => JSON.parse(value) as EvidenceWorkflowRunRecord);
}

function getRun(db: OpenFoxDatabase, runId: string): EvidenceWorkflowRunRecord | null {
  const raw = db.getKV(runKey(runId));
  return raw ? (JSON.parse(raw) as EvidenceWorkflowRunRecord) : null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function absoluteResultUrl(baseUrl: string, resultUrl: string | undefined): string | undefined {
  if (!resultUrl) return undefined;
  if (/^https?:\/\//i.test(resultUrl)) return resultUrl;
  return new URL(resultUrl, normalizeBaseUrl(baseUrl)).toString();
}

function requesterRef(identity: OpenFoxIdentity, config: OpenFoxConfig) {
  return {
    agent_id: config.agentId || identity.address.toLowerCase(),
    identity: {
      kind: "tos",
      value: identity.address.toLowerCase(),
    },
  };
}

export function createEvidenceWorkflowCoordinator(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  account?: LocalAccount;
  now?: () => Date;
}): EvidenceWorkflowCoordinator {
  const now = params.now ?? (() => new Date());

  return {
    async run(input) {
      const account = params.account ?? params.identity.account;
      if (!account) {
        throw new Error("A local account is required for evidence workflow coordination");
      }
      const createdAt = now().toISOString();
      const runId = ulid();
      const sourceUrls = input.sourceUrls.slice(0, Math.max(1, input.quorumN ?? input.sourceUrls.length));
      if (input.quorumM <= 0 || input.quorumM > sourceUrls.length) {
        throw new Error("quorumM must be between 1 and the number of sourceUrls being processed");
      }

      const payments: EvidenceWorkflowPaymentRecord[] = [];
      const sourceRecords: EvidenceWorkflowSourceRecord[] = [];

      for (let index = 0; index < sourceUrls.length; index += 1) {
        const sourceUrl = sourceUrls[index]!;
        const sourceRecord: EvidenceWorkflowSourceRecord = {
          sourceUrl,
          status: "pending",
        };
        try {
          const fetchPayload = {
            capability: "news.fetch",
            requester: requesterRef(params.identity, params.config),
            request_nonce: `news_${runId}_${index}`,
            request_expires_at: Math.floor(now().getTime() / 1000) + 300,
            source_url: sourceUrl,
            reason: `evidence workflow fetch ${runId}`,
          };
          const fetchResult = await x402Fetch(
            normalizeBaseUrl(input.newsFetchBaseUrl),
            account,
            "POST",
            JSON.stringify(fetchPayload),
          );
          if (!fetchResult.success) {
            throw new Error(fetchResult.error || `news.fetch failed with status ${fetchResult.status}`);
          }
          const fetchResponse = fetchResult.response as NewsFetchInvocationResponse;
          sourceRecord.fetchResponse = fetchResponse;
          if (fetchResponse.payment_tx_hash) {
            payments.push({
              role: "news_fetch",
              providerBaseUrl: normalizeBaseUrl(input.newsFetchBaseUrl),
              paymentTxHash: fetchResponse.payment_tx_hash,
              subjectRef: sourceUrl,
            });
          }

          const proofPayload = {
            capability: "proof.verify",
            requester: requesterRef(params.identity, params.config),
            request_nonce: `verify_${runId}_${index}`,
            request_expires_at: Math.floor(now().getTime() / 1000) + 300,
            subject_url: sourceUrl,
            subject_sha256: fetchResponse.article_sha256,
            proof_bundle_url: absoluteResultUrl(
              input.newsFetchBaseUrl,
              fetchResponse.zktls_bundle_url || fetchResponse.result_url,
            ),
            proof_bundle_sha256: fetchResponse.zktls_bundle_sha256,
            reason: `evidence workflow verify ${runId}`,
          };
          const proofResult = await x402Fetch(
            normalizeBaseUrl(input.proofVerifyBaseUrl),
            account,
            "POST",
            JSON.stringify(proofPayload),
          );
          if (!proofResult.success) {
            throw new Error(proofResult.error || `proof.verify failed with status ${proofResult.status}`);
          }
          const verifyResponse = proofResult.response as ProofVerifyInvocationResponse;
          sourceRecord.verifyResponse = verifyResponse;
          sourceRecord.status = verifyResponse.verdict === "valid" ? "verified" : "rejected";
          sourceRecord.reason = verifyResponse.summary;
          if (verifyResponse.payment_tx_hash) {
            payments.push({
              role: "proof_verify",
              providerBaseUrl: normalizeBaseUrl(input.proofVerifyBaseUrl),
              paymentTxHash: verifyResponse.payment_tx_hash,
              subjectRef: sourceUrl,
            });
          }
        } catch (error) {
          sourceRecord.status = "rejected";
          sourceRecord.reason = error instanceof Error ? error.message : String(error);
        }
        sourceRecords.push(sourceRecord);
      }

      const validCount = sourceRecords.filter((entry) => entry.verifyResponse?.verdict === "valid").length;
      const status: EvidenceWorkflowRunRecord["status"] = validCount >= input.quorumM ? "completed" : "failed";

      let aggregateResponse: StoragePutInvocationResponse | undefined;
      let aggregateObjectId: string | undefined;
      let aggregateResultUrl: string | undefined;
      let aggregateError: string | undefined;
      if (status === "completed" && input.storageBaseUrl) {
        try {
          const aggregatePayload = {
            version: 1,
            title: input.title,
            question: input.question,
            quorum: {
              m: input.quorumM,
              n: sourceUrls.length,
              valid: validCount,
            },
            sources: sourceRecords,
            payments,
            created_at: createdAt,
          };
          const storagePayload = {
            capability: "storage.put",
            requester: requesterRef(params.identity, params.config),
            request_nonce: `storage_${runId}`,
            request_expires_at: Math.floor(now().getTime() / 1000) + 300,
            content_type: "application/json",
            content_text: JSON.stringify(aggregatePayload),
            ttl_seconds: input.ttlSeconds,
            metadata: {
              kind: "evidence.aggregate",
              run_id: runId,
              question: input.question,
              valid_count: validCount,
              attempted_count: sourceUrls.length,
            },
            reason: `evidence workflow aggregate ${runId}`,
          };
          const storageResult = await x402Fetch(
            `${normalizeBaseUrl(input.storageBaseUrl)}/put`,
            account,
            "POST",
            JSON.stringify(storagePayload),
          );
          if (!storageResult.success) {
            throw new Error(
              storageResult.error || `storage.put failed with status ${storageResult.status}`,
            );
          }
          aggregateResponse = storageResult.response as StoragePutInvocationResponse;
          aggregateObjectId = aggregateResponse.object_id;
          aggregateResultUrl = absoluteResultUrl(input.storageBaseUrl, aggregateResponse.result_url);
          if (aggregateResponse.payment_tx_hash) {
            payments.push({
              role: "storage_put",
              providerBaseUrl: normalizeBaseUrl(input.storageBaseUrl),
              paymentTxHash: aggregateResponse.payment_tx_hash,
              subjectRef: runId,
            });
          }
        } catch (error) {
          aggregateError = error instanceof Error ? error.message : String(error);
        }
      }

      const recordStatus: EvidenceWorkflowRunRecord["status"] =
        status === "completed" && !aggregateError ? "completed" : "failed";

      const record: EvidenceWorkflowRunRecord = {
        runId,
        title: input.title,
        question: input.question,
        quorumM: input.quorumM,
        quorumN: sourceUrls.length,
        status: recordStatus,
        attemptedCount: sourceUrls.length,
        validCount,
        aggregateObjectId,
        aggregateResultUrl,
        aggregateResponse,
        aggregateError,
        sourceRecords,
        payments,
        createdAt,
        updatedAt: now().toISOString(),
      };
      storeRun(params.db, record);
      return record;
    },
    list(limit) {
      return listRuns(params.db, limit);
    },
    get(runId) {
      return getRun(params.db, runId);
    },
  };
}
