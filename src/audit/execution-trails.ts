import { ulid } from "ulid";
import type { Hex } from "tosdk";

import type {
  ExecutionTrailExecutionKind,
  ExecutionTrailRecord,
  ExecutionTrailSubjectKind,
  OpenFoxDatabase,
} from "../types.js";

type ExecutionReference = {
  executionKind: ExecutionTrailExecutionKind;
  executionRecordId: string;
  executionTxHash?: Hex | null;
  executionReceiptHash?: Hex | null;
};

function uniqueExecutionReferences(
  references: ExecutionReference[],
): ExecutionReference[] {
  const seen = new Set<string>();
  const deduped: ExecutionReference[] = [];
  for (const reference of references) {
    const key = `${reference.executionKind}:${reference.executionRecordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reference);
  }
  return deduped;
}

export function resolveExecutionReferences(params: {
  db: OpenFoxDatabase;
  txHash?: Hex | null | undefined;
  receiptHash?: Hex | null | undefined;
}): ExecutionReference[] {
  const references: ExecutionReference[] = [];

  if (params.txHash) {
    const signer = params.db.findSignerExecutionBySubmittedTxHash(params.txHash);
    if (signer) {
      references.push({
        executionKind: "signer_execution",
        executionRecordId: signer.executionId,
        executionTxHash: signer.submittedTxHash ?? null,
        executionReceiptHash: signer.receiptHash ?? null,
      });
    }
    const paymaster = params.db.findPaymasterAuthorizationBySubmittedTxHash(
      params.txHash,
    );
    if (paymaster) {
      references.push({
        executionKind: "paymaster_authorization",
        executionRecordId: paymaster.authorizationId,
        executionTxHash: paymaster.submittedTxHash ?? null,
        executionReceiptHash: paymaster.receiptHash ?? null,
      });
    }
  }

  if (params.receiptHash) {
    const signer = params.db.findSignerExecutionByReceiptHash(params.receiptHash);
    if (signer) {
      references.push({
        executionKind: "signer_execution",
        executionRecordId: signer.executionId,
        executionTxHash: signer.submittedTxHash ?? null,
        executionReceiptHash: signer.receiptHash ?? null,
      });
    }
    const paymaster = params.db.findPaymasterAuthorizationByReceiptHash(
      params.receiptHash,
    );
    if (paymaster) {
      references.push({
        executionKind: "paymaster_authorization",
        executionRecordId: paymaster.authorizationId,
        executionTxHash: paymaster.submittedTxHash ?? null,
        executionReceiptHash: paymaster.receiptHash ?? null,
      });
    }
  }

  return uniqueExecutionReferences(references);
}

export function bindExecutionTrailsByTransaction(params: {
  db: OpenFoxDatabase;
  subjectKind: ExecutionTrailSubjectKind;
  subjectId: string;
  txHash?: Hex | null | undefined;
  receiptHash?: Hex | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  createdAt?: string | undefined;
}): ExecutionTrailRecord[] {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const references = resolveExecutionReferences({
    db: params.db,
    txHash: params.txHash,
    receiptHash: params.receiptHash,
  });

  const inserted: ExecutionTrailRecord[] = [];
  for (const reference of references) {
    const existing = params.db.listExecutionTrailsForSubject(
      params.subjectKind,
      params.subjectId,
    ).find(
      (item) =>
        item.executionKind === reference.executionKind &&
        item.executionRecordId === reference.executionRecordId,
    );
    const record: ExecutionTrailRecord = {
      trailId: existing?.trailId ?? ulid(),
      subjectKind: params.subjectKind,
      subjectId: params.subjectId,
      executionKind: reference.executionKind,
      executionRecordId: reference.executionRecordId,
      executionTxHash: reference.executionTxHash ?? null,
      executionReceiptHash: reference.executionReceiptHash ?? null,
      linkMode: "direct",
      sourceSubjectKind: null,
      sourceSubjectId: null,
      metadata: params.metadata ?? null,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt: createdAt,
    };
    params.db.upsertExecutionTrail(record);
    inserted.push(record);
  }
  return inserted;
}

export function propagateExecutionTrailsForSubject(params: {
  db: OpenFoxDatabase;
  fromSubjectKind: ExecutionTrailSubjectKind;
  fromSubjectId: string;
  toSubjectKind: ExecutionTrailSubjectKind;
  toSubjectId: string;
  metadata?: Record<string, unknown> | null | undefined;
  createdAt?: string | undefined;
}): ExecutionTrailRecord[] {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const sourceTrails = params.db.listExecutionTrailsForSubject(
    params.fromSubjectKind,
    params.fromSubjectId,
  );
  const inserted: ExecutionTrailRecord[] = [];
  for (const sourceTrail of sourceTrails) {
    const existing = params.db.listExecutionTrailsForSubject(
      params.toSubjectKind,
      params.toSubjectId,
    ).find(
      (item) =>
        item.executionKind === sourceTrail.executionKind &&
        item.executionRecordId === sourceTrail.executionRecordId,
    );
    const record: ExecutionTrailRecord = {
      trailId: existing?.trailId ?? ulid(),
      subjectKind: params.toSubjectKind,
      subjectId: params.toSubjectId,
      executionKind: sourceTrail.executionKind,
      executionRecordId: sourceTrail.executionRecordId,
      executionTxHash: sourceTrail.executionTxHash ?? null,
      executionReceiptHash: sourceTrail.executionReceiptHash ?? null,
      linkMode: "derived",
      sourceSubjectKind: params.fromSubjectKind,
      sourceSubjectId: params.fromSubjectId,
      metadata: params.metadata ?? null,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt: createdAt,
    };
    params.db.upsertExecutionTrail(record);
    inserted.push(record);
  }
  return inserted;
}
