import {
  hashArtifactValue,
  hashArtifactVerificationReceipt,
  hashStorageReceipt,
  type Address,
  type ArtifactBundleKind,
  type ArtifactVerificationReceipt,
  type PrivateKeyAccount,
  type StorageReceipt,
} from "@tosnetwork/tosdk";
import { ulid } from "ulid";
import {
  buildBundleFromEntries,
  type StorageBundle,
} from "../storage/bundle.js";
import {
  auditStoredBundle,
  getStorageHead,
  storePreparedBundleWithProvider,
} from "../storage/client.js";
import { propagateExecutionTrailsForSubject } from "../audit/execution-trails.js";
import type {
  ArtifactAnchorRecord,
  ArtifactPipelineConfig,
  ArtifactRecord,
  ArtifactSearchFilters,
  ArtifactVerificationRecord,
  OpenFoxDatabase,
  OpenFoxIdentity,
  StorageLeaseRecord,
  StorageQuoteRecord,
} from "../types.js";
import type { ArtifactAnchorPublisher } from "./publisher.js";

export interface ArtifactManager {
  capturePublicNews(input: {
    providerBaseUrl?: string;
    title: string;
    sourceUrl: string;
    headline: string;
    bodyText: string;
    capturedAt?: string;
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }): Promise<{
    artifact: ArtifactRecord;
    lease: Awaited<ReturnType<typeof getStorageHead>>;
    anchor?: ArtifactAnchorRecord | null;
  }>;
  createOracleEvidence(input: {
    providerBaseUrl?: string;
    title: string;
    question: string;
    evidenceText: string;
    sourceUrl?: string;
    relatedArtifactIds?: string[];
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }): Promise<{
    artifact: ArtifactRecord;
    lease: Awaited<ReturnType<typeof getStorageHead>>;
    anchor?: ArtifactAnchorRecord | null;
  }>;
  createOracleAggregate(input: {
    providerBaseUrl?: string;
    title: string;
    question: string;
    resultText: string;
    committeeVotes?: Array<Record<string, unknown>>;
    evidenceArtifactIds?: string[];
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }): Promise<{
    artifact: ArtifactRecord;
    lease: Awaited<ReturnType<typeof getStorageHead>>;
    anchor?: ArtifactAnchorRecord | null;
  }>;
  createCommitteeVote(input: {
    providerBaseUrl?: string;
    title: string;
    question: string;
    voterId: string;
    voteText: string;
    evidenceArtifactIds?: string[];
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }): Promise<{
    artifact: ArtifactRecord;
    lease: Awaited<ReturnType<typeof getStorageHead>>;
    anchor?: ArtifactAnchorRecord | null;
  }>;
  verifyArtifact(input: {
    artifactId: string;
  }): Promise<{
    artifact: ArtifactRecord;
    verification: ArtifactVerificationRecord;
    audit: Awaited<ReturnType<typeof auditStoredBundle>>;
  }>;
  anchorArtifact(input: {
    artifactId: string;
    metadata?: Record<string, unknown>;
  }): Promise<ArtifactAnchorRecord>;
  listArtifacts(limit: number, filters?: ArtifactSearchFilters): ArtifactRecord[];
  getArtifact(artifactId: string): ArtifactRecord | undefined;
}

export interface ArtifactStorageDriver {
  quote(input: {
    providerBaseUrl: string;
    bundleKind: ArtifactBundleKind;
    requesterAddress: Address;
    ttlSeconds: number;
    cid: string;
    sizeBytes: number;
  }): Promise<{
    quote_id: string;
    provider_address: Address;
    requester_address: Address;
    cid: string;
    bundle_kind: string;
    size_bytes: number;
    ttl_seconds: number;
    amount_tomi: string;
    expires_at: string;
  }>;
  put(input: {
    providerBaseUrl: string;
    bundleKind: ArtifactBundleKind;
    bundle: StorageBundle;
    cid: string;
    requesterAccount: PrivateKeyAccount;
    requesterAddress: Address;
    ttlSeconds: number;
    quoteId?: string;
  }): Promise<Awaited<ReturnType<typeof storePreparedBundleWithProvider>>>;
  head(input: {
    providerBaseUrl: string;
    cid: string;
  }): Promise<Awaited<ReturnType<typeof getStorageHead>>>;
  audit(input: {
    providerBaseUrl: string;
    leaseId: string;
  }): Promise<Awaited<ReturnType<typeof auditStoredBundle>>>;
}

