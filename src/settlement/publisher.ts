import {
  canonicalizeSettlementReceipt,
  hashSettlementReceipt,
  hashSettlementValue,
  toHex,
  type Address,
  type Hex,
  type SettlementReceipt,
} from "@tosnetwork/tosdk";
import {
  sendNativeTransfer,
} from "../chain/client.js";
import type {
  OpenFoxDatabase,
  SettlementConfig,
  SettlementKind,
  SettlementRecord,
} from "../types.js";

export interface SettlementPublicationInput {
  kind: SettlementKind;
  subjectId: string;
  publisherAddress: Address;
  capability?: string;
  solverAddress?: Address | null;
  payerAddress?: Address | null;
  artifactUrl?: string | null;
  paymentTxHash?: Hex | null;
  payoutTxHash?: Hex | null;
  runtimeReceiptRef?: Hex | null;
  runtimeSettlementRef?: Hex | null;
  result: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface SettlementPublisher {
  publish(input: SettlementPublicationInput): Promise<SettlementRecord>;
}

export function buildSettlementReceiptRecord(
  input: SettlementPublicationInput,
): SettlementRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const receiptId = `${input.kind}:${input.subjectId}`;
  const receipt: SettlementReceipt = {
    version: 1,
    receiptId,
    kind: input.kind,
    subjectId: input.subjectId,
    capability: input.capability,
    publisherAddress: input.publisherAddress,
    solverAddress: input.solverAddress ?? undefined,
    payerAddress: input.payerAddress ?? undefined,
    resultHash: hashSettlementValue(input.result),
    artifactUrl: input.artifactUrl ?? undefined,
    paymentTxHash: input.paymentTxHash ?? undefined,
    payoutTxHash: input.payoutTxHash ?? undefined,
    createdAt,
    metadata: input.metadata,
  };

  return {
    receiptId,
    kind: input.kind,
    subjectId: input.subjectId,
    receipt,
    receiptHash: hashSettlementReceipt(receipt),
    artifactUrl: input.artifactUrl ?? null,
    paymentTxHash: input.paymentTxHash ?? null,
    payoutTxHash: input.payoutTxHash ?? null,
    settlementTxHash: null,
    settlementReceipt: null,
    runtimeReceiptRef: input.runtimeReceiptRef ?? null,
    runtimeSettlementRef: input.runtimeSettlementRef ?? null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createNativeSettlementPublisher(params: {
  db: OpenFoxDatabase;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: SettlementConfig;
  publisherAddress: Address;
  now?: () => Date;
}): SettlementPublisher {
  const now = params.now ?? (() => new Date());

  return {
    async publish(input) {
      const nextRecord = buildSettlementReceiptRecord({
        ...input,
        createdAt: input.createdAt ?? now().toISOString(),
      });
      const existing = params.db.getSettlementReceipt(
        nextRecord.kind,
        nextRecord.subjectId,
      );
      if (
        existing &&
        existing.receiptHash === nextRecord.receiptHash &&
        existing.settlementTxHash
      ) {
        return existing;
      }

      const canonicalReceipt = canonicalizeSettlementReceipt(nextRecord.receipt);
      const transfer = await sendNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey: params.privateKey,
        to: params.config.sinkAddress || params.publisherAddress,
        amountTomi: 0n,
        gas: BigInt(params.config.gas),
        data: toHex(canonicalReceipt),
        waitForReceipt: params.config.waitForReceipt,
        receiptTimeoutMs: params.config.receiptTimeoutMs,
      });

      const published: SettlementRecord = {
        ...nextRecord,
        settlementTxHash: transfer.txHash,
        settlementReceipt: transfer.receipt ?? null,
        updatedAt: now().toISOString(),
      };
      params.db.upsertSettlementReceipt(published);
      return published;
    },
  };
}
