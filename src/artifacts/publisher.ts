import {
  canonicalizeArtifactAnchorSummary,
  hashArtifactAnchorSummary,
  toHex,
  type Address,
  type ArtifactAnchorSummary,
  type Hex,
} from "tosdk";
import {
  bindExecutionTrailsByTransaction,
  propagateExecutionTrailsForSubject,
} from "../audit/execution-trails.js";
import { sendTOSNativeTransfer } from "../tos/client.js";
import type {
  ArtifactAnchorConfig,
  ArtifactAnchorRecord,
  ArtifactRecord,
  OpenFoxDatabase,
  StorageLeaseRecord,
} from "../types.js";

export interface ArtifactAnchorPublisher {
  publish(input: {
    artifact: ArtifactRecord;
    lease: StorageLeaseRecord;
    publisherAddress: Address;
    metadata?: Record<string, unknown>;
  }): Promise<ArtifactAnchorRecord>;
}

export function buildArtifactAnchorRecord(input: {
  artifact: ArtifactRecord;
  lease: StorageLeaseRecord;
  publisherAddress: Address;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}): ArtifactAnchorRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const summary: ArtifactAnchorSummary = {
    version: 1,
    anchorId: `artifact:${input.artifact.artifactId}`,
    artifactId: input.artifact.artifactId,
    kind: input.artifact.kind,
    cid: input.artifact.cid,
    bundleHash: input.artifact.bundleHash,
    leaseId: input.lease.leaseId,
    providerAddress: input.lease.providerAddress,
    requesterAddress: input.lease.requesterAddress,
    sourceUrl: input.artifact.sourceUrl ?? undefined,
    subjectId: input.artifact.subjectId ?? undefined,
    resultDigest: input.artifact.resultDigest ?? undefined,
    createdAt,
    metadata: {
      title: input.artifact.title,
      summary_text: input.artifact.summaryText ?? undefined,
      ...input.metadata,
    },
  };
  return {
    anchorId: summary.anchorId,
    artifactId: input.artifact.artifactId,
    summary,
    summaryHash: hashArtifactAnchorSummary(summary),
    anchorTxHash: null,
    anchorReceipt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createNativeArtifactAnchorPublisher(params: {
  db: OpenFoxDatabase;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: ArtifactAnchorConfig;
  publisherAddress: Address;
  now?: () => Date;
}): ArtifactAnchorPublisher {
  const now = params.now ?? (() => new Date());
  return {
    async publish(input) {
      const nextRecord = buildArtifactAnchorRecord({
        artifact: input.artifact,
        lease: input.lease,
        publisherAddress: input.publisherAddress,
        createdAt: now().toISOString(),
        metadata: input.metadata,
      });
      const existing = params.db.getArtifactAnchorByArtifactId(input.artifact.artifactId);
      if (existing && existing.summaryHash === nextRecord.summaryHash && existing.anchorTxHash) {
        return existing;
      }
      const transfer = await sendTOSNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey: params.privateKey,
        to: params.config.sinkAddress || params.publisherAddress,
        amountWei: 0n,
        gas: BigInt(params.config.gas),
        data: toHex(canonicalizeArtifactAnchorSummary(nextRecord.summary)),
        waitForReceipt: params.config.waitForReceipt,
        receiptTimeoutMs: params.config.receiptTimeoutMs,
      });
      const published: ArtifactAnchorRecord = {
        ...nextRecord,
        anchorTxHash: transfer.txHash as Hex,
        anchorReceipt: transfer.receipt ?? null,
        updatedAt: now().toISOString(),
      };
      params.db.upsertArtifactAnchor(published);
      bindExecutionTrailsByTransaction({
        db: params.db,
        subjectKind: "artifact_anchor",
        subjectId: published.anchorId,
        txHash: published.anchorTxHash ?? undefined,
        metadata: { artifact_id: published.artifactId },
        createdAt: published.updatedAt,
      });
      propagateExecutionTrailsForSubject({
        db: params.db,
        fromSubjectKind: "artifact_anchor",
        fromSubjectId: published.anchorId,
        toSubjectKind: "artifact",
        toSubjectId: published.artifactId,
        metadata: { via: "artifact_anchor", anchor_id: published.anchorId },
        createdAt: published.updatedAt,
      });
      return published;
    },
  };
}