function normalizeProviderBaseUrl(
  providerBaseUrl: string | undefined,
  config: ArtifactPipelineConfig,
): string {
  const resolved = providerBaseUrl || config.defaultProviderBaseUrl;
  if (!resolved) {
    throw new Error("provider base URL is required");
  }
  return resolved.replace(/\/+$/, "");
}

async function storeArtifactBundle(params: {
  providerBaseUrl: string;
  bundleKind: ArtifactBundleKind;
  bundle: StorageBundle;
  cid: string;
  requesterAccount: PrivateKeyAccount;
  requesterAddress: Address;
  ttlSeconds: number;
  storageDriver: ArtifactStorageDriver;
}) {
  const canonicalProviderBaseUrl = normalizeProviderBaseUrl(params.providerBaseUrl, {
    enabled: true,
    publishToDiscovery: false,
    defaultProviderBaseUrl: params.providerBaseUrl,
    defaultTtlSeconds: params.ttlSeconds,
    autoAnchorOnStore: false,
    captureCapability: "public_news.capture",
    evidenceCapability: "oracle.evidence",
    aggregateCapability: "oracle.aggregate",
    verificationCapability: "artifact.verify",
    service: {
      enabled: false,
      bindHost: "127.0.0.1",
      port: 0,
      pathPrefix: "/artifacts",
      requireNativeIdentity: true,
      maxBodyBytes: 256 * 1024,
      maxTextChars: 32 * 1024,
    },
    anchor: {
      enabled: false,
      gas: "0",
      waitForReceipt: false,
      receiptTimeoutMs: 0,
    },
  });
  const payloadJson = JSON.stringify(params.bundle);
  const quote = await params.storageDriver.quote({
    providerBaseUrl: canonicalProviderBaseUrl,
    bundleKind: params.bundleKind,
    requesterAddress: params.requesterAddress,
    ttlSeconds: params.ttlSeconds,
    cid: params.cid,
    sizeBytes: Buffer.byteLength(payloadJson),
  });
  const lease = await params.storageDriver.put({
    providerBaseUrl: canonicalProviderBaseUrl,
    bundleKind: params.bundleKind,
    bundle: params.bundle,
    cid: params.cid,
    requesterAccount: params.requesterAccount,
    requesterAddress: params.requesterAddress,
    ttlSeconds: params.ttlSeconds,
    quoteId: quote.quote_id,
  });
  const head = await params.storageDriver.head({
    providerBaseUrl: canonicalProviderBaseUrl,
    cid: params.cid,
  });
  return {
    providerBaseUrl: canonicalProviderBaseUrl,
    quote,
    lease,
    head,
  };
}

