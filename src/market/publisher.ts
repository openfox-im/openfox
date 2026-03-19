import type {
  Address,
  Hex,
  MarketBindingReceipt,
} from "@tosnetwork/tosdk";
import {
  hashMarketBindingReceipt,
} from "@tosnetwork/tosdk";
import type {
  MarketBindingKind,
  MarketBindingRecord,
  OpenFoxDatabase,
} from "../types.js";

export interface MarketBindingPublicationInput {
  kind: MarketBindingKind;
  subjectId: string;
  publisherAddress: Address;
  capability?: string;
  requesterAddress?: Address | null;
  artifactUrl?: string | null;
  paymentTxHash?: Hex | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface MarketBindingPublisher {
  publish(input: MarketBindingPublicationInput): MarketBindingRecord;
}

export function buildMarketBindingRecord(
  input: MarketBindingPublicationInput,
): MarketBindingRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const bindingId = `${input.kind}:${input.subjectId}`;
  const receipt: MarketBindingReceipt = {
    version: 1,
    bindingId,
    kind: input.kind,
    subjectId: input.subjectId,
    capability: input.capability,
    publisherAddress: input.publisherAddress,
    requesterAddress: input.requesterAddress ?? undefined,
    paymentTxHash: input.paymentTxHash ?? undefined,
    artifactUrl: input.artifactUrl ?? undefined,
    createdAt,
    metadata: input.metadata,
  };

  return {
    bindingId,
    kind: input.kind,
    subjectId: input.subjectId,
    receipt,
    receiptHash: hashMarketBindingReceipt(receipt),
    callbackTarget: null,
    callbackTxHash: null,
    callbackReceipt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createMarketBindingPublisher(params: {
  db: OpenFoxDatabase;
  now?: () => Date;
}): MarketBindingPublisher {
  const now = params.now ?? (() => new Date());

  return {
    publish(input) {
      const nextRecord = buildMarketBindingRecord({
        ...input,
        createdAt: input.createdAt ?? now().toISOString(),
      });
      const existing = params.db.getMarketBinding(
        nextRecord.kind,
        nextRecord.subjectId,
      );
      if (existing && existing.receiptHash === nextRecord.receiptHash) {
        return existing;
      }
      params.db.upsertMarketBinding(nextRecord);
      return nextRecord;
    },
  };
}