async function requestStorageQuoteFromPreparedBundle(params: {
  providerBaseUrl: string;
  bundleKind: string;
  requesterAddress: string;
  ttlSeconds: number;
  cid: string;
  sizeBytes: number;
}) {
  const response = await fetch(`${params.providerBaseUrl}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cid: params.cid,
      bundle_kind: params.bundleKind,
      size_bytes: params.sizeBytes,
      ttl_seconds: params.ttlSeconds,
      requester_address: params.requesterAddress,
    }),
  });
  if (!response.ok) {
    throw new Error(`storage quote failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as {
    quote_id: string;
    provider_address: Address;
    requester_address: Address;
    cid: string;
    bundle_kind: string;
    size_bytes: number;
    ttl_seconds: number;
    amount_tomi: string;
    expires_at: string;
  };
}

function createArtifactRecord(params: {
  kind: ArtifactBundleKind;
  title: string;
  storage: Awaited<ReturnType<typeof storeArtifactBundle>>;
  identity: OpenFoxIdentity;
  sourceUrl?: string;
  subjectId?: string;
  summaryText?: string;
  resultDigest?: `0x${string}`;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): ArtifactRecord {
  const createdAt = params.createdAt ?? new Date().toISOString();
  return {
    artifactId: ulid(),
    kind: params.kind,
    title: params.title,
    leaseId: params.storage.lease.lease_id,
    quoteId: params.storage.quote.quote_id,
    cid: params.storage.lease.cid,
    bundleHash: params.storage.lease.bundle_hash as `0x${string}`,
    providerBaseUrl: params.storage.providerBaseUrl,
    providerAddress: params.storage.quote.provider_address as Address,
    requesterAddress: params.identity.address,
    sourceUrl: params.sourceUrl ?? null,
    subjectId: params.subjectId ?? null,
    summaryText: params.summaryText ?? null,
    resultDigest: params.resultDigest ?? null,
    metadata: params.metadata ?? null,
    status: "stored",
    verificationId: null,
    anchorId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function createStorageQuoteRecord(params: {
  storedAt: string;
  storage: Awaited<ReturnType<typeof storeArtifactBundle>>;
}): StorageQuoteRecord {
  return {
    quoteId: params.storage.quote.quote_id,
    requesterAddress: params.storage.quote.requester_address,
    providerAddress: params.storage.quote.provider_address,
    cid: params.storage.quote.cid,
    bundleKind: params.storage.quote.bundle_kind,
    sizeBytes: params.storage.quote.size_bytes,
    ttlSeconds: params.storage.quote.ttl_seconds,
    amountTomi: params.storage.quote.amount_tomi,
    status: "used",
    expiresAt: params.storage.quote.expires_at,
    createdAt: params.storedAt,
    updatedAt: params.storedAt,
  };
}

function createStorageLeaseRecord(params: {
  storedAt: string;
  storage: Awaited<ReturnType<typeof storeArtifactBundle>>;
}): StorageLeaseRecord {
  const receipt: StorageReceipt = {
    version: 1,
    receiptId: params.storage.head.receipt_id,
    leaseId: params.storage.head.lease_id,
    cid: params.storage.head.cid,
    bundleHash: params.storage.head.bundle_hash as `0x${string}`,
    bundleKind: params.storage.head.bundle_kind,
    providerAddress: params.storage.quote.provider_address,
    requesterAddress: params.storage.quote.requester_address,
    sizeBytes: params.storage.head.size_bytes,
    ttlSeconds: params.storage.head.ttl_seconds,
    amountTomi: params.storage.head.amount_tomi,
    status: "active",
    issuedAt: params.storage.head.issued_at,
    expiresAt: params.storage.head.expires_at,
    artifactUrl: params.storage.head.get_url,
    paymentTxHash: (params.storage.lease.payment_tx_hash as `0x${string}` | undefined) ?? null,
  };
  return {
    leaseId: params.storage.head.lease_id,
    quoteId: params.storage.quote.quote_id,
    cid: params.storage.head.cid,
    bundleHash: params.storage.head.bundle_hash as `0x${string}`,
    bundleKind: params.storage.head.bundle_kind,
    requesterAddress: params.storage.quote.requester_address,
    providerAddress: params.storage.quote.provider_address,
    providerBaseUrl: params.storage.providerBaseUrl,
    sizeBytes: params.storage.head.size_bytes,
    ttlSeconds: params.storage.head.ttl_seconds,
    amountTomi: params.storage.head.amount_tomi,
    status: "active",
    storagePath: params.storage.head.get_url,
    requestKey: `artifact:${params.storage.head.lease_id}`,
    paymentId: null,
    receipt,
    receiptHash: hashStorageReceipt(receipt),
    anchorTxHash: (params.storage.head.anchor_tx_hash as `0x${string}` | undefined) ?? null,
    anchorReceipt: null,
    createdAt: params.storedAt,
    updatedAt: params.storedAt,
  };
}

export function createArtifactManager(params: {
  identity: OpenFoxIdentity;
  requesterAccount: PrivateKeyAccount;
  db: OpenFoxDatabase;
  config: ArtifactPipelineConfig;
  anchorPublisher?: ArtifactAnchorPublisher;
  now?: () => Date;
  storageDriver?: Partial<ArtifactStorageDriver>;
}): ArtifactManager {
  const now = params.now ?? (() => new Date());
  const storageDriver: ArtifactStorageDriver = {
    quote: requestStorageQuoteFromPreparedBundle,
    put: storePreparedBundleWithProvider,
    head: getStorageHead,
    audit: auditStoredBundle,
    ...params.storageDriver,
  };

  async function maybeAnchor(
    artifact: ArtifactRecord,
    autoAnchor: boolean | undefined,
  ): Promise<ArtifactAnchorRecord | null> {
    if (!params.anchorPublisher) return null;
    if (!(autoAnchor ?? params.config.autoAnchorOnStore)) return null;
    return anchorArtifact({ artifactId: artifact.artifactId });
  }

  async function anchorArtifact(input: {
    artifactId: string;
    metadata?: Record<string, unknown>;
  }): Promise<ArtifactAnchorRecord> {
    const artifact = params.db.getArtifact(input.artifactId);
    if (!artifact) {
      throw new Error(`artifact not found: ${input.artifactId}`);
    }
    const lease = params.db.getStorageLease(artifact.leaseId);
    if (!lease) {
      throw new Error(`storage lease not found for artifact: ${input.artifactId}`);
    }
    if (!params.anchorPublisher) {
      throw new Error("artifact anchoring is not configured");
    }
    const anchor = await params.anchorPublisher.publish({
      artifact,
      lease,
      publisherAddress: params.identity.address,
      metadata: input.metadata,
    });
    params.db.upsertArtifact({
      ...artifact,
      status: "anchored",
      anchorId: anchor.anchorId,
      updatedAt: now().toISOString(),
    });
    return anchor;
  }

  async function persistStoredArtifact(input: {
    kind: ArtifactBundleKind;
    title: string;
    built: Awaited<ReturnType<typeof buildBundleFromEntries>>;
    providerBaseUrl: string;
    ttlSeconds: number;
    sourceUrl?: string;
    subjectId?: string;
    summaryText?: string;
    resultDigest?: `0x${string}`;
    metadata?: Record<string, unknown>;
    autoAnchor?: boolean;
  }) {
    const storedAt = now().toISOString();
    const storage = await storeArtifactBundle({
      providerBaseUrl: input.providerBaseUrl,
      bundleKind: input.kind,
      bundle: input.built.bundle,
      cid: input.built.cid,
      requesterAccount: params.requesterAccount,
      requesterAddress: params.identity.address,
      ttlSeconds: input.ttlSeconds,
      storageDriver,
    });
    params.db.upsertStorageQuote(
      createStorageQuoteRecord({
        storedAt,
        storage,
      }),
    );
    params.db.upsertStorageLease(
      createStorageLeaseRecord({
        storedAt,
        storage,
      }),
    );
    const artifact = createArtifactRecord({
      kind: input.kind,
      title: input.title,
      storage,
      identity: params.identity,
      sourceUrl: input.sourceUrl,
      subjectId: input.subjectId,
      summaryText: input.summaryText,
      resultDigest: input.resultDigest,
      metadata: input.metadata,
      createdAt: storedAt,
    });
    params.db.upsertArtifact(artifact);
    const anchor = await maybeAnchor(artifact, input.autoAnchor);
    return {
      artifact: anchor
        ? (params.db.getArtifact(artifact.artifactId) ?? artifact)
        : artifact,
      lease: storage.head,
      anchor,
    };
  }

  async function capturePublicNews(input: {
    providerBaseUrl?: string;
    title: string;
    sourceUrl: string;
    headline: string;
    bodyText: string;
    capturedAt?: string;
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }) {
    const capturedAt = input.capturedAt ?? now().toISOString();
    const built = await buildBundleFromEntries({
      bundleKind: "public_news.capture",
      createdBy: params.identity.address,
      createdAt: capturedAt,
      payload: [
        {
          path: "capture.json",
          mediaType: "application/json",
          content: {
            source_url: input.sourceUrl,
            headline: input.headline,
            body_text: input.bodyText,
            captured_at: capturedAt,
          },
        },
      ],
      metadata: [
        {
          path: "summary.json",
          mediaType: "application/json",
          content: {
            title: input.title,
            headline: input.headline,
            source_url: input.sourceUrl,
          },
        },
      ],
    });
    return persistStoredArtifact({
      kind: "public_news.capture",
      title: input.title,
      built,
      providerBaseUrl: normalizeProviderBaseUrl(input.providerBaseUrl, params.config),
      ttlSeconds: input.ttlSeconds ?? params.config.defaultTtlSeconds,
      sourceUrl: input.sourceUrl,
      summaryText: input.headline,
      resultDigest: hashArtifactValue({
        source_url: input.sourceUrl,
        headline: input.headline,
        body_text: input.bodyText,
      }),
      metadata: {
        captured_at: capturedAt,
      },
      autoAnchor: input.autoAnchor,
    });
  }

  async function createOracleEvidence(input: {
    providerBaseUrl?: string;
    title: string;
    question: string;
    evidenceText: string;
    sourceUrl?: string;
    relatedArtifactIds?: string[];
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }) {
    const built = await buildBundleFromEntries({
      bundleKind: "oracle.evidence",
      createdBy: params.identity.address,
      createdAt: now().toISOString(),
      payload: [
        {
          path: "evidence.json",
          mediaType: "application/json",
          content: {
            question: input.question,
            evidence_text: input.evidenceText,
            source_url: input.sourceUrl,
            related_artifact_ids: input.relatedArtifactIds ?? [],
          },
        },
      ],
      metadata: [
        {
          path: "summary.json",
          mediaType: "application/json",
          content: {
            title: input.title,
            question: input.question,
            source_url: input.sourceUrl,
          },
        },
      ],
    });
    return persistStoredArtifact({
      kind: "oracle.evidence",
      title: input.title,
      built,
      providerBaseUrl: normalizeProviderBaseUrl(input.providerBaseUrl, params.config),
      ttlSeconds: input.ttlSeconds ?? params.config.defaultTtlSeconds,
      sourceUrl: input.sourceUrl,
      subjectId: input.question,
      summaryText: input.question,
      resultDigest: hashArtifactValue({
        question: input.question,
        evidence_text: input.evidenceText,
        related_artifact_ids: input.relatedArtifactIds ?? [],
      }),
      metadata: {
        related_artifact_ids: input.relatedArtifactIds ?? [],
      },
      autoAnchor: input.autoAnchor,
    });
  }

  async function createOracleAggregate(input: {
    providerBaseUrl?: string;
    title: string;
    question: string;
    resultText: string;
    committeeVotes?: Array<Record<string, unknown>>;
    evidenceArtifactIds?: string[];
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }) {
    const built = await buildBundleFromEntries({
      bundleKind: "oracle.aggregate",
      createdBy: params.identity.address,
      createdAt: now().toISOString(),
      payload: [
        {
          path: "aggregate.json",
          mediaType: "application/json",
          content: {
            question: input.question,
            result_text: input.resultText,
            evidence_artifact_ids: input.evidenceArtifactIds ?? [],
          },
        },
      ],
      proofs: (input.committeeVotes ?? []).length
        ? [
            {
              path: "committee-votes.json",
              mediaType: "application/json",
              content: {
                votes: input.committeeVotes,
              },
            },
          ]
        : [],
      metadata: [
        {
          path: "summary.json",
          mediaType: "application/json",
          content: {
            title: input.title,
            question: input.question,
            result_text: input.resultText,
          },
        },
      ],
    });
    return persistStoredArtifact({
      kind: "oracle.aggregate",
      title: input.title,
      built,
      providerBaseUrl: normalizeProviderBaseUrl(input.providerBaseUrl, params.config),
      ttlSeconds: input.ttlSeconds ?? params.config.defaultTtlSeconds,
      subjectId: input.question,
      summaryText: input.resultText,
      resultDigest: hashArtifactValue({
        question: input.question,
        result_text: input.resultText,
        committee_votes: input.committeeVotes ?? [],
        evidence_artifact_ids: input.evidenceArtifactIds ?? [],
      }),
      metadata: {
        committee_votes: input.committeeVotes ?? [],
        evidence_artifact_ids: input.evidenceArtifactIds ?? [],
      },
      autoAnchor: input.autoAnchor,
    });
  }

  async function createCommitteeVote(input: {
    providerBaseUrl?: string;
    title: string;
    question: string;
    voterId: string;
    voteText: string;
    evidenceArtifactIds?: string[];
    ttlSeconds?: number;
    autoAnchor?: boolean;
  }) {
    const built = await buildBundleFromEntries({
      bundleKind: "committee.vote",
      createdBy: params.identity.address,
      createdAt: now().toISOString(),
      payload: [
        {
          path: "vote.json",
          mediaType: "application/json",
          content: {
            question: input.question,
            voter_id: input.voterId,
            vote_text: input.voteText,
            evidence_artifact_ids: input.evidenceArtifactIds ?? [],
          },
        },
      ],
      metadata: [
        {
          path: "summary.json",
          mediaType: "application/json",
          content: {
            title: input.title,
            question: input.question,
            voter_id: input.voterId,
          },
        },
      ],
    });
    return persistStoredArtifact({
      kind: "committee.vote",
      title: input.title,
      built,
      providerBaseUrl: normalizeProviderBaseUrl(input.providerBaseUrl, params.config),
      ttlSeconds: input.ttlSeconds ?? params.config.defaultTtlSeconds,
      subjectId: input.question,
      summaryText: input.voteText,
      resultDigest: hashArtifactValue({
        question: input.question,
        voter_id: input.voterId,
        vote_text: input.voteText,
        evidence_artifact_ids: input.evidenceArtifactIds ?? [],
      }),
      metadata: {
        voter_id: input.voterId,
        evidence_artifact_ids: input.evidenceArtifactIds ?? [],
      },
      autoAnchor: input.autoAnchor,
    });
  }

  async function verifyArtifact(input: { artifactId: string }) {
    const artifact = params.db.getArtifact(input.artifactId);
    if (!artifact) {
      throw new Error(`artifact not found: ${input.artifactId}`);
    }
    const lease = params.db.getStorageLease(artifact.leaseId);
    if (!lease) {
      throw new Error(`storage lease not found for artifact: ${input.artifactId}`);
    }
    const head = await storageDriver.head({
      providerBaseUrl: artifact.providerBaseUrl,
      cid: artifact.cid,
    });
    const audit = await storageDriver.audit({
      providerBaseUrl: artifact.providerBaseUrl,
      leaseId: artifact.leaseId,
    });
    const status =
      audit.status === "verified" &&
      head.cid === artifact.cid &&
      head.bundle_hash === artifact.bundleHash
        ? "verified"
        : "failed";
    const receipt: ArtifactVerificationReceipt = {
      version: 1,
      verificationId: ulid(),
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      cid: artifact.cid,
      leaseId: artifact.leaseId,
      bundleHash: artifact.bundleHash,
      verifierAddress: params.identity.address,
      status,
      responseHash: audit.response_hash as `0x${string}`,
      checkedAt: now().toISOString(),
      metadata: {
        provider_base_url: artifact.providerBaseUrl,
        audit_id: audit.audit_id,
      },
    };
    const verification: ArtifactVerificationRecord = {
      verificationId: receipt.verificationId,
      artifactId: artifact.artifactId,
      receipt,
      receiptHash: hashArtifactVerificationReceipt(receipt),
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    params.db.upsertArtifactVerification(verification);
    propagateExecutionTrailsForSubject({
      db: params.db,
      fromSubjectKind: "storage_lease",
      fromSubjectId: artifact.leaseId,
      toSubjectKind: "artifact_verification",
      toSubjectId: verification.verificationId,
      metadata: {
        via: "storage_lease",
        artifact_id: artifact.artifactId,
        lease_id: artifact.leaseId,
      },
      createdAt: verification.updatedAt,
    });
    propagateExecutionTrailsForSubject({
      db: params.db,
      fromSubjectKind: "artifact",
      fromSubjectId: artifact.artifactId,
      toSubjectKind: "artifact_verification",
      toSubjectId: verification.verificationId,
      metadata: { via: "artifact", artifact_id: artifact.artifactId },
      createdAt: verification.updatedAt,
    });
    params.db.upsertArtifact({
      ...artifact,
      status: status === "verified" ? "verified" : "failed",
      verificationId: verification.verificationId,
      updatedAt: now().toISOString(),
    });
    return {
      artifact: params.db.getArtifact(artifact.artifactId) ?? artifact,
      verification,
      audit,
    };
  }

  return {
    capturePublicNews,
    createOracleEvidence,
    createOracleAggregate,
    createCommitteeVote,
    verifyArtifact,
    anchorArtifact,
    listArtifacts(limit, filters) {
      return params.db.listArtifacts(limit, filters);
    },
    getArtifact(artifactId) {
      return params.db.getArtifact(artifactId);
    },
  };
}
